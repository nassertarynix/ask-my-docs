"""Screenshots for the README, taken from the real app against a local test server (a short generated test video, not a website).

    python scripts/shots.py docs

Needs ffmpeg, yt-dlp, playwright and Chromium (set MD_CHROMIUM to use a Chromium that is not Playwright's own).
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from media_server import MediaServer, make_video  # noqa: E402
from playwright.sync_api import expect, sync_playwright  # noqa: E402


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="md-shots-"))
    make_video(work / "clip.mp4", 6)
    make_video(work / "slow.mp4", 20, "854x480", crf=26)
    size = (work / "slow.mp4").stat().st_size
    media = MediaServer(work, throttle_bps=max(50_000, size // 40)).start()  # slow enough to photograph mid-download
    home = work / "home"
    (home / "Downloads").mkdir(parents=True)
    port = 8731
    env = {**os.environ, "MD_PORT": str(port), "MD_DATA_DIR": str(work / "data"), "HOME": str(home)}
    server = subprocess.Popen([sys.executable, str(ROOT / "main.py")], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = f"http://127.0.0.1:{port}"
    for _ in range(100):
        try:
            urllib.request.urlopen(base + "/api/system/status", timeout=1).read()
            break
        except Exception:
            time.sleep(0.2)
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(executable_path=os.environ.get("MD_CHROMIUM") or None, args=["--no-sandbox"])

            def still(page):  # a sticky header would be drawn in the middle of a full-page capture
                page.add_style_tag(content="header { position: static !important; }")

            def fetch(page, url):
                page.goto(base)
                page.fill("#url", url)
                page.click("#fetch-btn")
                expect(page.locator("#details")).to_be_visible(timeout=30_000)

            ctx = browser.new_context(viewport={"width": 1100, "height": 800}, device_scale_factor=2)
            page = ctx.new_page()
            fetch(page, media.url("/v/Sunrise%20timelapse%20(test%20clip).mp4"))
            page.screenshot(path=str(out / "desktop-details.png"))

            page.click("#download-btn")  # the first job finishes quickly...
            expect(page.locator("#queue li").first.get_by_text("Done", exact=True)).to_be_visible(timeout=60_000)
            fetch(page, media.url("/s/Long%20recording%20(test%20file).mp4"))  # ...the second one is throttled
            page.click("#download-btn")
            card = page.locator("#queue li").first
            expect(card.locator("[role=progressbar]")).not_to_have_attribute("aria-valuenow", "0", timeout=30_000)
            time.sleep(2.5)
            page.evaluate("window.scrollTo(0, 0)")
            still(page)
            page.screenshot(path=str(out / "desktop-queue.png"), full_page=True)
            card.get_by_role("button", name="Cancel").click()
            expect(card.get_by_text("Cancelled", exact=True)).to_be_visible(timeout=30_000)

            page.click("#advanced-toggle")
            page.fill("#proxy", "socks5://127.0.0.1:1080")
            page.fill("#user-agent", "Mozilla/5.0 (X11; Linux x86_64) Chrome/124.0 Safari/537.36")
            still(page)
            page.screenshot(path=str(out / "desktop-settings.png"), full_page=True)
            ctx.close()

            phone = browser.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
            page = phone.new_page()
            fetch(page, media.url("/feed.xml"))
            still(page)
            page.screenshot(path=str(out / "phone-playlist.png"), full_page=True)
            page.click("#download-btn")
            expect(page.locator("#queue li").first.get_by_text("Done", exact=True)).to_be_visible(timeout=60_000)
            page.screenshot(path=str(out / "phone-queue.png"), full_page=True)
            phone.close()
            browser.close()
    finally:
        server.terminate()
        media.stop()


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "docs"))
