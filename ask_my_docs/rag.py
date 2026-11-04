"""The retrieval step, shared by the CLI and the web app."""

from . import config
from .embeddings import embed
from .store import Hit, VectorStore


def retrieve(store: VectorStore, question: str, k: int = config.TOP_K) -> list[Hit]:
    """Embed the question and return the k most similar chunks."""
    query_vector = embed([question], prefix=config.QUERY_PREFIX)[0]
    return store.search(query_vector, k=k)
