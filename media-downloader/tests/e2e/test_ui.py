"""The page, driven like a person would: paste a link, look at the details, download, cancel, change settings."""
from __future__ import annotations

import json
import time

import pytest
from playwright.sync_api import expect

pytestmark = pytest.mark.e2e


def fetch(page, url):
    page.goto(page.app.url)
    page.fill("#url", url)
    page.click("#fetch-btn")
    expect(page.locator("#details")).to_be_visible(timeout=30_000)


def media_files(folder):
    return sorted(p for p in folder.rglob("*") if p.is_file())


def test_the_page_loads_under_its_own_security_policy(page):
    """Tailwind's CDN script must run under the app's CSP (no eval needed), and nothing may log an error."""
    page.goto(page.app.url)
    expect(page.locator("#chips")).to_contain_text("yt-dlp")
    assert page.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(9, 9, 11)"
    assert not page.problems, page.problems


def test_fetch_shows_a_loading_state_then_the_details(page, media):
    page.goto(page.app.url)
    page.fill("#url", media.url("/clip.mp4"))
    page.click("#fetch-btn")
    expect(page.locator("#fetch-btn")).to_be_disabled()
    expect(page.locator("#fetch-label")).to_have_text("Fetching…")
    expect(page.locator("#details")).to_be_visible(timeout=30_000)
    expect(page.locator("#fetch-btn")).to_be_enabled()
    expect(page.locator("#d-title")).to_have_text("clip")
    expect(page.locator("#quality option").first).to_have_text("Best available")
    expect(page.locator("#d-thumb")).to_have_text("")  # a video without a thumbnail must not print the word "null"
    expect(page.locator("#d-meta")).not_to_contain_text("Falling back")


def test_an_invalid_link_explains_itself(page):
    page.goto(page.app.url)
    page.fill("#url", "not a link")
    page.click("#fetch-btn")
    expect(page.locator("#fetch-error")).to_be_visible()
    expect(page.locator("#fetch-error")).not_to_be_empty()
    expect(page.locator("#fetch-error")).not_to_contain_text("null")
    expect(page.locator("#details")).to_be_hidden()


def test_an_empty_link_is_refused_without_asking_the_server(page):
    page.goto(page.app.url)
    page.click("#fetch-btn")
    expect(page.locator("#fetch-error")).to_contain_text("Paste a link")


def test_download_a_video_end_to_end(page, media):
    fetch(page, media.url("/clip.mp4"))
    page.click("#download-btn")
    card = page.locator("#queue li").first
    expect(card.locator("span").filter(has_text="Done")).to_be_visible(timeout=60_000)
    expect(card.locator("[role=progressbar]")).to_have_attribute("aria-valuenow", "100")
    files = media_files(page.app.downloads)
    assert [f.suffix for f in files] == [".mp4"], files
    assert files[0].stat().st_size > 10_000
    assert not page.problems, page.problems


def test_download_audio_only_as_mp3(page, media):
    fetch(page, media.url("/clip.mp4"))
    page.get_by_text("Audio only").click()
    expect(page.locator("#audio-opts")).to_be_visible()
    expect(page.locator("#video-opts")).to_be_hidden()
    page.select_option("#audio-format", "mp3")
    page.click("#download-btn")
    expect(page.locator("#queue li").first.get_by_text("Done", exact=True)).to_be_visible(timeout=60_000)
    assert [f.suffix for f in media_files(page.app.downloads)] == [".mp3"]


def test_cancel_stops_the_download_and_leaves_no_partial_files(page, media):
    fetch(page, media.url("/slow.mp4"))
    page.click("#download-btn")
    card = page.locator("#queue li").first
    expect(card.get_by_text("Downloading", exact=True)).to_be_visible(timeout=30_000)
    expect(card.locator("[role=progressbar]")).not_to_have_attribute("aria-valuenow", "0", timeout=30_000)
    card.get_by_role("button", name="Cancel").click()
    expect(card.get_by_text("Cancelled", exact=True)).to_be_visible(timeout=30_000)
    expect(card.get_by_role("button", name="Remove")).to_be_visible()
    assert media_files(page.app.downloads) == []
    # and it can be removed from the list
    card.get_by_role("button", name="Remove").click()
    expect(page.locator("#queue li")).to_have_count(0)
    expect(page.locator("#queue-empty")).to_be_visible()


