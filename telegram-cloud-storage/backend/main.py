"""Local API bridge: FastAPI on 127.0.0.1 that the desktop shell (Tauri + React) talks to.

Because this server has no login of its own and can write files, it is locked down (same approach as the sibling
"Ask My Docs" project):
 1. It binds to 127.0.0.1 only. The host is not configurable.
 2. Every request must carry the per-launch secret token (header `X-TGCS-Token`, or `?token=` for downloads and the
    WebSocket, where a browser cannot set headers). The desktop shell generates the token and passes it to the sidecar.
 3. The `Host` header must be a loopback name (stops DNS-rebinding), and a browser `Origin` must be on the allow-list
    (the Tauri webview and the Vite dev server), so a random website open in the same browser cannot talk to it.
 4. Upload size is capped while the body streams in, and names go through `clean_name`.
"""
from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
import os
import secrets
import shutil
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

from fastapi import BackgroundTasks, FastAPI, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from starlette.requests import ClientDisconnect

from .chunker import IntegrityError, check_chunk_size
from .config import ConfigStore, Settings
from .database import Conflict, Database, DatabaseError, InvalidName, NotFound, clean_name
from .service import EventBus, StorageService
from .telegram_client import (ChunkMissing, FloodWaitTooLong, LocalDirBackend, NeedPassword, NotAuthorized, NotConfigured,
                              StorageBackend, StorageError, TelethonBackend)

LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1"}
STATUS_FOR_CODE = {
    "not_found": 404, "name_exists": 409, "invalid_name": 422, "not_configured": 409, "not_authorized": 409,
    "password_required": 409, "flood_wait_too_long": 503, "chunk_missing": 410, "integrity_error": 502,
    "too_large": 413, "bad_request": 400,
}


@dataclass
class Context:
    settings: Settings
    db: Database
    bus: EventBus
    config: ConfigStore
    backend: StorageBackend | None = None
    service: StorageService | None = None
    backend_factory: Callable[[Settings, dict], StorageBackend | None] = field(default=lambda s, c: build_backend(s, c))
    connect_error: str | None = None
    connecting: bool = False

    async def connect_backend(self) -> None:
        """(Re)build the storage backend from settings and saved config. Safe to call again after the user logs in.

        Bounded by `connect_timeout`: with no internet Telegram never answers, and the app must still open and let the
        user browse. A failure is remembered in `connect_error` and shown by /api/status instead of being raised.
        """
        self.connecting, self.connect_error = True, None
        try:
            if self.backend is not None:
                with contextlib.suppress(Exception):
                    await self.backend.close()
            self.backend = self.service = None
            backend = self.backend_factory(self.settings, self.config.load())
            if backend is None:
                return
            self.backend = backend
            try:
                await asyncio.wait_for(backend.connect(), timeout=self.settings.connect_timeout)
            except asyncio.CancelledError:
                raise
            except asyncio.TimeoutError:
                self.connect_error = "Could not reach Telegram (timed out). Check your internet connection."
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(backend.close(), timeout=2)
                return
            except Exception as exc:  # noqa: BLE001 - a bad token or no network must not stop the app starting
                self.connect_error = (str(exc) or type(exc).__name__)[:200]
                return
            self.service = StorageService(self.db, backend, chunk_size=self.settings.chunk_size, bus=self.bus)
        finally:
            self.connecting = False


def build_backend(settings: Settings, cfg: dict) -> StorageBackend | None:
    if settings.backend == "local":
        return LocalDirBackend(settings.local_dir or settings.data_dir / "local-channel", settings.local_throttle)
    if cfg.get("api_id") and cfg.get("api_hash"):
        return TelethonBackend(session_path=settings.session_path, api_id=int(cfg["api_id"]), api_hash=cfg["api_hash"],
                               bot_token=cfg.get("bot_token") or None, channel=cfg.get("channel") or None)
    return None


# ---- request models ----------------------------------------------------------------------------------------------------
class FolderIn(BaseModel):
    name: str
    parent_id: int | None = None


class DeleteIn(BaseModel):
    file_ids: list[int] = Field(default_factory=list, max_length=10_000)
    folder_ids: list[int] = Field(default_factory=list, max_length=10_000)


class ConfigureIn(BaseModel):
    """Anything left out keeps its saved value, so the user never has to retype a secret the server cannot show them."""
    api_id: int | None = None
    api_hash: str | None = Field(default=None, min_length=8)
    bot_token: str | None = None  # "" clears it (switching from a bot to a user login)
    channel: str | None = None


class PhoneIn(BaseModel):
    phone: str = Field(min_length=5, max_length=32)


class CodeIn(BaseModel):
    code: str = Field(min_length=1, max_length=16)
    password: str | None = None


class ChannelIn(BaseModel):
    title: str = Field(default="Cloud storage", min_length=1, max_length=128)


class TooLarge(DatabaseError):
    code = "too_large"


class BadRequest(DatabaseError):
    code = "bad_request"


