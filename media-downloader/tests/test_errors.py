import pytest

from errors import ErrorInfo, classify_error, last_error_line, spawn_error


@pytest.mark.parametrize("text,code,retryable", [
    # messages captured from the real yt-dlp
    ("ERROR: [generic] 'hello world' is not a valid URL", "invalid_url", False),
    ("ERROR: Unsupported URL: https://example.com/page", "invalid_url", False),
    ("ERROR: [generic] x: Unable to download webpage: [Errno 111] Connection refused (caused by TransportError('[Errno 111] Connection refused'))", "network", True),
    ("ERROR: [generic] x: Unable to download webpage: [Errno -2] Name or service not known (caused by TransportError('[Errno -2] Name or service not known'))", "network", True),
    ("ERROR: Postprocessing: ffprobe and ffmpeg not found. Please install or provide the path using --ffmpeg-location", "ffmpeg_missing", False),
    ("ERROR: [generic] missing: Unable to download webpage: HTTP Error 404: File not found (caused by <HTTPError 404: File not found>)", "unavailable", False),
    # messages yt-dlp's YouTube extractor uses
    ("ERROR: [youtube] abc: Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.", "bot_check", False),
    ("ERROR: [youtube] abc: Sign in to confirm you're not a bot", "bot_check", False),
    ("ERROR: [youtube] abc: Sign in to confirm your age. This video may be inappropriate for some users.", "age_restricted", False),
    ("ERROR: [youtube] abc: Private video. Sign in if you've been granted access to this video", "private", False),
    ("ERROR: [youtube] abc: Video unavailable. This video is no longer available because the YouTube account associated with this video has been terminated.", "unavailable", False),
    ("ERROR: [youtube] abc: The uploader has not made this video available in your country", "geo_blocked", False),
    ("ERROR: [youtube] abc: Video unavailable. The uploader has not made this video available in your country", "geo_blocked", False),
    ("ERROR: [youtube] abc: Signature extraction failed: Some formats may be missing", "extraction_failed", False),
    ("ERROR: [youtube] abc: nsig extraction failed: Some formats may be missing", "extraction_failed", False),
    ("ERROR: [youtube] abc: Unable to extract initial player response; please report this issue", "extraction_failed", False),
    ("ERROR: unable to download video data: HTTP Error 403: Forbidden", "extraction_failed", False),
    ("ERROR: [youtube] abc: Requested format is not available. Use --list-formats for a list of available formats", "extraction_failed", False),
    ("ERROR: unable to write data: [Errno 28] No space left on device", "disk_full", False),
    ("ERROR: unable to open for writing: [Errno 13] Permission denied: '/root/x.mp4'", "permission", False),
    ("ERROR: unable to download video data: HTTP Error 429: Too Many Requests", "rate_limited", True),
    ("ERROR: unable to download video data: HTTP Error 503: Service Unavailable", "network", True),
    ("ERROR: unable to download video data: The read operation timed out", "network", True),
    ("ERROR: Proxy error: SOCKS5 proxy server sent invalid data", "proxy", False),
    ("ERROR: could not find chrome cookies database in /home/u/.config/google-chrome", "cookies", False),
    ("ERROR: Failed to decrypt with DPAPI. See  https://github.com/yt-dlp/yt-dlp/issues/10927  for more info", "cookies", False),
])
def test_real_messages_are_classified(text, code, retryable):
    info = classify_error(text)
    assert (info.code, info.retryable) == (code, retryable), info
    assert info.message and info.detail


def test_every_known_code_has_a_message_and_most_have_a_hint():
    for text in ("ERROR: x: Unable to download webpage: timed out", "ERROR: Sign in to confirm you're not a bot"):
        info = classify_error(text)
        assert info.hint and info.message


def test_error_lines_take_precedence_over_warnings():
    text = "WARNING: [youtube] Signature extraction failed\nWARNING: connection reset\nERROR: [generic] 'x' is not a valid URL"
    assert classify_error(text).code == "invalid_url"


def test_warnings_alone_are_still_classified_when_there_is_no_error_line():
    assert classify_error("WARNING: nsig extraction failed: Some formats may be missing").code == "extraction_failed"


def test_unrecognised_errors_are_shown_as_yt_dlp_said_them():
    info = classify_error("ERROR: something entirely new happened in the extractor")
    assert info.code == "unknown" and info.message == "something entirely new happened in the extractor" and not info.retryable


def test_silence_gets_a_generic_message_with_the_exit_code():
    info = classify_error("", returncode=7)
    assert info.code == "unknown" and "7" in info.message


def test_last_error_line_prefers_error_lines():
    assert last_error_line("a\nERROR: first\nb\nERROR: second\nc") == "second"
    assert last_error_line("only\nlines") == "lines" and last_error_line("") == ""


def test_spawn_errors():
    assert spawn_error(FileNotFoundError("yt-dlp")).code == "ytdlp_missing"
    assert spawn_error(PermissionError("x")).code == "permission" and spawn_error(OSError("boom")).code == "unknown"


def test_the_info_serialises_for_the_api():
    d = ErrorInfo("network", "m", "h", True, "d").to_dict()
    assert d == {"code": "network", "message": "m", "hint": "h", "retryable": True, "detail": "d"}


def test_a_very_long_error_line_is_trimmed():
    assert len(classify_error("ERROR: " + "x" * 5000).detail) <= 400
