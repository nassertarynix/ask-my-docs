import asyncio

import pytest
from telethon import errors, utils

from delivery import Delivery, flood_seconds, is_invalid_file_error, retry_flood, send_media_file
from fakes import CHANNEL, FakeClient, make_document, make_message

CH = CHANNEL


class Sleeps:
    def __init__(self):
        self.calls = []

    async def __call__(self, seconds):
        self.calls.append(seconds)


def expired():
    return errors.FileReferenceExpiredError(request=None)


def flood(seconds):
    return errors.FloodWaitError(request=None, capture=seconds)


async def stored_file(db, file_id="STALE-ID", message_id=50):
    r = await db.index_file({"title": "Dune", "type": "Movie"}, file_id=file_id, message_id=message_id, channel_id=CH)
    return await db.get_file(r.file_row_id)


def fresh_message(message_id=50, doc=None):
    msg = make_message(message_id, "caption", doc=doc or make_document(777))
    return msg, utils.pack_bot_file_id(msg.media)


async def send(client, db, row, sleeps=None, **kw):
    return await send_media_file(client, db, chat_id=5, file_row=row, caption="cap", sleep=sleeps or Sleeps(), **kw)


async def test_a_good_file_id_is_sent_once_with_the_caption(db, client):
    row = await stored_file(db)
    result = await send(client, db, row)
    assert result == Delivery("sent") and client.sent == [(5, "STALE-ID", "cap")] and client.fetch_calls == []


async def test_an_expired_reference_is_refreshed_from_the_channel_and_the_new_id_is_stored(db, client):
    row = await stored_file(db)
    msg, fresh = fresh_message()
    client.messages[(CH, 50)] = msg
    client.send_script = [expired()]
    result = await send(client, db, row)
    assert result.ok and result.refreshed
    assert client.fetch_calls == [(CH, 50)]
    assert [s[1] for s in client.sent] == ["STALE-ID", fresh]  # retried with the fresh file_id
    assert (await db.get_file(row["id"]))["telegram_file_id"] == fresh  # and remembered


async def test_every_kind_of_stale_file_error_triggers_the_refresh(db, client):
    for error in (errors.FileReferenceInvalidError(request=None), errors.FileIdInvalidError(request=None), errors.MediaEmptyError(request=None),
                  ValueError("Failed to convert x to media. Not an existing file, an HTTP URL or a valid bot-API-like file ID")):
        client2 = FakeClient()
        row = await stored_file(db, file_id=f"S{type(error).__name__}", message_id=60 + len(str(error)))
        client2.messages[(CH, row["telegram_message_id"])] = fresh_message(row["telegram_message_id"], make_document())[0]
        client2.send_script = [error]
        assert (await send(client2, db, row)).refreshed, type(error)


async def test_a_refreshed_id_that_still_fails_falls_back_to_the_message_media_itself(db, client):
    row = await stored_file(db)
    msg, fresh = fresh_message()
    client.messages[(CH, 50)] = msg
    client.send_script = [expired(), expired()]
    result = await send(client, db, row)
    assert result.ok and [s[1] for s in client.sent] == ["STALE-ID", fresh, msg.media]


async def test_when_the_refreshed_id_is_unchanged_it_goes_straight_to_the_media_object(db, client):
    msg, fresh = fresh_message()
    row = await stored_file(db, file_id=fresh)
    client.messages[(CH, 50)] = msg
    client.send_script = [expired()]
    result = await send(client, db, row)
    assert result.ok and [s[1] for s in client.sent] == [fresh, msg.media]


async def test_giving_up_when_even_the_media_object_is_rejected(db, client):
    row = await stored_file(db)
    client.messages[(CH, 50)] = fresh_message()[0]
    client.send_script = [expired(), expired(), expired(), expired()]
    result = await send(client, db, row)
    assert result.status == "failed" and len(client.sent) == 3


async def test_a_post_deleted_from_the_channel_forgets_the_file(db, client):
    row = await stored_file(db)
    client.messages[(CH, 50)] = None
    client.send_script = [expired()]
    result = await send(client, db, row)
    assert result.status == "gone" and await db.get_file(row["id"]) is None and (await db.stats())["titles"] == 0


async def test_a_post_without_media_counts_as_gone(db, client):
    row = await stored_file(db)
    client.messages[(CH, 50)] = make_message(50, "text only", with_media=False)
    client.send_script = [expired()]
    assert (await send(client, db, row)).status == "gone"


async def test_a_fresh_id_that_another_row_owns_is_still_used_for_this_send(db, client):
    other = await stored_file(db, file_id="X", message_id=70)
    row = await stored_file(db, file_id="STALE", message_id=71)
    msg, fresh = fresh_message(71)
    await db.update_file_id(other["id"], fresh)  # someone else already stores that id
    client.messages[(CH, 71)] = msg
    client.send_script = [expired()]
    result = await send(client, db, row)
    assert result.ok and client.sent[-1][1] == fresh
    assert (await db.get_file(row["id"]))["telegram_file_id"] == "STALE"  # not overwritten: it would break uniqueness


