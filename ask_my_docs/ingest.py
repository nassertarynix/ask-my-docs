"""Read documents from a folder (Markdown, text and PDF), chunk them, embed them, and build an index."""

import re
import unicodedata
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader

from . import config
from .chunking import chunk_text
from .embeddings import embed
from .store import Chunk, VectorStore

SUPPORTED_SUFFIXES = {".md", ".txt", ".pdf"}


@dataclass
class Page:
    number: int | None  # 1-based page number for PDFs; None for plain text and Markdown
    text: str


@dataclass
class Document:
    source: str  # path relative to the ingested folder
    title: str
    pages: list[Page]


class UnreadablePdf(Exception):
    """A PDF that cannot be turned into text. The message says why, in plain words."""


def extract_title(text: str) -> str:
    """The text of the first top-level Markdown heading ("# Title"), or ""."""
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def reflow_pdf_text(text: str) -> str:
    """Turn the text a PDF gives us into paragraphs that read like prose.

    PDFs store lines, not paragraphs: every visual line ends in a newline, words may be hyphenated
    across lines, and ligatures such as "ﬁ" arrive as one special character that would never match a
    search for "fi". So: normalise those characters, then join a line onto the previous one when it
    continues the same sentence, and keep short heading-like lines as their own paragraph.
    """
    text = unicodedata.normalize("NFKC", text)
    text = re.sub(r"(\w)-\n(?=[a-z])", r"\1", text)  # a word hyphenated at the end of a line

    paragraphs: list[str] = []
    current = ""
    last_line = ""
    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            if current:
                paragraphs.append(current)
                current, last_line = "", ""
            continue
        if not current:
            current, last_line = line, line
            continue
        # Does this line continue the paragraph, or start a new one? A heading is short and has no
        # closing punctuation, so it starts a new paragraph, and so does the line after it.
        looks_like_heading = len(line) < 50 and not line.endswith((".", "!", "?", ":", ",", ";"))
        if line[0].islower() or last_line.endswith((",", ";", ":")):
            continues = True
        elif last_line.endswith((".", "!", "?")):
            continues = not looks_like_heading      # a new sentence, or a heading that follows one
        else:
            continues = len(last_line) >= 50        # a wrapped line, or a short heading line
        if continues:
            current += " " + line
        else:
            paragraphs.append(current)
            current = line
        last_line = line
    if current:
        paragraphs.append(current)
    return "\n\n".join(paragraphs)


def _pdf_title(reader: PdfReader, path: Path) -> str:
    meta_title = (reader.metadata.title or "").strip() if reader.metadata else ""
    return meta_title or re.sub(r"[_\-]+", " ", path.stem).strip()


def read_pdf(path: Path, name: Path | None = None) -> tuple[str, list[Page]]:
    """Return (title, pages with text). Raises UnreadablePdf if the file cannot be read.

    `name` is what the file is called for the title fallback, when `path` is a temporary name.
    """
    try:
        reader = PdfReader(str(path))
        if reader.is_encrypted and not reader.decrypt(""):
            raise UnreadablePdf("it is password protected")
        pages = []
        for number, page in enumerate(reader.pages, start=1):
            text = reflow_pdf_text(page.extract_text() or "")
            if text.strip():
                pages.append(Page(number, text))
        return _pdf_title(reader, name or path), pages
    except UnreadablePdf:
        raise
    except Exception as error:  # pypdf raises many different errors for damaged files
        raise UnreadablePdf(f"it could not be read ({type(error).__name__})") from error


def read_document(path: Path, source: str) -> Document | None:
    """Read one file into a Document, the same way for `ingest` and for uploads.

    Returns None for an empty text file. Raises UnreadablePdf for a PDF that cannot be used
    (the message says why, in plain words).
    """
    if path.suffix.lower() == ".pdf":
        title, pages = read_pdf(path, Path(source))
        if not pages:
            raise UnreadablePdf("it has no text to read. It may be a scan; reading text from images "
                                "(OCR) is not supported")
        return Document(source, title, pages)
    text = path.read_text(encoding="utf-8", errors="ignore")
    if not text.strip():
        return None
    return Document(source, extract_title(text), [Page(None, text)])


def load_documents(folder: Path) -> tuple[list[Document], list[str]]:
    """Read every supported file under `folder`. Returns (documents, warnings about skipped files)."""
    if not folder.is_dir():
        raise NotADirectoryError(f"'{folder}' is not a folder")
    documents: list[Document] = []
    warnings: list[str] = []
    for path in sorted(folder.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in SUPPORTED_SUFFIXES:
            continue
        source = str(path.relative_to(folder))
        try:
            document = read_document(path, source)
        except UnreadablePdf as error:
            warnings.append(f"Skipped {source}: {error}.")
            continue
        if document:
            documents.append(document)
    return documents, warnings


def chunks_for(document: Document) -> list[Chunk]:
    """Split a document into chunks, page by page, so every chunk belongs to exactly one page."""
    chunks: list[Chunk] = []
    index = 0
    for page in document.pages:
        for piece in chunk_text(page.text, config.CHUNK_SIZE, config.CHUNK_OVERLAP):
            chunks.append(Chunk(text=piece, source=document.source, index=index,
                                title=document.title, page=page.number))
            index += 1
    return chunks


def build_index(folder: Path, on_warning: Callable[[str], None] | None = None) -> VectorStore:
    documents, warnings = load_documents(folder)
    for warning in warnings:
        if on_warning:
            on_warning(warning)
    if not documents:
        raise ValueError(f"No readable .md, .txt or .pdf files with text found in '{folder}'.")

    chunks = [chunk for document in documents for chunk in chunks_for(document)]
    vectors = embed([c.embedding_text for c in chunks], prefix=config.DOC_PREFIX)
    return VectorStore(chunks, vectors)
