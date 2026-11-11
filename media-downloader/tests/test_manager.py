"""The process manager against the REAL yt-dlp and ffmpeg, downloading from a local web server."""
import asyncio
import os
import subprocess
import time
from pathlib import Path

import pytest

import downloader
from helpers import YTDLP, needs_tools
from downloader import DownloaderError, JobManager
from options import DEFAULT_VIDEO_FORMAT, Options

pytestmark = needs_tools


@pytest.fixture
async def manager(tmp_path):
    m = JobManager(YTDLP, temp_root=tmp_path / "tmp", retry_delays=(0.05, 0.05), max_concurrent=2)
    yield m
    await m.shutdown()


@pytest.fixture
def out(tmp_path):
    d = tmp_path / "out"
    d.mkdir()
    return d


async def go(manager, url, out, *, audio=False, fmt="mp3", selection=DEFAULT_VIDEO_FORMAT, playlist=False, options=None, **kw):
    return await manager.start(url=url, options=options or Options(), format_selection=selection, output_dir=out, extract_audio=audio,
                               audio_format=fmt, playlist=playlist, **kw)


async def finish(manager, job):
    async for _ in manager.subscribe(job.id):
        pass
    return job


def spy(manager):
    """Record every published snapshot (the subscriber queue only keeps the newest one)."""
    seen = []
    original = manager._publish

    def publish(job, force=False):
        seen.append(job.snapshot())
        original(job, force=force)

    manager._publish = publish
    return seen


def streams(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(path)], capture_output=True, text=True)
    return sorted(set(r.stdout.split()))


def alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    try:  # a zombie still answers signal 0
        return Path(f"/proc/{pid}/stat").read_text().split()[2] != "Z"
    except OSError:
        return False


async def until(predicate, timeout=20.0):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        if predicate():
            return True
        await asyncio.sleep(0.05)
    return False


# ---- successful downloads ---------------------------------------------------------------------------------------------------------------------
async def test_a_video_downloads_completely_and_leaves_nothing_behind(manager, media, out, tmp_path):
    job = await finish(manager, await go(manager, media.url("/clip.mp4"), out))
    assert job.status == "completed" and job.percent == 100 and job.error is None
    files = [p for p in out.rglob("*") if p.is_file()]
    assert [p.name for p in files] == ["clip [clip].mp4"] and files[0].stat().st_size > 1000
    assert job.filename == str(files[0]) and streams(files[0]) == ["audio", "video"]
    assert not (tmp_path / "tmp" / job.id).exists()


@pytest.mark.parametrize("fmt,ext", [("mp3", "mp3"), ("flac", "flac"), ("m4a", "m4a"), ("opus", "opus"), ("wav", "wav")])
async def test_audio_extraction_produces_an_audio_only_file(manager, media, out, fmt, ext):
    job = await finish(manager, await go(manager, media.url("/clip.mp4"), out, audio=True, fmt=fmt, selection="ba/b"))
    assert job.status == "completed", job.error
    files = list(out.iterdir())
    assert [p.suffix for p in files] == [f".{ext}"] and streams(files[0]) == ["audio"]


async def test_progress_goes_through_the_stages_and_never_goes_backwards(manager, media, out):
    seen = spy(manager)
    job = await finish(manager, await go(manager, media.url("/slow.mp4"), out))
    assert job.status == "completed"
    assert [s["status"] for s in seen][0] == "downloading" and seen[-1]["status"] == "completed"
    downloading = [s["percent"] for s in seen if s["status"] == "downloading" and s["stage"] == "Downloading"]
    assert len(downloading) >= 3 and downloading == sorted(downloading) and 0 <= downloading[0] < downloading[-1] <= 100
    assert any(s["speed"] for s in seen if s["status"] == "downloading") and seen[-1]["percent"] == 100


async def test_post_processing_is_reported_with_a_readable_stage(manager, media, out):
    seen = spy(manager)
    await finish(manager, await go(manager, media.url("/clip.mp4"), out, audio=True, fmt="mp3", selection="ba/b"))
    stages = {s["stage"] for s in seen if s["status"] == "post-processing"}
    assert "Extracting audio" in stages and "Finishing" in stages


