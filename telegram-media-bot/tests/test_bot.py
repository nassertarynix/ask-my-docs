import pytest
from telethon import errors, utils

from bot import Action, Cooldown, LibraryBot, SearchMemory, is_video_message, to_buttons
from config import Config
from fakes import CHANNEL, FakeButtonEvent, FakeClient, FakeTextEvent, make_document, make_message, yaml_caption


def callback_data(button):
    """The callback bytes of a Telethon inline button. Newer Telethon stores them at .type.data, older at .data."""
    return getattr(button, "data", None) or button.type.data


async def post(bot, message_id, caption, **kw):
    return await bot.ingest_message(make_message(message_id, caption, **kw))


async def fill(bot):
    """A small library: a movie in two qualities, an anime with 2 seasons, and a one-file show."""
    await post(bot, 1, yaml_caption("Dune", "Movie", 2021, resolution="1080p", genres="SciFi"))
    await post(bot, 2, yaml_caption("Dune", "Movie", 2021, resolution="4K"))
    for mid, (s, e) in enumerate([(1, 1), (1, 2), (1, 3), (2, 1)], start=10):
        await post(bot, mid, yaml_caption("Attack on Titan", "Anime", 2013, season=s, episode=e, resolution="1080p"))
    await post(bot, 20, yaml_caption("Solo Short", "Show", 2020))


# ---- ingestion -----------------------------------------------------------------------------------------------------------------
async def test_a_video_post_with_a_yaml_caption_is_indexed_with_a_real_bot_file_id(bot, db):
    msg = make_message(7, yaml_caption("Attack on Titan", "Anime", 2013, season=1, episode=1, resolution="1080p", genres="Action, Fantasy"))
    out = await bot.ingest_message(msg)
    assert out.status == "indexed"
    row = await db.get_file((await db.files_for(out.media_id, 1, 1))[0]["id"])
    assert (row["telegram_message_id"], row["channel_id"], row["quality_resolution"]) == (7, CHANNEL, "1080p")
    assert row["telegram_file_id"] == utils.pack_bot_file_id(msg.media)
    assert utils.resolve_bot_file_id(row["telegram_file_id"]).id == msg.media.document.id  # the stored id really points at the video
    assert (await db.get_media(out.media_id))["genre"] == "Action, Fantasy"


async def test_legacy_captions_are_indexed_too(bot, db):
    out = await post(bot, 8, "Title: Breaking Bad\nType: Show\nYear: 2008\nSeason: 2\nEpisode: 5\nResolution: 720P\n#Crime")
    assert out.status == "indexed" and (await db.search("breaking"))[1] == 1


@pytest.mark.parametrize("kwargs,reason", [({"mime": "image/png", "video_attr": False}, "not a video"), ({"with_media": False}, "not a video"),
                                           ({"channel": -1009999999999}, "not the storage channel")])
async def test_posts_that_are_not_videos_or_not_in_the_storage_channel_are_ignored(bot, db, kwargs, reason):
    out = await post(bot, 1, yaml_caption("X", "Movie"), **kwargs)
    assert (out.status, out.reason) == ("ignored", reason) and (await db.stats())["files"] == 0


async def test_a_video_sent_as_a_document_is_accepted(bot):
    mkv = make_message(3, yaml_caption("Doc Movie", "Movie"), mime="application/x-matroska", video_attr=False)
    by_attr = make_message(4, yaml_caption("Attr Movie", "Movie"), mime="application/octet-stream", video_attr=True)
    assert is_video_message(mkv) and is_video_message(by_attr)
    assert (await bot.ingest_message(mkv)).status == "indexed" and (await bot.ingest_message(by_attr)).status == "indexed"


async def test_a_caption_without_a_title_is_skipped_and_the_admins_are_told(bot, client, db):
    out = await post(bot, 5, "just a nice movie, enjoy")
    assert out.status == "skipped" and (await db.stats())["files"] == 0
    assert len(client.dms) == 1 and client.dms[0][0] == 99 and "message 5" in client.dms[0][1]


async def test_a_post_with_no_caption_at_all_is_skipped_quietly_for_reindexing(bot, client):
    out = await bot.ingest_message(make_message(6, None), notify=False)
    assert out.status == "skipped" and client.dms == []