# ---- flood waits ---------------------------------------------------------------------------------------------------------------
async def test_a_short_flood_wait_is_slept_out_and_retried(db, client):
    row = await stored_file(db)
    client.send_script = [flood(12)]
    sleeps = Sleeps()
    result = await send(client, db, row, sleeps)
    assert result.ok and sleeps.calls == [13] and len(client.sent) == 2


async def test_a_long_flood_wait_is_reported_not_slept(db, client):
    row = await stored_file(db)
    client.send_script = [flood(4000)]
    sleeps = Sleeps()
    result = await send(client, db, row, sleeps, max_flood_wait=300)
    assert (result.status, result.wait_seconds) == ("flood", 4000) and sleeps.calls == []


async def test_repeated_flood_waits_eventually_give_up(db, client):
    row = await stored_file(db)
    client.send_script = [flood(1)] * 10
    assert (await send(client, db, row)).status == "flood"


async def test_a_flood_wait_during_the_refresh_retries_the_refresh_not_the_stale_id(db, client):
    """Regression: a flood wait while fetching the message must not make the code resend the stale id."""
    row = await stored_file(db)
    msg, fresh = fresh_message()
    client.messages[(CH, 50)] = msg
    client.send_script = [expired()]
    client.fetch_script = [flood(5)]
    result = await send(client, db, row)
    assert result.ok and result.refreshed
    assert len(client.fetch_calls) == 2 and [s[1] for s in client.sent] == ["STALE-ID", fresh]


# ---- other failures ------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("error", [errors.UserIsBlockedError(request=None), errors.InputUserDeactivatedError(request=None),
                                   errors.ChatWriteForbiddenError(request=None), errors.PeerIdInvalidError(request=None)])
async def test_a_person_who_cannot_receive_files_is_not_retried(db, client, error):
    row = await stored_file(db)
    client.send_script = [error]
    result = await send(client, db, row)
    assert result.status == "blocked" and len(client.sent) == 1


async def test_an_unknown_chat_is_reported_as_unreachable_not_as_a_channel_problem(db, client):
    row = await stored_file(db)
    client.send_script = [ValueError("Could not find the input entity for PeerUser(user_id=5)")]
    assert (await send(client, db, row)).status == "blocked"


@pytest.mark.parametrize("error", [errors.ChannelPrivateError(request=None), errors.ChatAdminRequiredError(request=None),
                                   ValueError("Could not find the input entity for PeerChannel(channel_id=1)")])
async def test_a_storage_channel_the_bot_cannot_read_is_reported(db, client, error):
    row = await stored_file(db)
    client.send_script = [expired()]
    client.fetch_script = [error]
    assert (await send(client, db, row)).status == "channel_unavailable"


async def test_network_errors_back_off_then_succeed_or_give_up(db, client):
    row = await stored_file(db)
    client.send_script = [ConnectionError("reset"), TimeoutError("slow")]
    sleeps = Sleeps()
    assert (await send(client, db, row, sleeps)).ok and sleeps.calls == [2, 4]
    client.send_script = [ConnectionError("x")] * 10
    assert (await send(client, db, row, Sleeps())).status == "failed"


async def test_an_unexpected_error_is_reported_without_endless_retries(db, client):
    row = await stored_file(db)
    client.send_script = [RuntimeError("boom")]
    result = await send(client, db, row)
    assert result.status == "failed" and result.detail == "RuntimeError" and len(client.sent) == 1


async def test_cancellation_is_never_swallowed(db, client):
    row = await stored_file(db)
    client.send_script = [asyncio.CancelledError()]
    with pytest.raises(asyncio.CancelledError):
        await send(client, db, row)


# ---- helpers ---------------------------------------------------------------------------------------------------------------------
def test_flood_seconds_recognises_telethons_error_and_other_shapes():
    assert flood_seconds(flood(9)) == 9
    assert flood_seconds(ValueError("nope")) is None

    class FloodWait(Exception):  # Pyrogram's shape
        value = 4

    assert flood_seconds(FloodWait()) == 4


def test_invalid_file_detection_by_class_message_and_text():
    assert is_invalid_file_error(expired())
    assert is_invalid_file_error(errors.RPCError(request=None, message="FILE_REFERENCE_3_EXPIRED"))
    assert is_invalid_file_error(ValueError("Failed to convert abc to media"))
    assert not is_invalid_file_error(ValueError("something else"))
    assert not is_invalid_file_error(ConnectionError("x"))


async def test_retry_flood_waits_then_returns_and_reraises_long_waits():
    sleeps, calls = Sleeps(), []

    async def op():
        calls.append(1)
        if len(calls) < 3:
            raise flood(3)
        return "ok"

    assert await retry_flood(op, sleep=sleeps) == "ok" and sleeps.calls == [4, 4]

    async def long():
        raise flood(900)

    with pytest.raises(errors.FloodWaitError):
        await retry_flood(long, max_wait=300, sleep=Sleeps())

    async def other():
        raise KeyError("x")

    with pytest.raises(KeyError):
        await retry_flood(other, sleep=Sleeps())
