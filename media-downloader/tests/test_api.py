"""The HTTP API, end to end, with the real yt-dlp and ffmpeg downloading from the local media server."""
import json
import os
import time
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from helpers import YTDLP, needs_tools
from main import create_app
from options import DEFAULT_AUDIO_FORMAT, DEFAULT_VIDEO_FORMAT, preset_format

pytestmark = needs_tools
BASE = "http://127.0.0.1:8000"
COOKIES = "# Netscape HTTP Cookie File\n127.0.0.1\tFALSE\t/\tFALSE\t0\tsession\tabc123\n"


@pytest.fixture
def client(tmp_path):
    app = create_app(data_dir=tmp_path / "data", ytdlp=YTDLP, retry_delays=(0.05, 0.05))
    with TestClient(app, base_url=BASE) as c:
        c.out = tmp_path / "downloads"
        c.tmp = tmp_path
        yield c


def post_download(client, url, **kw):
    body = {"url": url, "output_path": str(client.out), **kw}
    return client.post("/api/download", json=body)


def sse(client, job_id):
    """All events of a job's progress stream, as (event, data) pairs."""
    events, name = [], None
    with client.stream("GET", "/api/download/stream", params={"job_id": job_id}) as r:
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
        for raw in r.iter_lines():
            if raw.startswith("event:"):
                name = raw.split(":", 1)[1].strip()
            elif raw.startswith("data:"):
                events.append((name, json.loads(raw.split(":", 1)[1])))
    return events


def wait_for(client, job_id, predicate, timeout=30):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        job = next(j for j in client.get("/api/jobs").json()["jobs"] if j["job_id"] == job_id)
        if predicate(job):
            return job
        time.sleep(0.1)
    raise AssertionError("timed out waiting for the job")


# ---- the guard -------------------------------------------------------------------------------------------------------------------------------
def test_requests_for_another_host_name_are_refused(tmp_path):
    with TestClient(create_app(data_dir=tmp_path / "d", ytdlp=YTDLP), base_url="http://evil.example:8000") as c:
        r = c.get("/api/system/status")
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden_host"


@pytest.mark.parametrize("origin", ["https://evil.example", "http://localhost:9999", "null", "http://127.0.0.1:8001", "https://127.0.0.1:8000"])
def test_other_websites_cannot_use_the_api(client, origin):
    for method, path, kw in (("post", "/api/info", {"json": {"url": "https://x.com/v"}}), ("post", "/api/download", {"json": {"url": "https://x.com/v"}}),
                             ("get", "/api/settings", {}), ("put", "/api/settings", {"json": {"proxy": "http://x:1"}}), ("get", "/api/browse-directory", {"params": {"mode": "list"}})):
        r = getattr(client, method)(path, headers={"Origin": origin}, **kw)
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden_origin", (path, origin)


def test_the_apps_own_origin_is_accepted_and_responses_carry_security_headers(client):
    r = client.get("/api/system/status", headers={"Origin": BASE})
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store" and r.headers["x-content-type-options"] == "nosniff"
    csp = r.headers["content-security-policy"]
    assert "frame-ancestors 'none'" in csp and "connect-src 'self'" in csp and "base-uri 'none'" in csp


def test_the_page_is_served(client):
    r = client.get("/")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")


# ---- information -------------------------------------------------------------------------------------------------------------------------------
def test_info_for_a_video(client, media):
    r = client.post("/api/info", json={"url": media.url("/clip.mp4")})
    body = r.json()
    assert r.status_code == 200 and body["title"] == "clip" and body["is_playlist"] is False and body["formats"][0]["has_video"]


def test_info_for_a_playlist(client, media):
    body = client.post("/api/info", json={"url": media.url("/feed.xml")}).json()
    assert body["is_playlist"] is True and [e["title"] for e in body["entries"]] == ["First clip", "Second clip"]


@pytest.mark.parametrize("url", ["", "not a url", "file:///etc/passwd", "ftp://x.com/v", "--exec id", "javascript:alert(1)"])
def test_info_rejects_bad_links_without_starting_yt_dlp(client, url):
    r = client.post("/api/info", json={"url": url})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_url" and r.json()["error"]["message"]


