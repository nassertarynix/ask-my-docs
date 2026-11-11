import asyncio
import hashlib
import os

import pytest

from backend.chunker import IntegrityError, parse_caption
from backend.service import EventBus, StorageService
from backend.telegram_client import ChunkMissing, LocalDirBackend, StorageError
from conftest import SMALL_CHUNK as CS


def payload(n, seed=7):
    return bytes((i * seed + i // 251) % 256 for i in range(n))


@pytest.fixture
async def svc(db, backend):
    return StorageService(db, backend, chunk_size=CS, bus=EventBus())


def write(tmp_path, data, name="in.bin"):
    p = tmp_path / name
    p.write_bytes(data)
    return p


async def upload(svc, tmp_path, data, name="doc.bin", folder=None, **kw):
    return await svc.upload_path(write(tmp_path, data, "src-" + name), name=name, folder_id=folder, **kw)


async def channel_ids(backend):
    return [r.message_id async for r in backend.iter_remote_chunks()]


async def test_multi_chunk_round_trip_is_byte_identical(svc, tmp_path, backend, db):
    data = payload(3 * CS + 777)
    rec = await upload(svc, tmp_path, data, "big.bin")
    assert rec["total_chunks"] == 4 and rec["file_size"] == len(data) and rec["sha256_hash"] == hashlib.sha256(data).hexdigest()
    assert len(await channel_ids(backend)) == 4
    out = await svc.download_to(rec["id"], tmp_path / "out" / "big.bin")
    assert out.read_bytes() == data


async def test_exact_multiple_of_chunk_size_and_a_single_byte(svc, tmp_path):
    for n in (CS, 2 * CS, 1):
        rec = await upload(svc, tmp_path, payload(n), f"f{n}")
        assert (await svc.download_to(rec["id"], tmp_path / f"o{n}")).read_bytes() == payload(n)


async def test_empty_file_stores_nothing_on_the_channel_but_round_trips(svc, tmp_path, backend):
    rec = await upload(svc, tmp_path, b"", "empty.txt")
    assert rec["total_chunks"] == 0 and await channel_ids(backend) == []
    assert (await svc.download_to(rec["id"], tmp_path / "e")).read_bytes() == b""


async def test_every_message_carries_a_recovery_caption(svc, tmp_path, backend):
    data = payload(2 * CS + 5)
    rec = await upload(svc, tmp_path, data, "spec.pdf")
    metas = [parse_caption(r.caption) async for r in backend.iter_remote_chunks()]
    assert [m.index for m in metas] == [0, 1, 2] and {m.total for m in metas} == {3}
    assert {m.file_sha256 for m in metas} == {rec["sha256_hash"]} and {m.uid for m in metas} == {rec["uid"]}
    assert {(m.name, m.size, m.mime) for m in metas} == {("spec.pdf", len(data), "application/pdf")}
    assert metas[0].chunk_sha256 == hashlib.sha256(data[:CS]).hexdigest()


async def test_a_taken_name_is_suffixed_not_rejected(svc, tmp_path):
    a = await upload(svc, tmp_path, b"one", "same.txt")
    b = await upload(svc, tmp_path, b"two", "same.txt")
    assert (a["file_name"], b["file_name"]) == ("same.txt", "same (1).txt")


async def test_progress_events_cover_every_phase_and_never_go_backwards(svc, tmp_path):
    queue = svc.bus.subscribe()
    data = payload(3 * CS)
    await upload(svc, tmp_path, data, "p.bin", job_id="job1")
    events = []
    while not queue.empty():
        events.append(queue.get_nowait())
    assert {e["job_id"] for e in events} == {"job1"} and events[-1]["phase"] == "done"
    phases = [e["phase"] for e in events]
    assert phases[0] == "hashing" and "uploading" in phases and "committing" in phases
    up = [e["done"] for e in events if e["phase"] == "uploading"]
    assert up == sorted(up) and max(up) == len(data) and events[-1]["done"] == events[-1]["total"] == len(data)


class FailingBackend(LocalDirBackend):
    def __init__(self, root, fail_on):
        super().__init__(root)
        self.fail_on, self.calls = fail_on, 0

    async def upload_chunk(self, *a, **kw):
        self.calls += 1
        if self.calls == self.fail_on:
            raise StorageError("telegram said no")
        return await super().upload_chunk(*a, **kw)


async def test_a_failed_upload_deletes_the_chunks_already_sent_and_writes_no_rows(db, tmp_path):
    backend = FailingBackend(tmp_path / "ch", fail_on=3)
    await backend.connect()
    svc = StorageService(db, backend, chunk_size=CS)
    queue = svc.bus.subscribe()
    with pytest.raises(StorageError):
        await upload(svc, tmp_path, payload(4 * CS), "doomed.bin")
    assert await channel_ids(backend) == [] and (await db.stats())["files"] == 0
    last = None
    while not queue.empty():
        last = queue.get_nowait()
    assert last["phase"] == "error" and "telegram said no" in last["error"]


async def test_cancelling_an_upload_cleans_up_too(db, tmp_path):
    backend = LocalDirBackend(tmp_path / "ch", bytes_per_second=CS * 4)  # slow enough to cancel mid-way
    await backend.connect()
    svc = StorageService(db, backend, chunk_size=CS)
    task = asyncio.create_task(upload(svc, tmp_path, payload(6 * CS), "slow.bin"))
    while len(await channel_ids(backend)) < 2:
        await asyncio.sleep(0.02)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert await channel_ids(backend) == [] and (await db.stats())["files"] == 0


async def test_a_corrupted_chunk_is_detected_and_no_file_is_delivered(svc, tmp_path, backend):
    rec = await upload(svc, tmp_path, payload(2 * CS), "c.bin")
    victim = tmp_path / "channel" / f"{(await channel_ids(backend))[1]}.bin"
    raw = bytearray(victim.read_bytes())
    raw[5] ^= 0xFF
    victim.write_bytes(bytes(raw))
    dest = tmp_path / "out" / "c.bin"
    with pytest.raises(IntegrityError, match="checksum"):
        await svc.download_to(rec["id"], dest)
    assert not dest.exists() and not dest.with_name("c.bin.part").exists()


async def test_a_truncated_chunk_is_detected_by_size(svc, tmp_path, backend):
    rec = await upload(svc, tmp_path, payload(2 * CS), "t.bin")
    victim = tmp_path / "channel" / f"{(await channel_ids(backend))[0]}.bin"
    victim.write_bytes(victim.read_bytes()[:-1])
    with pytest.raises(IntegrityError, match="bytes"):
        await svc.download_to(rec["id"], tmp_path / "t.out")


async def test_a_chunk_deleted_from_the_channel_is_reported_clearly(svc, tmp_path, backend):
    rec = await upload(svc, tmp_path, payload(2 * CS), "m.bin")
    await backend.delete_messages([(await channel_ids(backend))[0]])
    with pytest.raises(ChunkMissing):
        await svc.download_to(rec["id"], tmp_path / "m.out")
    assert not (tmp_path / "m.out").exists()


async def test_deleting_a_folder_removes_its_files_from_the_database_and_the_channel(svc, db, tmp_path, backend):
    top = await db.create_folder("Top")
    sub = await db.create_folder("Sub", top["id"])
    await upload(svc, tmp_path, payload(2 * CS), "a.bin", folder=top["id"])
    await upload(svc, tmp_path, payload(CS + 1), "b.bin", folder=sub["id"])
    keep = await upload(svc, tmp_path, payload(10), "keep.bin")
    out = await svc.delete_items([], [top["id"]])
    assert out == {"files": 0, "folders": 1, "messages": 4, "orphaned": 0}
    assert await channel_ids(backend) == [m["telegram_message_id"] for m in (await db.get_file(keep["id"]))["chunks"]]
    assert (await db.stats())["files"] == 1


async def test_delete_reports_orphans_when_the_channel_refuses(svc, db, tmp_path, backend, monkeypatch):
    rec = await upload(svc, tmp_path, payload(CS + 1), "o.bin")

    async def refuse(ids):
        raise StorageError("no")

    monkeypatch.setattr(backend, "delete_messages", refuse)
    out = await svc.delete_items([rec["id"]], [])
    assert out["files"] == 1 and out["orphaned"] == 2
    with pytest.raises(Exception):
        await db.get_file(rec["id"])  # the item is gone from the app even though Telegram kept the messages


async def test_rebuild_index_recovers_everything_from_the_channel_alone(svc, db, tmp_path, backend):
    files = {"one.bin": payload(2 * CS + 3), "two.txt": payload(50), "empty-ish.bin": payload(CS)}
    for name, data in files.items():
        await upload(svc, tmp_path, data, name)
    await db.delete_items(file_ids=[f["id"] for f in (await db.list_folder())["files"]])  # "lose" the local index
    assert (await db.stats())["files"] == 0
    out = await svc.rebuild_index()
    assert out == {"recovered": 3, "already_indexed": 0, "incomplete": 0}
    rec = (await db.list_folder((await db.list_folder())["folders"][0]["id"]))["files"]
    assert {r["file_name"] for r in rec} == set(files)
    for r in rec:
        assert (await svc.download_to(r["id"], tmp_path / "rec" / r["file_name"])).read_bytes() == files[r["file_name"]]
    assert await svc.rebuild_index() == {"recovered": 0, "already_indexed": 3, "incomplete": 0}


async def test_rebuild_index_reports_a_file_with_a_missing_chunk_instead_of_importing_it(svc, db, tmp_path, backend):
    await upload(svc, tmp_path, payload(3 * CS), "broken.bin")
    await upload(svc, tmp_path, payload(CS), "fine.bin")
    ids = await channel_ids(backend)
    await backend.delete_messages([ids[1]])
    await db.delete_items(file_ids=[f["id"] for f in (await db.list_folder())["files"]])
    out = await svc.rebuild_index()
    assert out == {"recovered": 1, "already_indexed": 0, "incomplete": 1}


async def test_rebuild_ignores_messages_that_are_not_ours(svc, db, tmp_path, backend):
    await backend.upload_chunk("x", b"hello", "just a human caption")
    await backend.upload_chunk("y", b"hello", '{"app":"someone-else","v":1}')
    assert await svc.rebuild_index() == {"recovered": 0, "already_indexed": 0, "incomplete": 0}


async def test_two_uploads_at_once_do_not_interfere(svc, tmp_path):
    a, b = payload(3 * CS, 3), payload(3 * CS, 5)
    ra, rb = await asyncio.gather(upload(svc, tmp_path, a, "a.bin"), upload(svc, tmp_path, b, "b.bin"))
    assert (await svc.download_to(ra["id"], tmp_path / "ao")).read_bytes() == a
    assert (await svc.download_to(rb["id"], tmp_path / "bo")).read_bytes() == b
