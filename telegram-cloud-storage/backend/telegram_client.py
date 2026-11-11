"""Storage backends: where the chunk bytes actually live.

`StorageBackend` is the small interface the rest of the app uses. Two implementations:
- `TelethonBackend`: a private Telegram channel, through Telethon (MTProto). It works with a bot token or a user account.
  MTProto is used instead of the HTTP Bot API because the HTTP Bot API caps uploads at 50 MB and downloads at 20 MB.
- `LocalDirBackend`: a plain folder on disk that behaves like the channel. It exists for tests, development and demos, so
  nothing in the app needs a Telegram account to be exercised. It is never used unless asked for.

Every Telegram call goes through `with_retries`, which sleeps out FLOOD_WAIT_X limits (and retries brief network
errors with exponential backoff) instead of failing a multi-gigabyte upload half way.
"""
from __future__ import annotations

import abc
import asyncio
import io
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import AsyncIterator, Awaitable, Callable, TypeVar

T = TypeVar("T")
ByteProgress = Callable[[int, int], None]
WaitNotice = Callable[[float, str], None]


class StorageError(Exception):
    """Base class for backend problems. `code` is mapped to an HTTP status by the API."""

    code = "storage_error"


class NotConfigured(StorageError):
    code = "not_configured"


class NotAuthorized(StorageError):
    code = "not_authorized"


class NeedPassword(StorageError):
    code = "password_required"


class FloodWaitTooLong(StorageError):
    code = "flood_wait_too_long"


class ChunkMissing(StorageError):
    code = "chunk_missing"


@dataclass(frozen=True)
class UploadedChunk:
    file_id: str
    message_id: int


@dataclass(frozen=True)
class RemoteChunk:
    message_id: int
    file_id: str
    size: int
    caption: str | None


# ---- flood wait and retry ----------------------------------------------------------------------------------------------
_FLOOD_TEXT = re.compile(r"(?:FLOOD|SLOWMODE)_?WAIT_?(\d+)", re.I)
TRANSIENT = (ConnectionError, TimeoutError, asyncio.TimeoutError)


def flood_wait_seconds(exc: BaseException) -> int | None:
    """Seconds Telegram asks us to wait, or None if `exc` is not a flood-wait error.

    Telethon's FloodWaitError has `.seconds`; Pyrogram's has `.value`; some wrappers only put it in the message.
    """
    name = type(exc).__name__.lower()
    if "floodwait" in name or "slowmodewait" in name or "flood" in name:
        for attr in ("seconds", "value", "x"):
            value = getattr(exc, attr, None)
            if isinstance(value, (int, float)) and value >= 0:
                return int(value)
    match = _FLOOD_TEXT.search(str(exc))
    return int(match.group(1)) if match else None


async def with_retries(
    operation: Callable[[], Awaitable[T]], *, attempts: int = 6, max_flood_wait: float = 900.0, base_delay: float = 1.0,
    max_delay: float = 30.0, sleep: Callable[[float], Awaitable[None]] = asyncio.sleep, on_wait: WaitNotice | None = None,
) -> T:
    """Run `operation()`; on FLOOD_WAIT_X wait X (+1) seconds and retry, on a network blip back off exponentially.

    `operation` is a function that creates a *fresh* coroutine each call (a coroutine can only be awaited once).
    Flood waits longer than `max_flood_wait` are not slept out: they raise `FloodWaitTooLong` so the UI can tell the user.
    """
    for attempt in range(1, attempts + 1):
        try:
            return await operation()
        except asyncio.CancelledError:
            raise
        except BaseException as exc:  # noqa: BLE001 - classified below, everything else is re-raised unchanged
            wait = flood_wait_seconds(exc)
            if wait is not None:
                if wait > max_flood_wait:
                    raise FloodWaitTooLong(f"Telegram asked us to wait {wait} s; that is longer than the {int(max_flood_wait)} s limit.") from exc
                if attempt == attempts:
                    raise
                if on_wait:
                    on_wait(wait + 1, "flood_wait")
                await sleep(wait + 1)
            elif isinstance(exc, TRANSIENT):
                if attempt == attempts:
                    raise
                delay = min(max_delay, base_delay * 2 ** (attempt - 1))
                if on_wait:
                    on_wait(delay, "retry")
                await sleep(delay)
            else:
                raise
    raise AssertionError("unreachable")


