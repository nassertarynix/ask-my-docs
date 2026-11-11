import asyncio
import sqlite3

import pytest

from database import Database, SCHEMA_VERSION, like_pattern, quality_sort_key

CH = -1001234567890


async def add(db, title="Dune", kind="Movie", year=None, season=None, episode=None, quality=None, fid=None, mid=None, genre=None):
    n = add.n = getattr(add, "n", 0) + 1
    meta = {"title": title, "type": kind}
    for key, value in (("release_year", year), ("season_number", season), ("episode_number", episode), ("quality_resolution", quality), ("genre", genre)):
        if value is not None:
            meta[key] = value
    return await db.index_file(meta, file_id=fid or f"FID{n}", message_id=mid or 1000 + n, channel_id=CH)


# ---- connection settings, schema ---------------------------------------------------------------------------------------------
async def test_every_connection_has_foreign_keys_on_wal_and_the_casefold_function(db):
    for conn in db._all:
        assert conn.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        assert conn.execute("SELECT casefold('\u00c9COLE')").fetchone()[0] == "\u00e9cole"
    assert db._writer.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    assert db._writer.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION


async def test_the_schema_matches_the_specification(db):
    rows = {r["name"]: r["sql"] for r in db._writer.execute("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL").fetchall()}
    assert {"media", "media_files", "idx_media_title", "idx_media_files_lookup", "uq_media_identity"} <= set(rows)
    files = rows["media_files"]
    assert "telegram_file_id TEXT UNIQUE NOT NULL" in files and "telegram_message_id INTEGER UNIQUE NOT NULL" in files
    assert "ON DELETE CASCADE" in files and "channel_id INTEGER NOT NULL" in files
    assert "CHECK(type IN ('Movie', 'Anime', 'Show'))" in rows["media"]


async def test_the_database_itself_refuses_a_bad_type(db):
    with pytest.raises(sqlite3.IntegrityError):
        db._writer.execute("INSERT INTO media(title, type) VALUES ('x', 'Podcast')")


async def test_deleting_a_title_cascades_to_its_files_because_foreign_keys_are_on(db):
    r = await add(db)
    db._writer.execute("DELETE FROM media WHERE id = ?", (r.media_id,))
    assert db._writer.execute("SELECT COUNT(*) FROM media_files").fetchone()[0] == 0


async def test_readers_cannot_write(db):
    reader = db._readers.get_nowait()
    with pytest.raises(sqlite3.OperationalError):
        reader.execute("INSERT INTO media(title, type) VALUES ('x', 'Movie')")
    db._readers.put_nowait(reader)


async def test_reopen_keeps_data_and_an_in_memory_database_is_refused(tmp_path):
    first = await Database(tmp_path / "x.db").open()
    await add(first, "Keep")
    await first.close()
    second = await Database(tmp_path / "x.db").open()
    assert (await second.search("keep"))[1] == 1
    await second.close()
    with pytest.raises(ValueError):
        await Database(":memory:").open()


async def test_a_database_from_a_newer_version_is_refused(tmp_path):
    first = await Database(tmp_path / "x.db").open()
    first._writer.execute(f"PRAGMA user_version = {SCHEMA_VERSION + 1}")
    await first.close()
    with pytest.raises(RuntimeError, match="newer"):
        await Database(tmp_path / "x.db").open()


# ---- indexing and de-duplication --------------------------------------------------------------------------------------------
async def test_a_new_file_creates_its_title(db):
    r = await add(db, "Dune", "Movie", 2021, quality="1080p")
    assert (r.status, r.media_created) == ("inserted", True)
    assert (await db.get_media(r.media_id))["release_year"] == 2021


async def test_the_same_title_is_reused_regardless_of_case_and_gets_one_row(db):
    a = await add(db, "Attack on Titan", "Anime", 2013, season=1, episode=1)
    b = await add(db, "ATTACK ON TITAN", "Anime", 2013, season=1, episode=2)
    assert a.media_id == b.media_id and not b.media_created
    assert (await db.stats())["titles"] == 1


async def test_the_same_title_with_another_type_or_year_is_a_different_title(db):
    a = await add(db, "Dune", "Movie", 1984)
    b = await add(db, "Dune", "Movie", 2021)
    c = await add(db, "Dune", "Show", 2021)
    assert len({a.media_id, b.media_id, c.media_id}) == 3


async def test_a_caption_without_a_year_joins_the_only_matching_title(db):
    a = await add(db, "Dune", "Movie", 2021, quality="1080p")
    b = await add(db, "dune", "Movie", None, quality="720p")
    assert a.media_id == b.media_id


