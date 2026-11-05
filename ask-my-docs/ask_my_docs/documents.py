"""Add and remove documents in a running index: the logic behind the web page's upload feature.

Everything here that a person could get wrong raises UploadError with a plain-language message
and an HTTP status, so the web layer can pass it straight on.
"""

import os
import re
import secrets
from dataclasses import dataclass
from pathlib import Path

from openai import APIConnectionError

from . import config
from .embeddings import embed
from .ingest import SUPPORTED_SUFFIXES, UnreadablePdf, chunks_for, read_document
from .store import VectorStore

MAX_NAME_LENGTH = 120
TYPES_TEXT = ", ".join(sorted(SUPPORTED_SUFFIXES))


class UploadError(Exception):
    """A problem the person can fix. `status` is the HTTP status the web layer should answer with."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass
class AddResult:
    name: str
    chunks: int
    pages: int | None  # number of PDF pages with text, None for plain text
    replaced: bool  # True when a document with this name was already in the index


def clean_name(raw: str | None) -> str:
    """Validate an uploaded file name. Only a plain file name with a supported extension passes.

    The name is used as a file name on disk and as the document's name in the index, so it must not
    be able to point anywhere else: no folders, no hidden files, no control characters.
    """
    name = (raw or "").strip()
    if not name:
        raise UploadError("The file needs a name.")
    if re.search(r"[\x00-\x1f]", name) or "/" in name or "\\" in name or name != Path(name).name:
        raise UploadError("The file name cannot contain folders or control characters.")
    if name.startswith("."):
        raise UploadError("The file name cannot start with a dot.")
    if len(name) > MAX_NAME_LENGTH:
        raise UploadError(f"The file name is longer than {MAX_NAME_LENGTH} characters.")
    suffix = Path(name).suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise UploadError(f"'{name}' is not a supported file type. Use {TYPES_TEXT}.", 415)
    return name


def check_content(name: str, data: bytes) -> None:
    """Reject files whose content does not match their extension, before any work is done."""
    if not data.strip():
        raise UploadError(f"'{name}' is empty.", 422)
    if name.lower().endswith(".pdf"):
        if b"%PDF-" not in data[:1024]:
            raise UploadError(f"'{name}' does not look like a PDF file.", 415)
    elif b"\x00" in data[:4096]:
        raise UploadError(f"'{name}' does not look like a text file.", 415)


def add_document(store: VectorStore, uploads_dir: Path, name: str, data: bytes) -> tuple[VectorStore, AddResult]:
    """Read, chunk and embed one uploaded file, and return a new store that includes it.

    The upload is checked and embedded first and only then moved into `uploads_dir`, so a file that
    fails leaves nothing behind, and a failed replacement keeps the previous version. A document
    with the same name is replaced.
    """
    name = clean_name(name)
    check_content(name, data)
    uploads_dir.mkdir(parents=True, exist_ok=True)
    temp = uploads_dir / f".incoming-{secrets.token_hex(6)}{Path(name).suffix.lower()}"
    try:
        temp.write_bytes(data)
        try:
            document = read_document(temp, name)
        except UnreadablePdf as error:
            raise UploadError(f"'{name}': {error}.", 422) from error
        chunks = chunks_for(document) if document else []
        if not chunks:
            raise UploadError(f"'{name}' has no text to read.", 422)
        try:
            vectors = embed([c.embedding_text for c in chunks], prefix=config.DOC_PREFIX)
        except APIConnectionError as error:
            raise UploadError(f"Could not reach the model server at {config.BASE_URL}. "
                              "Is Ollama running?", 503) from error
        except Exception as error:
            raise UploadError(f"The model server could not embed '{name}': {error}", 502) from error

        replaced = any(chunk.source == name for chunk in store.chunks)
        try:
            new_store = store.without_source(name).extended(chunks, vectors)
        except ValueError as error:
            raise UploadError(str(error), 409) from error
        os.replace(temp, uploads_dir / name)
        pages = max((c.page for c in chunks if c.page), default=None)
        return new_store, AddResult(name, len(chunks), pages, replaced)
    finally:
        temp.unlink(missing_ok=True)


def remove_document(store: VectorStore, uploads_dir: Path, name: str) -> VectorStore:
    """Remove a document that was added from the web page. Documents from `ingest` stay put."""
    name = clean_name(name)
    path = uploads_dir / name
    if not path.is_file():
        raise UploadError(f"'{name}' was not added from this page, so it cannot be removed here.", 404)
    new_store = store.without_source(name)
    path.unlink()
    return new_store


def describe(store: VectorStore, uploads_dir: Path) -> list[dict]:
    """The documents in the index, each with its passage count and whether it can be removed here."""
    return [
        {"name": name, **summary, "uploaded": "/" not in name and (uploads_dir / name).is_file()}
        for name, summary in store.source_summaries().items()
    ]