def create_app(settings: Settings, backend_factory: Callable[[Settings, dict], StorageBackend | None] | None = None) -> FastAPI:
    if not settings.token or len(settings.token) < 16:
        raise ValueError("A secret token of at least 16 characters is required (TGCS_TOKEN).")
    ctx_holder: dict[str, Context] = {}

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        settings.data_dir.mkdir(parents=True, exist_ok=True)
        shutil.rmtree(settings.spool_dir, ignore_errors=True)  # leftovers of an interrupted run
        settings.spool_dir.mkdir(parents=True, exist_ok=True)
        db = await Database(settings.db_path).open()
        ctx = Context(settings, db, EventBus(), ConfigStore(settings.config_path))
        if backend_factory is not None:
            ctx.backend_factory = backend_factory
        ctx_holder["ctx"] = ctx
        app.state.ctx = ctx
        # A local folder is instant; Telegram needs the network, so connect in the background and let the window open now.
        starter = asyncio.create_task(ctx.connect_backend()) if settings.backend == "telegram" else None
        if starter is None:
            await ctx.connect_backend()
        try:
            yield
        finally:
            if starter is not None:
                starter.cancel()
                with contextlib.suppress(BaseException):
                    await starter
            if ctx.backend:
                with contextlib.suppress(Exception):
                    await ctx.backend.close()
            await db.close()
            shutil.rmtree(settings.spool_dir, ignore_errors=True)

    app = FastAPI(title="Telegram Cloud Storage", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

    def ctx() -> Context:
        return ctx_holder["ctx"]

    def require_service() -> StorageService:
        service = ctx().service
        if service is None:
            raise NotConfigured("Telegram is not connected yet. Open Settings and connect an account and a channel.")
        return service

    # ---- security ------------------------------------------------------------------------------------------------------
    def host_ok(host_header: str | None) -> bool:
        if not host_header:
            return False
        host = host_header.rsplit(":", 1)[0] if not host_header.endswith("]") and host_header.count(":") == 1 else host_header
        return host.lower() in LOOPBACK_HOSTS

    def origin_ok(origin: str | None, host_header: str | None) -> bool:
        if origin is None:
            return True  # not a browser request; the token still has to be right
        return origin in settings.allowed_origins or origin == f"http://{host_header}"

    def token_ok(candidate: str | None) -> bool:
        return bool(candidate) and hmac.compare_digest(candidate.encode(), settings.token.encode())

    @app.middleware("http")
    async def guard(request: Request, call_next):
        if not host_ok(request.headers.get("host")):
            return _error("forbidden_host", "Requests must be sent to 127.0.0.1.", 403)
        if not origin_ok(request.headers.get("origin"), request.headers.get("host")):
            return _error("forbidden_origin", "This website is not allowed to use the local API.", 403)
        if request.url.path.startswith("/api/") and request.url.path != "/api/health" and request.method != "OPTIONS":
            if not token_ok(request.headers.get("x-tgcs-token") or request.query_params.get("token")):
                return _error("unauthorized", "Missing or wrong API token.", 401)
        return await call_next(request)

    app.add_middleware(CORSMiddleware, allow_origins=list(settings.allowed_origins), allow_methods=["GET", "POST", "DELETE"],
                       allow_headers=["Content-Type", "X-TGCS-Token"], expose_headers=["Content-Disposition"])

    def _error(code: str, message: str, status: int) -> JSONResponse:
        return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)

    @app.exception_handler(DatabaseError)
    async def db_error(_: Request, exc: DatabaseError):
        return _error(exc.code, str(exc), STATUS_FOR_CODE.get(exc.code, 400))

    @app.exception_handler(StorageError)
    async def storage_error(_: Request, exc: StorageError):
        return _error(exc.code, str(exc), STATUS_FOR_CODE.get(exc.code, 502))

    @app.exception_handler(IntegrityError)
    async def integrity_error(_: Request, exc: IntegrityError):
        return _error("integrity_error", str(exc), 502)

    # ---- status and connection -----------------------------------------------------------------------------------------
    @app.get("/api/health")
    async def health():
        return {"ok": True}

    @app.get("/api/status")
    async def status():
        c = ctx()
        info: dict[str, Any] = {"backend": c.settings.backend, "authorized": False, "ready": False, "channel": None,
                                "connecting": c.connecting, "connect_error": c.connect_error}
        if c.backend is not None:
            with contextlib.suppress(Exception):
                info.update(await c.backend.status())
        info["ready"] = bool(info.get("ready")) and c.service is not None
        info["connecting"], info["connect_error"] = c.connecting, c.connect_error
        return {**info, "config": c.config.public(), "stats": await c.db.stats(), "chunk_size": c.settings.chunk_size,
                "max_upload_bytes": c.settings.max_upload_bytes}

    @app.post("/api/auth/configure")
    async def configure(body: ConfigureIn):
        c = ctx()
        if c.settings.backend != "telegram":
            raise NotConfigured("This server runs with a local storage folder; there is nothing to configure.")
        merged = c.config.update(api_id=body.api_id, api_hash=body.api_hash, bot_token=body.bot_token, channel=body.channel)
        if not merged.get("api_id") or not merged.get("api_hash"):
            raise BadRequest("Both the API id and the API hash are needed (get them at my.telegram.org).")
        await c.connect_backend()
        return await status()

    @app.post("/api/auth/send-code")
    async def send_code(body: PhoneIn):
        backend = ctx().backend
        if not isinstance(backend, TelethonBackend):
            raise NotConfigured("Save your API id and API hash first.")
        await backend.send_code(body.phone.strip())
        return {"sent": True}

    @app.post("/api/auth/sign-in")
    async def sign_in(body: CodeIn):
        backend = ctx().backend
        if not isinstance(backend, TelethonBackend):
            raise NotConfigured("Save your API id and API hash first.")
        await backend.sign_in(body.code.strip(), body.password)
        await ctx().connect_backend()
        return await status()

    @app.post("/api/channel/create")
    async def create_channel(body: ChannelIn):
        backend = ctx().backend
        if not isinstance(backend, TelethonBackend):
            raise NotConfigured("Connect a Telegram account first.")
        channel = await backend.create_channel(body.title)
        ctx().config.update(channel=channel)
        await ctx().connect_backend()
        return await status()

    # ---- folders and files ---------------------------------------------------------------------------------------------
    @app.get("/api/folders")
    async def list_folder(parent_id: int | None = Query(default=None)):
        return await ctx().db.list_folder(parent_id)

    @app.get("/api/tree")
    async def tree():
        return {"folders": await ctx().db.folder_tree()}

    @app.post("/api/folders", status_code=201)
    async def create_folder(body: FolderIn):
        return await ctx().db.create_folder(body.name, body.parent_id)

    @app.post("/api/upload", status_code=201)
    async def upload(request: Request, name: str, folder_id: int | None = None, job_id: str | None = None):
        """The request body is the raw file. It is spooled to disk (and counted) first, because the whole-file checksum
        has to be known before the first chunk is sent."""
        name = clean_name(name)
        service = require_service()
        if folder_id is not None:
            await ctx().db.get_folder(folder_id)
        limit = settings.max_upload_bytes
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > limit:
            raise TooLarge(f"The file is larger than the {limit // 1024**3} GB limit.")
        spool = settings.spool_dir / f"{uuid.uuid4().hex}.upload"
        received = 0
        try:
            with open(spool, "wb") as fh:
                async for block in request.stream():
                    received += len(block)
                    if received > limit:
                        raise TooLarge(f"The file is larger than the {limit // 1024**3} GB limit.")
                    fh.write(block)
            return await service.upload_path(spool, name=name, folder_id=folder_id, job_id=job_id)
        except ClientDisconnect:
            return _error("bad_request", "The upload was interrupted.", 400)
        finally:
            with contextlib.suppress(FileNotFoundError):
                spool.unlink()

    @app.get("/api/download/{file_id}")
    async def download(file_id: int, background: BackgroundTasks, job_id: str | None = None):
        service = require_service()
        record = await ctx().db.get_file(file_id)
        dest = settings.spool_dir / f"{uuid.uuid4().hex}.download"
        await service.download_to(file_id, dest, job_id=job_id)
        background.add_task(lambda: dest.unlink(missing_ok=True))
        return FileResponse(dest, media_type=record["mime_type"], filename=record["file_name"], background=background)

    @app.delete("/api/items")
    async def delete_items(body: DeleteIn):
        if not body.file_ids and not body.folder_ids:
            return {"files": 0, "folders": 0, "messages": 0, "orphaned": 0}
        service = ctx().service
        if service is not None:
            return await service.delete_items(body.file_ids, body.folder_ids)
        result = await ctx().db.delete_items(body.file_ids, body.folder_ids)  # not connected: records go, messages are orphaned
        return {"files": result["files"], "folders": result["folders"], "messages": len(result["messages"]), "orphaned": len(result["messages"])}

    @app.post("/api/recover")
    async def recover():
        return await require_service().rebuild_index()

    # ---- live progress -------------------------------------------------------------------------------------------------
    @app.websocket("/ws/progress")
    async def progress_socket(ws: WebSocket):
        if not (host_ok(ws.headers.get("host")) and origin_ok(ws.headers.get("origin"), ws.headers.get("host"))
                and token_ok(ws.query_params.get("token"))):
            await ws.close(code=1008)
            return
        await ws.accept()
        queue = ctx().bus.subscribe()
        listener = asyncio.create_task(ws.receive())  # completes when the client goes away
        try:
            while True:
                getter = asyncio.create_task(queue.get())
                done, _ = await asyncio.wait({getter, listener}, return_when=asyncio.FIRST_COMPLETED)
                if listener in done:
                    getter.cancel()
                    break
                await ws.send_json(getter.result())
        except WebSocketDisconnect:
            pass
        finally:
            listener.cancel()
            ctx().bus.unsubscribe(queue)

    return app


def run() -> None:
    import uvicorn

    settings = Settings.from_env()
    if "--dev" in sys.argv and not settings.token:
        settings.token = secrets.token_urlsafe(24)
    app = create_app(settings)
    print(json.dumps({"event": "starting", "host": settings.host, "port": settings.port, "token": settings.token if "--dev" in sys.argv else None}), flush=True)
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="warning")


if __name__ == "__main__":
    run()