def test_info_errors_are_explained_with_a_hint(client, media):
    r = client.post("/api/info", json={"url": media.url("/missing.mp4")})
    assert r.status_code == 502 and r.json()["error"]["code"] == "unavailable" and r.json()["error"]["hint"]
    r = client.post("/api/info", json={"url": "http://127.0.0.1:1/x.mp4"})
    assert r.json()["error"]["code"] == "network"


def test_a_bad_request_body_is_a_422_not_a_crash(client):
    assert client.post("/api/info", json={}).status_code == 422
    assert client.post("/api/info", content=b"not json", headers={"content-type": "application/json"}).status_code == 422


@pytest.mark.parametrize("options", [{"proxy": "ftp://x:1"}, {"user_agent": "a\nb"}, {"cookies_from_browser": "netscape"}, {"exec": "id"}, {"playlist_items": "1;2"},
                                     {"cookies_file": "/definitely/missing.txt"}])
def test_bad_options_are_rejected(client, media, options):
    r = client.post("/api/info", json={"url": media.url("/clip.mp4"), "options": options})
    assert r.status_code == 422 and r.json()["error"]["code"] in ("invalid_option", "invalid_proxy", "invalid_user_agent", "invalid_cookies")


# ---- downloading ---------------------------------------------------------------------------------------------------------------------------------
def test_download_streams_progress_and_delivers_the_file(client, media):
    r = post_download(client, media.url("/slow.mp4"))
    assert r.status_code == 202 and r.json()["status"] == "queued"
    events = sse(client, r.json()["job_id"])
    names = [n for n, _ in events]
    assert names.count("end") == 1 and names[-1] == "end" and set(names) == {"update", "end"}
    updates = [d for n, d in events if n == "update"]
    assert updates[-1]["status"] == "completed" and updates[-1]["percent"] == 100
    pct = [u["percent"] for u in updates if u["status"] == "downloading"]
    assert pct == sorted(pct) and len(pct) >= 2
    assert [p.name for p in client.out.iterdir()] == ["slow [slow].mp4"]


def test_a_stream_opened_after_the_job_ended_still_delivers_the_result(client, media):
    jid = post_download(client, media.url("/clip.mp4")).json()["job_id"]
    wait_for(client, jid, lambda j: j["status"] == "completed")
    events = sse(client, jid)
    assert [n for n, _ in events] == ["update", "end"] and events[0][1]["status"] == "completed"


def test_audio_extraction_uses_the_audio_format_and_defaults_the_selection(client, media):
    for selection in ("", DEFAULT_VIDEO_FORMAT):
        jid = post_download(client, media.url("/clip.mp4"), extract_audio=True, audio_format="flac", format_selection=selection).json()["job_id"]
        job = wait_for(client, jid, lambda j: j["status"] in ("completed", "failed"))
        assert job["status"] == "completed" and job["request"]["format_selection"] == DEFAULT_AUDIO_FORMAT
    assert [p.suffix for p in client.out.iterdir()] == [".flac"]


def test_a_chosen_quality_and_container_are_used(client, media):
    selection = preset_format(360)
    jid = post_download(client, media.url("/clip.mp4"), format_selection=selection, options={"container": "mkv"}).json()["job_id"]
    job = wait_for(client, jid, lambda j: j["status"] in ("completed", "failed"))
    assert job["status"] == "completed", job["error"] and job["request"]["format_selection"] == selection


def test_a_strict_height_filter_on_a_source_without_height_info_fails_with_a_clear_reason(client, media):
    """Documents why the presets use `<=?`: yt-dlp excludes formats of unknown height when `<=` is used."""
    jid = post_download(client, media.url("/clip.mp4"), format_selection="bv*[height<=360]+ba/b[height<=360]").json()["job_id"]
    job = wait_for(client, jid, lambda j: j["status"] in ("completed", "failed"))
    assert job["status"] == "failed" and job["error"]["code"] == "extraction_failed" and "format" in job["error"]["detail"].lower()


def test_a_playlist_download_goes_into_a_folder(client, media):
    jid = post_download(client, media.url("/feed.xml"), is_playlist=True).json()["job_id"]
    job = wait_for(client, jid, lambda j: j["status"] in ("completed", "failed"))
    assert job["status"] == "completed" and sorted(p.name for p in (client.out / "Test feed").iterdir()) == ["001 - First clip [clip].mp4", "002 - Second clip [clip].mp4"]