async def test_a_missing_type_is_inferred_and_reported(bot, db):
    movie = await post(bot, 9, "---\ntitle: Some Movie\n---")
    assert movie.status == "indexed" and (await db.get_media(movie.media_id))["type"] == "Movie"
    show = await post(bot, 10, "---\ntitle: Some Show\nepisode: 3\n---")
    assert show.status == "indexed" and "type missing, assumed Show" in show.reason and "season missing, assumed 1" in show.reason
    row = (await db.files_for(show.media_id, 1, 3))[0]
    assert (await db.get_media(show.media_id))["type"] == "Show" and row["episode_number"] == 3


async def test_the_same_file_posted_twice_is_a_duplicate(bot, db):
    doc = make_document(4242)
    first = await bot.ingest_message(make_message(11, yaml_caption("A", "Movie"), doc=doc))
    second = await bot.ingest_message(make_message(12, yaml_caption("A2", "Movie"), doc=doc))
    assert (first.status, second.status) == ("indexed", "duplicate") and (await db.stats())["titles"] == 1


async def test_editing_a_caption_updates_the_entry_and_a_bad_edit_keeps_the_old_one(bot, db):
    doc = make_document(555)
    await bot.ingest_message(make_message(30, yaml_caption("Wrong Name", "Movie", 2020), doc=doc))
    out = await bot.ingest_message(make_message(30, yaml_caption("Right Name", "Movie", 2020), doc=doc))
    assert out.status == "updated" and (await db.search("wrong"))[1] == 0 and (await db.search("right"))[1] == 1
    bad = await bot.ingest_message(make_message(30, "oops, deleted the metadata", doc=doc))
    assert bad.status == "skipped" and (await db.search("right"))[1] == 1


async def test_deleted_posts_are_forgotten_with_their_empty_titles(bot, db):
    await fill(bot)
    assert await bot.handle_deleted(CHANNEL, [1, 2]) == 2
    assert (await db.search("dune"))[1] == 0
    assert await bot.handle_deleted(None, [20]) == 1  # no chat id: the storage channel is assumed
    assert await bot.handle_deleted(-1009999999999, [10]) == 0


# ---- reindex --------------------------------------------------------------------------------------------------------------------
async def test_reindex_reads_the_channel_by_id_and_stops_after_a_gap(bot, client, db):
    for mid in (3, 4, 150):
        client.messages[(CHANNEL, mid)] = make_message(mid, yaml_caption(f"Movie {mid}", "Movie"))
    client.messages[(CHANNEL, 5)] = make_message(5, "no metadata here")
    counts = await bot.reindex()
    assert counts["indexed"] == 3 and counts["skipped"] == 1
    assert counts["last_id_checked"] >= 150 + 250 and (await db.stats())["titles"] == 3
    assert client.dms == []  # a bulk reindex does not message the admins once per bad post


async def test_reindex_respects_the_range_and_is_repeatable(bot, client, db):
    for mid in (1, 2, 3):
        client.messages[(CHANNEL, mid)] = make_message(mid, yaml_caption(f"M{mid}", "Movie"))
    counts = await bot.reindex(2, 3)
    assert counts["indexed"] == 2 and counts["last_id_checked"] == 3 and (await db.stats())["titles"] == 2
    again = await bot.reindex(1, 3)
    assert (again["indexed"], again["updated"]) == (1, 2)  # id 1 is new; 2 and 3 were already indexed


async def test_a_flood_wait_while_reindexing_is_waited_out(bot, client):
    client.messages[(CHANNEL, 1)] = make_message(1, yaml_caption("M", "Movie"))
    client.fetch_script = [errors.FloodWaitError(request=None, capture=3)]
    assert (await bot.reindex(1, 5))["indexed"] == 1


async def test_check_channel_reports_a_channel_the_bot_cannot_see(bot, client):
    assert await bot.check_channel() is True
    client.entity_error = ValueError("Could not find the input entity")
    assert await bot.check_channel() is False


# ---- commands and search -----------------------------------------------------------------------------------------------------------
async def test_start_and_help(bot):
    assert "Media library" in (await bot.command_reply(1, "/start")).text
    assert "Media library" in (await bot.command_reply(1, "/help@MyBot")).text


