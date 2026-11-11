"""Opt-in checks against the real YouTube:  pytest -m network

They use one Creative Commons short film (Blender Foundation's "Big Buck Bunny", licensed CC BY, reuse allowed) and download only its
smallest audio track. They are not part of the normal run because they need the internet and YouTube changes without warning: a failure
here usually means yt-dlp needs updating (`pip install -U yt-dlp`), not that this app is broken."""
import time

import pytest
from starlette.testclient import TestClient

from helpers import YTDLP, needs_tools
from main import create_app

pytestmark = [pytest.mark.network, needs_tools]
VIDEO = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(data_dir=tmp_path / "data", ytdlp=YTDLP), base_url="http://127.0.0.1:8000") as c:
        c.out = tmp_path / "downloads"
        yield c


REFUSALS = ("extraction_failed", "bot_check", "rate_limited", "age_restricted", "network")


def test_real_video_details(client):
    info = client.post("/api/info", json={"url": VIDEO}).json()
    if "error" in info and info["error"]["code"] in REFUSALS:  # YouTube often refuses data-centre addresses; the app must explain it
        assert info["error"]["message"] and info["error"]["hint"]
        pytest.skip(f"YouTube refused the request from this network ({info['error']['code']}): {info['error']['message']}")
    assert info["title"].startswith("Big Buck Bunny") and not info["is_playlist"]
    assert info["duration"] == pytest.approx(635, abs=5)
    assert 1080 in info["available_heights"] and info["thumbnail"].startswith("https://")
    assert any(f["has_audio"] and not f["has_video"] for f in info["formats"])


def test_real_download_of_the_smallest_audio_track(client):
    r = client.post("/api/download", json={"url": VIDEO, "output_path": str(client.out), "extract_audio": True, "audio_format": "mp3",
                                           "format_selection": "wa"})  # the smallest audio track keeps this quick
    assert r.status_code == 202, r.text
    job_id = r.json()["job_id"]
    deadline = time.time() + 120
    job = {}
    while time.time() < deadline:
        job = next(j for j in client.get("/api/jobs").json()["jobs"] if j["job_id"] == job_id)
        if job["status"] in ("completed", "failed", "cancelled"):
            break
        time.sleep(1)
    else:
        client.post("/api/download/cancel", json={"job_id": job_id})
        pytest.skip("YouTube kept refusing the media fragments from this network (yt-dlp retries each one); try from another connection or with cookies")
    if job["status"] == "failed" and job["error"]["code"] in REFUSALS:
        # YouTube often refuses data-centre addresses. The app must still explain it, which is what we can check.
        assert job["error"]["message"] and job["error"]["hint"]
        pytest.skip(f"YouTube refused the download from this network ({job['error']['code']}); the error was explained: {job['error']['message']}")
    assert job["status"] == "completed", job.get("error")
    files = list(client.out.glob("*.mp3"))
    assert len(files) == 1 and files[0].stat().st_size > 20_000


def test_a_video_that_does_not_exist_is_explained(client):
    r = client.post("/api/info", json={"url": "https://www.youtube.com/watch?v=AAAAAAAAAAA"})
    assert r.status_code >= 400 and r.json()["error"]["hint"]
