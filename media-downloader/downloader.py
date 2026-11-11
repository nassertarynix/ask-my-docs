"""Running yt-dlp: starting it, reading its progress, retrying network drops, cancelling it cleanly.

yt-dlp is never imported. Every call is a separate operating-system process started with `asyncio.create_subprocess_exec`, so a
crash, a hang or a cancel in one download cannot touch the web server, and heavy work stays out of this process.

Cancelling kills the whole process group (yt-dlp and the FFmpeg it started), and every download writes its partial files to a
private temporary folder that is deleted at the end, so a cancelled or failed download leaves nothing half-written in the
destination folder. Files that finished before a cancel (items of a playlist) are kept.
"""
from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Mapping

from errors import ErrorInfo, classify_error, spawn_error
from options import (DEFAULT_AUDIO_FORMAT, SEP, Options, download_command, info_command)

log = logging.getLogger("downloader")
TERMINAL = frozenset({"completed", "failed", "cancelled"})
POSIX = os.name == "posix"

STAGE_LABELS = {
    "ExtractAudio": "Extracting audio", "Merger": "Merging video and audio", "MoveFiles": "Finishing", "Concat": "Joining parts",
    "FFmpegMetadata": "Writing metadata", "EmbedThumbnail": "Embedding thumbnail", "VideoRemuxer": "Converting container",
    "FFmpegVideoConvertor": "Converting video", "FFmpegFixup": "Repairing the file", "FFmpegCopyStream": "Repairing the file",
    "FixupM3u8": "Repairing the file", "FixupM4a": "Repairing the file", "FixupStretched": "Repairing the file",
}


class DownloaderError(Exception):
    """A failure with a ready-to-show explanation."""

    def __init__(self, info: ErrorInfo) -> None:
        super().__init__(info.message)
        self.info = info


# ---- finding the tools ---------------------------------------------------------------------------------------------------------
def resolve_ytdlp(env: Mapping[str, str] | None = None) -> list[str] | None:
    """The command prefix that starts yt-dlp, or None if it is not installed. `YTDLP_BIN` overrides everything."""
    e = env if env is not None else os.environ
    if e.get("YTDLP_BIN"):
        return [e["YTDLP_BIN"]]
    found = shutil.which("yt-dlp", path=e.get("PATH"))
    if found:
        return [found]
    sibling = Path(sys.executable).with_name("yt-dlp.exe" if os.name == "nt" else "yt-dlp")  # a venv that is not activated
    if sibling.exists():
        return [str(sibling)]
    import importlib.util

    if importlib.util.find_spec("yt_dlp") is not None:  # still a separate process: `python -m yt_dlp`
        return [sys.executable, "-m", "yt_dlp"]
    return None


def find_ffmpeg(env: Mapping[str, str] | None = None) -> str | None:
    return shutil.which("ffmpeg", path=(env or os.environ).get("PATH"))


# ---- the progress lines yt-dlp prints ----------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class ProgressEvent:
    status: str
    downloaded: float | None
    total: float | None
    speed: float | None
    eta: float | None
    index: int | None
    count: int | None
    title: str


@dataclass(frozen=True)
class PostprocessEvent:
    status: str
    name: str
    index: int | None
    count: int | None
    title: str


@dataclass(frozen=True)
class DoneEvent:
    path: str


def _num(text: str) -> float | None:
    if text in ("", "NA", "None"):
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def _int(text: str) -> int | None:
    value = _num(text)
    return int(value) if value is not None else None


