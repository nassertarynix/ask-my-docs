"""Stream-based file splitting, hashing and verified reassembly. Pure standard library; no Telegram, no database.

Why this shape
- Files are read in fixed blocks, never loaded whole, so a 20 GB file needs only one chunk (default 20 MB) of memory.
- The SHA-256 of the *whole* file is computed before anything is uploaded. After download the reassembled file is hashed
  again and must match, so corruption or a missing/reordered chunk can never be delivered silently.
- Every Telegram message carries a small JSON caption (file uid, chunk index, total, whole-file checksum, chunk checksum, and
  the file's name/size/type). If the local index is lost, the channel alone is enough to rebuild it.
"""
from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator

DEFAULT_CHUNK_SIZE = 20 * 1024 * 1024
MIN_CHUNK_SIZE = 64 * 1024  # smaller chunks would mean thousands of messages per file and flood limits
MAX_CHUNK_SIZE = 1900 * 1024 * 1024  # Telegram's regular limit is 2 GB per file
HASH_BLOCK = 1024 * 1024
CAPTION_LIMIT = 1000  # Telegram allows 1024 characters on a caption; keep a margin
CAPTION_APP = "tgcs"
CAPTION_VERSION = 1

ProgressFn = Callable[[int, int], None]


class IntegrityError(Exception):
    """Reassembled data does not match what was uploaded."""


@dataclass(frozen=True)
class Chunk:
    index: int
    offset: int
    size: int
    sha256: str
    data: bytes


@dataclass(frozen=True)
class ChunkMeta:
    """What a Telegram caption says about one chunk."""
    uid: str
    index: int
    total: int
    file_sha256: str
    chunk_sha256: str
    name: str = ""
    size: int = 0
    mime: str = ""


def check_chunk_size(chunk_size: int) -> int:
    if not MIN_CHUNK_SIZE <= chunk_size <= MAX_CHUNK_SIZE:
        raise ValueError(f"chunk size must be between {MIN_CHUNK_SIZE} and {MAX_CHUNK_SIZE} bytes")
    return chunk_size


