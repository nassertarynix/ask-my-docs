"""SQLite metadata index: which virtual folders and files exist, and which Telegram messages hold each file's chunks.

Design notes
- WAL mode so readers never block the writer, foreign keys ON so the database itself refuses orphans and cascades deletes.
- "Connection pool": one writer connection (serialised by a lock, every write is one explicit transaction) plus a few
  read-only connections. aiosqlite wraps each connection in a thread, so this is what gives real read concurrency.
- The root folder is represented by NULL (`parent_id` / `folder_id` IS NULL), not by a row.
- `files.uid` is the one column added to the specification: a random identifier that is also written into every Telegram
  caption, so the index can be rebuilt from the channel alone and two files with the same content never collide.
- Every FK column is the leading column of an index (the composite unique indexes double as the FK indexes), which
  `tests/test_database.py` verifies.
"""
from __future__ import annotations

import asyncio
import contextlib
import re
import unicodedata
from pathlib import Path
from typing import Any, AsyncIterator, Sequence

import aiosqlite

SCHEMA_VERSION = 1

_V1 = """
CREATE TABLE folders (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
    parent_id  INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_folders_parent_id ON folders(parent_id);
CREATE UNIQUE INDEX uq_folders_name ON folders(COALESCE(parent_id, 0), name COLLATE NOCASE);

CREATE TABLE files (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    uid          TEXT NOT NULL UNIQUE,
    folder_id    INTEGER REFERENCES folders(id) ON DELETE CASCADE,
    file_name    TEXT NOT NULL CHECK (length(trim(file_name)) > 0),
    file_size    INTEGER NOT NULL CHECK (file_size >= 0),
    mime_type    TEXT NOT NULL DEFAULT 'application/octet-stream',
    sha256_hash  TEXT NOT NULL CHECK (length(sha256_hash) = 64),
    total_chunks INTEGER NOT NULL CHECK (total_chunks >= 0),
    uploaded_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_files_folder_id ON files(folder_id);
CREATE UNIQUE INDEX uq_files_name ON files(COALESCE(folder_id, 0), file_name COLLATE NOCASE);

CREATE TABLE file_chunks (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id             INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    chunk_index         INTEGER NOT NULL CHECK (chunk_index >= 0),
    chunk_size          INTEGER NOT NULL CHECK (chunk_size > 0),
    telegram_file_id    TEXT NOT NULL,
    telegram_message_id INTEGER NOT NULL
);
CREATE UNIQUE INDEX uq_file_chunks_file_index ON file_chunks(file_id, chunk_index);
CREATE INDEX idx_file_chunks_message ON file_chunks(telegram_message_id);
"""

MIGRATIONS: list[str] = [_V1]  # append new migrations here; never edit an old one

MAX_NAME_LENGTH = 255
_FORBIDDEN = re.compile(r"[\x00-\x1f\x7f/\\]")
_RESERVED = {".", ".."}


class DatabaseError(Exception):
    """Base class. `code` is a stable machine-readable reason the API layer maps to an HTTP status."""

    code = "database_error"

    def __init__(self, message: str = "", **details: Any) -> None:
        super().__init__(message or self.code)
        self.details = details


class NotFound(DatabaseError):
    code = "not_found"


class Conflict(DatabaseError):
    code = "name_exists"


class InvalidName(DatabaseError):
    code = "invalid_name"


def clean_name(raw: str) -> str:
    """Validate a file or folder name. Names are single path segments: no slashes, control characters or dot-names."""
    if not isinstance(raw, str):
        raise InvalidName("Name must be text.")
    name = unicodedata.normalize("NFC", raw).strip()
    if not name:
        raise InvalidName("Name cannot be empty.")
    if len(name) > MAX_NAME_LENGTH:
        raise InvalidName(f"Name is longer than {MAX_NAME_LENGTH} characters.")
    if name in _RESERVED or _FORBIDDEN.search(name):
        raise InvalidName("Name cannot contain slashes or control characters, or be '.' or '..'.")
    return name


def _split_ext(name: str) -> tuple[str, str]:
    dot = name.rfind(".")
    return (name, "") if dot <= 0 else (name[:dot], name[dot:])


