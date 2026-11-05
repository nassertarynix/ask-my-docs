"""Turn text into unit-length embedding vectors via an OpenAI-compatible API."""

import numpy as np
from openai import OpenAI

from . import config

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(base_url=config.BASE_URL, api_key=config.API_KEY)
    return _client


def embed(texts: list[str], prefix: str = "", batch_size: int = 16) -> np.ndarray:
    """Return an (n, dim) float32 array of L2-normalised embeddings.

    Normalising here means a plain dot product between two vectors is their
    cosine similarity, which keeps search a one-liner.
    """
    if not texts:
        return np.zeros((0, 0), dtype=np.float32)

    vectors: list[list[float]] = []
    for start in range(0, len(texts), batch_size):
        batch = [prefix + t for t in texts[start : start + batch_size]]
        response = _get_client().embeddings.create(model=config.EMBED_MODEL, input=batch)
        vectors.extend(item.embedding for item in response.data)

    matrix = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return matrix / norms