async def test_search_by_command_and_by_plain_text(bot):
    await fill(bot)
    for text in ("/search attack titan", "/search@MyLibraryBot attack titan", "titan attack", "ATTACK"):
        reply = await bot.command_reply(1, text)
        assert "Attack on Titan" in reply.keyboard[0][0][0], text
    assert (await bot.command_reply(1, "/search")).text.startswith("Usage")
    assert "No titles match" in (await bot.command_reply(1, "nothing like this")).text


async def test_a_title_cannot_inject_formatting_into_the_reply(bot):
    await post(bot, 40, yaml_caption("<b>Bold</b> & *star*", "Movie"))
    reply = await bot.command_reply(1, "<script>alert(1)</script>")
    assert "<script>" not in reply.text and "&lt;script&gt;" in reply.text
    reply = await bot.command_reply(1, "bold")
    assert "<b>Bold</b>" in reply.keyboard[0][0][0]  # button labels are plain text, shown as typed


async def test_blank_messages_are_ignored_and_unknown_commands_answered(bot):
    assert await bot.command_reply(1, "   ") is None and await bot.command_reply(1, "") is None
    assert "Unknown command" in (await bot.command_reply(1, "/dance")).text


async def test_long_queries_are_truncated(bot):
    reply = await bot.command_reply(1, "x" * 5000)
    assert len(reply.text) < 400


async def test_stats_and_reindex_are_for_administrators_only(bot, client):
    await fill(bot)
    assert "administrators" in (await bot.command_reply(1, "/stats")).text
    assert "administrators" in (await bot.command_reply(1, "/reindex")).text
    stats = (await bot.command_reply(99, "/stats")).text
    assert "3 titles (1 movies, 1 anime, 1 shows)" in stats and "7 files" in stats
    client.messages[(CHANNEL, 99)] = make_message(99, yaml_caption("New", "Movie"))
    done = await bot.command_reply(99, "/reindex 99 99")
    assert "indexed: 1" in done.text
    assert "Usage" in (await bot.command_reply(99, "/reindex 1 2 3")).text and "Usage" in (await bot.command_reply(99, "/reindex abc")).text


async def test_reindex_tells_the_admin_when_the_channel_is_unreachable(bot, client):
    client.fetch_script = [errors.ChannelPrivateError(request=None)]
    assert "ADMINISTRATOR" in (await bot.command_reply(99, "/reindex")).text


async def test_a_private_library_refuses_strangers_everywhere(client, db, tmp_path):
    cfg = Config(api_id=1, api_hash="h", bot_token="1:a", storage_channel_id=CHANNEL, allowed_user_ids=frozenset({5}), admin_ids=frozenset({99}))
    private = LibraryBot(client, db, cfg)
    await post(private, 1, yaml_caption("Secret", "Movie"))
    assert (await private.command_reply(6, "secret")).text == "This library is private."
    assert "Secret" in (await private.command_reply(5, "secret")).keyboard[0][0][0]
    assert "Secret" in (await private.command_reply(99, "secret")).keyboard[0][0][0]  # admins may always use it
    assert (await private.route_callback(6, b"m:1")).alert == "This library is private."


# ---- the menus ------------------------------------------------------------------------------------------------------------------------
async def press(bot, data, user=1):
    return await bot.route_callback(user, data)


async def test_a_movie_with_two_qualities_asks_for_the_quality_then_sends_that_file(bot, db):
    await fill(bot)
    results = await bot.command_reply(1, "dune")
    media_cb = results.keyboard[0][0][1]
    menu = await press(bot, media_cb)
    assert menu.send is None and [b[0] for b in menu.edit.keyboard[0]] == ["4K", "1080p"]
    send = await press(bot, menu.edit.keyboard[0][1][1])
    assert send.send["quality_resolution"] == "1080p" and send.send["title"] == "Dune"


async def test_a_movie_with_one_file_is_sent_directly(bot):
    await post(bot, 1, yaml_caption("Only One", "Movie", 2019))
    results = await bot.command_reply(1, "only")
    action = await press(bot, results.keyboard[0][0][1])
    assert action.edit is None and action.send["title"] == "Only One"


