"""The operations the API exposes, independent of HTTP: upload a file, download it, delete things, rebuild the index.

Upload  : hash the whole file -> split into chunks -> send each to the backend with a recovery caption -> commit rows.
          Nothing is committed to the database until every chunk is safely stored; if anything fails, the chunks already
          sent are deleted again, so a failed upload leaves no trace.
Download: fetch chunks in order into a temporary file -> verify size and SHA-256 -> only then rename it into place.
"""
from __future__ import annotations

import asyncio
import contextlib
import mimetypes
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .chunker import ChunkMeta, IntegrityError, Reassembler, build_caption, chunk_count, hash_file, parse_caption, read_chunk
from .database import Database
from .telegram_client import ChunkMissing, StorageBackend, with_retries

__all__ = ["EventBus", "StorageService", "IntegrityError"]


class EventBus:
    """Fan-out of progress events to every connected WebSocket. Slow listeners drop events rather than slow uploads down."""

    def __init__(self) -> None:
        self._listeners: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._listeners.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue) -> None:
        self._listeners.discard(queue)

    def publish(self, event: dict) -> None:
        for queue in list(self._listeners):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                pass


@dataclass
class _Job:
    """Progress of one transfer. Emits at most ~10 events a second, plus every phase change and the last event."""
    bus: EventBus
    job_id: str
    kind: str
    name: str
    total: int = 0
    done: int = 0
    phase: str = "queued"
    _last: float = field(default=0.0, repr=False)

    def emit(self, *, force: bool = False, **extra: Any) -> None:
        now = time.monotonic()
        if not force and now - self._last < 0.1:
            return
        self._last = now
        self.bus.publish({"job_id": self.job_id, "kind": self.kind, "name": self.name, "phase": self.phase,
                          "done": self.done, "total": self.total, **extra})

    def set_phase(self, phase: str, **extra: Any) -> None:
        self.phase = phase
        self.emit(force=True, **extra)


