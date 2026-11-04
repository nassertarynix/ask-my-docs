"""A small web app: a JSON/streaming API plus a single-page frontend.

Run it with `python -m ask_my_docs serve`. It is meant for local use and has no
authentication, so it binds to 127.0.0.1 by default.
"""

import json
from collections.abc import Iterator
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openai import APIConnectionError
from pydantic import BaseModel, Field

from . import config
from .generate import stream_answer
from .rag import retrieve
from .store import Hit, VectorStore

STATIC_DIR = Path(__file__).parent / "static"


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    top_k: int = Field(default=config.TOP_K, ge=1, le=10)
    use_llm: bool = True


def _line(event: dict) -> str:
    """One event in newline-delimited JSON, which the browser reads as a stream."""
    return json.dumps(event) + "\n"


def _source_payload(hits: list[Hit]) -> list[dict]:
    return [
        {
            "n": n,
            "source": hit.chunk.source,
            "chunk": hit.chunk.index,
            "page": hit.chunk.page,
            "score": round(hit.score, 4),
            "text": hit.chunk.text,
        }
        for n, hit in enumerate(hits, start=1)
    ]


def create_app(index_dir: Path | None = None) -> FastAPI:
    app = FastAPI(title="Ask My Docs")
    # Fonts are served from the app itself, so the page makes no requests to other sites.
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    directory = index_dir or config.INDEX_DIR
    cache: dict = {"mtime": None, "store": None}

    def get_store() -> VectorStore:
        """Load the index, reloading it if `ingest` has rewritten it."""
        marker = directory / "chunks.json"
        mtime = marker.stat().st_mtime if marker.exists() else None
        if cache["store"] is None or cache["mtime"] != mtime:
            cache["store"] = VectorStore.load(directory)  # raises if missing
            cache["mtime"] = mtime
        return cache["store"]

    @app.get("/")
    def home() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/api/status")
    def status() -> dict:
        info = {"chat_model": config.CHAT_MODEL, "embed_model": config.EMBED_MODEL,
                "top_k": config.TOP_K}
        try:
            store = get_store()
        except FileNotFoundError:
            return {**info, "indexed": False, "chunks": 0, "documents": []}
        documents = sorted({chunk.source for chunk in store.chunks})
        return {**info, "indexed": True, "chunks": len(store), "documents": documents}

    @app.post("/api/ask")
    def ask(request: AskRequest) -> StreamingResponse:
        question = request.question.strip()
        if not question:
            raise HTTPException(status_code=422, detail="Question must not be empty.")
        try:
            store = get_store()
        except FileNotFoundError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error

        def events() -> Iterator[str]:
            try:
                hits = retrieve(store, question, request.top_k)
                yield _line({"type": "sources", "sources": _source_payload(hits)})
                if request.use_llm:
                    for token in stream_answer(question, hits):
                        yield _line({"type": "token", "text": token})
                yield _line({"type": "done"})
            except APIConnectionError:
                yield _line({"type": "error", "message":
                             f"Could not reach the model server at {config.BASE_URL}. "
                             "Is Ollama running?"})
            except Exception as error:  # surface any other failure in the UI
                yield _line({"type": "error", "message": f"{type(error).__name__}: {error}"})

        return StreamingResponse(events(), media_type="application/x-ndjson")

    return app