async def test_an_anime_walks_seasons_then_episodes_then_sends(bot):
    await fill(bot)
    media_cb = (await bot.command_reply(1, "titan")).keyboard[0][0][1]
    seasons = await press(bot, media_cb)
    labels = [b[0] for row in seasons.edit.keyboard for b in row]
    assert labels[:2] == ["Season 1 · 3", "Season 2 · 1"] and labels[-1] == "‹ Back to results"
    episodes = await press(bot, seasons.edit.keyboard[0][0][1])
    assert [b[0] for b in episodes.edit.keyboard[0]] == ["E1", "E2", "E3"]
    assert episodes.edit.keyboard[-1][0][0] == "‹ Back to seasons"
    sent = await press(bot, episodes.edit.keyboard[0][1][1])
    assert (sent.send["season_number"], sent.send["episode_number"]) == (1, 2)


async def test_back_buttons_lead_where_they_say(bot):
    await fill(bot)
    results = await bot.command_reply(1, "titan")
    seasons = await press(bot, results.keyboard[0][0][1])
    back = await press(bot, seasons.edit.keyboard[-1][0][1])  # "Back to results"
    assert back.edit.keyboard[0][0][0].endswith("Attack on Titan (2013)")
    episodes = await press(bot, seasons.edit.keyboard[0][0][1])
    to_seasons = await press(bot, episodes.edit.keyboard[-1][0][1])
    assert "Choose a season" in to_seasons.edit.text


async def test_a_one_file_show_with_no_season_is_sent_directly(bot):
    await fill(bot)
    action = await press(bot, (await bot.command_reply(1, "solo")).keyboard[0][0][1])
    assert action.send["title"] == "Solo Short"


async def test_an_episode_in_two_qualities_offers_a_choice(bot):
    await post(bot, 1, yaml_caption("S", "Show", season=1, episode=1, resolution="720p"))
    await post(bot, 2, yaml_caption("S", "Show", season=1, episode=1, resolution="1080p"))
    media_id = (await bot.db.search("s"))[0][0]["id"]
    action = await press(bot, f"e:{media_id}:1:1")
    assert "Choose a quality" in action.edit.text and [b[0] for b in action.edit.keyboard[0]] == ["1080p", "720p"]


async def test_search_paging_survives_and_an_expired_search_is_explained(bot):
    for i in range(20):
        await post(bot, 100 + i, yaml_caption(f"Movie {i:02d}", "Movie"))
    first = await bot.command_reply(1, "movie")
    assert len(first.keyboard) == 9 and first.keyboard[-1][-1][0] == "Next ›"
    nxt = await press(bot, first.keyboard[-1][-1][1])
    assert nxt.edit.keyboard[0][0][0].endswith("Movie 08") and [b[0] for b in nxt.edit.keyboard[-1]] == ["‹ Prev", "2/3", "Next ›"]
    assert (await press(bot, "s:zzzz:0")).alert == "That search has expired. Send your search again."


async def test_a_page_past_the_end_after_the_library_shrank_shows_the_last_page(bot):
    for i in range(10):
        await post(bot, 100 + i, yaml_caption(f"Movie {i}", "Movie"))
    first = await bot.command_reply(1, "movie")
    token = first.keyboard[-1][-1][1].split(":")[1]
    await bot.db.delete_messages(CHANNEL, list(range(103, 110)))
    action = await press(bot, f"s:{token}:1")
    assert action.edit is not None and "<b>3</b> titles" in action.edit.text and len(action.edit.keyboard) == 3


async def test_removed_items_and_bad_buttons_get_a_clear_alert_not_an_error(bot):
    assert "no longer" in (await press(bot, "m:999")).alert
    assert "no longer" in (await press(bot, "q:999")).alert
    assert "no longer" in (await press(bot, "e:999:1:1")).alert
    assert "no longer" in (await press(bot, "t:999:1:0")).alert
    assert "not valid" in (await press(bot, "garbage")).alert and "not valid" in (await press(bot, None)).alert
    assert await press(bot, "x") == Action()


async def test_long_seasons_are_paged(bot):
    for e in range(1, 121):
        await post(bot, 1000 + e, yaml_caption("One Long Show", "Anime", season=1, episode=e))
    media_id = (await bot.db.search("long"))[0][0]["id"]
    page = await press(bot, f"t:{media_id}:1:2")
    assert page.edit.keyboard[0][0][0] == "E101" and sum(len(r) for r in page.edit.keyboard) <= 100