def test_the_title_and_thumbnail_sent_with_the_request_are_shown_in_the_job(client, media):
    jid = post_download(client, media.url("/clip.mp4"), title="Nice title", thumbnail="https://example.com/t.jpg").json()["job_id"]
    job = wait_for(client, jid, lambda j: j["status"] == "completed")
    assert job["title"] == "Nice title" and job["thumbnail"] == "https://example.com/t.jpg"
    jid = post_download(client, media.url("/clip.mp4"), thumbnail="javascript:alert(1)").json()["job_id"]
    assert wait_for(client, jid, lambda j: True)["thumbnail"] == ""


@pytest.mark.parametrize("body,code", [({"format_selection": "best; rm -rf /"}, "invalid_format"), ({"format_selection": "--exec=id"}, "invalid_format"),
                                       ({"audio_format": "exe"}, "invalid_format"), ({"output_path": "relative/dir"}, "invalid_path"),
                                       ({"output_path": "/proc/forbidden/dir"}, "permission"), ({"options": {"nope": 1}}, "invalid_option"),
                                       ({"url": "file:///x"}, "invalid_url")])
def test_bad_download_requests_are_refused_before_anything_starts(client, media, body, code):
    payload = {"url": media.url("/clip.mp4"), "output_path": str(client.out), **body}
    r = client.post("/api/download", json=payload)
    assert r.status_code in (403, 422) and r.json()["error"]["code"] == code
    assert client.get("/api/jobs").json()["jobs"] == []


def test_audio_extraction_is_refused_up_front_when_ffmpeg_is_missing(tmp_path, media):
    app = create_app(data_dir=tmp_path / "d", ytdlp=YTDLP, env={"PATH": str(tmp_path)})
    with TestClient(app, base_url=BASE) as c:
        r = c.post("/api/download", json={"url": media.url("/clip.mp4"), "extract_audio": True, "output_path": str(tmp_path / "o")})
        assert r.status_code == 424 and r.json()["error"]["code"] == "ffmpeg_missing" and r.json()["error"]["hint"]
        assert c.get("/api/system/status").json()["ffmpeg"]["installed"] is False
        assert c.get("/api/jobs").json()["jobs"] == []


def test_without_yt_dlp_every_call_explains_how_to_install_it(tmp_path, media):
    with TestClient(create_app(data_dir=tmp_path / "d", ytdlp=None), base_url=BASE) as c:
        for r in (c.post("/api/info", json={"url": media.url("/clip.mp4")}), c.post("/api/download", json={"url": media.url("/clip.mp4"), "output_path": str(tmp_path / "o")})):
            assert r.status_code == 503 and r.json()["error"]["code"] == "ytdlp_missing" and "pip install yt-dlp" in r.json()["error"]["hint"]
        assert c.get("/api/system/status").json()["ytdlp"]["installed"] is False


def test_a_failed_download_reports_the_reason_through_the_stream(client, media):
    jid = post_download(client, media.url("/missing.mp4")).json()["job_id"]
    last = [d for n, d in sse(client, jid) if n == "update"][-1]
    assert last["status"] == "failed" and last["error"]["code"] == "unavailable" and last["error"]["hint"]


def test_an_unknown_job_stream_is_a_404(client):
    r = client.get("/api/download/stream", params={"job_id": "nope"})
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
    assert client.get("/api/download/stream").status_code == 422


# ---- cancelling and the job list ------------------------------------------------------------------------------------------------------------------
def test_cancelling_over_http_stops_the_download_and_leaves_nothing(client, media):
    jid = post_download(client, media.url("/slow.mp4")).json()["job_id"]
    wait_for(client, jid, lambda j: j["status"] == "downloading" and j["percent"] > 8)
    r = client.post("/api/download/cancel", json={"job_id": jid})
    assert r.status_code == 200 and r.json() == {"job_id": jid, "cancelled": True, "status": "cancelled"}
    assert list(client.out.rglob("*")) == [] and not any((client.tmp / "data" / "tmp").iterdir())
    assert [d["status"] for n, d in sse(client, jid) if n == "update"] == ["cancelled"]


