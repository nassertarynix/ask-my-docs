"""The web application: a local page and a small JSON/SSE API in front of yt-dlp.

Run it with `python main.py` and open http://127.0.0.1:8000. It binds to this machine only and cannot be told otherwise: the API can
start programs and write files, and it has no login. Every request must therefore be addressed to a loopback name (blocking DNS
rebinding) and, if a browser sends an `Origin`, it must be this same page (blocking other websites from using it).
"""
from __future__ import annotations

import contextlib
import json
import logging
import os
import shutil
import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Query, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from downloader import DownloaderError, JobManager, find_ffmpeg, list_directories, native_folder_dialog, resolve_ytdlp
from errors import ErrorInfo
from options import (DEFAULT_AUDIO_FORMAT, DEFAULT_VIDEO_FORMAT, OptionError, build_options, resolve_output_dir, validate_audio_format,
                     validate_format_selection, validate_url)
from settings import SettingsStore, default_data_dir

log = logging.getLogger("main")
HERE = Path(__file__).resolve().parent
LOOPBACK = {"127.0.0.1", "localhost", "[::1]", "::1"}
STATUS_FOR_CODE = {"invalid_url": 422, "invalid_option": 422, "invalid_format": 422, "invalid_path": 422, "invalid_proxy": 422,
                   "invalid_user_agent": 422, "invalid_cookies": 422, "permission": 403, "ytdlp_missing": 503, "ffmpeg_missing": 424,
                   "busy": 409, "not_found": 404, "update_failed": 502}
CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; style-src 'self' 'unsafe-inline'; "
       "img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")


class InfoRequest(BaseModel):
    url: str
    options: dict[str, Any] = Field(default_factory=dict)


class DownloadRequest(BaseModel):
    url: str
    format_selection: str = ""
    output_path: str = ""
    extract_audio: bool = False
    audio_format: str = "mp3"
    options: dict[str, Any] = Field(default_factory=dict)
    is_playlist: bool = False  # lets the download go into a folder named after the playlist
    title: str | None = Field(default=None, max_length=300)
    thumbnail: str | None = Field(default=None, max_length=2000)


class CancelRequest(BaseModel):
    job_id: str = Field(min_length=1, max_length=64)


def _error(code: str, message: str, status: int, hint: str = "") -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message, "hint": hint}}, status_code=status)