def parse_output_line(line: str) -> ProgressEvent | PostprocessEvent | DoneEvent | None:
    """Understand one stdout line. Only the lines we asked for (PROG, PP, DONE) are recognised; everything else is ignored."""
    parts = line.rstrip("\r\n").split(SEP)
    tag = parts[0]
    if tag == "PROG" and len(parts) >= 10:
        return ProgressEvent(parts[1], _num(parts[2]), _num(parts[3]) or _num(parts[4]), _num(parts[5]), _num(parts[6]),
                             _int(parts[7]), _int(parts[8]), SEP.join(parts[9:]).strip() if parts[9] != "NA" else "")
    if tag == "PP" and len(parts) >= 6:
        return PostprocessEvent(parts[1], parts[2], _int(parts[3]), _int(parts[4]), SEP.join(parts[5:]).strip() if parts[5] != "NA" else "")
    if tag == "DONE" and len(parts) >= 2 and parts[1].strip():
        return DoneEvent(SEP.join(parts[1:]).strip())
    return None


# ---- starting and stopping processes -------------------------------------------------------------------------------------------------
def _spawn_kwargs() -> dict[str, Any]:
    if POSIX:
        return {"start_new_session": True}  # its own process group, so the group can be signalled as one
    return {"creationflags": getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)}


async def terminate_process(proc: asyncio.subprocess.Process, grace: float = 5.0) -> None:
    """Stop `proc` and everything it started: ask politely (SIGTERM), then insist (SIGKILL) after `grace` seconds."""
    if proc.returncode is not None:
        return

    def signal_group(sig: int) -> None:
        try:
            os.killpg(proc.pid, sig)
        except (ProcessLookupError, PermissionError):
            with contextlib.suppress(ProcessLookupError):
                proc.send_signal(sig)

    if POSIX:
        signal_group(signal.SIGTERM)
    else:  # no process groups on Windows: kill the tree by pid
        await asyncio.to_thread(subprocess.run, ["taskkill", "/PID", str(proc.pid), "/T", "/F"], capture_output=True)
    try:
        await asyncio.wait_for(proc.wait(), grace)
    except asyncio.TimeoutError:
        if POSIX:
            signal_group(signal.SIGKILL)
        else:
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
        await proc.wait()


async def run_capture(cmd: list[str], *, timeout: float, env: Mapping[str, str] | None = None) -> tuple[int, str, str]:
    """Run a command to the end and return (exit code, stdout, stderr). On timeout or cancellation the process is stopped."""
    proc = await asyncio.create_subprocess_exec(*cmd, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE,
                                                stderr=asyncio.subprocess.PIPE, env=dict(env) if env is not None else None, **_spawn_kwargs())
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
    except BaseException:
        await terminate_process(proc, grace=2.0)
        raise
    return proc.returncode or 0, out.decode("utf-8", "replace"), err.decode("utf-8", "replace")


async def _lines(reader: asyncio.StreamReader) -> AsyncIterator[str]:
    """Lines of a stream, tolerating a line longer than the buffer (it is skipped instead of ending the loop)."""
    while True:
        try:
            raw = await reader.readline()
        except (ValueError, asyncio.LimitOverrunError):
            continue
        if not raw:
            return
        yield raw.decode("utf-8", "replace").rstrip("\r\n")