async def test_a_playlist_goes_into_its_own_folder_and_reports_the_item_number(manager, media, out):
    seen = spy(manager)
    job = await finish(manager, await go(manager, media.url("/feed.xml"), out, playlist=True))
    assert job.status == "completed" and len(job.files) == 2
    assert sorted(p.relative_to(out).as_posix() for p in out.rglob("*.mp4")) == ["Test feed/001 - First clip [clip].mp4", "Test feed/002 - Second clip [clip].mp4"]
    assert {(s["playlist_index"], s["playlist_count"]) for s in seen} >= {(1, 2), (2, 2)}


async def test_a_playlist_with_one_broken_item_keeps_the_good_ones_and_says_so(manager, media, out):
    job = await finish(manager, await go(manager, media.url("/halfbad.xml"), out, playlist=True))
    assert job.status == "completed" and len(job.files) == 2 and job.message.startswith("Finished with errors") and job.warnings
    assert len(list(out.rglob("*.mp4"))) == 2


async def test_playlist_items_can_be_chosen(manager, media, out):
    job = await finish(manager, await go(manager, media.url("/feed.xml"), out, playlist=True, options=Options(playlist_items="2")))
    assert job.status == "completed" and [p.name for p in out.rglob("*.mp4")] == ["002 - Second clip [clip].mp4"]


async def test_downloading_the_same_thing_twice_does_not_overwrite_or_fail(manager, media, out):
    first = await finish(manager, await go(manager, media.url("/clip.mp4"), out))
    second = await finish(manager, await go(manager, media.url("/clip.mp4"), out))
    assert first.status == second.status == "completed" and len(list(out.iterdir())) == 1


async def test_the_title_and_thumbnail_hints_are_kept(manager, media, out):
    job = await go(manager, media.url("/clip.mp4"), out, meta={"title": "My title", "thumbnail": "https://example.com/t.jpg"})
    assert job.title == "My title" and job.thumbnail == "https://example.com/t.jpg"
    await finish(manager, job)


# ---- cancelling ------------------------------------------------------------------------------------------------------------------------------------
async def start_slow(manager, media, out):
    job = await go(manager, media.url("/slow.mp4"), out)
    assert await until(lambda: job.status == "downloading" and job.percent > 8)
    return job


async def test_cancelling_stops_the_process_and_removes_every_partial_file(manager, media, out, tmp_path):
    job = await start_slow(manager, media, out)
    pid = job._proc.pid
    started = time.monotonic()
    assert await manager.cancel(job.id) is True
    assert job.status == "cancelled" and time.monotonic() - started < 6
    assert not alive(pid)
    assert not (tmp_path / "tmp" / job.id).exists()
    assert list(out.rglob("*")) == []  # not even a .part file in the destination


async def test_cancelling_kills_the_whole_process_group_including_children(tmp_path, fake_ytdlp, out):
    pidfile = tmp_path / "child.pid"
    m = JobManager(fake_ytdlp, temp_root=tmp_path / "tmp", env={**os.environ, "FAKE_MODE": "spawn-children", "FAKE_PIDFILE": str(pidfile)})
    job = await go(m, "https://example.com/v", out)
    assert await until(pidfile.exists)
    await asyncio.sleep(0.2)
    child = int(pidfile.read_text())
    assert alive(child) and alive(job._proc.pid)
    await m.cancel(job.id)
    assert await until(lambda: not alive(child), 5), "the child process survived the cancel"
    await m.shutdown()


async def test_a_job_that_has_not_started_yet_can_be_cancelled(tmp_path, media, out):
    m = JobManager(YTDLP, temp_root=tmp_path / "tmp", max_concurrent=1)
    first = await start_slow(m, media, out)
    waiting = await go(m, media.url("/clip.mp4"), out)
    await asyncio.sleep(0.2)
    assert waiting.status == "queued"
    assert await m.cancel(waiting.id) is True and waiting.status == "cancelled"
    assert not (tmp_path / "tmp" / waiting.id).exists()
    await m.cancel(first.id)
    await m.shutdown()


async def test_only_so_many_downloads_run_at_once_and_the_rest_wait_their_turn(tmp_path, media, out):
    m = JobManager(YTDLP, temp_root=tmp_path / "tmp", max_concurrent=1)
    first = await start_slow(m, media, out)
    second = await go(m, media.url("/clip.mp4"), out)
    await asyncio.sleep(0.3)
    assert (first.status, second.status) == ("downloading", "queued")
    await m.cancel(first.id)
    await finish(m, second)
    assert second.status == "completed"
    await m.shutdown()