# ---- interface ---------------------------------------------------------------------------------------------------------
class StorageBackend(abc.ABC):
    name = "backend"

    @abc.abstractmethod
    async def connect(self) -> None: ...

    @abc.abstractmethod
    async def close(self) -> None: ...

    @abc.abstractmethod
    async def status(self) -> dict: ...

    @abc.abstractmethod
    async def upload_chunk(self, name: str, data: bytes, caption: str, progress: ByteProgress | None = None) -> UploadedChunk: ...

    @abc.abstractmethod
    def download_chunk(self, message_id: int) -> AsyncIterator[bytes]: ...

    @abc.abstractmethod
    async def delete_messages(self, message_ids: list[int]) -> int: ...

    @abc.abstractmethod
    def iter_remote_chunks(self) -> AsyncIterator[RemoteChunk]: ...

    def set_wait_notice(self, notice: WaitNotice | None) -> None:
        """The service installs a callback so the UI can show "waiting 30 s for Telegram"."""
        self._notice = notice

    _notice: WaitNotice | None = None


# ---- local folder backend (tests, development, demos) ------------------------------------------------------------------
class LocalDirBackend(StorageBackend):
    """A folder that behaves like the channel: numbered messages, each holding a document and a caption."""

    name = "local"

    def __init__(self, root: str | os.PathLike, bytes_per_second: float | None = None) -> None:
        self.root = Path(root)
        self.bytes_per_second = bytes_per_second  # throttle, so progress bars are visible in demos
        self._lock = asyncio.Lock()
        self._counter = 0

    async def connect(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)

    async def close(self) -> None:
        return None

    async def status(self) -> dict:
        return {"backend": self.name, "authorized": True, "ready": True, "channel": str(self.root)}

    def _next_id(self) -> int:
        # message ids only ever go up, even after deletes, like on Telegram; the counter makes concurrent uploads safe
        on_disk = max((int(p.stem) for p in self.root.glob("*.bin") if p.stem.isdigit()), default=0)
        self._counter = max(self._counter, on_disk) + 1
        return self._counter

    async def upload_chunk(self, name: str, data: bytes, caption: str, progress: ByteProgress | None = None) -> UploadedChunk:
        async with self._lock:
            message_id = self._next_id()
        total, step, done = len(data), 256 * 1024, 0
        while done < total:
            part = min(step, total - done)
            done += part
            if self.bytes_per_second:
                await asyncio.sleep(part / self.bytes_per_second)
            if progress:
                progress(done, total)
        (self.root / f"{message_id}.json").write_text(json.dumps({"name": name, "caption": caption}), encoding="utf-8")
        tmp = self.root / f"{message_id}.bin.tmp"
        tmp.write_bytes(data)
        os.replace(tmp, self.root / f"{message_id}.bin")
        return UploadedChunk(file_id=f"local-{message_id}", message_id=message_id)

    async def download_chunk(self, message_id: int) -> AsyncIterator[bytes]:
        path = self.root / f"{message_id}.bin"
        if not path.exists():
            raise ChunkMissing(f"Message {message_id} is not in the storage folder.")
        with open(path, "rb") as fh:
            while block := fh.read(256 * 1024):
                if self.bytes_per_second:
                    await asyncio.sleep(len(block) / self.bytes_per_second)
                yield block

    async def delete_messages(self, message_ids: list[int]) -> int:
        removed = 0
        for mid in message_ids:
            for suffix in (".bin", ".json"):
                try:
                    (self.root / f"{mid}{suffix}").unlink()
                    removed += suffix == ".bin"
                except FileNotFoundError:
                    pass
        return removed

    async def iter_remote_chunks(self) -> AsyncIterator[RemoteChunk]:
        for path in sorted(self.root.glob("*.bin"), key=lambda p: int(p.stem) if p.stem.isdigit() else 0):
            if not path.stem.isdigit():
                continue
            side = path.with_suffix(".json")
            caption = json.loads(side.read_text(encoding="utf-8")).get("caption") if side.exists() else None
            yield RemoteChunk(int(path.stem), f"local-{path.stem}", path.stat().st_size, caption)