# ---- sending ------------------------------------------------------------------------------------------------------------------------
async def test_deliver_sends_with_a_caption_and_throttles_repeat_requests(client, db, config, clock):
    cfg = Config(api_id=1, api_hash="h", bot_token="1:a", storage_channel_id=CHANNEL, send_cooldown=3.0, admin_ids=frozenset({99}))
    bot = LibraryBot(client, db, cfg, clock=clock)
    await post(bot, 1, yaml_caption("Dune", "Movie", 2021, resolution="4K"))
    file = (await press(bot, (await bot.command_reply(1, "dune")).keyboard[0][0][1])).send
    assert await bot.deliver(7, 1, file) is None
    assert client.sent[0][0] == 7 and client.sent[0][2] == "Dune (2021) · 4K"
    assert "wait" in await bot.deliver(7, 1, file)
    assert len(client.sent) == 1
    clock.now += 3.5
    assert await bot.deliver(7, 1, file) is None and len(client.sent) == 2
    assert await bot.deliver(8, 2, file) is None and len(client.sent) == 3 and client.sent[-1][0] == 8  # another person has their own allowance


async def test_a_second_tap_while_a_file_is_being_sent_is_ignored(bot, client):
    await post(bot, 1, yaml_caption("Dune", "Movie"))
    file = (await press(bot, (await bot.command_reply(1, "dune")).keyboard[0][0][1])).send
    bot._sending.add((1, file["id"]))
    assert "Already sending" in await bot.deliver(7, 1, file) and client.sent == []


async def test_delivery_problems_are_explained_to_the_user_and_the_admins_are_told_when_it_matters(bot, client, db):
    await post(bot, 1, yaml_caption("Dune", "Movie"))
    file = (await press(bot, (await bot.command_reply(1, "dune")).keyboard[0][0][1])).send
    client.send_script = [errors.UserIsBlockedError(request=None)]
    assert await bot.deliver(7, 1, file) is None  # nobody to tell
    client.send_script = [errors.FloodWaitError(request=None, capture=4000)]
    assert "limiting this bot" in await bot.deliver(7, 2, file)
    client.send_script = [RuntimeError("x")]
    assert "could not be sent" in await bot.deliver(7, 3, file)
    client.send_script = [errors.FileReferenceExpiredError(request=None)]
    client.messages[(CHANNEL, 1)] = None
    assert "no longer available" in await bot.deliver(7, 4, file)
    assert any("removed from the library" in text for _, text in client.dms)
    assert (await db.stats())["files"] == 0


async def test_an_unreachable_storage_channel_alerts_the_admins(bot, client):
    await post(bot, 1, yaml_caption("Dune", "Movie"))
    file = (await press(bot, (await bot.command_reply(1, "dune")).keyboard[0][0][1])).send
    client.send_script = [errors.FileReferenceExpiredError(request=None)]
    client.fetch_script = [errors.ChannelPrivateError(request=None)]
    assert "not reachable" in await bot.deliver(7, 1, file)
    assert any("ADMINISTRATOR" in text for _, text in client.dms)


# ---- the whole journey, with a stale file id -----------------------------------------------------------------------------------------
async def test_search_to_file_even_when_telegram_has_invalidated_the_file_id(bot, client, db):
    msg = make_message(10, yaml_caption("Attack on Titan", "Anime", 2013, season=1, episode=1, resolution="1080p"))
    await bot.ingest_message(msg)
    client.messages[(CHANNEL, 10)] = msg
    client.send_script = [errors.FileReferenceExpiredError(request=None)]
    results = await bot.command_reply(1, "attack on titan")
    seasons = await press(bot, results.keyboard[0][0][1])
    episodes = await press(bot, seasons.edit.keyboard[0][0][1])
    action = await press(bot, episodes.edit.keyboard[0][0][1])
    assert await bot.deliver(1, 1, action.send) is None
    assert len(client.sent) == 2 and client.fetch_calls == [(CHANNEL, 10)]


# ---- helpers and Telethon wiring ---------------------------------------------------------------------------------------------------------
def test_search_memory_reuses_tokens_expires_and_stays_bounded():
    now = [0.0]
    mem = SearchMemory(capacity=3, ttl=10, clock=lambda: now[0])
    a = mem.remember("alpha")
    assert mem.remember("alpha") == a and mem.lookup(a) == "alpha"
    for q in ("b", "c", "d"):
        mem.remember(q)
    assert mem.lookup(a) is None  # pushed out by capacity
    t = mem.remember("fresh")
    now[0] = 11
    assert mem.lookup(t) is None  # expired
    mem.set_last(1, "t", 2)
    assert mem.last(1) == ("t", 2) and mem.last(2) is None


