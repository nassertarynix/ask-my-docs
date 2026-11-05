"""A small web app: a JSON/streaming API plus a single-page frontend.

Run it with `python -m ask_my_docs serve`. It is meant for local use and has no
authentication, so it binds to 127.0.0.1 by default. Adding and removing documents from the
page is only allowed when the server is bound to this machine (see `create_app`).
"""

import json
import threading
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openai import APIConnectionError
from pydantic import BaseModel, Field

from . import config, documents
from .documents import UploadError
from .generate import stream_answer
from .ingest import SUPPORTED_SUFFIXES
from .rag import retrieve
from .store import Hit, VectorStore

STATIC_DIR = Path(__file__).parent / "static"
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


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


def _require_same_local_origin(request: Request) -> None:
    """Refuse requests that did not come from this app's own page on this machine.

    A page on another website that the person has open in the same browser could otherwise send
    requests to a server on localhost. A request is accepted only if its Host is a loopback name
    (this also stops DNS rebinding) and any Origin header names that same host.
    """
    host_header = request.headers.get("host", "")
    if (urlparse("//" + host_header).hostname or "") not in LOCAL_HOSTS:
        raise HTTPException(status_code=403, detail="Documents can only be changed from this machine.")
    origin = request.headers.get("origin")
    if origin is not None and urlparse(origin).netloc.lower() != host_header.lower():
        raise HTTPException(status_code=403, detail="This request came from another site and was refused.")


def create_app(index_dir: Path | None = None, uploads_enabled: bool = True,
               max_upload_mb: int | None = None) -> FastAPI:
    """Build the web app.

    `uploads_enabled` turns the add/remove-document endpoints on or off. The command line turns it
    off whenever the server is bound to anything other than this machine, because the server has
    no login. Uploaded files are kept in `<index folder>/uploads`.
    """
    app = FastAPI(title="Ask My Docs")
    # Fonts are served from the app itself, so the page makes no requests to other sites.
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
    directory = index_dir or config.INDEX_DIR
    uploads_dir = directory / "uploads"
    max_mb = max_upload_mb or config.MAX_UPLOAD_MB
    max_bytes = max_mb * 1024 * 1024
    cache: dict = {"mtime": None, "store": None}
    lock = threading.Lock()  # one change to the index at a time

    def get_store() -> VectorStore:
        """Load the index, reloading it if `ingest` has rewritten it."""
        marker = directory / "chunks.json"
        mtime = marker.stat().st_mtime if marker.exists() else None
        if cache["store"] is None or cache["mtime"] != mtime:
            cache["store"] = VectorStore.load(directory)  # raises if missing
            cache["mtime"] = mtime
        return cache["store"]

    def current_store() -> VectorStore:
        try:
            return get_store()
        except FileNotFoundError:
            return VectorStore.empty()

    def save_and_use(store: VectorStore) -> None:
        store.save(directory)
        cache["store"] = store
        cache["mtime"] = (directory / "chunks.json").stat().st_mtime

    def status_payload() -> dict:
        store = current_store()
        details = documents.describe(store, uploads_dir)
        return {
            "chat_model": config.CHAT_MODEL, "embed_model": config.EMBED_MODEL, "top_k": config.TOP_K,
            "uploads": {"enabled": uploads_enabled, "max_mb": max_mb, "types": sorted(SUPPORTED_SUFFIXES)},
            "indexed": len(store) > 0, "chunks": len(store),
            "documents": [d["name"] for d in details], "document_details": details,
        }

    @app.get("/")
    def home() -> FileResponse:
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/api/status")
    def status() -> dict:
        return status_payload()

    @app.post("/api/documents")
    async def add_document(request: Request, name: str = Query(..., max_length=300)) -> dict:
        """Add (or replace) one document. The request body is the raw file; `name` is its file name."""
        if not uploads_enabled:
            raise HTTPException(status_code=403, detail="Adding documents is turned off on this server.")
        _require_same_local_origin(request)
        try:
            clean = documents.clean_name(name)
        except UploadError as error:
            raise HTTPException(status_code=error.status, detail=error.message) from error

        too_big = HTTPException(status_code=413, detail=f"The file is larger than {max_mb} MB.")
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > max_bytes:
            raise too_big
        body = bytearray()
        async for piece in request.stream():  # stop reading as soon as the limit is passed
            body += piece
            if len(body) > max_bytes:
                raise too_big

        def work() -> documents.AddResult:
            with lock:
                new_store, result = documents.add_document(current_store(), uploads_dir, clean, bytes(body))
                save_and_use(new_store)
                return result

        try:
            result = await run_in_threadpool(work)
        except UploadError as error:
            raise HTTPException(status_code=error.status, detail=error.message) from error
        return {**status_payload(), "added": {"name": result.name, "chunks": result.chunks,
                                              "pages": result.pages, "replaced": result.replaced}}

    @app.delete("/api/documents/{name}")
    def remove_document(name: str, request: Request) -> dict:
        """Remove a document that was added from the page."""
        if not uploads_enabled:
            raise HTTPException(status_code=403, detail="Removing documents is turned off on this server.")
        _require_same_local_origin(request)
        try:
            with lock:
                save_and_use(documents.remove_document(current_store(), uploads_dir, name))
        except UploadError as error:
            raise HTTPException(status_code=error.status, detail=error.message) from error
        return status_payload()

    @app.post("/api/ask")
    def ask(request: AskRequest) -> StreamingResponse:
        question = request.question.strip()
        if not question:
            raise HTTPException(status_code=422, detail="Question must not be empty.")
        try:
            store = get_store()
        except FileNotFoundError as error:
            raise HTTPException(status_code=409, detail=str(error)) from error
        if not len(store):
            raise HTTPException(status_code=409, detail="There are no documents yet. Add some first.")

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