async def test_cancelling_a_job_that_just_finished_reports_what_really_happened(manager, media, out):
    job = await go(manager, media.url("/clip.mp4"), out)
    assert await until(lambda: bool(job.files))  # the file is done; the job is only tidying up
    result = await manager.cancel(job.id)
    await finish(manager, job)
    assert result == (job.status == "cancelled")


async def test_cancelling_an_unknown_or_finished_job_is_refused(manager, media, out):
    assert await manager.cancel("nope") is False
    job = await finish(manager, await go(manager, media.url("/clip.mp4"), out))
    assert await manager.cancel(job.id) is False and job.status == "completed"


async def test_shutdown_stops_everything(tmp_path, media, out):
    m = JobManager(YTDLP, temp_root=tmp_path / "tmp")
    job = await start_slow(m, media, out)
    pid = job._proc.pid
    await m.shutdown()
    assert job.status == "cancelled" and not alive(pid) and not (tmp_path / "tmp" / job.id).exists()


# ---- failures ----------------------------------------------------------------------------------------------------------------------------------------
async def test_a_missing_file_fails_at_once_with_a_clear_reason_and_no_retries(manager, media, out):
    job = await finish(manager, await go(manager, media.url("/missing.mp4"), out))
    assert job.status == "failed" and job.error["code"] == "unavailable" and job.attempt == 1 and job.error["hint"]
    assert list(out.iterdir()) == []


async def test_a_network_that_never_works_is_retried_then_reported(manager, out):
    job = await finish(manager, await go(manager, "http://127.0.0.1:1/x.mp4", out))
    assert job.status == "failed" and job.error["code"] == "network" and job.error["retryable"] is True
    assert job.attempt == 3  # the first try and two retries
    assert job.message == job.error["message"]


async def test_a_dropped_connection_is_retried_and_the_download_then_succeeds(manager, media, out):
    media.flaky_failures = 2
    seen = spy(manager)
    job = await finish(manager, await go(manager, media.url("/flaky.mp4"), out))
    assert job.status == "completed" and job.attempt == 3 and len(list(out.iterdir())) == 1
    assert any("Retrying" in s["message"] for s in seen)


async def test_a_cancel_during_the_wait_before_a_retry_ends_it_at_once(tmp_path, out):
    m = JobManager(YTDLP, temp_root=tmp_path / "tmp", retry_delays=(60.0,))
    job = await go(m, "http://127.0.0.1:1/x.mp4", out)
    assert await until(lambda: job.stage == "Waiting to retry")
    started = time.monotonic()
    await m.cancel(job.id)
    assert job.status == "cancelled" and time.monotonic() - started < 3
    await m.shutdown()


async def test_extracting_audio_without_ffmpeg_fails_with_a_clear_message(tmp_path, media, out):
    m = JobManager(YTDLP, temp_root=tmp_path / "tmp", env={"PATH": str(tmp_path)})  # no ffmpeg on this PATH
    job = await finish(m, await go(m, media.url("/clip.mp4"), out, audio=True, selection="ba/b"))
    assert job.status == "failed" and job.error["code"] == "ffmpeg_missing" and "FFmpeg" in job.error["message"]
    assert list(out.iterdir()) == [] and not (tmp_path / "tmp" / job.id).exists()
    assert (await m.status())["ffmpeg"]["installed"] is False


async def test_a_yt_dlp_that_cannot_be_started_fails_the_job_cleanly(tmp_path, out):
    m = JobManager(["/nonexistent/yt-dlp"], temp_root=tmp_path / "tmp")
    job = await finish(m, await go(m, "https://example.com/v", out))
    assert job.status == "failed" and job.error["code"] == "ytdlp_missing"


async def test_without_yt_dlp_installed_starting_a_download_is_refused(tmp_path, out):
    m = JobManager(None, temp_root=tmp_path / "tmp")
    with pytest.raises(DownloaderError) as err:
        await go(m, "https://example.com/v", out)
    assert err.value.info.code == "ytdlp_missing"
    with pytest.raises(DownloaderError):
        await m.fetch_info("https://example.com/v", Options())