# ---- jobs ------------------------------------------------------------------------------------------------------------------------------
@dataclass
class Job:
    id: str
    url: str
    request: dict[str, Any]
    created_at: float = field(default_factory=time.time)
    status: str = "queued"
    stage: str = "Waiting"
    message: str = ""
    percent: float = 0.0
    speed: float | None = None
    eta: int | None = None
    downloaded_bytes: int = 0
    total_bytes: int | None = None
    title: str = ""
    thumbnail: str = ""
    filename: str = ""
    files: list[str] = field(default_factory=list)
    playlist_index: int | None = None
    playlist_count: int | None = None
    part: int = 1
    attempt: int = 1
    warnings: list[str] = field(default_factory=list)
    error: dict | None = None
    updated_at: float = field(default_factory=time.time)
    # runtime-only state, never sent to the browser
    _subs: set = field(default_factory=set, repr=False)
    _task: asyncio.Task | None = field(default=None, repr=False)
    _proc: Any = field(default=None, repr=False)
    _tmp: Path | None = field(default=None, repr=False)
    _cancel: asyncio.Event = field(default_factory=asyncio.Event, repr=False)
    _last_pub: float = field(default=0.0, repr=False)
    _last_downloaded: float = field(default=0.0, repr=False)
    _outcome: tuple | None = field(default=None, repr=False)  # (status, stage), applied after the temp folder is removed

    def snapshot(self) -> dict[str, Any]:
        return {
            "job_id": self.id, "url": self.url, "status": self.status, "stage": self.stage, "message": self.message,
            "percent": round(self.percent, 1), "speed": self.speed, "eta": self.eta, "downloaded_bytes": self.downloaded_bytes,
            "total_bytes": self.total_bytes, "title": self.title, "thumbnail": self.thumbnail, "filename": self.filename,
            "files": self.files[-50:], "files_count": len(self.files), "playlist_index": self.playlist_index,
            "playlist_count": self.playlist_count, "part": self.part, "attempt": self.attempt, "warnings": self.warnings[-5:],
            "error": self.error, "created_at": self.created_at, "updated_at": self.updated_at,
            "request": {k: v for k, v in self.request.items() if k != "temp"},
        }


