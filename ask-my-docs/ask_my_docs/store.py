"""A tiny in-memory vector store, persisted as JSON + a NumPy file."""

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np


@dataclass
class Chunk:
    text: str
    source: str  # file the chunk came from, relative to the ingested folder
    index: int  # position of the chunk within that file
    title: str = ""  # the document's title (its first "# " heading, or a PDF's title), if any
    page: int | None = None  # page number for PDFs, so answers can cite "page 3"

    @property
    def embedding_text(self) -> str:
        """Text sent to the embedding model: the chunk with its document title.

        A chunk from the middle of a long document may never mention what the
        document is about; the title restores that context for search.
        """
        return f"{self.title}\n\n{self.text}" if self.title else self.text


@dataclass
class Hit:
    chunk: Chunk
    score: float  # cosine similarity, higher is closer


class VectorStore:
    def __init__(self, chunks: list[Chunk], vectors: np.ndarray):
        if len(chunks) != len(vectors):
            raise ValueError("chunks and vectors must have the same length")
        self.chunks = chunks
        self.vectors = vectors

    def __len__(self) -> int:
        return len(self.chunks)

    @classmethod
    def empty(cls) -> "VectorStore":
        return cls([], np.zeros((0, 0), dtype=np.float32))

    def search(self, query_vector: np.ndarray, k: int = 4) -> list[Hit]:
        """Return the k chunks most similar to `query_vector` (unit length)."""
        if not self.chunks:
            return []
        scores = self.vectors @ query_vector
        top = np.argsort(-scores)[:k]
        return [Hit(self.chunks[i], float(scores[i])) for i in top]

    # The two methods below return a new store and leave this one untouched, so a server can
    # build the new version and then swap it in while other requests keep using the old one.

    def extended(self, chunks: list[Chunk], vectors: np.ndarray) -> "VectorStore":
        """A new store with `chunks` and their `vectors` added."""
        if not self.chunks:
            return VectorStore(list(chunks), vectors)
        if len(chunks) and vectors.shape[1] != self.vectors.shape[1]:
            raise ValueError(
                "The new passages were embedded with a different model than the index. "
                "Re-run 'ingest' to rebuild the index with the current model."
            )
        return VectorStore(self.chunks + list(chunks), np.vstack([self.vectors, vectors]))

    def without_source(self, source: str) -> "VectorStore":
        """A new store without any chunk that came from `source`."""
        keep = [i for i, chunk in enumerate(self.chunks) if chunk.source != source]
        if not keep:
            return VectorStore.empty()
        return VectorStore([self.chunks[i] for i in keep], self.vectors[keep])

    def source_summaries(self) -> dict[str, dict]:
        """Per document: how many passages it has and, for PDFs, how many pages."""
        summaries: dict[str, dict] = {}
        for chunk in self.chunks:
            entry = summaries.setdefault(chunk.source, {"chunks": 0, "pages": None})
            entry["chunks"] += 1
            if chunk.page:
                entry["pages"] = max(entry["pages"] or 0, chunk.page)
        return dict(sorted(summaries.items()))

    def save(self, directory: Path) -> None:
        """Write the index so that a crash part-way cannot leave a half-written file behind."""
        directory.mkdir(parents=True, exist_ok=True)
        chunks_tmp = directory / "chunks.json.tmp"
        vectors_tmp = directory / "vectors.npy.tmp"
        chunks_tmp.write_text(json.dumps([asdict(c) for c in self.chunks], indent=2), encoding="utf-8")
        with open(vectors_tmp, "wb") as handle:
            np.save(handle, self.vectors)
        os.replace(vectors_tmp, directory / "vectors.npy")
        os.replace(chunks_tmp, directory / "chunks.json")

    @classmethod
    def load(cls, directory: Path) -> "VectorStore":
        chunks_file = directory / "chunks.json"
        vectors_file = directory / "vectors.npy"
        if not chunks_file.exists() or not vectors_file.exists():
            raise FileNotFoundError(
                f"No index found in '{directory}'. Run the 'ingest' command first."
            )
        raw = json.loads(chunks_file.read_text(encoding="utf-8"))
        return cls([Chunk(**c) for c in raw], np.load(vectors_file))