# ---- the job list and the progress stream ------------------------------------------------------------------------------------------------------
async def test_finished_jobs_can_be_removed_but_running_ones_cannot(tmp_path, media, out):
    m = JobManager(YTDLP, temp_root=tmp_path / "tmp")
    running = await start_slow(m, media, out)
    assert m.remove(running.id) is False and m.remove("nope") is False
    await m.cancel(running.id)
    assert m.remove(running.id) is True and m.get(running.id) is None
    await m.shutdown()


async def test_old_finished_jobs_are_trimmed(tmp_path, media, out):
    m = JobManager(YTDLP, temp_root=tmp_path / "tmp", history=3)
    for _ in range(5):
        await finish(m, await go(m, media.url("/clip.mp4"), out))
    assert len(m.list()) <= 4
    await m.shutdown()


async def test_a_late_subscriber_gets_the_final_state_at_once(manager, media, out):
    job = await finish(manager, await go(manager, media.url("/clip.mp4"), out))
    snapshots = [s async for s in manager.subscribe(job.id)]
    assert len(snapshots) == 1 and snapshots[0]["status"] == "completed"


async def test_an_idle_stream_sends_keep_alive_ticks(tmp_path, media, out):
    m = JobManager(YTDLP, temp_root=tmp_path / "tmp", max_concurrent=1)
    m.keepalive = 0.2
    first = await start_slow(m, media, out)
    waiting = await go(m, media.url("/clip.mp4"), out)  # queued: nothing happens to it for a while
    ticks = 0
    async for snapshot in m.subscribe(waiting.id):
        ticks += snapshot is None
        if ticks >= 2:
            break
    assert ticks >= 2
    await m.cancel(first.id)
    await m.cancel(waiting.id)
    await m.shutdown()


# ---- information, status, updates -----------------------------------------------------------------------------------------------------------------
async def test_info_for_a_single_video(manager, media):
    info = await manager.fetch_info(media.url("/clip.mp4"), Options())
    assert info["is_playlist"] is False and info["title"] == "clip" and info["formats"] and info["formats"][0]["ext"] == "mp4"


async def test_info_for_a_playlist_is_fast_and_lists_the_items(manager, media):
    info = await manager.fetch_info(media.url("/feed.xml"), Options())
    assert info["is_playlist"] is True and [e["title"] for e in info["entries"]] == ["First clip", "Second clip"] and info["playlist_count"] == 2


@pytest.mark.parametrize("path,code", [("/missing.mp4", "unavailable")])
async def test_info_errors_are_explained(manager, media, path, code):
    with pytest.raises(DownloaderError) as err:
        await manager.fetch_info(media.url(path), Options())
    assert err.value.info.code == code


async def test_info_for_an_unreachable_host_is_a_network_error(manager):
    with pytest.raises(DownloaderError) as err:
        await manager.fetch_info("http://127.0.0.1:1/x.mp4", Options())
    assert err.value.info.code == "network" and err.value.info.retryable


@pytest.mark.parametrize("mode,code", [("garbage", "extraction_failed"), ("empty", "unknown"), ("botcheck", "bot_check")])
async def test_info_failures_from_a_misbehaving_yt_dlp(tmp_path, fake_ytdlp, mode, code):
    m = JobManager(fake_ytdlp, temp_root=tmp_path / "tmp", env={**os.environ, "FAKE_MODE": mode})
    with pytest.raises(DownloaderError) as err:
        await m.fetch_info("https://example.com/v", Options())
    assert err.value.info.code == code


async def test_info_that_hangs_times_out_and_the_process_is_stopped(tmp_path, fake_ytdlp):
    m = JobManager(fake_ytdlp, temp_root=tmp_path / "tmp", env={**os.environ, "FAKE_MODE": "hang"})
    started = time.monotonic()
    with pytest.raises(DownloaderError) as err:
        await m.fetch_info("https://example.com/v", Options(), timeout=0.6)
    assert err.value.info.code == "network" and time.monotonic() - started < 8


async def test_status_reports_the_tools(manager):
    s = await manager.status()
    assert s["ytdlp"]["installed"] and s["ytdlp"]["version"] and s["ffmpeg"]["installed"] and "ffmpeg version" in s["ffmpeg"]["version"]
    assert s["active_downloads"] == 0 and isinstance(s["native_folder_dialog"], bool)