async def test_a_caption_without_a_year_picks_the_oldest_when_remakes_exist(db):
    old = await add(db, "Dune", "Movie", 1984)
    await add(db, "Dune", "Movie", 2021)
    assert (await add(db, "Dune", "Movie", None)).media_id == old.media_id


async def test_a_title_stored_without_a_year_adopts_one_later(db):
    a = await add(db, "Dune", "Movie", None)
    b = await add(db, "Dune", "Movie", 2021)
    assert a.media_id == b.media_id and (await db.get_media(a.media_id))["release_year"] == 2021


async def test_genre_is_filled_in_but_never_overwritten(db):
    a = await add(db, "X", "Movie", genre=None)
    await add(db, "X", "Movie", genre="Action")
    await add(db, "X", "Movie", genre="Comedy")
    assert (await db.get_media(a.media_id))["genre"] == "Action"


async def test_the_unique_index_enforces_one_title_in_the_database_itself(db):
    await add(db, "Dune", "Movie", 2021)
    with pytest.raises(sqlite3.IntegrityError):
        db._writer.execute("INSERT INTO media(title, type, release_year) VALUES ('DUNE', 'Movie', 2021)")


async def test_the_same_file_in_another_post_is_a_duplicate_and_creates_nothing(db):
    await add(db, "A", fid="SAME", mid=1)
    r = await add(db, "B-should-not-exist", fid="SAME", mid=2)
    assert (r.status, r.existing_message_id) == ("duplicate", 1)
    assert (await db.stats()) == {"titles": 1, "files": 1, "movies": 1, "anime": 0, "shows": 0}


async def test_a_post_seen_again_updates_in_place_and_can_move_to_another_title(db):
    first = await add(db, "Wrong Title", "Movie", fid="F", mid=5)
    again = await add(db, "Right Title", "Movie", fid="F", mid=5)
    assert again.status == "updated" and again.file_row_id == first.file_row_id
    assert (await db.search("wrong"))[1] == 0 and (await db.search("right"))[1] == 1
    # search hides titles without files, so count the rows themselves: the emptied old title must really be gone
    assert (await db.stats())["files"] == 1 and (await db.stats())["titles"] == 1


async def test_an_edit_that_keeps_the_title_keeps_one_title(db):
    await add(db, "Same", "Movie", quality="720p", fid="F", mid=5)
    r = await add(db, "Same", "Movie", quality="1080p", fid="F", mid=5)
    assert r.status == "updated" and (await db.files_for(r.media_id, None, None))[0]["quality_resolution"] == "1080p"


async def test_an_edit_cannot_steal_another_posts_file_id(db):
    await add(db, "A", fid="A-id", mid=1)
    await add(db, "B", fid="B-id", mid=2)
    r = await add(db, "B", fid="A-id", mid=2)
    assert r.status == "duplicate"


async def test_a_failure_halfway_writes_nothing(db):
    await add(db, "A", fid="F1", mid=1)
    with pytest.raises(sqlite3.IntegrityError):
        await db.index_file({"title": "Brand New", "type": "Movie"}, file_id="F9", message_id=1, channel_id=CH + 1)  # reuses message id 1
    assert (await db.search("brand"))[1] == 0


async def test_concurrent_indexing_loses_nothing(db):
    results = await asyncio.gather(*[add(db, f"Title {i}", "Movie", fid=f"CF{i}", mid=5000 + i) for i in range(40)])
    assert all(r.status == "inserted" for r in results) and (await db.stats())["titles"] == 40


# ---- deleting -------------------------------------------------------------------------------------------------------------
async def test_deleting_posts_removes_their_files_and_empty_titles_only(db):
    a = await add(db, "Show", "Show", season=1, episode=1, mid=10)
    await add(db, "Show", "Show", season=1, episode=2, mid=11)
    await add(db, "Solo", "Movie", mid=12)
    assert await db.delete_messages(CH, [10, 12, 999]) == 2
    assert (await db.stats())["titles"] == 1 and (await db.get_media(a.media_id)) is not None
    assert await db.delete_messages(CH, []) == 0


async def test_deleting_a_post_in_another_channel_changes_nothing(db):
    await add(db, "Keep", mid=10)
    assert await db.delete_messages(CH + 5, [10]) == 0


async def test_delete_file_and_update_file_id(db):
    a = await add(db, "A", fid="F1", mid=1)
    b = await add(db, "B", fid="F2", mid=2)
    assert await db.update_file_id(a.file_row_id, "NEW") is True
    assert await db.update_file_id(a.file_row_id, "F2") is False  # another row owns it
    assert (await db.get_file(a.file_row_id))["telegram_file_id"] == "NEW"
    await db.delete_file(b.file_row_id)
    assert (await db.stats())["titles"] == 1


