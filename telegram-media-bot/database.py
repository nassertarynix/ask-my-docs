"""SQLite storage: a small connection pool, the schema, and the queries the bot needs.

`sqlite3` is blocking, so every query runs in a worker thread (`asyncio.to_thread`) and the event loop never waits on the disk.
The pool is one writer (serialised by a lock; each write is one transaction) plus a few read-only readers. WAL mode lets the
readers keep working while a write is in progress.

`PRAGMA foreign_keys = ON` is a *per-connection* setting. The line in schema.sql only affects the connection that runs the
script, so it is set again on every connection opened here; without that, `ON DELETE CASCADE` would silently do nothing.
"""
from __future__ import annotations

import asyncio
import contextlib
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, TypeVar

T = TypeVar("T")
SCHEMA_PATH = Path(__file__).with_name("schema.sql")
SCHEMA_VERSION = 1
QUALITY_RANK = {"4K": 0, "2160p": 0, "1440p": 1, "1080p": 2, "720p": 3, "576p": 4, "480p": 5, "360p": 6}
MAX_SEARCH_TOKENS = 6


@dataclass(frozen=True)
class IndexResult:
    """What `index_file` did. status: inserted | updated | duplicate."""
    status: str
    media_id: int | None = None
    file_row_id: int | None = None
    media_created: bool = False
    existing_message_id: int | None = None  # for a duplicate: the message that already holds this file


def _fold(text: str | None) -> str | None:
    """Case folding that works beyond ASCII (SQLite's own LIKE only ignores the case of A-Z)."""
    return None if text is None else text.casefold()


def like_pattern(token: str, mode: str = "contains") -> str:
    """A LIKE pattern for a user's word, with %, _ and the escape character neutralised so they match themselves."""
    escaped = token.casefold().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return {"contains": f"%{escaped}%", "prefix": f"{escaped}%"}[mode]


def quality_sort_key(quality: str | None) -> tuple[int, str]:
    if not quality:
        return (99, "")
    first = re.match(r"\s*(\S+)", quality)
    return (QUALITY_RANK.get(first.group(1) if first else quality, 50), quality.casefold())


