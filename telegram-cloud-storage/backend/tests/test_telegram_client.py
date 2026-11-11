import asyncio
import io

import pytest

from backend.telegram_client import (ChunkMissing, FloodWaitTooLong, LocalDirBackend, NotConfigured, TelethonBackend, flood_wait_seconds,
                                     with_retries)


class FloodWaitError(Exception):  # same name and shape as telethon.errors.FloodWaitError
    def __init__(self, seconds):
        super().__init__(f"A wait of {seconds} seconds is required")
        self.seconds = seconds


class FloodWait(Exception):  # Pyrogram's shape: `.value`
    def __init__(self, value):
        self.value = value


class Recorder:
    def __init__(self):
        self.sleeps, self.notes = [], []

    async def sleep(self, s):
        self.sleeps.append(s)

    def note(self, s, why):
        self.notes.append((s, why))


def test_flood_wait_is_recognised_in_all_its_shapes():
    assert flood_wait_seconds(FloodWaitError(37)) == 37
    assert flood_wait_seconds(FloodWait(12)) == 12
    assert flood_wait_seconds(RuntimeError("420 FLOOD_WAIT_45")) == 45
    assert flood_wait_seconds(RuntimeError("SLOWMODE_WAIT_9")) == 9
    assert flood_wait_seconds(ValueError("something else")) is None
    assert flood_wait_seconds(ConnectionError("reset")) is None


async def test_flood_wait_sleeps_the_requested_time_plus_one_then_succeeds():
    r, calls = Recorder(), []

    async def op():
        calls.append(1)
        if len(calls) < 3:
            raise FloodWaitError(20)
        return "ok"

    assert await with_retries(op, sleep=r.sleep, on_wait=r.note) == "ok"
    assert r.sleeps == [21, 21] and r.notes == [(21, "flood_wait")] * 2 and len(calls) == 3


async def test_a_flood_wait_longer_than_the_limit_is_not_slept_out():
    r = Recorder()

    async def op():
        raise FloodWaitError(5000)

    with pytest.raises(FloodWaitTooLong):
        await with_retries(op, sleep=r.sleep, max_flood_wait=900)
    assert r.sleeps == []


async def test_network_blips_back_off_exponentially_and_are_capped():
    r, calls = Recorder(), []

    async def op():
        calls.append(1)
        if len(calls) < 6:
            raise ConnectionError("reset")
        return "done"

    assert await with_retries(op, sleep=r.sleep, base_delay=1, max_delay=5, attempts=6) == "done"
    assert r.sleeps == [1, 2, 4, 5, 5]


async def test_gives_up_after_the_last_attempt_and_reraises_the_real_error():
    async def op():
        raise FloodWaitError(1)

    with pytest.raises(FloodWaitError):
        await with_retries(op, sleep=Recorder().sleep, attempts=3)

    async def blip():
        raise TimeoutError("slow")

    with pytest.raises(TimeoutError):
        await with_retries(blip, sleep=Recorder().sleep, attempts=2)


async def test_other_errors_are_not_retried():
    calls = []

    async def op():
        calls.append(1)
        raise ValueError("bad input")

    with pytest.raises(ValueError):
        await with_retries(op, sleep=Recorder().sleep)
    assert calls == [1]


async def test_cancellation_is_never_swallowed():
    async def op():
        raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        await with_retries(op, sleep=Recorder().sleep)


# ---- TelethonBackend against a fake Telethon client --------------------------------------------------------------------
class Doc:
    def __init__(self, id, size):
        self.id, self.size = id, size


class Msg:
    def __init__(self, id, data, caption):
        self.id, self.message, self.data = id, caption, data
        self.document = Doc(9000 + id, len(data))
        self.media = self


class FakeClient:
    """Just enough of telethon.TelegramClient for the calls TelethonBackend makes."""

    def __init__(self, *_):
        self.messages, self.next_id, self.deleted_batches, self.send_attempts = {}, 1, [], []
        self.fail_sends = []  # exceptions raised by the next send_file calls, in order
        self.connected = self.authorized = False
        self.sign_ins = []

    async def connect(self): self.connected = True
    async def disconnect(self): self.connected = False
    async def is_user_authorized(self): return self.authorized

    async def sign_in(self, **kw):
        self.sign_ins.append(kw)
        self.authorized = True

    async def get_entity(self, target): return ("channel", target)
    async def get_dialogs(self): return []

    async def send_file(self, entity, buffer, caption=None, force_document=None, progress_callback=None):
        self.send_attempts.append((buffer.name, buffer.tell(), buffer.getbuffer().nbytes))
        if self.fail_sends:
            buffer.read(3)  # like the real client, some bytes were already consumed when the error arrived
            raise self.fail_sends.pop(0)
        data = buffer.read()
        if progress_callback:
            progress_callback(len(data), len(data))
        msg = Msg(self.next_id, data, caption)
        self.messages[msg.id] = msg
        self.next_id += 1
        return msg

    async def get_messages(self, entity, ids): return self.messages.get(ids)

    async def iter_download(self, media, chunk_size):
        for i in range(0, len(media.data), chunk_size):
            yield media.data[i:i + chunk_size]

    async def delete_messages(self, entity, ids, revoke=True):
        self.deleted_batches.append(list(ids))
        for i in ids:
            self.messages.pop(i, None)

    async def iter_messages(self, entity):
        for m in sorted(self.messages.values(), key=lambda m: -m.id):
            yield m