def test_the_queue_survives_a_reload(page, media):
    fetch(page, media.url("/clip.mp4"))
    page.click("#download-btn")
    expect(page.locator("#queue li").first.get_by_text("Done", exact=True)).to_be_visible(timeout=60_000)
    page.reload()
    expect(page.locator("#queue li")).to_have_count(1)
    expect(page.locator("#queue li").first.get_by_text("Done", exact=True)).to_be_visible()
    expect(page.locator("#clear-done")).to_be_visible()
    page.click("#clear-done")
    expect(page.locator("#queue li")).to_have_count(0)


def test_a_failed_download_shows_a_clear_error(page, media):
    fetch(page, media.url("/clip.mp4"))
    page.route("**/api/download", lambda route: route.continue_(post_data=json.dumps({**json.loads(route.request.post_data), "url": media.url("/missing.mp4")})))
    page.click("#download-btn")
    card = page.locator("#queue li").first
    expect(card.get_by_text("Failed", exact=True)).to_be_visible(timeout=60_000)
    expect(card.locator("div.border-rose-900")).to_be_visible()
    assert media_files(page.app.downloads) == []


def test_playlist_items_can_be_chosen(page, media):
    fetch(page, media.url("/feed.xml"))
    expect(page.locator("#entries-wrap")).to_be_visible()
    expect(page.locator("#entries li")).to_have_count(2)
    expect(page.locator("#entries-count")).to_have_text("2 of 2 selected")
    page.uncheck("#entry-2")
    expect(page.locator("#entries-count")).to_have_text("1 of 2 selected")
    expect(page.locator("#download-btn")).to_have_text("Download 1 item")
    page.click("#download-btn")
    expect(page.locator("#queue li").first.get_by_text("Done", exact=True)).to_be_visible(timeout=60_000)
    files = media_files(page.app.downloads)
    assert len(files) == 1 and files[0].parent.name == "Test feed", files
    assert files[0].name.startswith("001 - ")


def test_select_none_blocks_the_download(page, media):
    fetch(page, media.url("/feed.xml"))
    page.uncheck("#entries-all")
    expect(page.locator("#entries-count")).to_have_text("0 of 2 selected")
    page.click("#download-btn")
    expect(page.locator("#download-msg")).to_have_text("Select at least one item.")
    expect(page.locator("#queue li")).to_have_count(0)


def test_titles_from_other_websites_are_text_never_markup(page, media):
    fetch(page, media.url("/evil.xml"))
    expect(page.locator("#entries li").first).to_contain_text("<img src=x onerror=window.__pwned=1>")
    expect(page.locator("#entries li").nth(1)).to_contain_text("<b>bold</b> & more")
    assert page.locator("#entries img, #entries b").count() == 0
    assert page.evaluate("window.__pwned") is None
    page.click("#download-btn")
    expect(page.locator("#queue li").first.get_by_text("Done", exact=True)).to_be_visible(timeout=60_000)
    assert page.locator("#queue img, #queue b").count() == 0
    assert page.evaluate("window.__pwned") is None


def test_a_thumbnail_that_is_not_http_is_not_loaded(page, media):
    fetch(page, media.url("/clip.mp4"))
    # the UI only ever builds <img> for http(s) URLs
    assert page.evaluate("[isWebImage('javascript:alert(1)'), isWebImage('data:image/svg+xml,<svg onload=alert(1)>'), isWebImage('https://x.test/a.jpg')]") == [False, False, True]


