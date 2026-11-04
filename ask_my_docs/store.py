"""A tiny in-memory vector store, persisted as JSON + a NumPy file."""

import json
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np


@dataclass
class Chunk:
    text: str
    source: str  # file the chunk came from, relative to the ingested folder
    index: int  # position of the chunk within that file
    title: str = ""  # the document's title (its first "# " heading), if any

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

    def search(self, query_vector: np.ndarray, k: int = 4) -> list[Hit]:
        """Return the k chunks most similar to `query_vector` (unit length)."""
        if not self.chunks:
            return []
        scores = self.vectors @ query_vector
        top = np.argsort(-scores)[:k]
        return [Hit(self.chunks[i], float(scores[i])) for i in top]

    def save(self, directory: Path) -> None:
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "chunks.json").write_text(
            json.dumps([asdict(c) for c in self.chunks], indent=2), encoding="utf-8"
        )
        np.save(directory / "vectors.npy", self.vectors)

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