def test_cancelling_an_unknown_job_is_a_404_and_a_finished_one_reports_false(client, media):
    assert client.post("/api/download/cancel", json={"job_id": "nope"}).status_code == 404
    jid = post_download(client, media.url("/clip.mp4")).json()["job_id"]
    wait_for(client, jid, lambda j: j["status"] == "completed")
    assert client.post("/api/download/cancel", json={"job_id": jid}).json()["cancelled"] is False
    assert client.post("/api/download/cancel", json={}).status_code == 422


def test_the_job_list_survives_a_page_reload_and_jobs_can_be_removed(client, media):
    done = post_download(client, media.url("/clip.mp4")).json()["job_id"]
    wait_for(client, done, lambda j: j["status"] == "completed")
    running = post_download(client, media.url("/slow.mp4")).json()["job_id"]
    wait_for(client, running, lambda j: j["status"] == "downloading")
    listed = client.get("/api/jobs").json()["jobs"]
    assert [j["job_id"] for j in listed] == [running, done]
    assert client.delete(f"/api/jobs/{running}").status_code == 409
    assert client.delete(f"/api/jobs/{done}").json() == {"removed": True}
    assert client.delete(f"/api/jobs/{done}").status_code == 404
    client.post("/api/download/cancel", json={"job_id": running})


# ---- folders ---------------------------------------------------------------------------------------------------------------------------------------------
def test_the_folder_browser_lists_sub_folders(client, tmp_path):
    for name in ("b", "a"):
        (tmp_path / name).mkdir()
    body = client.get("/api/browse-directory", params={"mode": "list", "path": str(tmp_path)}).json()
    assert body["path"] == str(tmp_path) and {"a", "b"} <= {e["name"] for e in body["entries"]} and body["parent"] == str(tmp_path.parent)
    assert client.get("/api/browse-directory", params={"mode": "bogus"}).status_code == 422


def test_without_a_native_dialog_the_api_says_to_use_the_built_in_browser(client):
    try:
        import tkinter  # noqa: F401
        pytest.skip("tkinter is available here")
    except ImportError:
        pass
    r = client.get("/api/browse-directory")
    assert r.status_code == 501 and r.json()["error"]["code"] == "dialog_unavailable" and "built-in" in r.json()["error"]["hint"]


# ---- system --------------------------------------------------------------------------------------------------------------------------------------------------
def test_system_status(client):
    s = client.get("/api/system/status").json()
    assert s["ytdlp"]["installed"] and s["ytdlp"]["version"] and s["ffmpeg"]["installed"] and s["python"]


def test_update_endpoint_returns_the_result_and_maps_errors(client, media):
    async def fake_update():
        return {"ok": True, "method": "pip", "before": "1", "after": "2", "changed": True, "output": "done"}

    manager = client.app.state.manager
    real = manager.update_ytdlp
    manager.update_ytdlp = fake_update
    assert client.post("/api/system/update-ytdlp").json()["after"] == "2"
    manager.update_ytdlp = real
    jid = post_download(client, media.url("/slow.mp4")).json()["job_id"]
    wait_for(client, jid, lambda j: j["status"] == "downloading")
    r = client.post("/api/system/update-ytdlp")
    assert r.status_code == 409 and r.json()["error"]["code"] == "busy"
    client.post("/api/download/cancel", json={"job_id": jid})


# ---- settings reach yt-dlp ---------------------------------------------------------------------------------------------------------------------------------
def test_settings_roundtrip_and_validation(client):
    assert client.get("/api/settings").json()["user_agent"] == ""
    saved = client.put("/api/settings", json={"user_agent": "Saved/1.0", "proxy": "socks5://u:secret@127.0.0.1:1080"}).json()
    assert saved["user_agent"] == "Saved/1.0" and saved["proxy"] == "socks5://***@127.0.0.1:1080" and "secret" not in json.dumps(saved)
    r = client.put("/api/settings", json={"user_agent": "changed", "proxy": "ftp://bad"})
    assert r.status_code == 422 and client.get("/api/settings").json()["user_agent"] == "Saved/1.0"