def test_the_folder_browser_works_when_there_is_no_native_dialog(page, media, tmp_path):
    (page.app.downloads / "Movies").mkdir()
    (page.app.downloads / "Music").mkdir()
    (page.app.downloads / ".hidden").mkdir()
    fetch(page, media.url("/clip.mp4"))
    page.route("**/api/browse-directory?path=*", lambda route: route.fulfill(status=501, content_type="application/json", body=json.dumps(
        {"error": {"code": "dialog_unavailable", "message": "no dialog", "hint": ""}})) if "mode=list" not in route.request.url else route.continue_())
    page.click("#browse")
    expect(page.locator("#folder-dialog")).to_be_visible()
    expect(page.locator("#fd-path")).to_have_text(str(page.app.downloads))
    expect(page.locator("#fd-list li")).to_have_count(2)  # hidden folders stay hidden
    page.get_by_role("button", name="Movies").click()
    expect(page.locator("#fd-path")).to_have_text(str(page.app.downloads / "Movies"))
    expect(page.locator("#fd-list")).to_contain_text("No sub-folders here.")
    page.click("#fd-up")
    page.check("#fd-hidden")
    expect(page.locator("#fd-list li")).to_have_count(3)
    page.get_by_role("button", name="Music").click()
    page.click("#fd-choose")
    expect(page.locator("#folder-dialog")).to_be_hidden()
    expect(page.locator("#out-path")).to_have_value(str(page.app.downloads / "Music"))
    page.click("#download-btn")
    expect(page.locator("#queue li").first.get_by_text("Done", exact=True)).to_be_visible(timeout=60_000)
    assert len(media_files(page.app.downloads / "Music")) == 1


def test_native_dialog_result_fills_the_folder_field(page, media, tmp_path):
    fetch(page, media.url("/clip.mp4"))
    page.route("**/api/browse-directory?path=*", lambda route: route.fulfill(content_type="application/json", body=json.dumps(
        {"available": True, "path": "/somewhere/chosen", "cancelled": False})))
    page.click("#browse")
    expect(page.locator("#out-path")).to_have_value("/somewhere/chosen")


def test_settings_are_saved_and_the_proxy_password_is_not_shown_back(page):
    page.goto(page.app.url)
    page.click("#advanced-toggle")
    expect(page.locator("#advanced")).to_be_visible()
    page.fill("#proxy", "http://user:s3cret@proxy.example:3128")
    page.fill("#user-agent", "MyAgent/1.0")
    page.click("#settings-save")
    expect(page.locator("#settings-msg")).to_have_text("Saved.")
    page.reload()
    page.click("#advanced-toggle")
    expect(page.locator("#user-agent")).to_have_value("MyAgent/1.0")
    value = page.input_value("#proxy")
    assert "proxy.example:3128" in value and "s3cret" not in value, value
    # saving again with the masked text must not overwrite the real password
    page.click("#settings-save")
    expect(page.locator("#settings-msg")).to_have_text("Saved.")
    saved = json.loads(next(page.app.downloads.parents[1].glob("data/settings.json")).read_text())
    assert saved["proxy"] == "http://user:s3cret@proxy.example:3128"


def test_a_bad_proxy_is_refused_with_a_message(page):
    page.goto(page.app.url)
    page.click("#advanced-toggle")
    page.fill("#proxy", "ftp://nope")
    page.click("#settings-save")
    expect(page.locator("#settings-msg")).not_to_have_text("Saved.")
    expect(page.locator("#settings-msg")).not_to_be_empty()


def test_cookies_can_be_uploaded_and_removed(page, tmp_path):
    cookies = tmp_path / "cookies.txt"
    cookies.write_text("# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tFALSE\t2000000000\tname\tvalue\n")
    page.goto(page.app.url)
    page.click("#advanced-toggle")
    page.set_input_files("#cookie-upload", str(cookies))
    expect(page.locator("#cookie-note")).to_contain_text("uploaded")
    expect(page.locator("#cookie-remove")).to_be_visible()
    expect(page.locator("input[name=cookie-mode][value=file]")).to_be_checked()
    page.click("#cookie-remove")
    expect(page.locator("#cookie-remove")).to_be_hidden()
    expect(page.locator("input[name=cookie-mode][value=none]")).to_be_checked()


