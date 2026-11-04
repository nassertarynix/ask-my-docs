"""Split text into overlapping chunks that respect natural boundaries."""

import re

_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def _paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


def _split_long(block: str, size: int) -> list[str]:
    """Break a block longer than `size` into pieces of at most `size` characters.

    Prefers natural boundaries so chunks do not start or end mid-sentence:
    first line breaks (bullet lists), then sentence ends, and only as a last
    resort fixed-width windows.
    """
    for split in (lambda s: s.split("\n"), lambda s: _SENTENCE_END.split(s)):
        parts = [p.strip() for p in split(block) if p.strip()]
        if len(parts) > 1:
            pieces: list[str] = []
            for part in parts:
                pieces.extend([part] if len(part) <= size else _split_long(part, size))
            return pieces
    return [block[i : i + size] for i in range(0, len(block), size)]


def _word_boundary_tail(text: str, overlap: int) -> str:
    """Last `overlap` characters of `text`, trimmed to start at a whole word."""
    if overlap <= 0:
        return ""
    tail = text[-overlap:]
    space = tail.find(" ")
    return tail[space + 1 :] if space != -1 else tail


def chunk_text(text: str, size: int = 800, overlap: int = 120) -> list[str]:
    """Pack paragraphs into chunks of roughly `size` characters.

    - Paragraphs are kept whole whenever they fit.
    - A longer paragraph is split at line breaks, then sentence ends, and only
      then into fixed windows (see `_split_long`). Headings therefore stay
      packed with the text that follows them.
    - Each new chunk starts with the tail of the previous one (`overlap`
      characters) so a fact that straddles a boundary still appears intact
      in at least one chunk. A chunk can therefore exceed `size` by up to
      `overlap + 2` characters (the overlap plus the paragraph separator).
    """
    if size <= 0:
        raise ValueError("size must be positive")
    if not 0 <= overlap < size:
        raise ValueError("overlap must be >= 0 and smaller than size")

    pieces: list[str] = []
    for para in _paragraphs(text):
        pieces.extend([para] if len(para) <= size else _split_long(para, size))

    chunks: list[str] = []
    current = ""
    for piece in pieces:
        if current and len(current) + len(piece) + 2 > size:
            chunks.append(current)
            tail = _word_boundary_tail(current, overlap)
            current = f"{tail}\n\n{piece}" if tail else piece
        else:
            current = f"{current}\n\n{piece}" if current else piece
    if current:
        chunks.append(current)
    return chunks
