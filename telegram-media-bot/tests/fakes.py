"""Test doubles. Messages and documents are REAL Telethon objects (built offline), so file_id packing, `message.video` and
`chat_id` behave exactly as in production; only the network client is faked."""
from __future__ import annotations

import datetime
import itertools

from telethon import types
from telethon.tl.custom import Message

CHANNEL = -1001234567890
_NOW = datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc)
_ids = itertools.count(1000)


def make_document(doc_id: int | None = None, mime: str = "video/mp4", video_attr: bool = True, size: int = 700_000_000) -> types.Document:
    attrs = [types.DocumentAttributeFilename("file.bin")]
    if video_attr:
        attrs.append(types.DocumentAttributeVideo(duration=1400, w=1920, h=1080))
    return types.Document(id=doc_id or next(_ids) * 7919, access_hash=123456789, file_reference=b"ref", date=_NOW, mime_type=mime,
                          size=size, dc_id=2, attributes=attrs)


def make_message(message_id: int, caption: str | None, *, channel: int = CHANNEL, doc: types.Document | None = None,
                 mime: str = "video/mp4", video_attr: bool = True, with_media: bool = True) -> Message:
    media = types.MessageMediaDocument(document=doc or make_document(mime=mime, video_attr=video_attr)) if with_media else None
    peer = types.PeerChannel(channel_id=abs(channel) - 1_000_000_000_000)
    return Message(id=message_id, peer_id=peer, date=_NOW, message=caption or "", media=media)


def yaml_caption(title: str, kind: str = "Movie", year: int | None = None, season: int | None = None, episode: int | None = None,
                 resolution: str | None = None, genres: str | None = None) -> str:
    lines = ["---", f'title: "{title}"', f"type: {kind}"]
    for key, value in (("year", year), ("season", season), ("episode", episode), ("resolution", resolution), ("genres", genres)):
        if value is not None:
            lines.append(f"{key}: {value}")
    return "\n".join(lines + ["---"])


class FakeClient:
    """Just enough of TelegramClient. `send_script` is a list consumed one entry per send_file call: an exception is raised,
    None means success. `fetch_script` does the same for get_messages."""

    def __init__(self) -> None:
        self.sent: list[tuple] = []
        self.dms: list[tuple] = []
        self.messages: dict[tuple[int, int], Message | None] = {}
        self.send_script: list = []
        self.fetch_script: list = []
        self.fetch_calls: list = []
        self.entity_error: Exception | None = None
        self.handlers: list[tuple] = []

    async def send_file(self, chat_id, source, caption=None, parse_mode=None):
        self.sent.append((chat_id, source, caption))
        if self.send_script:
            item = self.send_script.pop(0)
            if isinstance(item, BaseException):
                raise item

    async def get_messages(self, channel, ids=None):
        self.fetch_calls.append((channel, ids))
        if self.fetch_script:
            item = self.fetch_script.pop(0)
            if isinstance(item, BaseException):
                raise item
        if isinstance(ids, list):
            return [self.messages.get((channel, i)) for i in ids]
        return self.messages.get((channel, ids))

    async def send_message(self, user, text):
        self.dms.append((user, text))

    async def get_input_entity(self, peer):
        if self.entity_error:
            raise self.entity_error
        return peer

    def add_event_handler(self, callback, event):
        self.handlers.append((callback, event))


class FakeButtonEvent:
    def __init__(self, data, sender_id=1, chat_id=1, private=True) -> None:
        self.data, self.sender_id, self.chat_id, self.is_private = data, sender_id, chat_id, private
        self.edits: list = []
        self.answers: list = []
        self.edit_error: Exception | None = None

    async def edit(self, text, buttons=None, parse_mode=None):
        if self.edit_error:
            raise self.edit_error
        self.edits.append((text, buttons))

    async def answer(self, text=None, alert=False):
        self.answers.append((text, alert))


class FakeTextEvent:
    def __init__(self, text, sender_id=1, private=True) -> None:
        self.raw_text, self.sender_id, self.is_private = text, sender_id, private
        self.responses: list = []

    async def respond(self, text, buttons=None, parse_mode=None):
        self.responses.append((text, buttons))