class Database:
    def __init__(self, path: str | Path, readers: int = 2) -> None:
        self.path = str(path)
        self._reader_count = readers
        self._writer: sqlite3.Connection | None = None
        self._readers: asyncio.Queue[sqlite3.Connection] = asyncio.Queue()
        self._all: list[sqlite3.Connection] = []
        self._write_lock = asyncio.Lock()

    # ---- lifecycle ----------------------------------------------------------------------------------------------------
    async def open(self) -> "Database":
        await asyncio.to_thread(self._open_sync)
        for conn in self._all[1:]:
            self._readers.put_nowait(conn)
        return self

    def _connect(self) -> sqlite3.Connection:
        # check_same_thread=False: the worker thread differs from call to call, but a connection is only ever used by one at a time
        conn = sqlite3.connect(self.path, isolation_level=None, check_same_thread=False, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.execute("PRAGMA busy_timeout = 5000")
        conn.create_function("casefold", 1, _fold, deterministic=True)
        self._all.append(conn)
        return conn

    def _open_sync(self) -> None:
        if self.path == ":memory:":
            raise ValueError("Use a file path: an in-memory database cannot be shared between pooled connections.")
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._writer = self._connect()
        mode = self._writer.execute("PRAGMA journal_mode = WAL").fetchone()[0]
        if str(mode).lower() != "wal":
            raise RuntimeError(f"SQLite refused WAL mode (got {mode!r}). Is the database on a network drive?")
        self._writer.execute("PRAGMA synchronous = NORMAL")
        version = self._writer.execute("PRAGMA user_version").fetchone()[0]
        if version > SCHEMA_VERSION:
            raise RuntimeError(f"Database schema v{version} is newer than this bot understands (v{SCHEMA_VERSION}).")
        self._writer.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
        self._writer.execute("PRAGMA foreign_keys = ON")  # executescript may have committed; make sure it is still on
        self._writer.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        for _ in range(self._reader_count):
            reader = self._connect()
            reader.execute("PRAGMA query_only = ON")

    async def close(self) -> None:
        conns, self._all = self._all, []
        self._writer = None
        self._readers = asyncio.Queue()
        for conn in conns:
            with contextlib.suppress(Exception):
                await asyncio.to_thread(conn.close)

    # ---- pool ---------------------------------------------------------------------------------------------------------
    async def _read(self, fn: Callable[[sqlite3.Connection], T]) -> T:
        conn = await self._readers.get()
        try:
            return await asyncio.to_thread(fn, conn)
        finally:
            self._readers.put_nowait(conn)

    async def _write(self, fn: Callable[[sqlite3.Connection], T]) -> T:
        """Run `fn` in one exclusive transaction: committed if it returns, rolled back entirely if it raises."""
        assert self._writer is not None, "call open() first"
        writer = self._writer

        def run() -> T:
            writer.execute("BEGIN IMMEDIATE")
            try:
                result = fn(writer)
            except BaseException:
                writer.execute("ROLLBACK")
                raise
            writer.execute("COMMIT")
            return result

        async with self._write_lock:
            return await asyncio.to_thread(run)

    # ---- writing ------------------------------------------------------------------------------------------------------
    async def index_file(self, meta: dict[str, Any], *, file_id: str, message_id: int, channel_id: int) -> IndexResult:
        """Store one video: its title (created or reused) and its file row, atomically.

        - Same message seen again (an edited caption): the row is updated, and the old title is removed if it is now empty.
        - Same `file_id` already stored for a different message: nothing is written (`duplicate`).
        - Title match: same title and type, case-insensitive. With a year, the same year (or a year-less row, which adopts it).
          Without a year, the only matching title, or the oldest if several remakes exist.
        """
        return await self._write(lambda c: self._index_file(c, meta, file_id, message_id, channel_id))

    @staticmethod
    def _index_file(c: sqlite3.Connection, meta: dict[str, Any], file_id: str, message_id: int, channel_id: int) -> IndexResult:
        # matched on the channel too: message ids are only unique within one channel, and the specified schema makes them unique
        # overall, so a post of another channel with the same id must fail loudly (and roll back) instead of re-pointing a row
        same_message = c.execute("SELECT id, media_id FROM media_files WHERE telegram_message_id = ? AND channel_id = ?",
                                 (message_id, channel_id)).fetchone()
        other = c.execute("SELECT id, telegram_message_id FROM media_files WHERE telegram_file_id = ?", (file_id,)).fetchone()
        if other and (same_message is None or other["id"] != same_message["id"]):
            return IndexResult("duplicate", file_row_id=other["id"], existing_message_id=other["telegram_message_id"])

        media_id, created = Database._upsert_media(c, meta["title"], meta["type"], meta.get("release_year"), meta.get("genre"))
        values = (media_id, meta.get("season_number"), meta.get("episode_number"), meta.get("quality_resolution"), file_id, channel_id)
        if same_message:
            c.execute(
                """UPDATE media_files SET media_id=?, season_number=?, episode_number=?, quality_resolution=?,
                          telegram_file_id=?, channel_id=? WHERE id=?""", (*values, same_message["id"]))
            if same_message["media_id"] != media_id:
                Database._prune_media(c, same_message["media_id"])
            return IndexResult("updated", media_id, same_message["id"], created)
        cur = c.execute(
            """INSERT INTO media_files(media_id, season_number, episode_number, quality_resolution, telegram_file_id,
                                       channel_id, telegram_message_id) VALUES (?,?,?,?,?,?,?)""", (*values, message_id))
        return IndexResult("inserted", media_id, cur.lastrowid, created)

    @staticmethod
    def _upsert_media(c: sqlite3.Connection, title: str, kind: str, year: int | None, genre: str | None) -> tuple[int, bool]:
        row = c.execute("SELECT id, release_year, genre FROM media WHERE title = ? COLLATE NOCASE AND type = ? AND release_year IS ?",
                        (title, kind, year)).fetchone()
        if row is None and year is None:
            row = c.execute("SELECT id, release_year, genre FROM media WHERE title = ? COLLATE NOCASE AND type = ? ORDER BY id LIMIT 1",
                            (title, kind)).fetchone()
        elif row is None:
            row = c.execute("SELECT id, release_year, genre FROM media WHERE title = ? COLLATE NOCASE AND type = ? AND release_year IS NULL",
                            (title, kind)).fetchone()
            if row is not None:
                c.execute("UPDATE media SET release_year = ? WHERE id = ?", (year, row["id"]))
        if row is not None:
            if genre and not row["genre"]:
                c.execute("UPDATE media SET genre = ? WHERE id = ?", (genre, row["id"]))  # fill in, never overwrite
            return row["id"], False
        cur = c.execute("INSERT INTO media(title, type, release_year, genre) VALUES (?,?,?,?)", (title, kind, year, genre))
        return cur.lastrowid, True  # type: ignore[return-value]

    @staticmethod
    def _prune_media(c: sqlite3.Connection, media_id: int | None = None) -> int:
        """Remove titles that no longer have any file (all of them, or just `media_id`)."""
        sql = "DELETE FROM media WHERE NOT EXISTS (SELECT 1 FROM media_files f WHERE f.media_id = media.id)"
        if media_id is not None:
            return c.execute(sql + " AND id = ?", (media_id,)).rowcount
        return c.execute(sql).rowcount

    async def delete_messages(self, channel_id: int, message_ids: list[int]) -> int:
        """The posts were deleted from the channel: forget their files, and any title left with none."""
        if not message_ids:
            return 0

        def run(c: sqlite3.Connection) -> int:
            q = ",".join("?" * len(message_ids))
            removed = c.execute(f"DELETE FROM media_files WHERE channel_id = ? AND telegram_message_id IN ({q})", (channel_id, *message_ids)).rowcount
            Database._prune_media(c)
            return removed

        return await self._write(run)

    async def update_file_id(self, file_row_id: int, new_file_id: str) -> bool:
        """Store the fresh `file_id` after a refresh. False if another row already uses that id (nothing is changed)."""
        def run(c: sqlite3.Connection) -> bool:
            clash = c.execute("SELECT 1 FROM media_files WHERE telegram_file_id = ? AND id != ?", (new_file_id, file_row_id)).fetchone()
            if clash:
                return False
            return c.execute("UPDATE media_files SET telegram_file_id = ? WHERE id = ?", (new_file_id, file_row_id)).rowcount > 0

        return await self._write(run)

    async def delete_file(self, file_row_id: int) -> None:
        def run(c: sqlite3.Connection) -> None:
            c.execute("DELETE FROM media_files WHERE id = ?", (file_row_id,))
            Database._prune_media(c)

        await self._write(run)

    # ---- reading ------------------------------------------------------------------------------------------------------
    @staticmethod
    def _search_where(query: str) -> tuple[str, list[str], list[str]]:
        tokens = [t for t in query.casefold().split() if t][:MAX_SEARCH_TOKENS]
        where = " AND ".join("casefold(m.title) LIKE ? ESCAPE '\\'" for _ in tokens)
        return where, [like_pattern(t) for t in tokens], tokens

    async def search(self, query: str, limit: int = 8, offset: int = 0) -> tuple[list[dict], int]:
        """Titles containing every word of `query` (any order, any case), best matches first, and the total number found."""
        where, patterns, tokens = self._search_where(query)
        if not tokens:
            return [], 0
        whole = " ".join(tokens)

        def run(c: sqlite3.Connection) -> tuple[list[dict], int]:
            base = f"FROM media m WHERE {where} AND EXISTS (SELECT 1 FROM media_files f WHERE f.media_id = m.id)"
            total = c.execute(f"SELECT COUNT(*) {base}", patterns).fetchone()[0]
            rows = c.execute(
                f"""SELECT m.id, m.title, m.type, m.release_year, m.genre,
                           (SELECT COUNT(*) FROM media_files f WHERE f.media_id = m.id) AS file_count {base}
                    ORDER BY CASE WHEN casefold(m.title) = ? THEN 0 WHEN casefold(m.title) LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END,
                             m.title COLLATE NOCASE, m.release_year
                    LIMIT ? OFFSET ?""", (*patterns, whole, like_pattern(whole, "prefix"), limit, offset)).fetchall()
            return [dict(r) for r in rows], total

        return await self._read(run)

    async def get_media(self, media_id: int) -> dict | None:
        row = await self._read(lambda c: c.execute("SELECT * FROM media WHERE id = ?", (media_id,)).fetchone())
        return dict(row) if row else None

    async def seasons(self, media_id: int) -> list[dict]:
        """Seasons with their episode counts. `season_number` is None for files that have no season."""
        def run(c: sqlite3.Connection) -> list[dict]:
            rows = c.execute(
                """SELECT season_number, COUNT(DISTINCT episode_number) AS episodes, COUNT(*) AS files
                   FROM media_files WHERE media_id = ? GROUP BY season_number
                   ORDER BY season_number IS NULL, season_number""", (media_id,)).fetchall()
            return [dict(r) for r in rows]

        return await self._read(run)

    async def episodes(self, media_id: int, season: int | None, limit: int = 50, offset: int = 0) -> tuple[list[dict], int]:
        def run(c: sqlite3.Connection) -> tuple[list[dict], int]:
            total = c.execute("SELECT COUNT(DISTINCT episode_number) FROM media_files WHERE media_id = ? AND season_number IS ?",
                              (media_id, season)).fetchone()[0]
            rows = c.execute(
                """SELECT episode_number, COUNT(*) AS files FROM media_files WHERE media_id = ? AND season_number IS ?
                   GROUP BY episode_number ORDER BY episode_number IS NULL, episode_number LIMIT ? OFFSET ?""",
                (media_id, season, limit, offset)).fetchall()
            return [dict(r) for r in rows], total

        return await self._read(run)

    async def files_for(self, media_id: int, season: int | None, episode: int | None) -> list[dict]:
        """Every file for one episode (or one movie), best quality first."""
        def run(c: sqlite3.Connection) -> list[dict]:
            rows = c.execute("SELECT * FROM media_files WHERE media_id = ? AND season_number IS ? AND episode_number IS ?",
                             (media_id, season, episode)).fetchall()
            return sorted((dict(r) for r in rows), key=lambda r: (quality_sort_key(r["quality_resolution"]), r["id"]))

        return await self._read(run)

    async def get_file(self, file_row_id: int) -> dict | None:
        def run(c: sqlite3.Connection) -> dict | None:
            row = c.execute(
                """SELECT f.*, m.title, m.type, m.release_year FROM media_files f JOIN media m ON m.id = f.media_id WHERE f.id = ?""",
                (file_row_id,)).fetchone()
            return dict(row) if row else None

        return await self._read(run)

    async def stats(self) -> dict:
        row = await self._read(lambda c: c.execute(
            """SELECT (SELECT COUNT(*) FROM media) AS titles, (SELECT COUNT(*) FROM media_files) AS files,
                      (SELECT COUNT(*) FROM media WHERE type='Movie') AS movies,
                      (SELECT COUNT(*) FROM media WHERE type='Anime') AS anime,
                      (SELECT COUNT(*) FROM media WHERE type='Show') AS shows""").fetchone())
        return dict(row)

    async def max_message_id(self, channel_id: int) -> int:
        row = await self._read(lambda c: c.execute("SELECT COALESCE(MAX(telegram_message_id), 0) FROM media_files WHERE channel_id = ?", (channel_id,)).fetchone())
        return int(row[0])
