"""Split text into overlapping chunks that respect paragraph boundaries."""

import re


def _paragraphs(text: str) -> list[str]:
    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


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
    - A paragraph longer than `size` is cut into windows of `size` characters.
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
        if len(para) <= size:
            pieces.append(para)
        else:
            # Plain windows: the overlap is added once, in the packing loop below.
            pieces.extend(para[i : i + size] for i in range(0, len(para), size))

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