def test_cooldown_per_person():
    now = [100.0]
    cd = Cooldown(2.0, clock=lambda: now[0])
    assert cd.wait_time(1) == 0
    cd.hit(1)
    assert 1.9 < cd.wait_time(1) <= 2.0 and cd.wait_time(2) == 0
    now[0] += 2.1
    assert cd.wait_time(1) == 0


def test_buttons_are_built_as_inline_buttons_with_the_callback_data():
    rows = to_buttons([[("A", "m:1"), ("B", "q:2")], [("C", "x")]])
    assert [[b.text for b in row] for row in rows] == [["A", "B"], ["C"]] and callback_data(rows[0][1]) == b"q:2"
    assert to_buttons([]) is None


async def test_register_wires_the_five_handlers_and_they_work(bot, client, db):
    bot.register()
    assert len(client.handlers) == 5
    on_post, on_edit, on_delete, on_private, on_button = [h[0] for h in client.handlers]

    class PostEvent:
        message = make_message(7, yaml_caption("Wired", "Movie"))

    await on_post(PostEvent())
    assert (await db.search("wired"))[1] == 1

    class Deleted:
        deleted_ids = [7]
        chat_id = CHANNEL

    await on_delete(Deleted())
    assert (await db.search("wired"))[1] == 0

    await on_edit(PostEvent())
    text = FakeTextEvent("wired")
    await on_private(text)
    assert "Found" in text.responses[0][0] and text.responses[0][1] is not None
    assert (await on_private(FakeTextEvent("wired", private=False))) is None  # groups are ignored

    press_event = FakeButtonEvent(callback_data(text.responses[0][1][0][0]), chat_id=44)
    await on_button(press_event)
    assert client.sent and client.sent[0][0] == 44 and press_event.answers == [("Sending\u2026", False)]


async def test_button_handler_edits_menus_answers_alerts_and_ignores_stale_presses(bot, client):
    bot.register()
    on_button = client.handlers[4][0]
    await post(bot, 1, yaml_caption("A Show", "Show", season=1, episode=1))
    await post(bot, 2, yaml_caption("A Show", "Show", season=1, episode=2))
    media_id = (await bot.db.search("show"))[0][0]["id"]
    event = FakeButtonEvent(f"m:{media_id}".encode())
    await on_button(event)
    assert "Choose a season" in event.edits[0][0] and event.answers == [(None, False)]
    event = FakeButtonEvent(b"m:999")
    await on_button(event)
    assert event.edits == [] and event.answers[0][1] is True
    event = FakeButtonEvent(f"m:{media_id}".encode())
    event.edit_error = errors.MessageNotModifiedError(request=None)
    await on_button(event)  # pressing the same button twice must not crash
    assert event.answers
    group = FakeButtonEvent(b"m:1", private=False)
    await on_button(group)
    assert group.answers == [] and group.edits == []
    episode = FakeButtonEvent(f"e:{media_id}:1:1".encode(), chat_id=55)
    await on_button(episode)
    assert client.sent[-1][0] == 55 and episode.answers[0] == ("Sending…", False)
    again = FakeButtonEvent(f"e:{media_id}:1:1".encode(), chat_id=55)
    bot.cooldown.interval = 60
    bot.cooldown.hit(1)
    await on_button(again)
    assert again.answers[0][1] is True


async def test_users_can_search_by_genre_year_and_type_in_one_message(bot):
    await post(bot, 1, yaml_caption("Attack on Titan", "Anime", 2013, season=1, episode=1, genres="[Action, Fantasy]"))
    await post(bot, 2, yaml_caption("Dune", "Movie", 2021, genres="[Sci-Fi]"))
    await post(bot, 3, "Title: Blade Runner\nType: Movie\nYear: 1982\n#SciFi #Thriller")
    for text, expected in (("action 2013", "Attack on Titan"), ("sci-fi movie 2021", "Dune"), ("scifi", "Blade Runner"), ("anime", "Attack on Titan")):
        reply = await bot.command_reply(1, text)
        assert expected in reply.keyboard[0][0][0], text
    assert "No titles match" in (await bot.command_reply(1, "action 1999")).text
    assert "genre, year or type" in (await bot.command_reply(1, "/help")).text
