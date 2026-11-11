"""Browser tests: the real app (uvicorn in its own process) driven by a real Chromium, downloading from a local media server."""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

import pytest

sync_api = pytest.importorskip("playwright.sync_api", reason="pip install playwright (and: playwright install chromium)")

ROOT = Path(__file__).resolve().parents[2]


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="module")
def browser():
    # module scope, not session: Playwright's sync API keeps an event loop alive in this thread until it stops, and a running loop makes
    # the async tests that run afterwards (pytest-asyncio) fail with "Runner.run() cannot be called from a running event loop"
    with sync_api.sync_playwright() as p:
        # MD_CHROMIUM lets a machine that already has a Chromium (not Playwright's own) run these tests
        executable = os.environ.get("MD_CHROMIUM") or None
        b = p.chromium.launch(executable_path=executable, args=["--no-sandbox"])
        yield b
        b.close()


@pytest.fixture
def app(tmp_path):
    """A fresh app with its own settings and download folder. Yields an object with .url, .downloads and .stop()."""
    port, data, home = free_port(), tmp_path / "data", tmp_path / "home"
    downloads = home / "Downloads"  # the app's default download folder is ~/Downloads, so a fresh HOME keeps it away from the real one
    downloads.mkdir(parents=True)
    env = {**os.environ, "MD_PORT": str(port), "MD_DATA_DIR": str(data), "HOME": str(home), "USERPROFILE": str(home), "PYTHONUNBUFFERED": "1"}
    log = (tmp_path / "server.log").open("w")
    proc = subprocess.Popen([sys.executable, str(ROOT / "main.py")], cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)

    class App:
        url = f"http://127.0.0.1:{port}"

    App.downloads = downloads
    deadline = time.time() + 20
    while time.time() < deadline:
        try:
            urllib.request.urlopen(App.url + "/api/system/status", timeout=1).read()
            break
        except Exception:
            if proc.poll() is not None:
                pytest.fail("the app did not start:\n" + (tmp_path / "server.log").read_text())
            time.sleep(0.2)
    else:
        proc.kill()
        pytest.fail("the app did not start in time")
    yield App
    proc.terminate()
    try:
        proc.wait(5)
    except subprocess.TimeoutExpired:
        proc.kill()
    log.close()


@pytest.fixture
def page(browser, app):
    context = browser.new_context(viewport={"width": 1280, "height": 900}, accept_downloads=False)
    page = context.new_page()
    page.app = app
    page.problems = []
    page.on("pageerror", lambda e: page.problems.append(f"pageerror: {e}"))
    page.on("console", lambda m: page.problems.append(f"console.{m.type}: {m.text}") if m.type in ("error",) else None)
    yield page
    context.close()
