"""The Telegram bot: indexes videos posted to the storage channel, and lets people search and receive them.

Run it with `python bot.py` (see README.md). The logic is in `LibraryBot`, which takes any object with Telethon's client methods,
so it is tested with a fake client and never needs a network.

Why a bot token is required: only bots can send inline keyboards. A user account could index the channel, but could not show the
menus. A bot also works with MTProto (Telethon), so files up to 2 GB are fine, unlike the HTTP Bot API's 50 MB limit.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from telethon import TelegramClient, errors, events, utils
from telethon.tl.custom import Button

from config import Config, ConfigError
from database import Database
from delivery import Delivery, retry_flood, send_media_file
from menus import (HELP_TEXT, Keyboard, decode, episodes_screen, esc, file_caption, media_header, qualities_screen, search_screen,
                   seasons_screen)
from parser import complete_metadata, parse_caption

log = logging.getLogger("bot")
MAX_QUERY = 100
CHANNEL_HINT = ("The bot cannot reach the storage channel. Make sure it is an ADMINISTRATOR of the channel, and that "
                "STORAGE_CHANNEL_ID is right (it starts with -100).")


# ---- small helpers ---------------------------------------------------------------------------------------------------------
@dataclass
class Reply:
    text: str
    keyboard: Keyboard = field(default_factory=list)


@dataclass
class Action:
    """What a button press should do. `edit` replaces the menu, `send` delivers a file, `alert` shows a pop-up."""
    edit: Optional[Reply] = None
    send: Optional[dict] = None
    alert: Optional[str] = None


@dataclass(frozen=True)
class IngestOutcome:
    """status: indexed | updated | duplicate | skipped | ignored"""
    status: str
    reason: str = ""
    media_id: int | None = None


class SearchMemory:
    """Remembers recent searches so that the "Next page" and "Back" buttons can find them again. Callback data is too small to
    hold the query itself. Entries expire, and old ones are dropped, so memory stays bounded."""

    def __init__(self, capacity: int = 500, ttl: float = 6 * 3600, clock: Callable[[], float] = time.monotonic) -> None:
        self._items: dict[str, tuple[str, float]] = {}
        self._last: dict[int, tuple[str, int]] = {}
        self._counter = 0
        self.capacity, self.ttl, self._clock = capacity, ttl, clock

    def remember(self, query: str) -> str:
        for token, (stored, _) in self._items.items():
            if stored == query:
                self._items[token] = (stored, self._clock())
                return token
        self._counter += 1
        token = format(self._counter, "x")
        self._items[token] = (query, self._clock())
        while len(self._items) > self.capacity:
            self._items.pop(next(iter(self._items)))
        return token

    def lookup(self, token: str) -> str | None:
        item = self._items.get(token)
        if item is None or self._clock() - item[1] > self.ttl:
            self._items.pop(token, None)
            return None
        return item[0]

    def set_last(self, user_id: int, token: str, page: int) -> None:
        self._last[user_id] = (token, page)
        if len(self._last) > 5000:
            self._last.pop(next(iter(self._last)))

    def last(self, user_id: int) -> tuple[str, int] | None:
        return self._last.get(user_id)


class Cooldown:
    """At most one file per `interval` seconds per person, so a double tap or a hammered button cannot flood Telegram."""

    def __init__(self, interval: float, clock: Callable[[], float] = time.monotonic) -> None:
        self.interval, self._clock = interval, clock
        self._seen: dict[int, float] = {}

    def wait_time(self, key: int) -> float:
        remaining = self.interval - (self._clock() - self._seen.get(key, -1e9))
        return max(0.0, remaining)

    def hit(self, key: int) -> None:
        self._seen[key] = self._clock()
        if len(self._seen) > 5000:
            cutoff = self._clock() - self.interval
            self._seen = {k: v for k, v in self._seen.items() if v > cutoff}


def to_buttons(keyboard: Keyboard) -> list[list[Any]] | None:
    return [[Button.inline(label, data=data.encode()) for label, data in row] for row in keyboard] or None


def is_video_message(message: Any) -> bool:
    """A video, or a document that is one (many .mkv/.mp4 files are posted as documents)."""
    if getattr(message, "video", None):
        return True
    doc = getattr(message, "document", None)
    if doc is None:
        return False
    mime = (getattr(doc, "mime_type", "") or "").lower()
    if mime.startswith("video/") or mime == "application/x-matroska":
        return True
    return any(type(a).__name__ == "DocumentAttributeVideo" for a in getattr(doc, "attributes", []) or [])


# ---- the bot ---------------------------------------------------------------------------------------------------------------
class LibraryBot:
    def __init__(self, client: Any, db: Database, config: Config, *, sleep: Callable[[float], Any] = asyncio.sleep,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.client, self.db, self.config = client, db, config
        self.sleep = sleep
        self.searches = SearchMemory(clock=clock)
        self.cooldown = Cooldown(config.send_cooldown, clock)
        self._sending: set[tuple[int, int]] = set()

    # ---- ingestion: the storage channel -----------------------------------------------------------------------------------
    async def ingest_message(self, message: Any, *, notify: bool = True) -> IngestOutcome:
        """Index one channel post. Safe to call again for the same post (an edit): it updates instead of duplicating."""
        if getattr(message, "chat_id", None) != self.config.storage_channel_id:
            return IngestOutcome("ignored", "not the storage channel")
        if not is_video_message(message):
            return IngestOutcome("ignored", "not a video")
        meta, notes = complete_metadata(parse_caption(getattr(message, "raw_text", None) or getattr(message, "message", None)))
        if meta is None:
            reason = "no usable metadata in the caption (a title is required)"
            log.warning("message %s skipped: %s", message.id, reason)
            if notify:
                await self._notify_admins(f"Skipped message {message.id}: {reason}. Fix the caption (edit the post) and it will be indexed.")
            return IngestOutcome("skipped", reason)
        file_id = utils.pack_bot_file_id(message.media)
        if not file_id:
            return IngestOutcome("skipped", "could not read the file id")
        result = await self.db.index_file(meta, file_id=file_id, message_id=message.id, channel_id=message.chat_id)
        for note in notes:
            log.info("message %s: %s", message.id, note)
        if result.status == "duplicate":
            log.info("message %s holds a file already indexed as message %s", message.id, result.existing_message_id)
            return IngestOutcome("duplicate", f"same file as message {result.existing_message_id}", result.media_id)
        log.info("message %s %s as %s", message.id, result.status, meta["title"])
        return IngestOutcome("indexed" if result.status == "inserted" else "updated", "; ".join(notes), result.media_id)

    async def handle_deleted(self, channel_id: int | None, message_ids: list[int]) -> int:
        removed = await self.db.delete_messages(channel_id or self.config.storage_channel_id, list(message_ids))
        if removed:
            log.info("forgot %s file(s) whose posts were deleted from the channel", removed)
        return removed

    async def reindex(self, start: int = 1, end: int | None = None) -> dict:
        """Read the channel's posts by id (which both bots and user accounts may do) and index them. Stops at `end`, or after
        `reindex_gap` ids in a row with nothing there, so it never runs forever on a short channel."""
        counts = {"indexed": 0, "updated": 0, "duplicate": 0, "skipped": 0, "ignored": 0, "missing": 0}
        gap = 0
        current = max(1, start)
        while (end is None or current <= end) and gap < self.config.reindex_gap:
            last = current + 99 if end is None else min(end, current + 99)
            ids = list(range(current, last + 1))
            messages = await retry_flood(lambda ids=ids: self.client.get_messages(self.config.storage_channel_id, ids=ids),
                                         max_wait=self.config.max_flood_wait, sleep=self.sleep)
            for message in messages:
                if message is None or getattr(message, "empty", False) or not getattr(message, "id", None):
                    counts["missing"] += 1
                    gap += 1
                    continue
                gap = 0
                counts[(await self.ingest_message(message, notify=False)).status] += 1
            current = last + 1
        counts["last_id_checked"] = current - 1
        return counts

    async def check_channel(self) -> bool:
        """At start-up: can the bot see the storage channel? Logs what to fix if not."""
        try:
            await self.client.get_input_entity(self.config.storage_channel_id)
            return True
        except (ValueError, errors.RPCError) as exc:
            log.warning("%s (%s). Post anything in the channel, or re-add the bot as an admin, so the bot learns the channel.", CHANNEL_HINT, type(exc).__name__)
            return False

    async def _notify_admins(self, text: str) -> None:
        for admin in self.config.admin_ids:
            try:
                await self.client.send_message(admin, text)
            except Exception as exc:  # noqa: BLE001 - an unreachable admin must never break ingestion
                log.debug("could not notify admin %s: %r", admin, exc)

    # ---- talking to people --------------------------------------------------------------------------------------------------
    async def command_reply(self, user_id: int, text: str) -> Reply | None:
        """The answer to a private message: a command, or a plain search. None means: say nothing."""
        text = (text or "").strip()
        if not text:
            return None
        if not self.config.may_use(user_id):
            return Reply("This library is private.")
        if text.startswith("/"):
            command, _, arg = text.partition(" ")
            command = command.split("@", 1)[0].lower()
            arg = arg.strip()
            if command in ("/start", "/help"):
                return Reply(HELP_TEXT)
            if command == "/search":
                return await self.search_reply(user_id, arg) if arg else Reply("Usage: <code>/search attack titan</code>")
            if command == "/stats":
                return await self._stats() if self.config.is_admin(user_id) else Reply("Only administrators can use /stats.")
            if command == "/reindex":
                return await self._reindex_command(user_id, arg)
            return Reply("Unknown command. Send a title to search, or /help.")
        return await self.search_reply(user_id, text)

    async def search_reply(self, user_id: int, query: str, page: int = 0, token: str | None = None) -> Reply:
        query = re.sub(r"\s+", " ", query).strip()[:MAX_QUERY]
        if not query:
            return Reply("Send part of a title to search for.")
        per_page = self.config.results_per_page
        rows, total = await self.db.search(query, limit=per_page, offset=page * per_page)
        if total and not rows and page > 0:  # the library shrank since that page was shown
            page = max(0, -(-total // per_page) - 1)
            rows, total = await self.db.search(query, limit=per_page, offset=page * per_page)
        token = token or self.searches.remember(query)
        self.searches.set_last(user_id, token, page)
        text, keyboard = search_screen(query, rows, total, token, page, per_page)
        return Reply(text, keyboard)

    async def _stats(self) -> Reply:
        s = await self.db.stats()
        return Reply(f"<b>Library</b>\n{s['titles']} titles ({s['movies']} movies, {s['anime']} anime, {s['shows']} shows)\n{s['files']} files")

    async def _reindex_command(self, user_id: int, arg: str) -> Reply:
        if not self.config.is_admin(user_id):
            return Reply("Only administrators can use /reindex.")
        numbers = re.findall(r"\d+", arg)
        if len(numbers) > 2 or (arg and not numbers):
            return Reply("Usage: <code>/reindex [first_id] [last_id]</code>")
        start = int(numbers[0]) if numbers else 1
        end = int(numbers[1]) if len(numbers) > 1 else None
        try:
            counts = await self.reindex(start, end)
        except (errors.RPCError, ValueError) as exc:
            return Reply(f"{esc(CHANNEL_HINT)}\n<code>{esc(type(exc).__name__)}</code>")
        return Reply("<b>Reindex finished</b>\n" + "\n".join(f"{k.replace('_', ' ')}: {v}" for k, v in counts.items()))

    # ---- buttons -----------------------------------------------------------------------------------------------------------
    async def route_callback(self, user_id: int, data: bytes | str | None) -> Action:
        """Decide what a button press does. Pure with respect to Telegram: it only reads the database."""
        if not self.config.may_use(user_id):
            return Action(alert="This library is private.")
        decoded = decode(data)
        if decoded is None:
            return Action(alert="That button is not valid any more. Search again.")
        kind, args = decoded
        if kind == "x":
            return Action()
        if kind == "s":
            token, page = args
            query = self.searches.lookup(token)
            if query is None:
                return Action(alert="That search has expired. Send your search again.")
            return Action(edit=await self.search_reply(user_id, query, page, token))
        if kind == "m":
            return await self._open_media(user_id, args[0])
        if kind == "t":
            return await self._open_season(args[0], args[1], args[2])
        if kind == "e":
            return await self._open_episode(*args)
        return await self._open_file(args[0])

    async def _media_or_none(self, media_id: int) -> dict | None:
        return await self.db.get_media(media_id)

    async def _open_media(self, user_id: int, media_id: int) -> Action:
        media = await self._media_or_none(media_id)
        if media is None:
            return Action(alert="That title is no longer in the library.")
        seasons = await self.db.seasons(media_id)
        if not seasons:
            return Action(alert="That title has no files any more.")
        if all(s["season_number"] is None for s in seasons):  # a movie, or a single file: no seasons to choose from
            return await self._open_episode(media_id, None, None)
        last = self.searches.last(user_id)
        back = f"s:{last[0]}:{last[1]}" if last else None
        text, keyboard = seasons_screen(media, seasons, back)
        return Action(edit=Reply(text, keyboard))

    async def _open_season(self, media_id: int, season: int | None, page: int) -> Action:
        media = await self._media_or_none(media_id)
        if media is None:
            return Action(alert="That title is no longer in the library.")
        per_page = self.config.episodes_per_page
        episodes, total = await self.db.episodes(media_id, season, limit=per_page, offset=page * per_page)
        if not episodes:
            return Action(alert="That season is no longer in the library.")
        has_seasons = any(s["season_number"] is not None for s in await self.db.seasons(media_id))
        text, keyboard = episodes_screen(media, season, episodes, total, page, per_page, has_seasons)
        return Action(edit=Reply(text, keyboard))

    async def _open_episode(self, media_id: int, season: int | None, episode: int | None) -> Action:
        media = await self._media_or_none(media_id)
        files = await self.db.files_for(media_id, season, episode) if media else []
        if media is None or not files:
            return Action(alert="That file is no longer in the library.")
        if len(files) == 1:
            return Action(send=await self.db.get_file(files[0]["id"]))
        text, keyboard = qualities_screen(media, season, episode, files)
        return Action(edit=Reply(text, keyboard))

    async def _open_file(self, file_row_id: int) -> Action:
        file = await self.db.get_file(file_row_id)
        return Action(send=file) if file else Action(alert="That file is no longer in the library.")

    async def deliver(self, chat_id: int, user_id: int, file: dict) -> str | None:
        """Send a file. Returns a message for the user if it could not be delivered, otherwise None."""
        key = (user_id, file["id"])
        if key in self._sending:
            return "Already sending that file."
        wait = self.cooldown.wait_time(user_id)
        if wait > 0:
            return f"One moment: wait {int(wait) + 1} s before asking for another file."
        self._sending.add(key)
        self.cooldown.hit(user_id)
        try:
            result: Delivery = await send_media_file(self.client, self.db, chat_id=chat_id, file_row=file, caption=file_caption(file),
                                                      max_flood_wait=self.config.max_flood_wait, sleep=self.sleep)
        finally:
            self._sending.discard(key)
        if result.ok:
            return None
        if result.status == "gone":
            await self._notify_admins(f"A file was removed from the library because its post is gone from the channel: {file['title']} (message {file['telegram_message_id']}).")
            return "Sorry, that file is no longer available."
        if result.status == "flood":
            return f"Telegram is limiting this bot. Try again in about {result.wait_seconds // 60 + 1} minute(s)."
        if result.status == "channel_unavailable":
            await self._notify_admins(CHANNEL_HINT)
            return "Sorry, the library storage is not reachable right now. Try again later."
        if result.status == "blocked":
            return None  # the person cannot receive messages (blocked the bot); there is nobody to tell
        return "Sorry, that file could not be sent. Try again in a moment."

    # ---- Telethon wiring ----------------------------------------------------------------------------------------------------
    def register(self) -> None:
        channel = self.config.storage_channel_id
        add = self.client.add_event_handler

        async def on_post(event: Any) -> None:
            await self.ingest_message(event.message)

        async def on_edit(event: Any) -> None:
            await self.ingest_message(event.message)

        async def on_delete(event: Any) -> None:
            await self.handle_deleted(getattr(event, "chat_id", None), list(event.deleted_ids))

        async def on_private(event: Any) -> None:
            if not event.is_private:
                return
            reply = await self.command_reply(event.sender_id, event.raw_text)
            if reply:
                await self._respond(event, reply)

        async def on_button(event: Any) -> None:
            if not event.is_private:
                return
            action = await self.route_callback(event.sender_id, event.data)
            if action.edit:
                try:
                    await event.edit(action.edit.text, buttons=to_buttons(action.edit.keyboard), parse_mode="html")
                except errors.MessageNotModifiedError:
                    pass
            if action.send:
                problem = await self.deliver(event.chat_id, event.sender_id, action.send)
                await self._answer(event, problem or "Sending…", alert=bool(problem))
            else:
                await self._answer(event, action.alert, alert=bool(action.alert))

        add(on_post, events.NewMessage(chats=[channel]))
        add(on_edit, events.MessageEdited(chats=[channel]))
        add(on_delete, events.MessageDeleted(chats=[channel]))
        add(on_private, events.NewMessage(func=lambda e: e.is_private and not e.out))
        add(on_button, events.CallbackQuery())

    @staticmethod
    async def _respond(event: Any, reply: Reply) -> None:
        try:
            await event.respond(reply.text, buttons=to_buttons(reply.keyboard), parse_mode="html")
        except errors.FloodWaitError as exc:
            log.warning("flood wait %s s while replying", exc.seconds)
        except errors.RPCError as exc:
            log.warning("could not reply: %s", type(exc).__name__)

    @staticmethod
    async def _answer(event: Any, text: str | None, alert: bool = False) -> None:
        try:
            await event.answer(text, alert=alert)
        except (errors.QueryIdInvalidError, errors.RPCError):
            pass  # the button was pressed too long ago for Telegram to accept an answer


# ---- entry point -------------------------------------------------------------------------------------------------------------
async def amain() -> None:
    from dotenv import load_dotenv

    load_dotenv()
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    logging.getLogger("telethon").setLevel(logging.WARNING)
    try:
        config = Config.from_env()
    except ConfigError as exc:
        raise SystemExit(f"Configuration problem: {exc}") from None
    db = await Database(config.db_path).open()
    client = TelegramClient(config.session_name, config.api_id, config.api_hash)
    client.parse_mode = "html"
    try:
        await client.start(bot_token=config.bot_token)
        for suffix in (".session", ""):  # the login must not be readable by other users of the machine
            try:
                os.chmod(config.session_name + suffix, 0o600)
            except OSError:
                pass
        bot = LibraryBot(client, db, config)
        bot.register()
        await bot.check_channel()
        me = await client.get_me()
        log.info("Running as @%s. Listening to channel %s.", getattr(me, "username", "?"), config.storage_channel_id)
        await client.run_until_disconnected()
    finally:
        await client.disconnect()
        await db.close()


def main() -> None:
    try:
        asyncio.run(amain())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
