"""Shared by the test files (kept out of conftest.py, because tests/e2e has a conftest.py of its own and two modules cannot both be `conftest`)."""
import shutil

import pytest

from downloader import resolve_ytdlp

YTDLP = resolve_ytdlp()
HAVE_TOOLS = bool(YTDLP and shutil.which("ffmpeg"))
needs_tools = pytest.mark.skipif(not HAVE_TOOLS, reason="needs yt-dlp and ffmpeg")
