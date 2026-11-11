import asyncio

import aiosqlite
import pytest

from backend.database import SCHEMA_VERSION, Conflict, Database, InvalidName, NotFound, clean_name

SHA = "a" * 64


def chunk(i, size=10, mid=None):
    return {"index": i, "size": size, "telegram_file_id": f"f{i}", "message_id": mid if mid is not None else 100 + i}


async def add(db, name="a.txt", folder=None, chunks=None, uid=None):
    chunks = chunks or [chunk(0, 10, 1)]
    return await db.add_file(uid=uid or f"uid-{name}-{folder}", folder_id=folder, file_name=name, file_size=sum(c["size"] for c in chunks),
                             mime_type="text/plain", sha256=SHA, chunks=chunks)


async def pragma(db, sql):
    async with db.read() as c:
        return (await (await c.execute(sql)).fetchone())[0]


async def test_wal_and_foreign_keys_are_on(db):
    assert await pragma(db, "PRAGMA journal_mode") == "wal"
    assert await pragma(db, "PRAGMA foreign_keys") == 1
    assert await pragma(db, "PRAGMA user_version") == SCHEMA_VERSION


async def test_three_tables_exist(db):
    async with db.read() as c:
        names = {r[0] for r in await (await c.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")).fetchall()}
    assert names == {"folders", "files", "file_chunks"}


async def test_every_foreign_key_column_leads_an_index(db):
    async with db.read() as c:
        for table in ("folders", "files", "file_chunks"):
            for fk in await (await c.execute(f"PRAGMA foreign_key_list({table})")).fetchall():
                assert fk["on_delete"] == "CASCADE"
                leading = []
                for idx in await (await c.execute(f"PRAGMA index_list({table})")).fetchall():
                    info = await (await c.execute(f"PRAGMA index_info({idx['name']})")).fetchall()
                    leading.append(info[0]["name"])
                assert fk["from"] in leading, f"{table}.{fk['from']} has no index"


async def test_reader_connections_cannot_write(db):
    async with db.read() as c:
        with pytest.raises(aiosqlite.OperationalError):
            await c.execute("INSERT INTO folders(name) VALUES ('x')")


async def test_refuses_a_database_from_a_newer_version(tmp_path):
    first = await Database(tmp_path / "x.db").open()
    async with first.write() as c:
        await c.execute(f"PRAGMA user_version={SCHEMA_VERSION + 1}")
    await first.close()
    with pytest.raises(RuntimeError, match="newer"):
        await Database(tmp_path / "x.db").open()


async def test_reopening_keeps_data_and_does_not_remigrate(tmp_path):
    first = await Database(tmp_path / "x.db").open()
    await first.create_folder("Keep")
    await first.close()
    second = await Database(tmp_path / "x.db").open()
    assert [f["name"] for f in (await second.list_folder())["folders"]] == ["Keep"]
    await second.close()


async def test_in_memory_database_is_rejected(tmp_path):
    with pytest.raises(ValueError):
        await Database(":memory:").open()


@pytest.mark.parametrize("bad", ["", "   ", ".", "..", "a/b", "a\\b", "nul\x00", "tab\tname", "x" * 256])
async def test_bad_names_are_rejected(bad):
    with pytest.raises(InvalidName):
        clean_name(bad)


def test_names_are_trimmed_and_normalised():
    assert clean_name("  report.pdf ") == "report.pdf"
    assert clean_name("é.txt") == "é.txt"  # NFC


async def test_folders_nest_and_list(db):
    a = await db.create_folder("Photos")
    b = await db.create_folder("2026", a["id"])
    root = await db.list_folder(None)
    assert [f["name"] for f in root["folders"]] == ["Photos"]
    assert root["folders"][0]["subfolder_count"] == 1
    inner = await db.list_folder(a["id"])
    assert [f["name"] for f in inner["folders"]] == ["2026"]
    assert [c["name"] for c in (await db.list_folder(b["id"]))["breadcrumbs"]] == ["Photos", "2026"]


async def test_duplicate_folder_names_conflict_case_insensitively_but_only_within_a_parent(db):
    a = await db.create_folder("Docs")
    with pytest.raises(Conflict):
        await db.create_folder("docs")
    other = await db.create_folder("Other")
    assert (await db.create_folder("Docs", other["id"]))["parent_id"] == other["id"]
    assert a["id"] != 0


async def test_folder_with_missing_parent(db):
    with pytest.raises(NotFound):
        await db.create_folder("x", 999)
    with pytest.raises(NotFound):
        await db.list_folder(999)


async def test_add_file_and_read_back_chunks_in_order(db):
    f = await add(db, chunks=[chunk(1, 5, 12), chunk(0, 10, 11)])
    got = await db.get_file(f["id"])
    assert [c["chunk_index"] for c in got["chunks"]] == [0, 1]
    assert got["total_chunks"] == 2 and got["file_size"] == 15


async def test_empty_file_has_no_chunks(db):
    f = await db.add_file(uid="e", folder_id=None, file_name="empty", file_size=0, mime_type="text/plain", sha256=SHA, chunks=[])
    assert (await db.get_file(f["id"]))["chunks"] == []


async def test_add_file_validates_chunks(db):
    with pytest.raises(ValueError):
        await add(db, chunks=[chunk(0), chunk(2)])  # gap
    with pytest.raises(ValueError):
        await db.add_file(uid="u", folder_id=None, file_name="x", file_size=99, mime_type="t", sha256=SHA, chunks=[chunk(0, 10)])
    assert (await db.stats())["files"] == 0  # nothing half-written


async def test_failed_add_file_rolls_back_the_file_row(db):
    with pytest.raises(NotFound):
        await add(db, folder=404)
    assert (await db.stats())["files"] == 0


async def test_taken_name_gets_a_numbered_suffix_keeping_the_extension(db):
    names = [(await add(db, "report.pdf", uid=f"u{i}"))["file_name"] for i in range(3)]
    assert names == ["report.pdf", "report (1).pdf", "report (2).pdf"]
    assert (await add(db, "notes", uid="n1"))["file_name"] == "notes"
    assert (await add(db, "notes", uid="n2"))["file_name"] == "notes (1)"


async def test_uid_must_be_unique(db):
    await add(db, uid="same")
    with pytest.raises(aiosqlite.IntegrityError):
        await add(db, "other.txt", uid="same")
    assert await db.has_uid("same") and not await db.has_uid("nope")


async def test_deleting_a_folder_cascades_and_returns_every_message_id(db):
    a = await db.create_folder("A")
    b = await db.create_folder("B", a["id"])
    await add(db, "1", a["id"], [chunk(0, 5, 1), chunk(1, 5, 2)])
    await add(db, "2", b["id"], [chunk(0, 5, 3)])
    keep = await add(db, "3", None, [chunk(0, 5, 4)])
    out = await db.delete_items(folder_ids=[a["id"]])
    assert out["messages"] == [1, 2, 3] and out["folders"] == 1
    assert (await db.stats()) == {"files": 1, "folders": 0, "bytes": 5}
    async with db.read() as c:
        assert (await (await c.execute("SELECT COUNT(*) FROM file_chunks")).fetchone())[0] == 1
    assert (await db.get_file(keep["id"]))["file_name"] == "3"


async def test_deleting_files_and_unknown_ids(db):
    f = await add(db, chunks=[chunk(0, 5, 7)])
    out = await db.delete_items(file_ids=[f["id"], 12345])
    assert out == {"messages": [7], "files": 1, "folders": 0}
    assert await db.delete_items([], []) == {"messages": [], "files": 0, "folders": 0}


async def test_ensure_folder_path_is_idempotent(db):
    a = await db.ensure_folder_path("Recovered")
    assert await db.ensure_folder_path("recovered") == a


async def test_concurrent_writes_are_serialised_not_lost(db):
    results = await asyncio.gather(*[db.create_folder(f"f{i}") for i in range(30)], return_exceptions=True)
    assert not [r for r in results if isinstance(r, Exception)]
    assert (await db.stats())["folders"] == 30


async def test_reads_proceed_while_a_write_transaction_is_open(db):
    async with db.write() as c:
        await c.execute("INSERT INTO folders(name) VALUES ('inside')")
        assert (await db.list_folder(None))["folders"] == []  # uncommitted, invisible to readers, and not blocked
    assert [f["name"] for f in (await db.list_folder(None))["folders"]] == ["inside"]