# ---- Telegram backend (Telethon) ---------------------------------------------------------------------------------------
class TelethonBackend(StorageBackend):
    """A private channel as object storage. Needs `api_id` and `api_hash` from https://my.telegram.org.

    Either a `bot_token` (bot must be an admin of the channel) or a user login (phone, code, optional 2FA password).
    The Telethon session file holds the login, so it is created in the data folder with owner-only permissions.
    """

    name = "telegram"
    DELETE_BATCH = 100
    DOWNLOAD_BLOCK = 512 * 1024

    def __init__(self, *, session_path: str | os.PathLike, api_id: int, api_hash: str, bot_token: str | None = None,
                 channel: str | int | None = None, client_factory: Callable[..., object] | None = None,
                 sleep: Callable[[float], Awaitable[None]] = asyncio.sleep, max_flood_wait: float = 900.0) -> None:
        self.session_path, self.api_id, self.api_hash = str(session_path), int(api_id), api_hash
        self.bot_token, self.channel = bot_token, channel
        self._factory = client_factory
        self._sleep, self._max_flood_wait = sleep, max_flood_wait
        self._client = None
        self._entity = None
        self._phone: str | None = None
        self._code_hash: str | None = None

    # -- connection and login
    def _make_client(self):
        if self._factory:
            return self._factory(self.session_path, self.api_id, self.api_hash)
        from telethon import TelegramClient  # imported lazily so the app starts (and tests run) without a Telegram setup

        # flood_sleep_threshold=0: Telethon must not sleep silently; with_retries does it so the UI can show the wait
        return TelegramClient(self.session_path, self.api_id, self.api_hash, flood_sleep_threshold=0)

    async def connect(self) -> None:
        if self._client is None:
            self._client = self._make_client()
        await self._client.connect()
        for suffix in ("", ".session"):  # the login must not be readable by other users of the machine
            try:
                os.chmod(self.session_path + suffix, 0o600)
            except OSError:
                pass
        if self.bot_token and not await self._client.is_user_authorized():
            await self._retry(lambda: self._client.sign_in(bot_token=self.bot_token))
        if self.channel and await self._client.is_user_authorized():
            await self._resolve_channel()

    async def close(self) -> None:
        if self._client is not None:
            await self._client.disconnect()

    async def authorized(self) -> bool:
        return self._client is not None and await self._client.is_user_authorized()

    async def status(self) -> dict:
        authorized = await self.authorized()
        return {"backend": self.name, "authorized": authorized, "ready": authorized and self._entity is not None,
                "channel": str(self.channel) if self.channel else None}

    async def send_code(self, phone: str) -> None:
        """Step 1 of a user login: Telegram sends a code to the account's other devices or by SMS."""
        if self._client is None:
            await self.connect()
        sent = await self._retry(lambda: self._client.send_code_request(phone))
        self._phone, self._code_hash = phone, getattr(sent, "phone_code_hash", None)

    async def sign_in(self, code: str, password: str | None = None) -> None:
        """Step 2 (and 3 if the account has two-step verification): raises `NeedPassword` when the password is needed."""
        if self._client is None or not self._phone:
            raise NotAuthorized("Ask for a login code first.")
        try:
            from telethon.errors import SessionPasswordNeededError
        except ImportError:  # pragma: no cover - telethon is a hard dependency
            SessionPasswordNeededError = ()  # type: ignore[assignment]
        try:
            if password is None:
                await self._retry(lambda: self._client.sign_in(phone=self._phone, code=code, phone_code_hash=self._code_hash))
            else:
                await self._retry(lambda: self._client.sign_in(password=password))
        except SessionPasswordNeededError as exc:
            raise NeedPassword("This account has two-step verification; send the password too.") from exc
        if self.channel:
            await self._resolve_channel()

    async def create_channel(self, title: str = "Cloud storage") -> str:
        """Create a private channel for the files. Only possible with a user login (bots cannot create channels)."""
        from telethon.tl.functions.channels import CreateChannelRequest

        if not await self.authorized() or self.bot_token:
            raise NotAuthorized("Creating a channel needs a user login, not a bot token.")
        result = await self._retry(lambda: self._client(CreateChannelRequest(title=title, about="Private storage", megagroup=False, broadcast=True)))
        chat = result.chats[0]
        self.channel = int(f"-100{chat.id}")
        self._entity = await self._client.get_entity(chat)
        return str(self.channel)

    async def _resolve_channel(self) -> None:
        target = self.channel
        if isinstance(target, str) and re.fullmatch(r"-?\d+", target.strip()):
            target = int(target)
        try:
            self._entity = await self._retry(lambda: self._client.get_entity(target))
        except ValueError:
            # user accounts only know a channel id after the dialogs have been loaded once
            await self._retry(lambda: self._client.get_dialogs())
            self._entity = await self._retry(lambda: self._client.get_entity(target))

    def _require_ready(self):
        if self._client is None or self._entity is None:
            raise NotConfigured("Telegram is not connected to a channel yet.")
        return self._client

    def _retry(self, operation: Callable[[], Awaitable[T]]) -> Awaitable[T]:
        return with_retries(operation, sleep=self._sleep, max_flood_wait=self._max_flood_wait, on_wait=lambda s, why: self._notice and self._notice(s, why))

    # -- chunk operations
    async def upload_chunk(self, name: str, data: bytes, caption: str, progress: ByteProgress | None = None) -> UploadedChunk:
        client = self._require_ready()

        def make_call():
            buffer = io.BytesIO(data)  # a fresh buffer per attempt: a retry must start from byte 0
            buffer.name = name
            return client.send_file(self._entity, buffer, caption=caption, force_document=True, progress_callback=progress)

        message = await self._retry(make_call)
        document = getattr(message, "document", None) or getattr(getattr(message, "media", None), "document", None)
        return UploadedChunk(file_id=str(getattr(document, "id", message.id)), message_id=int(message.id))

    async def download_chunk(self, message_id: int) -> AsyncIterator[bytes]:
        client = self._require_ready()
        message = await self._retry(lambda: client.get_messages(self._entity, ids=message_id))
        if message is None or not getattr(message, "media", None):
            raise ChunkMissing(f"Message {message_id} is gone from the channel.")
        async for block in client.iter_download(message.media, chunk_size=self.DOWNLOAD_BLOCK):
            yield bytes(block)

    async def delete_messages(self, message_ids: list[int]) -> int:
        client = self._require_ready()
        for start in range(0, len(message_ids), self.DELETE_BATCH):
            batch = message_ids[start:start + self.DELETE_BATCH]
            await self._retry(lambda batch=batch: client.delete_messages(self._entity, batch, revoke=True))
        return len(message_ids)

    async def iter_remote_chunks(self) -> AsyncIterator[RemoteChunk]:
        client = self._require_ready()
        async for message in client.iter_messages(self._entity):
            document = getattr(message, "document", None)
            if document is None or not getattr(message, "message", None):
                continue
            yield RemoteChunk(int(message.id), str(document.id), int(getattr(document, "size", 0)), message.message)