class Database:
    def __init__(self, path: str | Path, readers: int = 3) -> None:
        self.path = str(path)
        self._reader_count = readers
        self._writer: aiosqlite.Connection | None = None
        self._readers: asyncio.Queue[aiosqlite.Connection] = asyncio.Queue()
        self._all: list[aiosqlite.Connection] = []
        self._write_lock = asyncio.Lock()

    # ---- lifecycle -----------------------------------------------------------------------------------------------
    async def open(self) -> "Database":
        if self.path == ":memory:":
            raise ValueError("Use a file path: an in-memory database cannot be shared between pooled connections.")
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._writer = await self._connect()
        mode = (await (await self._writer.execute("PRAGMA journal_mode=WAL")).fetchone())[0]
        if str(mode).lower() != "wal":
            raise RuntimeError(f"SQLite refused WAL mode (got {mode!r}); is the data folder on a network drive?")
        await self._writer.execute("PRAGMA synchronous=NORMAL")
        await self._migrate()
        for _ in range(self._reader_count):
            reader = await self._connect()
            await reader.execute("PRAGMA query_only=ON")
            self._readers.put_nowait(reader)
        return self

    async def _connect(self) -> aiosqlite.Connection:
        conn = await aiosqlite.connect(self.path, isolation_level=None)  # autocommit; transactions are explicit
        conn.row_factory = aiosqlite.Row
        await conn.execute("PRAGMA foreign_keys=ON")
        await conn.execute("PRAGMA busy_timeout=5000")
        self._all.append(conn)
        return conn

    async def close(self) -> None:
        for conn in self._all:
            with contextlib.suppress(Exception):
                await conn.close()
        self._all.clear()
        self._writer = None
        self._readers = asyncio.Queue()

    async def _migrate(self) -> None:
        assert self._writer is not None
        version = (await (await self._writer.execute("PRAGMA user_version")).fetchone())[0]
        if version > SCHEMA_VERSION:
            raise RuntimeError(f"Database schema v{version} is newer than this app understands (v{SCHEMA_VERSION}).")
        for target in range(version, SCHEMA_VERSION):
            await self._writer.execute("BEGIN IMMEDIATE")
            try:
                for statement in _statements(MIGRATIONS[target]):
                    await self._writer.execute(statement)
                await self._writer.execute(f"PRAGMA user_version={target + 1}")
                await self._writer.execute("COMMIT")
            except BaseException:
                await self._writer.execute("ROLLBACK")
                raise

    # ---- pool ----------------------------------------------------------------------------------------------------
    @contextlib.asynccontextmanager
    async def read(self) -> AsyncIterator[aiosqlite.Connection]:
        conn = await self._readers.get()
        try:
            yield conn
        finally:
            self._readers.put_nowait(conn)

    @contextlib.asynccontextmanager
    async def write(self) -> AsyncIterator[aiosqlite.Connection]:
        """One exclusive transaction: commits if the block finishes, rolls back everything if it raises."""
        assert self._writer is not None, "call open() first"
        async with self._write_lock:
            await self._writer.execute("BEGIN IMMEDIATE")
            try:
                yield self._writer
            except BaseException:
                await self._writer.execute("ROLLBACK")
                raise
            else:
                await self._writer.execute("COMMIT")

    # ---- folders -------------------------------------------------------------------------------------------------
    async def create_folder(self, name: str, parent_id: int | None = None) -> dict:
        name = clean_name(name)
        async with self.write() as db:
            if parent_id is not None and not await _exists(db, "folders", parent_id):
                raise NotFound("Parent folder does not exist.", parent_id=parent_id)
            try:
                cur = await db.execute("INSERT INTO folders(name, parent_id) VALUES (?, ?)", (name, parent_id))
            except aiosqlite.IntegrityError as exc:
                raise Conflict("A folder with that name already exists here.", name=name) from exc
            row = await (await db.execute("SELECT * FROM folders WHERE id=?", (cur.lastrowid,))).fetchone()
        return dict(row)

    async def get_folder(self, folder_id: int) -> dict:
        async with self.read() as db:
            row = await (await db.execute("SELECT * FROM folders WHERE id=?", (folder_id,))).fetchone()
        if row is None:
            raise NotFound("Folder does not exist.", folder_id=folder_id)
        return dict(row)

    async def folder_tree(self) -> list[dict]:
        """Every folder, flat. The sidebar assembles the tree from `parent_id`."""
        async with self.read() as db:
            rows = await (await db.execute("SELECT id, name, parent_id FROM folders ORDER BY name COLLATE NOCASE")).fetchall()
        return [dict(r) for r in rows]

    async def breadcrumbs(self, folder_id: int | None) -> list[dict]:
        if folder_id is None:
            return []
        async with self.read() as db:
            rows = await (await db.execute(
                """WITH RECURSIVE up(id, name, parent_id, depth) AS (
                       SELECT id, name, parent_id, 0 FROM folders WHERE id=?
                       UNION ALL
                       SELECT f.id, f.name, f.parent_id, up.depth + 1 FROM folders f JOIN up ON f.id = up.parent_id)
                   SELECT id, name FROM up ORDER BY depth DESC""", (folder_id,))).fetchall()
        if not rows:
            raise NotFound("Folder does not exist.", folder_id=folder_id)
        return [dict(r) for r in rows]

    async def list_folder(self, parent_id: int | None = None) -> dict:
        crumbs = await self.breadcrumbs(parent_id)
        async with self.read() as db:
            folders = await (await db.execute(
                """SELECT f.id, f.name, f.parent_id, f.created_at,
                          (SELECT COUNT(*) FROM folders c WHERE c.parent_id = f.id) AS subfolder_count,
                          (SELECT COUNT(*) FROM files x WHERE x.folder_id = f.id) AS file_count
                   FROM folders f WHERE f.parent_id IS ? ORDER BY f.name COLLATE NOCASE""", (parent_id,))).fetchall()
            files = await (await db.execute(
                """SELECT id, uid, folder_id, file_name, file_size, mime_type, sha256_hash, total_chunks, uploaded_at
                   FROM files WHERE folder_id IS ? ORDER BY file_name COLLATE NOCASE""", (parent_id,))).fetchall()
        return {"folder_id": parent_id, "breadcrumbs": crumbs, "folders": [dict(r) for r in folders], "files": [dict(r) for r in files]}

    # ---- files ---------------------------------------------------------------------------------------------------
    async def add_file(self, *, uid: str, folder_id: int | None, file_name: str, file_size: int, mime_type: str,
                       sha256: str, chunks: Sequence[dict]) -> dict:
        """Commit a fully uploaded file and its chunk rows in one transaction.

        If the name is taken in that folder the file is stored as `name (1).ext`, `name (2).ext`, ...: by now the
        bytes are already on Telegram, and refusing would waste the upload.
        """
        name = clean_name(file_name)
        ordered = sorted(chunks, key=lambda c: c["index"])
        if [c["index"] for c in ordered] != list(range(len(ordered))):
            raise ValueError("Chunk indexes must be 0..n-1 with no gaps.")
        if sum(c["size"] for c in ordered) != file_size:
            raise ValueError("Chunk sizes do not add up to the file size.")
        async with self.write() as db:
            if folder_id is not None and not await _exists(db, "folders", folder_id):
                raise NotFound("Folder does not exist.", folder_id=folder_id)
            final = await _free_file_name(db, folder_id, name)
            cur = await db.execute(
                """INSERT INTO files(uid, folder_id, file_name, file_size, mime_type, sha256_hash, total_chunks)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""", (uid, folder_id, final, file_size, mime_type, sha256, len(ordered)))
            file_id = cur.lastrowid
            await db.executemany(
                "INSERT INTO file_chunks(file_id, chunk_index, chunk_size, telegram_file_id, telegram_message_id) VALUES (?,?,?,?,?)",
                [(file_id, c["index"], c["size"], str(c["telegram_file_id"]), c["message_id"]) for c in ordered])
            row = await (await db.execute("SELECT * FROM files WHERE id=?", (file_id,))).fetchone()
        return dict(row)

    async def get_file(self, file_id: int) -> dict:
        async with self.read() as db:
            row = await (await db.execute("SELECT * FROM files WHERE id=?", (file_id,))).fetchone()
            if row is None:
                raise NotFound("File does not exist.", file_id=file_id)
            chunks = await (await db.execute(
                "SELECT chunk_index, chunk_size, telegram_file_id, telegram_message_id FROM file_chunks WHERE file_id=? ORDER BY chunk_index",
                (file_id,))).fetchall()
        return {**dict(row), "chunks": [dict(c) for c in chunks]}

    async def has_uid(self, uid: str) -> bool:
        async with self.read() as db:
            return (await (await db.execute("SELECT 1 FROM files WHERE uid=?", (uid,))).fetchone()) is not None

    # ---- deleting ------------------------------------------------------------------------------------------------
    async def delete_items(self, file_ids: Sequence[int] = (), folder_ids: Sequence[int] = ()) -> dict:
        """Delete files and folders (with everything inside). Returns the Telegram message ids that are now unreferenced,
        so the caller can remove them from the channel after this transaction has committed."""
        file_ids, folder_ids = list(dict.fromkeys(file_ids)), list(dict.fromkeys(folder_ids))
        async with self.write() as db:
            messages: list[int] = []
            if file_ids:
                q = ",".join("?" * len(file_ids))
                messages += [r[0] for r in await (await db.execute(
                    f"SELECT telegram_message_id FROM file_chunks WHERE file_id IN ({q})", file_ids)).fetchall()]
            if folder_ids:
                q = ",".join("?" * len(folder_ids))
                messages += [r[0] for r in await (await db.execute(
                    f"""WITH RECURSIVE sub(id) AS (
                            SELECT id FROM folders WHERE id IN ({q})
                            UNION ALL SELECT f.id FROM folders f JOIN sub ON f.parent_id = sub.id)
                        SELECT c.telegram_message_id FROM file_chunks c JOIN files x ON x.id = c.file_id
                        WHERE x.folder_id IN (SELECT id FROM sub)""", folder_ids)).fetchall()]
            files_deleted = folders_deleted = 0
            if file_ids:
                q = ",".join("?" * len(file_ids))
                files_deleted = (await db.execute(f"DELETE FROM files WHERE id IN ({q})", file_ids)).rowcount
            if folder_ids:
                q = ",".join("?" * len(folder_ids))
                folders_deleted = (await db.execute(f"DELETE FROM folders WHERE id IN ({q})", folder_ids)).rowcount
        return {"messages": sorted(set(messages)), "files": files_deleted, "folders": folders_deleted}

    # ---- misc ----------------------------------------------------------------------------------------------------
    async def stats(self) -> dict:
        async with self.read() as db:
            row = await (await db.execute(
                "SELECT (SELECT COUNT(*) FROM files) AS files, (SELECT COUNT(*) FROM folders) AS folders, "
                "(SELECT COALESCE(SUM(file_size), 0) FROM files) AS bytes")).fetchone()
        return dict(row)

    async def ensure_folder_path(self, name: str, parent_id: int | None = None) -> int:
        """Return the id of a folder with this name under `parent_id`, creating it if missing."""
        name = clean_name(name)
        async with self.write() as db:
            row = await (await db.execute(
                "SELECT id FROM folders WHERE parent_id IS ? AND name = ? COLLATE NOCASE", (parent_id, name))).fetchone()
            if row:
                return row[0]
            cur = await db.execute("INSERT INTO folders(name, parent_id) VALUES (?, ?)", (name, parent_id))
            return cur.lastrowid  # type: ignore[return-value]


# ---- helpers -----------------------------------------------------------------------------------------------------
def _statements(script: str) -> list[str]:
    return [s.strip() for s in script.split(";") if s.strip()]


async def _exists(db: aiosqlite.Connection, table: str, row_id: int) -> bool:
    assert table in {"folders", "files"}
    return (await (await db.execute(f"SELECT 1 FROM {table} WHERE id=?", (row_id,))).fetchone()) is not None


async def _free_file_name(db: aiosqlite.Connection, folder_id: int | None, name: str) -> str:
    stem, ext = _split_ext(name)
    candidate, n = name, 0
    while await (await db.execute(
            "SELECT 1 FROM files WHERE folder_id IS ? AND file_name = ? COLLATE NOCASE", (folder_id, candidate))).fetchone():
        n += 1
        candidate = f"{stem} ({n}){ext}"
    return candidate
