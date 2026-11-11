"""Sending a stored video to a user, and surviving the ways that can go wrong.

Telegram's `file_id` for a document can stop working (a file reference expires, or the id was minted for another session).
The message that holds the video in the storage channel is the permanent source, which is why its id is stored too. So:

    1. send with the stored file_id;
    2. if Telegram says the id or reference is invalid: fetch the message from the storage channel by id, store the fresh
       file_id, and send with that;
    3. if that still fails: send the message's media object directly;
    4. if the message itself is gone, forget the file and say so.

Around that: FLOOD_WAIT_X is waited out (up to a limit, otherwise reported), brief network errors are retried with backoff, and
a user who blocked the bot is not an error worth retrying.
"""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, TypeVar

from telethon import errors, utils

log = logging.getLogger("delivery")
T = TypeVar("T")


@dataclass(frozen=True)
class Delivery:
    """status: sent | gone | blocked | flood | channel_unavailable | failed"""
    status: str
    detail: str = ""
    refreshed: bool = False
    wait_seconds: int = 0

    @property
    def ok(self) -> bool:
        return self.status == "sent"


def _named(*names: str) -> tuple[type, ...]:
    """Error classes by name; one that a future Telethon renames is skipped instead of breaking the import."""
    return tuple(getattr(errors, n) for n in names if hasattr(errors, n))


INVALID_FILE = _named("FileReferenceExpiredError", "FileReferenceInvalidError", "FileReferenceEmptyError", "FileIdInvalidError",
                      "MediaEmptyError", "DocumentInvalidError", "FileEmptyError")
USER_UNREACHABLE = _named("UserIsBlockedError", "InputUserDeactivatedError", "ChatWriteForbiddenError", "PeerIdInvalidError",
                          "UserDeactivatedError", "ChatIdInvalidError", "UserBannedInChannelError")
CHANNEL_UNAVAILABLE = _named("ChannelPrivateError", "ChannelInvalidError", "ChatAdminRequiredError", "ChatForbiddenError", "ChannelBannedError")
TRANSIENT = (ConnectionError, TimeoutError, asyncio.TimeoutError)
_FILE_RPC = re.compile(r"^(FILE_REFERENCE|FILE_ID|MEDIA_EMPTY|DOCUMENT_INVALID|FILEREF)", re.IGNORECASE)


def flood_seconds(exc: BaseException) -> int | None:
    """Seconds Telegram asks us to wait, if `exc` is a flood-wait error."""
    if isinstance(exc, errors.FloodWaitError):
        return int(getattr(exc, "seconds", 0) or 0)
    name = type(exc).__name__.lower()
    if "floodwait" in name or "slowmodewait" in name:
        value = getattr(exc, "seconds", None) or getattr(exc, "value", None)
        return int(value) if isinstance(value, (int, float)) else None
    return None


def is_invalid_file_error(exc: BaseException) -> bool:
    if isinstance(exc, INVALID_FILE):
        return True
    if isinstance(exc, errors.RPCError) and _FILE_RPC.match(str(getattr(exc, "message", "") or "")):
        return True
    # Telethon raises a plain ValueError when a string is not an existing file, a URL or a valid bot-API file id
    return isinstance(exc, ValueError) and ("bot-API-like file ID" in str(exc) or "Failed to convert" in str(exc))


def is_channel_problem(exc: BaseException) -> bool:
    return isinstance(exc, CHANNEL_UNAVAILABLE) or (isinstance(exc, ValueError) and "find the input entity" in str(exc))


async def retry_flood(operation: Callable[[], Awaitable[T]], *, max_wait: int = 300, attempts: int = 4,
                      sleep: Callable[[float], Awaitable[None]] = asyncio.sleep) -> T:
    """Run `operation()`; on FLOOD_WAIT_X wait X+1 seconds and try again. A wait longer than `max_wait` re-raises, so the caller
    can tell the user how long to wait instead of blocking the bot."""
    for attempt in range(1, attempts + 1):
        try:
            return await operation()
        except asyncio.CancelledError:
            raise
        except BaseException as exc:  # noqa: BLE001
            wait = flood_seconds(exc)
            if wait is None or wait > max_wait or attempt == attempts:
                raise
            log.warning("Telegram flood wait: sleeping %s s", wait)
            await sleep(wait + 1)
    raise AssertionError("unreachable")


async def send_media_file(client: Any, db: Any, *, chat_id: int, file_row: dict, caption: str, max_flood_wait: int = 300,
                          sleep: Callable[[float], Awaitable[None]] = asyncio.sleep) -> Delivery:
    """Send `file_row` (a media_files row) to `chat_id`, refreshing its file_id from the storage channel if it has gone stale."""
    stored = file_row["telegram_file_id"]
    source: Any = stored
    stage = 0  # which source is being tried: 0 the stored file_id, 1 a fresh file_id, 2 the message's media object
    message: Any = None
    refresh_wanted = False
    refreshed = False
    floods = network = 0

    for _ in range(12):  # every pass either returns or changes something; the bound is a safety net
        phase = "send"
        try:
            if refresh_wanted:
                phase = "fetch"
                message = await client.get_messages(file_row["channel_id"], ids=file_row["telegram_message_id"])
                refresh_wanted = False  # only once the fetch has worked: a flood wait here must retry the fetch
                if message is None or not getattr(message, "media", None):
                    await db.delete_file(file_row["id"])
                    return Delivery("gone", "the post was deleted from the storage channel")
                refreshed = True
                fresh = utils.pack_bot_file_id(message.media)
                if stage == 0 and fresh and fresh != stored:
                    await db.update_file_id(file_row["id"], fresh)  # remember it so the next request is fast
                    source, stage = fresh, 1
                else:  # the id is unchanged (or already refreshed once): retrying it would fail the same way
                    source, stage = message.media, 2
                phase = "send"
            await client.send_file(chat_id, source, caption=caption, parse_mode="html")
            return Delivery("sent", refreshed=refreshed)
        except asyncio.CancelledError:
            raise
        except USER_UNREACHABLE as exc:
            return Delivery("blocked", type(exc).__name__)
        except BaseException as exc:  # noqa: BLE001 - classified below; anything unknown is logged and reported
            wait = flood_seconds(exc)
            if wait is not None:
                floods += 1
                if wait > max_flood_wait or floods > 3:
                    return Delivery("flood", "Telegram is limiting this bot", refreshed=refreshed, wait_seconds=wait)
                log.warning("flood wait: sleeping %s s", wait)
                await sleep(wait + 1)
                continue
            if phase == "fetch" and is_channel_problem(exc):
                return Delivery("channel_unavailable", type(exc).__name__)
            if phase == "send" and isinstance(exc, ValueError) and "find the input entity" in str(exc):
                return Delivery("blocked", "that chat is unknown to the bot")
            if phase == "send" and is_invalid_file_error(exc):
                if stage >= 2:
                    log.error("file %s could not be sent even from its message: %r", file_row["id"], exc)
                    return Delivery("failed", "Telegram rejected the file", refreshed=refreshed)
                log.info("stale file_id for row %s (%s): refreshing from the channel", file_row["id"], type(exc).__name__)
                refresh_wanted = True
                continue
            if isinstance(exc, TRANSIENT):
                network += 1
                if network > 3:
                    return Delivery("failed", "network error", refreshed=refreshed)
                await sleep(2 ** network)
                continue
            log.exception("unexpected error sending file %s", file_row["id"])
            return Delivery("failed", type(exc).__name__, refreshed=refreshed)
    return Delivery("failed", "too many retries", refreshed=refreshed)