def make_backend(client, **kw):
    r = Recorder()
    b = TelethonBackend(session_path="x.session", api_id=1, api_hash="h" * 8, bot_token="123:abc", channel="@store",
                        client_factory=lambda *_: client, sleep=r.sleep, **kw)
    b.recorder = r
    return b


async def test_bot_login_resolves_the_channel_and_reports_ready():
    c = FakeClient()
    b = make_backend(c)
    await b.connect()
    assert c.sign_ins == [{"bot_token": "123:abc"}]
    assert (await b.status())["ready"] is True


async def test_not_ready_without_a_channel_raises_not_configured():
    c = FakeClient()
    b = TelethonBackend(session_path="x", api_id=1, api_hash="h" * 8, client_factory=lambda *_: c)
    await b.connect()
    with pytest.raises(NotConfigured):
        await b.upload_chunk("n", b"x", "cap")


async def test_upload_returns_message_id_and_document_id_and_passes_caption_and_progress():
    c = FakeClient()
    b = make_backend(c)
    await b.connect()
    seen = []
    up = await b.upload_chunk("abc-00000.bin", b"hello", '{"x":1}', lambda d, t: seen.append((d, t)))
    assert (up.message_id, up.file_id) == (1, "9001") and seen == [(5, 5)]
    assert c.messages[1].message == '{"x":1}'


async def test_a_flood_wait_retries_with_a_fresh_buffer_starting_at_byte_zero():
    c = FakeClient()
    c.fail_sends = [FloodWaitError(30), FloodWaitError(2)]
    b = make_backend(c)
    await b.connect()
    notes = []
    b.set_wait_notice(lambda s, why: notes.append((s, why)))
    up = await b.upload_chunk("p.bin", b"payload", "cap")
    assert b.recorder.sleeps == [31, 3] and notes == [(31, "flood_wait"), (3, "flood_wait")]
    assert c.send_attempts == [("p.bin", 0, 7)] * 3  # same name, position 0, full length every time
    assert c.messages[up.message_id].data == b"payload"


async def test_download_streams_in_blocks_and_a_missing_message_is_reported():
    c = FakeClient()
    b = make_backend(c)
    await b.connect()
    data = bytes(range(256)) * 5000
    up = await b.upload_chunk("p", data, "c")
    got = b"".join([blk async for blk in b.download_chunk(up.message_id)])
    assert got == data
    with pytest.raises(ChunkMissing):
        [blk async for blk in b.download_chunk(999)]


async def test_deletes_are_batched_to_100():
    c = FakeClient()
    b = make_backend(c)
    await b.connect()
    await b.delete_messages(list(range(250)))
    assert [len(x) for x in c.deleted_batches] == [100, 100, 50]


async def test_iter_remote_chunks_skips_messages_without_a_document_or_caption():
    c = FakeClient()
    b = make_backend(c)
    await b.connect()
    await b.upload_chunk("a", b"12", "caption-a")
    c.messages[50] = type("Text", (), {"id": 50, "message": "just text", "document": None, "media": None})()
    got = [r async for r in b.iter_remote_chunks()]
    assert [(r.message_id, r.caption, r.size) for r in got] == [(1, "caption-a", 2)]


async def test_user_login_asks_for_a_password_when_two_step_verification_is_on(monkeypatch):
    from telethon.errors import SessionPasswordNeededError
    from backend.telegram_client import NeedPassword

    class UserClient(FakeClient):
        async def send_code_request(self, phone):
            return type("Sent", (), {"phone_code_hash": "H"})()

        async def sign_in(self, **kw):
            self.sign_ins.append(kw)
            if "code" in kw:
                raise SessionPasswordNeededError(request=None)
            self.authorized = True

    c = UserClient()
    b = TelethonBackend(session_path="x", api_id=1, api_hash="h" * 8, channel="@c", client_factory=lambda *_: c)
    await b.connect()
    await b.send_code("+10000000000")
    with pytest.raises(NeedPassword):
        await b.sign_in("12345")
    await b.sign_in("12345", "hunter2")
    # first the code (which Telegram answers with "password needed"), then only the password
    assert c.sign_ins == [{"phone": "+10000000000", "code": "12345", "phone_code_hash": "H"}, {"password": "hunter2"}]
    assert (await b.status())["authorized"] is True


# ---- LocalDirBackend ---------------------------------------------------------------------------------------------------
async def test_local_backend_round_trip_and_ids_never_repeat_after_deletes(tmp_path):
    b = LocalDirBackend(tmp_path / "ch")
    await b.connect()
    a = await b.upload_chunk("n", b"aaa", "c1")
    c = await b.upload_chunk("n", b"bbbb", "c2")
    assert [x async for x in b.download_chunk(c.message_id)] == [b"bbbb"]
    assert await b.delete_messages([c.message_id]) == 1
    d = await b.upload_chunk("n", b"d", "c3")
    assert d.message_id > c.message_id > a.message_id
    assert [r.caption async for r in b.iter_remote_chunks()] == ["c1", "c3"]
    with pytest.raises(ChunkMissing):
        [x async for x in b.download_chunk(c.message_id)]


async def test_local_backend_concurrent_uploads_get_distinct_ids(tmp_path):
    b = LocalDirBackend(tmp_path / "ch")
    await b.connect()
    ups = await asyncio.gather(*[b.upload_chunk("n", bytes([i]) * 10, f"c{i}") for i in range(25)])
    assert len({u.message_id for u in ups}) == 25
    assert [bytes([i]) * 10 for i in range(25)] == [b"".join([x async for x in b.download_chunk(u.message_id)]) for u in ups]
