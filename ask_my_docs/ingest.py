"""Read documents from a folder, chunk them, embed them, and build an index."""

from pathlib import Path

from . import config
from .chunking import chunk_text
from .embeddings import embed
from .store import Chunk, VectorStore

SUPPORTED_SUFFIXES = {".md", ".txt"}


def load_documents(folder: Path) -> list[tuple[str, str]]:
    """Return (relative_path, text) for every supported file under `folder`."""
    if not folder.is_dir():
        raise NotADirectoryError(f"'{folder}' is not a folder")
    documents = []
    for path in sorted(folder.rglob("*")):
        if path.is_file() and path.suffix.lower() in SUPPORTED_SUFFIXES:
            text = path.read_text(encoding="utf-8", errors="ignore")
            if text.strip():
                documents.append((str(path.relative_to(folder)), text))
    return documents


def extract_title(text: str) -> str:
    """The text of the first top-level Markdown heading ("# Title"), or ""."""
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def build_index(folder: Path) -> VectorStore:
    documents = load_documents(folder)
    if not documents:
        raise ValueError(
            f"No .md or .txt files with content found in '{folder}'."
        )

    chunks: list[Chunk] = []
    for source, text in documents:
        title = extract_title(text)
        for i, piece in enumerate(chunk_text(text, config.CHUNK_SIZE, config.CHUNK_OVERLAP)):
            chunks.append(Chunk(text=piece, source=source, index=i, title=title))

    vectors = embed([c.embedding_text for c in chunks], prefix=config.DOC_PREFIX)
    return VectorStore(chunks, vectors)