def test_choosing_browser_cookies_after_uploading_a_file_works(page, tmp_path):
    cookies = tmp_path / "cookies.txt"
    cookies.write_text("# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tFALSE\t2000000000\tname\tvalue\n")
    page.goto(page.app.url)
    page.click("#advanced-toggle")
    page.set_input_files("#cookie-upload", str(cookies))
    expect(page.locator("#cookie-remove")).to_be_visible()
    page.check("input[name=cookie-mode][value=browser]")
    page.select_option("#cookie-browser", "firefox")
    page.click("#settings-save")
    expect(page.locator("#settings-msg")).to_have_text("Saved.")
    page.reload()
    page.click("#advanced-toggle")
    expect(page.locator("input[name=cookie-mode][value=browser]")).to_be_checked()
    expect(page.locator("#cookie-browser")).to_have_value("firefox")


def test_update_button_reports_the_result(page):
    page.route("**/api/system/update-ytdlp", lambda route: route.fulfill(content_type="application/json", body=json.dumps(
        {"ok": True, "method": "pip", "before": "2020.01.01", "after": "2030.01.01", "changed": True, "output": ""})))
    page.goto(page.app.url)
    page.click("#advanced-toggle")
    page.click("#update-ytdlp")
    expect(page.locator("#update-msg")).to_contain_text("2020.01.01 → 2030.01.01")
    expect(page.locator("#update-ytdlp")).to_be_enabled()


def test_update_failure_is_shown(page):
    page.route("**/api/system/update-ytdlp", lambda route: route.fulfill(status=409, content_type="application/json", body=json.dumps(
        {"error": {"code": "busy", "message": "Downloads are running.", "hint": "Wait for them to finish."}})))
    page.goto(page.app.url)
    page.click("#advanced-toggle")
    page.click("#update-ytdlp")
    expect(page.locator("#update-msg")).to_contain_text("Downloads are running.")


def test_a_missing_ffmpeg_is_explained_up_front(page):
    status = {"ytdlp": {"installed": True, "version": "2026.01.01", "command": "yt-dlp"}, "ffmpeg": {"installed": False, "path": "", "version": ""},
              "native_folder_dialog": False, "python": "3.12", "active_downloads": 0}
    page.route("**/api/system/status", lambda route: route.fulfill(content_type="application/json", body=json.dumps(status)))
    page.goto(page.app.url)
    expect(page.locator("#banners")).to_contain_text("FFmpeg was not found")
    expect(page.locator("#chips")).to_contain_text("FFmpeg missing")


def test_the_server_going_away_is_explained(page, media):
    page.goto(page.app.url)
    page.route("**/api/info", lambda route: route.abort())
    page.fill("#url", media.url("/clip.mp4"))
    page.click("#fetch-btn")
    expect(page.locator("#fetch-error")).to_contain_text("Cannot reach the downloader")


@pytest.mark.parametrize("width", [320, 375, 768, 1280])
def test_no_horizontal_scroll_at_any_width(page, media, width):
    page.set_viewport_size({"width": width, "height": 900})
    fetch(page, media.url("/feed.xml"))
    page.click("#advanced-toggle")
    page.click("#download-btn")
    expect(page.locator("#queue li").first.get_by_text("Done", exact=True)).to_be_visible(timeout=60_000)
    assert page.evaluate("document.documentElement.scrollWidth <= document.documentElement.clientWidth"), f"scrolls sideways at {width}px"


def test_queue_buttons_are_big_enough_to_tap(page, media):
    page.set_viewport_size({"width": 375, "height": 800})
    fetch(page, media.url("/clip.mp4"))
    page.click("#download-btn")
    button = page.locator("#queue li").first.get_by_role("button", name="Remove")
    expect(button).to_be_visible(timeout=60_000)
    assert button.bounding_box()["height"] >= 40
    assert page.locator("#queue li [role=progressbar]").first.bounding_box()["width"] > 200  # the bar uses the card's width