# ---- searching -------------------------------------------------------------------------------------------------------------
async def test_search_matches_every_word_in_any_order_and_any_case(db):
    await add(db, "Attack on Titan", "Anime")
    await add(db, "Titan A.E.", "Movie")
    rows, total = await db.search("TITAN attack")
    assert total == 1 and rows[0]["title"] == "Attack on Titan"
    assert (await db.search("titan"))[1] == 2


async def test_search_is_case_insensitive_beyond_ascii(db):
    await add(db, "\u00c9COLE DES FANS", "Movie")
    await add(db, "\u0424\u0438\u043b\u044c\u043c \u0411\u043e\u043c\u0431\u0430", "Movie")
    assert (await db.search("\u00e9cole"))[1] == 1
    assert (await db.search("\u0444\u0418\u043b\u044c\u043c"))[1] == 1


async def test_percent_and_underscore_in_a_search_match_themselves(db):
    await add(db, "100% Wolf", "Movie")
    await add(db, "Some_Name", "Movie")
    await add(db, "Plain", "Movie")
    assert (await db.search("%"))[1] == 1
    assert (await db.search("_"))[1] == 1
    assert (await db.search("100%"))[0][0]["title"] == "100% Wolf"
    assert (await db.search("a\\b"))[1] == 0


async def test_a_quote_or_sql_in_the_search_is_just_text(db):
    await add(db, "It's Fine", "Movie")
    assert (await db.search("it's"))[1] == 1
    assert (await db.search("'; DROP TABLE media; --"))[1] == 0
    assert (await db.stats())["titles"] == 1


async def test_search_ranks_exact_then_prefix_then_contains(db):
    for title in ("The Dune Story", "Dune Part Two", "Dune"):
        await add(db, title, "Movie")
    assert [r["title"] for r in (await db.search("dune"))[0]] == ["Dune", "Dune Part Two", "The Dune Story"]


async def test_search_pages_and_reports_the_total(db):
    for i in range(12):
        await add(db, f"Movie {i:02d}", "Movie")
    page1, total = await db.search("movie", limit=5, offset=0)
    page3, _ = await db.search("movie", limit=5, offset=10)
    assert total == 12 and len(page1) == 5 and [r["title"] for r in page3] == ["Movie 10", "Movie 11"]


async def test_an_empty_or_blank_query_finds_nothing(db):
    await add(db, "A", "Movie")
    assert await db.search("") == ([], 0) and await db.search("   ") == ([], 0)


async def test_search_reports_how_many_files_a_title_has(db):
    await add(db, "A", "Movie", quality="720p")
    await add(db, "A", "Movie", quality="1080p")
    assert (await db.search("a"))[0][0]["file_count"] == 2


def test_like_patterns_escape_their_wildcards():
    assert like_pattern("50%_x\\") == "%50\\%\\_x\\\\%"
    assert like_pattern("Ab", "prefix") == "ab%"


# ---- browsing --------------------------------------------------------------------------------------------------------------
async def test_seasons_and_episodes_come_back_in_order_with_season_less_files_last(db):
    r = await add(db, "S", "Show", season=2, episode=1)
    for s, e in ((1, 2), (1, 1), (1, 3), (0, 1)):
        await add(db, "S", "Show", season=s, episode=e)
    await add(db, "S", "Show", season=None, episode=None)
    assert [s["season_number"] for s in await db.seasons(r.media_id)] == [0, 1, 2, None]
    assert [s["episodes"] for s in await db.seasons(r.media_id)][:3] == [1, 3, 1]
    episodes, total = await db.episodes(r.media_id, 1)
    assert [e["episode_number"] for e in episodes] == [1, 2, 3] and total == 3


async def test_episodes_page(db):
    r = await add(db, "Long", "Anime", season=1, episode=1)
    for e in range(2, 121):
        await add(db, "Long", "Anime", season=1, episode=e)
    page, total = await db.episodes(r.media_id, 1, limit=50, offset=100)
    assert total == 120 and [e["episode_number"] for e in page] == list(range(101, 121))


async def test_two_qualities_of_one_episode_are_counted_once_and_sorted_best_first(db):
    r = await add(db, "S", "Show", season=1, episode=1, quality="720p")
    await add(db, "S", "Show", season=1, episode=1, quality="4K")
    await add(db, "S", "Show", season=1, episode=1, quality="1080p")
    await add(db, "S", "Show", season=1, episode=1, quality=None)
    assert (await db.seasons(r.media_id))[0]["episodes"] == 1
    assert [f["quality_resolution"] for f in await db.files_for(r.media_id, 1, 1)] == ["4K", "1080p", "720p", None]