class FakeRunner:
    """Replaces run_capture for the update tests, so nothing is installed for real."""

    def __init__(self, ytdlp_output=(0, "Updated yt-dlp to 2099.01.01", ""), pip_output=(0, "Successfully installed yt-dlp-2099.01.01", "")):
        self.calls, self.ytdlp_output, self.pip_output, self.version = [], ytdlp_output, pip_output, "2024.01.01"

    async def __call__(self, cmd, *, timeout, env=None):
        self.calls.append(cmd)
        if "--version" in cmd:
            return 0, self.version + "\n", ""
        if "-U" in cmd:
            if self.ytdlp_output[0] == 0:
                self.version = "2099.01.01"
            return self.ytdlp_output
        if "pip" in cmd:
            if self.pip_output[0] == 0:
                self.version = "2099.01.01"
            return self.pip_output
        raise AssertionError(cmd)


async def test_update_uses_yt_dlp_s_own_updater_when_it_works(tmp_path, monkeypatch):
    runner = FakeRunner()
    monkeypatch.setattr(downloader, "run_capture", runner)
    result = await JobManager(["yt-dlp"], temp_root=tmp_path / "t").update_ytdlp()
    assert result == {"ok": True, "method": "self-update", "before": "2024.01.01", "after": "2099.01.01", "changed": True, "output": "Updated yt-dlp to 2099.01.01"}
    assert not [c for c in runner.calls if "pip" in c]


async def test_update_falls_back_to_pip_when_installed_with_pip(tmp_path, monkeypatch):
    runner = FakeRunner(ytdlp_output=(1, "", "ERROR: You installed yt-dlp with pip or using a package manager; Use that to update"))
    monkeypatch.setattr(downloader, "run_capture", runner)
    result = await JobManager(["yt-dlp"], temp_root=tmp_path / "t").update_ytdlp()
    assert result["method"] == "pip" and result["changed"] and any(c[-3:] == ["install", "--upgrade", "yt-dlp"] for c in runner.calls)


async def test_a_failed_update_says_so(tmp_path, monkeypatch):
    monkeypatch.setattr(downloader, "run_capture", FakeRunner(ytdlp_output=(1, "", "pip please"), pip_output=(1, "", "ERROR: No matching distribution")))
    with pytest.raises(DownloaderError) as err:
        await JobManager(["yt-dlp"], temp_root=tmp_path / "t").update_ytdlp()
    assert err.value.info.code == "update_failed" and "No matching distribution" in err.value.info.detail


async def test_an_update_that_times_out_is_a_network_error(tmp_path, monkeypatch):
    async def slow(cmd, *, timeout, env=None):
        if "--version" in cmd:
            return 0, "1\n", ""
        raise asyncio.TimeoutError

    monkeypatch.setattr(downloader, "run_capture", slow)
    with pytest.raises(DownloaderError) as err:
        await JobManager(["yt-dlp"], temp_root=tmp_path / "t").update_ytdlp()
    assert err.value.info.code == "network"


async def test_updating_is_refused_while_downloads_are_running(tmp_path, media, out):
    m = JobManager(YTDLP, temp_root=tmp_path / "tmp")
    job = await start_slow(m, media, out)
    with pytest.raises(DownloaderError) as err:
        await m.update_ytdlp()
    assert err.value.info.code == "busy"
    await m.cancel(job.id)
    await m.shutdown()


# ---- the native folder dialog ------------------------------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("result,expected", [((0, "/home/me/Videos\n", ""), {"available": True, "path": "/home/me/Videos", "cancelled": False}),
                                             ((0, "\n", ""), {"available": True, "path": None, "cancelled": True}),
                                             ((3, "", ""), {"available": False, "path": None, "cancelled": False})])
async def test_the_native_dialog_result_is_interpreted(monkeypatch, result, expected):
    async def fake(cmd, *, timeout, env=None):
        return result

    monkeypatch.setattr(downloader, "run_capture", fake)
    assert await downloader.native_folder_dialog("/start") == expected


async def test_without_a_display_the_native_dialog_reports_itself_unavailable():
    try:
        import tkinter  # noqa: F401
        pytest.skip("tkinter is available here")
    except ImportError:
        pass
    assert (await downloader.native_folder_dialog("")) ["available"] is False