class JobManager:
    def __init__(self, ytdlp: list[str] | None, *, temp_root: Path, max_concurrent: int = 2, max_retries: int = 2,
                 retry_delays: tuple[float, ...] = (3.0, 8.0), env: Mapping[str, str] | None = None, history: int = 200) -> None:
        self.ytdlp = ytdlp
        self.temp_root = temp_root
        self.max_retries = max_retries
        self.retry_delays = retry_delays
        self.env = dict(env) if env is not None else None
        self.history = history
        self.keepalive = 15.0  # seconds between keep-alive ticks on an idle progress stream
        self._slots = asyncio.Semaphore(max_concurrent)
        self._jobs: dict[str, Job] = {}
        self._update_lock = asyncio.Lock()
        self._version: tuple[float, str] | None = None
        temp_root.mkdir(parents=True, exist_ok=True)

    # ---- bookkeeping ------------------------------------------------------------------------------------------------------------
    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def list(self) -> list[Job]:
        return sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)

    def active_count(self) -> int:
        return sum(1 for j in self._jobs.values() if j.status not in TERMINAL)

    def remove(self, job_id: str) -> bool:
        job = self._jobs.get(job_id)
        if job is None or job.status not in TERMINAL:
            return False
        del self._jobs[job_id]
        return True

    def _trim_history(self) -> None:
        finished = sorted((j for j in self._jobs.values() if j.status in TERMINAL), key=lambda j: j.created_at)
        for job in finished[: max(0, len(self._jobs) - self.history)]:
            self._jobs.pop(job.id, None)

    def _require_ytdlp(self) -> list[str]:
        if not self.ytdlp:
            raise DownloaderError(spawn_error(FileNotFoundError("yt-dlp")))
        return self.ytdlp

    # ---- publishing progress -------------------------------------------------------------------------------------------------------
    def _publish(self, job: Job, *, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - job._last_pub < 0.2:  # yt-dlp prints very often; the browser does not need every line
            return
        job._last_pub = now
        job.updated_at = time.time()
        snapshot = job.snapshot()
        for queue in list(job._subs):
            if queue.full():
                with contextlib.suppress(asyncio.QueueEmpty):
                    queue.get_nowait()  # keep only the newest snapshot
            with contextlib.suppress(asyncio.QueueFull):
                queue.put_nowait(snapshot)

    async def subscribe(self, job_id: str) -> AsyncIterator[dict | None]:
        """Yield the current state, then every change, until the job ends. A `None` is a keep-alive tick (see `keepalive`)."""
        job = self._jobs[job_id]
        queue: asyncio.Queue = asyncio.Queue(maxsize=1)
        job._subs.add(queue)
        try:
            first = job.snapshot()
            yield first
            if first["status"] in TERMINAL:
                return
            while True:
                try:
                    snapshot = await asyncio.wait_for(queue.get(), self.keepalive)
                except asyncio.TimeoutError:
                    yield None
                    continue
                yield snapshot
                if snapshot["status"] in TERMINAL:
                    return
        finally:
            job._subs.discard(queue)

    # ---- starting ---------------------------------------------------------------------------------------------------------------------
    async def start(self, *, url: str, options: Options, format_selection: str, output_dir: Path, extract_audio: bool, audio_format: str,
                    playlist: bool = False, meta: Mapping[str, Any] | None = None) -> Job:
        ytdlp = self._require_ytdlp()
        job_id = uuid.uuid4().hex[:12]
        temp_dir = self.temp_root / job_id
        temp_dir.mkdir(parents=True, exist_ok=True)
        meta = meta or {}
        job = Job(id=job_id, url=url, title=str(meta.get("title") or "")[:300], thumbnail=str(meta.get("thumbnail") or "")[:2000],
                  request={"format_selection": format_selection, "output_dir": str(output_dir), "extract_audio": extract_audio,
                           "audio_format": audio_format, "options": options.public()})
        job._tmp = temp_dir
        cmd = download_command(ytdlp, url, options, format_selection=format_selection, output_dir=output_dir, temp_dir=temp_dir,
                               extract_audio=extract_audio, audio_format=audio_format or DEFAULT_AUDIO_FORMAT, playlist=playlist)
        self._jobs[job_id] = job
        self._trim_history()
        job._task = asyncio.create_task(self._run(job, cmd), name=f"download-{job_id}")
        return job

    # ---- the run ----------------------------------------------------------------------------------------------------------------------
    async def _run(self, job: Job, cmd: list[str]) -> None:
        try:
            async with self._slots:  # a job waits here (status "queued") when too many are running
                if job._cancel.is_set():
                    raise asyncio.CancelledError
                await self._execute(job, cmd)
        except asyncio.CancelledError:
            self._finish(job, "cancelled", stage="Cancelled")
        except DownloaderError as exc:
            self._fail(job, exc.info)
        except Exception as exc:  # noqa: BLE001 - never leave a job stuck in "downloading"
            log.exception("job %s crashed", job.id)
            self._fail(job, ErrorInfo("unknown", f"Unexpected error: {exc}", "", False, str(exc)))
        finally:
            if job._tmp is not None:
                await asyncio.to_thread(shutil.rmtree, job._tmp, True)  # partial files; finished files were already moved out
            # only now announce the end: anyone told "failed" or "cancelled" can rely on the partial files being gone
            status, stage = job._outcome or ("cancelled", "Cancelled")
            job.status, job.stage = status, stage
            self._publish(job, force=True)

    async def _execute(self, job: Job, cmd: list[str]) -> None:
        job.status, job.stage = "downloading", "Starting"
        self._publish(job, force=True)
        while True:
            returncode, stderr = await self._run_once(job, cmd)
            if job._cancel.is_set():
                self._finish(job, "cancelled", stage="Cancelled")
                return
            if returncode == 0:
                job.percent = 100.0
                job.eta, job.speed = 0, None
                job.message = "" if job.files else "Nothing new to download."
                self._finish(job, "completed", stage="Done")
                return
            info = classify_error(stderr, returncode=returncode)
            if job.files:  # some items of a playlist finished: keep them and say what went wrong with the rest
                job.warnings.append(info.detail or info.message)
                job.message = f"Finished with errors: {info.message}"
                self._finish(job, "completed", stage="Done with errors")
                return
            if info.retryable and job.attempt <= self.max_retries:
                delay = self.retry_delays[min(job.attempt - 1, len(self.retry_delays) - 1)]
                job.message = f"{info.message} Retrying in {int(delay)} s (attempt {job.attempt + 1} of {self.max_retries + 1})."
                job.stage, job.speed, job.eta = "Waiting to retry", None, None
                job.attempt += 1
                self._publish(job, force=True)
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(job._cancel.wait(), delay)  # a cancel ends the wait at once
                if job._cancel.is_set():
                    self._finish(job, "cancelled", stage="Cancelled")
                    return
                job.message = ""
                continue
            self._fail(job, info)
            return

    async def _run_once(self, job: Job, cmd: list[str]) -> tuple[int, str]:
        try:
            proc = await asyncio.create_subprocess_exec(*cmd, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE,
                                                        stderr=asyncio.subprocess.PIPE, limit=2**20,
                                                        env=self.env, **_spawn_kwargs())
        except OSError as exc:
            raise DownloaderError(spawn_error(exc)) from exc
        job._proc = proc
        stderr_lines: list[str] = []

        # yt-dlp prints the download progress on stdout but the post-processing progress on stderr, so both streams are read for
        # our own progress lines; whatever else arrives on stderr is kept for error classification
        async def read_stdout() -> None:
            async for line in _lines(proc.stdout):
                self._on_line(job, line)

        async def read_stderr() -> None:
            async for line in _lines(proc.stderr):
                if self._on_line(job, line):
                    continue
                stderr_lines.append(line)
                del stderr_lines[:-300]
                if line.startswith("WARNING:") and line[8:].strip() not in job.warnings:
                    job.warnings.append(line[8:].strip()[:300])

        try:
            await asyncio.gather(read_stdout(), read_stderr())
            returncode = await proc.wait()
        finally:
            job._proc = None
            await terminate_process(proc)  # no-op when it already exited; stops it if this task was cancelled
        return returncode, "\n".join(stderr_lines)

    def _on_line(self, job: Job, line: str) -> bool:
        """Handle one of our progress lines. Returns False if `line` is not one (so it is ordinary output)."""
        event = parse_output_line(line)
        if event is None:
            return False
        if isinstance(event, ProgressEvent):
            job.status, job.stage = "downloading", "Downloading"
            if event.title:
                job.title = job.title or event.title
            job.playlist_index, job.playlist_count = event.index or job.playlist_index, event.count or job.playlist_count
            if event.downloaded is not None:
                if event.downloaded < job._last_downloaded - 1:  # a new stream started (video, then audio): count the part
                    job.part += 1
                job._last_downloaded = event.downloaded
                job.downloaded_bytes = int(event.downloaded)
            job.total_bytes = int(event.total) if event.total else job.total_bytes
            if event.total and event.downloaded is not None:
                job.percent = max(0.0, min(100.0, event.downloaded / event.total * 100))
            job.speed = event.speed
            job.eta = int(event.eta) if event.eta is not None else None
            if event.status == "finished":
                job._last_downloaded = 0.0
                job.speed, job.eta = None, None
            self._publish(job, force=event.status == "finished")
        elif isinstance(event, PostprocessEvent):
            if event.status == "started":
                job.status = "post-processing"
                job.stage = STAGE_LABELS.get(event.name, event.name or "Processing")
                job.speed, job.eta = None, None
                if event.title and not job.title:
                    job.title = event.title
                self._publish(job, force=True)
        else:
            job.filename = event.path
            job.files.append(event.path)
            self._publish(job, force=True)
        return True

    # ---- ending a job --------------------------------------------------------------------------------------------------------------------
    def _finish(self, job: Job, status: str, *, stage: str) -> None:
        """Record how the job ended (the first outcome wins). It is announced by `_run` once the temp folder has been removed."""
        if job._outcome is None:
            job._outcome = (status, stage)

    def _fail(self, job: Job, info: ErrorInfo) -> None:
        if job._outcome is not None:
            return
        job.error = info.to_dict()
        job.message = info.message
        self._finish(job, "failed", stage="Failed")

    async def cancel(self, job_id: str) -> bool:
        """Cancel a queued or running job. Returns False if it does not exist or has already ended."""
        job = self._jobs.get(job_id)
        if job is None or job.status in TERMINAL:
            return False
        job._cancel.set()
        if job._proc is not None:
            await terminate_process(job._proc)
        elif job._task is not None and job.status == "queued":
            job._task.cancel()
        if job._task is not None:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await asyncio.wait_for(asyncio.shield(job._task), 15)
        return job._outcome is not None and job._outcome[0] == "cancelled"  # false if it finished a moment before the cancel arrived

    async def shutdown(self) -> None:
        for job in list(self._jobs.values()):
            if job.status not in TERMINAL:
                await self.cancel(job.id)

    # ---- information and maintenance -----------------------------------------------------------------------------------------------------
    async def fetch_info(self, url: str, options: Options, *, timeout: float = 90.0) -> dict[str, Any]:
        cmd = info_command(self._require_ytdlp(), url, options)
        try:
            returncode, out, err = await run_capture(cmd, timeout=timeout, env=self.env)
        except asyncio.TimeoutError:
            raise DownloaderError(ErrorInfo("network", "Fetching the details took too long.", "Check your connection (and proxy) and try again.", True)) from None
        except OSError as exc:
            raise DownloaderError(spawn_error(exc)) from exc
        if returncode != 0 or not out.strip():
            raise DownloaderError(classify_error(err, returncode=returncode))
        try:
            raw = json.loads(out)
        except ValueError:
            raise DownloaderError(ErrorInfo("extraction_failed", "yt-dlp returned something that is not video information.",
                                            "Update yt-dlp (Advanced settings) and try again.", False)) from None
        info = normalize_info(raw)
        info["warnings"] = [ln[8:].strip()[:300] for ln in err.splitlines() if ln.startswith("WARNING:")][:5]
        return info

    async def ytdlp_version(self, *, refresh: bool = False) -> str:
        if self._version and not refresh and time.monotonic() - self._version[0] < 60:
            return self._version[1]
        if not self.ytdlp:
            return ""
        try:
            _, out, _ = await run_capture([*self.ytdlp, "--ignore-config", "--version"], timeout=20, env=self.env)
        except (OSError, asyncio.TimeoutError):
            return ""
        version = out.strip().splitlines()[0] if out.strip() else ""
        self._version = (time.monotonic(), version)
        return version

    async def status(self) -> dict[str, Any]:
        ffmpeg = find_ffmpeg(self.env)
        ffmpeg_version = ""
        if ffmpeg:
            with contextlib.suppress(OSError, asyncio.TimeoutError):
                _, out, _ = await run_capture([ffmpeg, "-version"], timeout=10, env=self.env)
                ffmpeg_version = out.splitlines()[0] if out else ""
        try:
            import tkinter  # noqa: F401

            native_dialog = True
        except Exception:  # noqa: BLE001 - no tkinter, or no display
            native_dialog = False
        return {"ytdlp": {"installed": bool(self.ytdlp), "version": await self.ytdlp_version(), "command": " ".join(self.ytdlp or [])},
                "ffmpeg": {"installed": bool(ffmpeg), "path": ffmpeg or "", "version": ffmpeg_version},
                "native_folder_dialog": native_dialog, "python": sys.version.split()[0], "active_downloads": self.active_count()}

    async def update_ytdlp(self) -> dict[str, Any]:
        """`yt-dlp -U`, or `pip install --upgrade yt-dlp` when it was installed with pip (where `-U` is not allowed)."""
        self._require_ytdlp()
        if self.active_count():
            raise DownloaderError(ErrorInfo("busy", "Downloads are running.", "Wait for them to finish or cancel them, then update.", False))
        async with self._update_lock:
            before = await self.ytdlp_version(refresh=True)
            method, output = "self-update", ""
            try:
                code, out, err = await run_capture([*self.ytdlp, "--ignore-config", "-U"], timeout=180, env=self.env)
                output = (out + "\n" + err).strip()
                if code != 0 or re.search(r"pip|package manager|installed (?:with|via|from)|use .*--no-update", output, re.IGNORECASE):
                    method = "pip"
                    code, out, err = await run_capture([sys.executable, "-m", "pip", "install", "--upgrade", "yt-dlp"], timeout=300, env=self.env)
                    output = (out + "\n" + err).strip()
                    if code != 0:
                        raise DownloaderError(ErrorInfo("update_failed", "The update did not work.", "Try: pip install --upgrade yt-dlp in a terminal.", False,
                                                        output.splitlines()[-1] if output else ""))
            except asyncio.TimeoutError:
                raise DownloaderError(ErrorInfo("network", "The update took too long.", "Check your connection and try again.", True)) from None
            after = await self.ytdlp_version(refresh=True)
            return {"ok": True, "method": method, "before": before, "after": after, "changed": before != after, "output": "\n".join(output.splitlines()[-8:])}


# ---- turning yt-dlp's JSON into what the interface needs ---------------------------------------------------------------------------------
def _safe_url(value: Any) -> str:
    text = str(value or "")
    return text if re.match(r"https?://", text) and len(text) <= 2000 else ""


def _thumbnail(raw: Mapping[str, Any]) -> str:
    direct = _safe_url(raw.get("thumbnail"))
    if direct:
        return direct
    for item in reversed(raw.get("thumbnails") or []):
        url = _safe_url(item.get("url") if isinstance(item, dict) else None)
        if url:
            return url
    return ""


def _kbps(value: Any) -> int | None:
    return round(value) if isinstance(value, (int, float)) and value > 0 else None


def normalize_format(f: Mapping[str, Any]) -> dict[str, Any] | None:
    """One format for the interface, or None for entries that are not downloadable media (storyboards)."""
    if f.get("ext") == "mhtml" or f.get("protocol") == "mhtml" or "storyboard" in str(f.get("format_note") or "").lower():
        return None
    vcodec, acodec = f.get("vcodec"), f.get("acodec")
    # "none" means absent; a missing or empty codec just means unknown (common for HLS and plain files), so it counts as present
    has_video = vcodec != "none"
    has_audio = acodec != "none"
    height, width = f.get("height"), f.get("width")
    return {
        "format_id": str(f.get("format_id") or ""), "ext": f.get("ext") or "", "height": height if isinstance(height, int) else None,
        "width": width if isinstance(width, int) else None, "fps": f.get("fps") if isinstance(f.get("fps"), (int, float)) else None,
        "resolution": (f"{width}x{height}" if width and height else f"{height}p" if height else "audio only" if not has_video else ""),
        "vcodec": "" if vcodec in (None, "none") else str(vcodec).split(".")[0], "acodec": "" if acodec in (None, "none") else str(acodec).split(".")[0],
        "bitrate": _kbps(f.get("tbr") or f.get("vbr") or f.get("abr")), "filesize": f.get("filesize") or f.get("filesize_approx"),
        "note": str(f.get("format_note") or "")[:60], "has_video": has_video, "has_audio": has_audio,
    }


def normalize_info(raw: Mapping[str, Any], *, max_entries: int = 500) -> dict[str, Any]:
    """The `/api/info` answer for either a single video or a playlist."""
    base = {"title": str(raw.get("title") or raw.get("id") or "Untitled")[:300], "thumbnail": _thumbnail(raw),
            "uploader": str(raw.get("uploader") or raw.get("channel") or "")[:200], "webpage_url": _safe_url(raw.get("webpage_url") or raw.get("original_url")),
            "extractor": str(raw.get("extractor_key") or raw.get("extractor") or ""), "license": str(raw.get("license") or "")[:120]}
    entries = raw.get("entries")
    if raw.get("_type") == "playlist" or entries is not None:
        items = []
        for number, entry in enumerate(entries or [], start=1):
            if not isinstance(entry, dict):
                continue
            items.append({"index": number, "id": str(entry.get("id") or ""), "title": str(entry.get("title") or entry.get("id") or f"Item {number}")[:300],
                          "url": _safe_url(entry.get("url") or entry.get("webpage_url")), "duration": entry.get("duration") if isinstance(entry.get("duration"), (int, float)) else None,
                          "thumbnail": _thumbnail(entry), "uploader": str(entry.get("uploader") or entry.get("channel") or "")[:200]})
        total = raw.get("playlist_count") if isinstance(raw.get("playlist_count"), int) else len(items)
        return {**base, "is_playlist": True, "playlist_count": max(total, len(items)), "entries": items[:max_entries],
                "truncated": len(items) > max_entries or total > len(items), "formats": [], "available_heights": [], "duration": None}
    formats = [n for n in (normalize_format(f) for f in raw.get("formats") or [] if isinstance(f, dict)) if n]
    if not formats:  # a plain media file: yt-dlp gives the single format at the top level
        single = normalize_format(raw)
        formats = [single] if single else []
    heights = sorted({f["height"] for f in formats if f["has_video"] and f["height"]}, reverse=True)
    duration = raw.get("duration")
    return {**base, "is_playlist": False, "duration": duration if isinstance(duration, (int, float)) else None, "formats": formats,
            "available_heights": heights, "has_audio_only": any(f["has_audio"] and not f["has_video"] for f in formats),
            "live": bool(raw.get("is_live")), "playlist_count": 0, "entries": [], "truncated": False}


# ---- choosing a folder -----------------------------------------------------------------------------------------------------------------
_DIALOG = (
    "import sys\n"
    "try:\n"
    "    import tkinter\n    from tkinter import filedialog\n"
    "    root = tkinter.Tk(); root.withdraw(); root.attributes('-topmost', True)\n"
    "except Exception:\n"
    "    sys.exit(3)\n"
    "chosen = filedialog.askdirectory(initialdir=sys.argv[1] or None, title='Choose the download folder', mustexist=False)\n"
    "root.destroy()\n"
    "print(chosen or '')\n"
)


async def native_folder_dialog(initial: str = "", *, timeout: float = 600.0) -> dict[str, Any]:
    """Open the operating system's folder chooser on this machine. It runs in its own process, because GUI toolkits want the
    main thread (and a crash must not take the server down). Returns {"available": False} when there is no usable dialog."""
    try:
        code, out, _ = await run_capture([sys.executable, "-c", _DIALOG, initial], timeout=timeout)
    except asyncio.TimeoutError:
        return {"available": True, "path": None, "cancelled": True}
    if code != 0:
        return {"available": False, "path": None, "cancelled": False}
    path = out.strip().splitlines()[-1].strip() if out.strip() else ""
    return {"available": True, "path": path or None, "cancelled": not path}


def list_directories(path: str, *, show_hidden: bool = False, limit: int = 2000) -> dict[str, Any]:
    """Sub-folders of `path` (the nearest existing folder if it does not exist), for the built-in folder browser."""
    home = Path.home()
    current = Path(os.path.expanduser(path)) if path else home
    if not current.is_absolute():
        current = home
    current = current.resolve()
    while not current.is_dir() and current != current.parent:
        current = current.parent
    entries: list[dict[str, str]] = []
    try:
        for child in sorted(current.iterdir(), key=lambda p: p.name.lower()):
            if len(entries) >= limit:
                break
            if (child.name.startswith(".") and not show_hidden) or not child.is_dir():
                continue
            entries.append({"name": child.name, "path": str(child)})
    except OSError:
        pass  # unreadable folder: show it empty rather than failing
    roots: list[str] = []
    if os.name == "nt":
        roots = [f"{letter}:\\" for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ" if Path(f"{letter}:\\").exists()]
    return {"path": str(current), "parent": str(current.parent) if current.parent != current else None, "home": str(home), "entries": entries,
            "roots": roots, "writable": os.access(current, os.W_OK | os.X_OK)}