def chunk_count(size: int, chunk_size: int = DEFAULT_CHUNK_SIZE) -> int:
    """How many chunks a file of `size` bytes needs. An empty file needs none: Telegram cannot store an empty document."""
    check_chunk_size(chunk_size)
    return -(-size // chunk_size)


def hash_file(path: str | os.PathLike, progress: ProgressFn | None = None) -> tuple[str, int]:
    """SHA-256 and size of a whole file, streamed in 1 MB blocks."""
    digest, done = hashlib.sha256(), 0
    total = os.path.getsize(path)
    with open(path, "rb") as fh:
        while block := fh.read(HASH_BLOCK):
            digest.update(block)
            done += len(block)
            if progress:
                progress(done, total)
    return digest.hexdigest(), done


def iter_chunks(path: str | os.PathLike, chunk_size: int = DEFAULT_CHUNK_SIZE) -> Iterator[Chunk]:
    """Yield the file as consecutive chunks of exactly `chunk_size` bytes (the last one may be shorter)."""
    check_chunk_size(chunk_size)
    with open(path, "rb") as fh:
        index = offset = 0
        while data := fh.read(chunk_size):
            # fh.read on a regular file returns the full amount unless at EOF, but be strict about it
            while len(data) < chunk_size:
                more = fh.read(chunk_size - len(data))
                if not more:
                    break
                data += more
            yield Chunk(index, offset, len(data), hashlib.sha256(data).hexdigest(), data)
            index += 1
            offset += len(data)


def read_chunk(path: str | os.PathLike, index: int, chunk_size: int = DEFAULT_CHUNK_SIZE) -> Chunk:
    """Read one chunk by index (used to resume or retry a single chunk)."""
    check_chunk_size(chunk_size)
    with open(path, "rb") as fh:
        fh.seek(index * chunk_size)
        data = fh.read(chunk_size)
    if not data:
        raise IndexError(f"chunk {index} is past the end of the file")
    return Chunk(index, index * chunk_size, len(data), hashlib.sha256(data).hexdigest(), data)


# ---- captions (disaster recovery) --------------------------------------------------------------------------------------
def build_caption(meta: ChunkMeta) -> str:
    """Compact JSON for the Telegram caption. The file name is trimmed if needed so the caption always fits."""
    def render(name: str) -> str:
        return json.dumps({
            "app": CAPTION_APP, "v": CAPTION_VERSION, "fid": meta.uid, "i": meta.index, "n": meta.total,
            "sha": meta.file_sha256, "csha": meta.chunk_sha256, "name": name, "size": meta.size, "mime": meta.mime,
        }, separators=(",", ":"), ensure_ascii=False)

    name = meta.name
    text = render(name)
    while len(text) > CAPTION_LIMIT and name:
        name = name[: max(0, len(name) - (len(text) - CAPTION_LIMIT) - 1)]
        text = render(name)
    return text


def parse_caption(text: str | None) -> ChunkMeta | None:
    """Return the metadata in a caption, or None if the message is not one of ours (or is damaged)."""
    if not text or not text.startswith("{"):
        return None
    try:
        raw = json.loads(text)
        if raw.get("app") != CAPTION_APP or raw.get("v") != CAPTION_VERSION:
            return None
        meta = ChunkMeta(
            uid=str(raw["fid"]), index=int(raw["i"]), total=int(raw["n"]), file_sha256=str(raw["sha"]),
            chunk_sha256=str(raw["csha"]), name=str(raw.get("name", "")), size=int(raw.get("size", 0)), mime=str(raw.get("mime", "")))
    except (ValueError, KeyError, TypeError, AttributeError):
        return None
    if meta.total < 1 or not 0 <= meta.index < meta.total or len(meta.file_sha256) != 64 or len(meta.chunk_sha256) != 64:
        return None
    return meta


# ---- reassembly --------------------------------------------------------------------------------------------------------
class Reassembler:
    """Append downloaded chunks, in order, to a destination file while hashing; `finish()` checks size and checksum.

    The destination is written under a temporary name and only renamed into place when everything matches, so a failed
    or interrupted download never leaves a plausible-looking partial file behind.
    """

    def __init__(self, dest: str | os.PathLike, expected_sha256: str, expected_size: int, expected_chunks: int) -> None:
        self.dest = Path(dest)
        self.tmp = self.dest.with_name(self.dest.name + ".part")
        self.expected_sha256, self.expected_size, self.expected_chunks = expected_sha256, expected_size, expected_chunks
        self._digest = hashlib.sha256()
        self._next = 0
        self._written = 0
        self.dest.parent.mkdir(parents=True, exist_ok=True)
        self._fh = open(self.tmp, "wb")

    def add(self, index: int, data: bytes, expected_size: int | None = None) -> None:
        if index != self._next:
            raise IntegrityError(f"chunk {index} arrived but chunk {self._next} was expected")
        if expected_size is not None and len(data) != expected_size:
            raise IntegrityError(f"chunk {index} is {len(data)} bytes, expected {expected_size}")
        self._fh.write(data)
        self._digest.update(data)
        self._written += len(data)
        self._next += 1

    def finish(self) -> Path:
        self._fh.close()
        try:
            if self._next != self.expected_chunks:
                raise IntegrityError(f"got {self._next} chunks, expected {self.expected_chunks}")
            if self._written != self.expected_size:
                raise IntegrityError(f"got {self._written} bytes, expected {self.expected_size}")
            if self._digest.hexdigest() != self.expected_sha256:
                raise IntegrityError("checksum mismatch: the reassembled file is not the file that was uploaded")
            os.replace(self.tmp, self.dest)
        except BaseException:
            self.abort()
            raise
        return self.dest

    def abort(self) -> None:
        try:
            self._fh.close()
        finally:
            try:
                os.remove(self.tmp)
            except FileNotFoundError:
                pass