class StorageService:
    def __init__(self, db: Database, backend: StorageBackend, *, chunk_size: int, bus: EventBus | None = None, concurrency: int = 2) -> None:
        self.db, self.backend, self.chunk_size = db, backend, chunk_size
        self.bus = bus or EventBus()
        self._slots = asyncio.Semaphore(concurrency)

    def _job(self, kind: str, name: str, job_id: str | None) -> _Job:
        return _Job(self.bus, job_id or uuid.uuid4().hex[:12], kind, name)

    def _wait_notice(self, job: _Job):
        def notice(seconds: float, why: str) -> None:
            job.emit(force=True, wait_seconds=seconds, note="Telegram asked us to slow down" if why == "flood_wait" else "Network error, retrying")
        return notice

    # ---- upload --------------------------------------------------------------------------------------------------------
    async def upload_path(self, src: str | Path, *, name: str, folder_id: int | None = None, job_id: str | None = None) -> dict:
        job = self._job("upload", name, job_id)
        sent: list[int] = []
        try:
            async with self._slots:
                return await self._upload(Path(src), name, folder_id, job, sent)
        except BaseException as exc:  # includes cancellation: remove what already reached the channel
            if sent:
                with contextlib.suppress(Exception):
                    await asyncio.shield(self.backend.delete_messages(sent))
            job.set_phase("error", error=_describe(exc))
            raise

    async def _upload(self, src: Path, name: str, folder_id: int | None, job: _Job, sent: list[int]) -> dict:
        loop = asyncio.get_running_loop()
        size = src.stat().st_size
        job.total = size
        job.set_phase("hashing")

        def hashed(done: int, total: int) -> None:  # runs in the worker thread
            job.done = done
            loop.call_soon_threadsafe(job.emit)

        sha256, _ = await asyncio.to_thread(hash_file, src, hashed)
        uid = uuid.uuid4().hex
        mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
        total_chunks = chunk_count(size, self.chunk_size)
        self.backend.set_wait_notice(self._wait_notice(job))

        job.done = 0
        job.set_phase("uploading", chunks_total=total_chunks)
        rows: list[dict] = []
        for index in range(total_chunks):
            chunk = await asyncio.to_thread(read_chunk, src, index, self.chunk_size)
            caption = build_caption(ChunkMeta(uid, index, total_chunks, sha256, chunk.sha256, name, size, mime))
            base = job.done

            def progress(done: int, total: int, base: int = base) -> None:
                job.done = base + done
                job.emit(chunk=index + 1, chunks_total=total_chunks)

            uploaded = await self.backend.upload_chunk(f"{uid}-{index:05d}.bin", chunk.data, caption, progress)
            sent.append(uploaded.message_id)
            job.done = base + chunk.size
            job.emit(force=True, chunk=index + 1, chunks_total=total_chunks)
            rows.append({"index": index, "size": chunk.size, "telegram_file_id": uploaded.file_id, "message_id": uploaded.message_id})

        job.set_phase("committing")
        record = await self.db.add_file(uid=uid, folder_id=folder_id, file_name=name, file_size=size, mime_type=mime, sha256=sha256, chunks=rows)
        job.done = job.total
        job.set_phase("done", file_id=record["id"], file_name=record["file_name"])
        return record

    # ---- download ------------------------------------------------------------------------------------------------------
    async def download_to(self, file_id: int, dest: str | Path, *, job_id: str | None = None) -> Path:
        record = await self.db.get_file(file_id)
        job = self._job("download", record["file_name"], job_id)
        job.total = record["file_size"]
        try:
            async with self._slots:
                job.set_phase("downloading", chunks_total=record["total_chunks"])
                self.backend.set_wait_notice(self._wait_notice(job))
                assembler = Reassembler(dest, record["sha256_hash"], record["file_size"], record["total_chunks"])
                try:
                    for chunk in record["chunks"]:
                        parts: list[bytes] = []
                        base = job.done
                        async for block in self.backend.download_chunk(chunk["telegram_message_id"]):
                            parts.append(block)
                            job.done = base + sum(map(len, parts))
                            job.emit(chunk=chunk["chunk_index"] + 1, chunks_total=record["total_chunks"])
                        assembler.add(chunk["chunk_index"], b"".join(parts), chunk["chunk_size"])
                    job.set_phase("verifying")
                    path = await asyncio.to_thread(assembler.finish)
                except BaseException:
                    assembler.abort()
                    raise
            job.set_phase("done")
            return path
        except BaseException as exc:
            job.set_phase("error", error=_describe(exc))
            raise

    # ---- delete --------------------------------------------------------------------------------------------------------
    async def delete_items(self, file_ids: list[int], folder_ids: list[int]) -> dict:
        """Remove the records first (so the items vanish at once), then the Telegram messages. If some messages cannot be
        removed they stay in the channel as unreferenced documents, which costs nothing and is reported as `orphaned`."""
        result = await self.db.delete_items(file_ids, folder_ids)
        orphaned = 0
        if result["messages"]:
            try:
                await with_retries(lambda: self.backend.delete_messages(result["messages"]))
            except Exception:  # noqa: BLE001
                orphaned = len(result["messages"])
        return {"files": result["files"], "folders": result["folders"], "messages": len(result["messages"]), "orphaned": orphaned}

    # ---- disaster recovery ---------------------------------------------------------------------------------------------
    async def rebuild_index(self, folder_name: str = "Recovered") -> dict:
        """Rebuild the database from the captions in the channel. Files whose uid is already indexed are left alone; files
        with a missing or inconsistent chunk are reported, not imported. Recovered files go into one folder."""
        groups: dict[str, dict[int, tuple[Any, ChunkMeta]]] = {}
        async for remote in self.backend.iter_remote_chunks():
            meta = parse_caption(remote.caption)
            if meta is not None:
                groups.setdefault(meta.uid, {})[meta.index] = (remote, meta)
        recovered = known = incomplete = 0
        folder_id: int | None = None
        for uid, parts in groups.items():
            if await self.db.has_uid(uid):
                known += 1
                continue
            first = next(iter(parts.values()))[1]
            consistent = all(m.file_sha256 == first.file_sha256 and m.total == first.total and m.name == first.name for _, m in parts.values())
            sizes = [parts[i][0].size for i in range(first.total) if i in parts]
            if not consistent or sorted(parts) != list(range(first.total)) or (first.size and sum(sizes) != first.size):
                incomplete += 1
                continue
            if folder_id is None:
                folder_id = await self.db.ensure_folder_path(folder_name)
            chunks = [{"index": i, "size": parts[i][0].size, "telegram_file_id": parts[i][0].file_id, "message_id": parts[i][0].message_id} for i in range(first.total)]
            await self.db.add_file(uid=uid, folder_id=folder_id, file_name=first.name or f"recovered-{uid[:8]}", file_size=sum(sizes),
                                   mime_type=first.mime or "application/octet-stream", sha256=first.file_sha256, chunks=chunks)
            recovered += 1
        return {"recovered": recovered, "already_indexed": known, "incomplete": incomplete}


def _describe(exc: BaseException) -> str:
    if isinstance(exc, asyncio.CancelledError):
        return "Cancelled"
    if isinstance(exc, (IntegrityError, ChunkMissing)):
        return str(exc)
    return str(exc) or type(exc).__name__