def create_app(*, data_dir: Path | None = None, ytdlp: list[str] | None | str = "auto", env: dict[str, str] | None = None,
               max_concurrent: int | None = None, max_retries: int = 2, retry_delays: tuple[float, ...] = (3.0, 8.0)) -> FastAPI:
    data = data_dir or default_data_dir()
    store = SettingsStore(data)
    state: dict[str, Any] = {}

    @contextlib.asynccontextmanager
    async def lifespan(app: FastAPI):
        data.mkdir(parents=True, exist_ok=True)
        temp_root = data / "tmp"
        shutil.rmtree(temp_root, ignore_errors=True)  # leftovers of a crash: no download can be running yet
        command = resolve_ytdlp(env) if ytdlp == "auto" else ytdlp
        manager = JobManager(command, temp_root=temp_root, env=env, max_retries=max_retries, retry_delays=retry_delays,
                             max_concurrent=max_concurrent or int(os.environ.get("MD_MAX_CONCURRENT", "2")))
        state["manager"] = manager
        app.state.manager, app.state.store = manager, store
        try:
            yield
        finally:
            await manager.shutdown()  # stops every yt-dlp process and removes their partial files
            shutil.rmtree(temp_root, ignore_errors=True)

    app = FastAPI(title="Media Downloader", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

    def manager() -> JobManager:
        return state["manager"]

    # ---- the guard --------------------------------------------------------------------------------------------------------------------
    def host_name(host_header: str | None) -> str:
        host = (host_header or "").lower()
        return host.rsplit(":", 1)[0] if host.count(":") == 1 and not host.endswith("]") else host

    @app.middleware("http")
    async def guard(request: Request, call_next):
        host = request.headers.get("host")
        if host_name(host) not in LOOPBACK:
            return _error("forbidden_host", "Open this app at http://127.0.0.1.", 403)
        origin = request.headers.get("origin")
        if origin is not None and origin != f"http://{host}":
            return _error("forbidden_origin", "This website is not allowed to use the local downloader.", 403)
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Content-Security-Policy", CSP)
        if request.url.path.startswith("/api/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response

    @app.exception_handler(OptionError)
    async def option_error(_: Request, exc: OptionError):
        return _error(exc.code, str(exc), STATUS_FOR_CODE.get(exc.code, 422), exc.hint)

    @app.exception_handler(DownloaderError)
    async def downloader_error(_: Request, exc: DownloaderError):
        info: ErrorInfo = exc.info
        return _error(info.code, info.message, STATUS_FOR_CODE.get(info.code, 502), info.hint)

    def build(request_options: dict[str, Any]):
        return build_options(store.options_layer(), request_options)

    # ---- information ---------------------------------------------------------------------------------------------------------------------
    @app.post("/api/info")
    async def info(body: InfoRequest):
        url = validate_url(body.url)
        return await manager().fetch_info(url, build(body.options))

    # ---- downloads -----------------------------------------------------------------------------------------------------------------------
    @app.post("/api/download", status_code=202)
    async def download(body: DownloadRequest):
        url = validate_url(body.url)
        options = build(body.options)
        audio_format = validate_audio_format(body.audio_format)
        selection = validate_format_selection(body.format_selection, DEFAULT_AUDIO_FORMAT if body.extract_audio else DEFAULT_VIDEO_FORMAT)
        if body.extract_audio and selection == DEFAULT_VIDEO_FORMAT:
            selection = DEFAULT_AUDIO_FORMAT  # audio extraction needs only the audio track, not the video as well
        if body.extract_audio and not find_ffmpeg(env):
            raise DownloaderError(ErrorInfo("ffmpeg_missing", "FFmpeg is needed to extract audio, and it is not installed.",
                                            "Install FFmpeg and make sure it is on your PATH, or download the video instead."))
        output_dir = resolve_output_dir(body.output_path, store.default_output_dir())
        job = await manager().start(url=url, options=options, format_selection=selection, output_dir=output_dir,
                                    extract_audio=body.extract_audio, audio_format=audio_format, playlist=body.is_playlist,
                                    meta={"title": body.title, "thumbnail": body.thumbnail if (body.thumbnail or "").startswith(("http://", "https://")) else ""})
        return {"job_id": job.id, "status": job.status}

    @app.get("/api/download/stream")
    async def stream(request: Request, job_id: str = Query(min_length=1, max_length=64)):
        if manager().get(job_id) is None:
            return _error("not_found", "That download is not known (the server may have restarted).", 404)

        async def events():
            yield "retry: 3000\n\n"
            async for snapshot in manager().subscribe(job_id):
                if snapshot is None:
                    yield ": keep-alive\n\n"
                    continue
                yield f"event: update\ndata: {json.dumps(snapshot)}\n\n"
                if await request.is_disconnected():
                    return
            yield "event: end\ndata: {}\n\n"

        return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    @app.post("/api/download/cancel")
    async def cancel(body: CancelRequest):
        if manager().get(body.job_id) is None:
            return _error("not_found", "That download is not known.", 404)
        cancelled = await manager().cancel(body.job_id)
        return {"job_id": body.job_id, "cancelled": cancelled, "status": manager().get(body.job_id).status}  # type: ignore[union-attr]

    @app.get("/api/jobs")
    async def jobs():
        return {"jobs": [j.snapshot() for j in manager().list()]}

    @app.delete("/api/jobs/{job_id}")
    async def remove_job(job_id: str):
        if manager().get(job_id) is None:
            return _error("not_found", "That download is not known.", 404)
        if not manager().remove(job_id):
            return _error("busy", "Cancel the download before removing it.", 409)
        return {"removed": True}

    # ---- folders -------------------------------------------------------------------------------------------------------------------------
    @app.get("/api/browse-directory")
    async def browse(mode: str = Query("native", pattern="^(native|list)$"), path: str = Query("", max_length=4096), show_hidden: bool = False):
        """`native`: open this computer's folder chooser. `list`: sub-folders of `path`, for the built-in browser (used when there is
        no native dialog, for example on a server without a display)."""
        if mode == "list":
            return list_directories(path, show_hidden=show_hidden)
        result = await native_folder_dialog(path)
        if not result["available"]:
            return _error("dialog_unavailable", "This computer has no folder dialog available to the server.", 501,
                          "Use the built-in folder browser, or type the folder path.")
        return result

    # ---- system and settings ---------------------------------------------------------------------------------------------------------
    @app.get("/api/system/status")
    async def system_status():
        return await manager().status()

    @app.post("/api/system/update-ytdlp")
    async def update_ytdlp():
        return await manager().update_ytdlp()

    @app.get("/api/settings")
    async def get_settings():
        return store.public()

    @app.put("/api/settings")
    async def put_settings(body: dict[str, Any]):
        return store.update(body)

    @app.post("/api/settings/cookies")
    async def upload_cookies(file: UploadFile = File(...)):
        return store.save_cookie_file(await file.read(2 * 1024 * 1024 + 1))

    @app.delete("/api/settings/cookies")
    async def delete_cookies():
        return store.delete_cookie_file()

    # ---- the page --------------------------------------------------------------------------------------------------------------------------
    @app.get("/", include_in_schema=False)
    async def index():
        return FileResponse(HERE / "static" / "index.html", media_type="text/html")

    app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")
    return app


app = create_app()


def run() -> None:
    import uvicorn

    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    port = int(os.environ.get("MD_PORT", "8000"))
    if "--open" in sys.argv:
        import threading
        import webbrowser

        threading.Timer(1.0, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    print(f"Media Downloader: http://127.0.0.1:{port}  (Ctrl+C to stop)")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")  # the host is deliberately not configurable


if __name__ == "__main__":
    run()