def test_quality_sort_key_ranks_known_resolutions_and_keeps_unknown_last():
    order = ["4K", "2160p", "1440p", "1080p", "1080p Dub", "720p", "480p", "weird", None]
    assert sorted(order[::-1], key=quality_sort_key)[0] in ("4K", "2160p")
    assert sorted(["weird", "720p", None, "4K"], key=quality_sort_key) == ["4K", "720p", "weird", None]


async def test_get_file_joins_the_title_and_unknown_ids_are_none(db):
    r = await add(db, "Dune", "Movie", 2021, fid="F")
    row = await db.get_file(r.file_row_id)
    assert (row["title"], row["release_year"], row["telegram_file_id"], row["channel_id"]) == ("Dune", 2021, "F", CH)
    assert await db.get_file(9999) is None and await db.get_media(9999) is None


async def test_max_message_id(db):
    assert await db.max_message_id(CH) == 0
    await add(db, "A", mid=77)
    assert await db.max_message_id(CH) == 77


# ---- searching by genre, year and type ----------------------------------------------------------------------------------------
async def library_for_filters(db):
    await add(db, "Attack on Titan", "Anime", 2013, season=1, episode=1, genre="Action, Fantasy")
    await add(db, "Dune", "Movie", 2021, genre="Sci-Fi, Adventure")
    await add(db, "Blade Runner", "Movie", 1982, genre="Sci-Fi, Thriller")
    await add(db, "Breaking Bad", "Show", 2008, season=1, episode=1, genre="Crime, Drama")
    await add(db, "No Metadata", "Movie")  # no year, no genre
    await add(db, "Action Jackson", "Movie", 1988, genre="Comedy")
    await add(db, "The Last Action Hero", "Movie", 1993, genre="Comedy")


def titles(result):
    return [r["title"] for r in result[0]]


async def test_a_genre_word_finds_titles_of_that_genre(db):
    await library_for_filters(db)
    assert titles(await db.search("fantasy")) == ["Attack on Titan"]
    assert sorted(titles(await db.search("sci-fi"))) == ["Blade Runner", "Dune"]
    assert titles(await db.search("THRILLER")) == ["Blade Runner"]


async def test_a_year_finds_titles_released_that_year(db):
    await library_for_filters(db)
    assert titles(await db.search("2013")) == ["Attack on Titan"]
    assert titles(await db.search("1982")) == ["Blade Runner"]
    assert (await db.search("1999"))[1] == 0


async def test_a_type_word_finds_that_type_including_its_aliases(db):
    await library_for_filters(db)
    assert titles(await db.search("anime")) == ["Attack on Titan"]
    assert sorted(titles(await db.search("movies"))) == ["Action Jackson", "Blade Runner", "Dune", "No Metadata", "The Last Action Hero"]
    assert titles(await db.search("series")) == ["Breaking Bad"] and titles(await db.search("tv")) == ["Breaking Bad"]


async def test_every_word_must_match_something_so_filters_narrow_the_results(db):
    await library_for_filters(db)
    assert titles(await db.search("sci-fi 2021")) == ["Dune"]
    assert titles(await db.search("sci-fi movie")) == ["Blade Runner", "Dune"]
    assert titles(await db.search("sci-fi 2013")) == []
    assert titles(await db.search("dune 2021")) == ["Dune"] and titles(await db.search("dune 2013")) == []
    assert titles(await db.search("action anime")) == ["Attack on Titan"]


async def test_title_matches_rank_before_genre_matches(db):
    await library_for_filters(db)
    # exact/prefix title match, then "contains it in the title", then matches only through the genre
    assert titles(await db.search("action")) == ["Action Jackson", "The Last Action Hero", "Attack on Titan"]


async def test_titles_without_a_year_or_genre_are_still_found_by_name_and_do_not_break_filters(db):
    await library_for_filters(db)
    assert titles(await db.search("metadata")) == ["No Metadata"]
    assert "No Metadata" not in titles(await db.search("sci-fi")) and "No Metadata" not in titles(await db.search("2013"))


async def test_a_year_typed_in_arabic_indic_digits_finds_the_same_titles(db):
    await library_for_filters(db)
    assert titles(await db.search("\u0662\u0660\u0661\u0663")) == ["Attack on Titan"]


async def test_a_number_that_is_not_a_year_only_matches_text(db):
    await add(db, "Apollo 13", "Movie", 1995)
    await add(db, "1917", "Movie", 2019)
    assert titles(await db.search("13")) == ["Apollo 13"]
    assert sorted(titles(await db.search("1917"))) == ["1917"]
    assert titles(await db.search("2019")) == ["1917"]


async def test_wildcards_in_a_genre_search_are_literal(db):
    await add(db, "A", "Movie", genre="Sci-Fi")
    assert (await db.search("%"))[1] == 0 and (await db.search("s_"))[1] == 0
