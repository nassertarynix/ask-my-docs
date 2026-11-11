import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(__file__))

from helpers import HAVE_TOOLS  # noqa: E402
from media_server import MediaServer, make_video  # noqa: E402


@pytest.fixture(scope="session")
def media(tmp_path_factory):
    """Real video files served from 127.0.0.1. `slow.mp4` is big and throttled, so a download lasts long enough to cancel."""
    if not HAVE_TOOLS:
        pytest.skip("needs yt-dlp and ffmpeg")
    root = tmp_path_factory.mktemp("media")
    make_video(root / "clip.mp4", 6)
    make_video(root / "slow.mp4", 20, "854x480", crf=26)
    size = (root / "slow.mp4").stat().st_size
    server = MediaServer(root, throttle_bps=max(50_000, size // 9)).start()  # the whole file takes about 9 s to arrive
    yield server
    server.stop()


@pytest.fixture
def fake_ytdlp():
    """Command prefix for the fake yt-dlp; set FAKE_MODE in the environment passed to the manager."""
    return [sys.executable, os.path.join(os.path.dirname(__file__), "fake_ytdlp.py")]
