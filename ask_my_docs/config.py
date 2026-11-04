"""Settings, read from environment variables with local-Ollama defaults.

To switch to a hosted provider, set LLM_BASE_URL, LLM_API_KEY, CHAT_MODEL and
EMBED_MODEL (and clear the embedding prefixes). No code changes needed.
"""

import os
from pathlib import Path

# Any OpenAI-compatible endpoint works. Ollama exposes one at /v1.
BASE_URL = os.getenv("LLM_BASE_URL", "http://localhost:11434/v1")
API_KEY = os.getenv("LLM_API_KEY", "ollama")  # Ollama ignores the key

CHAT_MODEL = os.getenv("CHAT_MODEL", "llama3.2:3b")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")

# nomic-embed-text was trained with task prefixes; they improve retrieval.
# Set both to "" for models that do not use prefixes.
DOC_PREFIX = os.getenv("EMBED_DOC_PREFIX", "search_document: ")
QUERY_PREFIX = os.getenv("EMBED_QUERY_PREFIX", "search_query: ")

INDEX_DIR = Path(os.getenv("INDEX_DIR", "index"))

CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "800"))  # characters
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "120"))  # characters
TOP_K = int(os.getenv("TOP_K", "4"))