def test_the_saved_user_agent_is_really_sent_and_a_per_request_one_wins(client, media):
    client.put("/api/settings", json={"user_agent": "Saved/1.0"})
    wait_for(client, post_download(client, media.url("/clip.mp4")).json()["job_id"], lambda j: j["status"] == "completed")
    assert media.headers_seen["/clip.mp4"]["user-agent"] == "Saved/1.0"
    jid = post_download(client, media.url("/clip.mp4"), options={"user_agent": "PerRequest/2.0"}, output_path=str(client.out / "second")).json()["job_id"]
    wait_for(client, jid, lambda j: j["status"] == "completed")
    assert media.headers_seen["/clip.mp4"]["user-agent"] == "PerRequest/2.0"


def test_an_uploaded_cookies_file_is_really_used(client, media):
    r = client.post("/api/settings/cookies", files={"file": ("cookies.txt", COOKIES.encode(), "text/plain")})
    assert r.status_code == 200 and r.json()["cookies_uploaded"] is True
    wait_for(client, post_download(client, media.url("/clip.mp4")).json()["job_id"], lambda j: j["status"] == "completed")
    assert "session=abc123" in media.headers_seen["/clip.mp4"].get("cookie", "")
    assert client.delete("/api/settings/cookies").json()["cookies_uploaded"] is False


@pytest.mark.parametrize("content", [b"hello", b"\xff\xfe\x00\x01", b""])
def test_a_file_that_is_not_a_cookies_file_is_refused(client, content):
    r = client.post("/api/settings/cookies", files={"file": ("cookies.txt", content, "text/plain")})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_cookies"


def test_the_saved_proxy_is_really_used(client, media):
    """The media server doubles as a forward proxy. The hostname below does not exist, so it can only be reached through the proxy.
    (yt-dlp never proxies loopback addresses, which is why a made-up host is needed.)"""
    url = "http://media.invalid/clip.mp4"
    jid = post_download(client, url).json()["job_id"]
    job = wait_for(client, jid, lambda j: j["status"] in ("completed", "failed"))
    assert job["status"] == "failed" and job["error"]["code"] == "network"  # no proxy: the name cannot be resolved
    client.put("/api/settings", json={"proxy": f"http://127.0.0.1:{media.port}"})
    before = media.proxied
    jid = post_download(client, url).json()["job_id"]
    job = wait_for(client, jid, lambda j: j["status"] in ("completed", "failed"))
    assert job["status"] == "completed", job["error"]
    assert media.proxied > before


def test_a_per_request_proxy_overrides_the_saved_one(client, media):
    client.put("/api/settings", json={"proxy": "http://127.0.0.1:1"})  # a dead proxy would make everything fail
    jid = post_download(client, "http://media.invalid/clip.mp4", options={"proxy": f"http://127.0.0.1:{media.port}"}).json()["job_id"]
    assert wait_for(client, jid, lambda j: j["status"] in ("completed", "failed"))["status"] == "completed"


# ---- lifecycle ------------------------------------------------------------------------------------------------------------------------------------------------
def test_leftover_temp_folders_from_a_crash_are_removed_at_start(tmp_path):
    stale = tmp_path / "data" / "tmp" / "deadbeef"
    stale.mkdir(parents=True)
    (stale / "video.mp4.part").write_text("x")
    with TestClient(create_app(data_dir=tmp_path / "data", ytdlp=YTDLP), base_url=BASE):
        assert not stale.exists()


def test_stopping_the_server_stops_running_downloads_and_removes_their_files(tmp_path, media):
    app = create_app(data_dir=tmp_path / "data", ytdlp=YTDLP)
    with TestClient(app, base_url=BASE) as c:
        jid = c.post("/api/download", json={"url": media.url("/slow.mp4"), "output_path": str(tmp_path / "o")}).json()["job_id"]
        wait_for(c, jid, lambda j: j["status"] == "downloading" and j["percent"] > 5)
        pid = c.app.state.manager.get(jid)._proc.pid
    time.sleep(0.3)
    assert not Path(f"/proc/{pid}").exists() or Path(f"/proc/{pid}/stat").read_text().split()[2] == "Z"
    assert list((tmp_path / "o").rglob("*")) == [] and not (tmp_path / "data" / "tmp").exists()
