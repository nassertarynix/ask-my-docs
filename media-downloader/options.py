"""Validate everything a person can type or select, and turn it into yt-dlp arguments.

The rule that matters: **user input never becomes a command-line flag.** Every value is passed as `--flag=value` (one argument, so a
value that starts with `-` cannot be read as another option), URLs come after a `--` separator, only http(s) links are accepted,
and free-text settings (proxy, user agent, cookie path, format expression) are checked against strict patterns first. There is no
way to pass arbitrary yt-dlp arguments, in particular none of the options that run commands (`--exec` and friends).
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Iterable, Mapping
from urllib.parse import urlparse

SEP = "\x1f"  # separates the fields of the progress lines we ask yt-dlp to print
AUDIO_FORMATS = ("mp3", "m4a", "flac", "opus", "wav", "aac", "vorbis")
LOSSY_AUDIO = ("mp3", "m4a", "aac", "opus", "vorbis")
CONTAINERS = ("", "mp4", "mkv", "webm")
BROWSERS = ("brave", "chrome", "chromium", "edge", "firefox", "opera", "safari", "vivaldi", "whale")
PROXY_SCHEMES = ("http", "https", "socks4", "socks4a", "socks5", "socks5h")
DEFAULT_VIDEO_FORMAT = "bv*+ba/b"
DEFAULT_AUDIO_FORMAT = "ba/b"
MAX_URL = 2048

_FORMAT = re.compile(r"[A-Za-z0-9_\-+*/\[\]<>=!^$.,:&|()~?'\"]{1,300}")
_PROFILE = re.compile(r"[A-Za-z0-9 ._\-]{1,64}")
_PLAYLIST_ITEMS = re.compile(r"[0-9]{1,6}(?:[:\-][0-9]{0,6})?(?:,[0-9]{1,6}(?:[:\-][0-9]{0,6})?){0,199}")
_BARE_HOST = re.compile(r"[A-Za-z0-9][A-Za-z0-9.\-]*\.[A-Za-z]{2,}(?:[:/?#]|$)")


class OptionError(ValueError):
    """A value is not acceptable. `code` and `hint` are shown to the user."""

    def __init__(self, message: str, code: str = "invalid_option", hint: str = "") -> None:
        super().__init__(message)
        self.code, self.hint = code, hint


# ---- single values -------------------------------------------------------------------------------------------------------------
def validate_url(raw: Any) -> str:
    url = str(raw or "").strip()
    if not url:
        raise OptionError("Paste a link first.", "invalid_url")
    if "://" not in url and _BARE_HOST.match(url):
        url = "https://" + url  # "youtube.com/watch?v=..." without the scheme
    if len(url) > MAX_URL or any(ord(c) <= 32 or ord(c) == 127 for c in url):
        raise OptionError("That is not a valid link (it contains spaces or is too long).", "invalid_url")
    parsed = urlparse(url)
    if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname:
        raise OptionError("Only http and https links are supported.", "invalid_url", "Paste a full link that starts with https://")
    return url


def validate_format_selection(raw: Any, default: str) -> str:
    text = str(raw or "").strip() or default
    if text.startswith("-") or not _FORMAT.fullmatch(text):  # no real format expression starts with a dash
        raise OptionError("That format selection is not valid.", "invalid_format", "Pick a quality from the list.")
    return text


def validate_audio_format(raw: Any) -> str:
    text = str(raw or "mp3").strip().lower()
    if text not in AUDIO_FORMATS:
        raise OptionError(f"Audio format must be one of: {', '.join(AUDIO_FORMATS)}.", "invalid_format")
    return text


def validate_proxy(raw: Any) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""
    if len(text) > 300 or any(ord(c) <= 32 or ord(c) == 127 for c in text):
        raise OptionError("The proxy address is not valid.", "invalid_proxy")
    parsed = urlparse(text if "://" in text else "http://" + text)
    if parsed.scheme.lower() not in PROXY_SCHEMES or not parsed.hostname:
        raise OptionError(f"The proxy must look like http://host:port or socks5://host:port.", "invalid_proxy",
                          f"Allowed types: {', '.join(PROXY_SCHEMES)}.")
    try:
        parsed.port  # noqa: B018 - raises ValueError for a bad port
    except ValueError:
        raise OptionError("The proxy port is not valid.", "invalid_proxy") from None
    return text if "://" in text else "http://" + text


def validate_user_agent(raw: Any) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""
    if len(text) > 300 or any(not 32 <= ord(c) <= 126 for c in text):
        raise OptionError("The user agent must be plain text up to 300 characters.", "invalid_user_agent")
    return text


def validate_browser(raw: Any) -> str:
    """`chrome` or `chrome:Profile 1`."""
    text = str(raw or "").strip()
    if not text:
        return ""
    browser, _, profile = text.partition(":")
    if browser.lower() not in BROWSERS:
        raise OptionError(f"The browser must be one of: {', '.join(BROWSERS)}.", "invalid_cookies")
    if profile and not _PROFILE.fullmatch(profile):
        raise OptionError("The browser profile name contains characters that are not allowed.", "invalid_cookies")
    return browser.lower() + (":" + profile if profile else "")


def validate_cookie_file(raw: Any) -> str:
    text = str(raw or "").strip()
    if not text:
        return ""
    if "\x00" in text:
        raise OptionError("The cookies file path is not valid.", "invalid_cookies")
    path = Path(os.path.expanduser(text))
    if not path.is_absolute():
        raise OptionError("The cookies file path must be absolute.", "invalid_cookies")
    if not path.is_file():
        raise OptionError("The cookies file was not found.", "invalid_cookies", "Check the path, or upload the file instead.")
    if path.stat().st_size > 5 * 1024 * 1024:
        raise OptionError("The cookies file is larger than 5 MB.", "invalid_cookies")
    if not os.access(path, os.R_OK):
        raise OptionError("The cookies file cannot be read.", "invalid_cookies")
    return str(path)


def validate_playlist_items(raw: Any) -> str:
    text = str(raw or "").strip().replace(" ", "")
    if not text:
        return ""
    if not _PLAYLIST_ITEMS.fullmatch(text):
        raise OptionError("Playlist items must look like 1-3,5,8.", "invalid_option")
    return text


def validate_container(raw: Any) -> str:
    text = str(raw or "").strip().lower()
    if text not in CONTAINERS:
        raise OptionError("The container must be mp4, mkv or webm.", "invalid_option")
    return text


def resolve_output_dir(raw: Any, default: Path) -> Path:
    """An absolute, existing (or creatable) and writable folder."""
    text = str(raw or "").strip() or str(default)
    if "\x00" in text:
        raise OptionError("The folder path is not valid.", "invalid_path")
    path = Path(os.path.expanduser(text))
    if not path.is_absolute():
        raise OptionError("The download folder must be an absolute path.", "invalid_path", "For example /home/you/Videos or C:\\Users\\you\\Videos.")
    path = path.resolve()
    if path.exists() and not path.is_dir():
        raise OptionError("That path is a file, not a folder.", "invalid_path")
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise OptionError(f"The folder cannot be created: {exc.strerror or exc}.", "permission", "Choose a folder you can write to.") from None
    if not os.access(path, os.W_OK | os.X_OK):
        raise OptionError("The folder is not writable.", "permission", "Choose a folder you can write to.")
    return path


# ---- the options bundle ----------------------------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Options:
    proxy: str = ""
    user_agent: str = ""
    cookies_from_browser: str = ""
    cookies_file: str = ""
    no_playlist: bool = False
    playlist_items: str = ""
    container: str = ""
    embed_metadata: bool = True

    def public(self) -> dict:
        return {"proxy": bool(self.proxy), "user_agent": bool(self.user_agent), "cookies": "browser" if self.cookies_from_browser else "file" if self.cookies_file else "none"}


_VALIDATORS = {"proxy": validate_proxy, "user_agent": validate_user_agent, "cookies_from_browser": validate_browser,
               "cookies_file": validate_cookie_file, "playlist_items": validate_playlist_items, "container": validate_container}


def _truthy(value: Any) -> bool:
    return value is True or (isinstance(value, str) and value.lower() in ("1", "true", "yes", "on"))


def build_options(*layers: Mapping[str, Any] | None) -> Options:
    """Merge settings layers (later ones win; an empty value in a later layer clears an earlier one) and validate the result.
    Unknown keys are rejected, so a typo or a smuggled option cannot be ignored silently."""
    merged: dict[str, Any] = {}
    for layer in layers:
        for key, value in (layer or {}).items():
            if key not in _VALIDATORS and key not in ("no_playlist", "embed_metadata"):
                raise OptionError(f"Unknown option: {str(key)[:40]}.", "invalid_option")
            merged[key] = value
    clean: dict[str, Any] = {key: fn(merged[key]) for key, fn in _VALIDATORS.items() if key in merged}
    for flag in ("no_playlist", "embed_metadata"):
        if flag in merged:
            clean[flag] = _truthy(merged[flag])
    options = Options(**clean)
    if options.cookies_from_browser and options.cookies_file:
        raise OptionError("Use either browser cookies or a cookies file, not both.", "invalid_cookies")
    return options


# ---- command lines -----------------------------------------------------------------------------------------------------------------
def common_args(o: Options) -> list[str]:
    args = [
        "--ignore-config",  # never read the user's own yt-dlp.conf: predictable behaviour, and no surprise --exec lines
        "--no-colors", "--socket-timeout=30", "--retries=10", "--fragment-retries=10", "--extractor-retries=3",
        "--retry-sleep=http:exp=1:20", "--retry-sleep=fragment:exp=1:20",
    ]
    if o.proxy:
        args.append(f"--proxy={o.proxy}")
    if o.user_agent:
        args.append(f"--user-agent={o.user_agent}")
    if o.cookies_from_browser:
        args.append(f"--cookies-from-browser={o.cookies_from_browser}")
    if o.cookies_file:
        args.append(f"--cookies={o.cookies_file}")
    if o.no_playlist:
        args.append("--no-playlist")
    return args


def info_command(ytdlp: list[str], url: str, o: Options, playlist_cap: int = 500) -> list[str]:
    """One call for both cases. `--flat-playlist` lists a playlist's items without resolving each video's formats (fast), and
    leaves a single video untouched, so `--dump-single-json` returns full format details for a video and a quick list for a playlist."""
    return [*ytdlp, *common_args(o), "--flat-playlist", f"--playlist-end={playlist_cap}", "--dump-single-json", "--skip-download", "--", url]


DOWNLOAD_TEMPLATE = "download:" + SEP.join(["PROG", "%(progress.status)s", "%(progress.downloaded_bytes)s", "%(progress.total_bytes)s",
                                           "%(progress.total_bytes_estimate)s", "%(progress.speed)s", "%(progress.eta)s",
                                           "%(info.playlist_index)s", "%(info.n_entries)s", "%(info.title)s"])
POSTPROCESS_TEMPLATE = "postprocess:" + SEP.join(["PP", "%(progress.status)s", "%(progress.postprocessor)s", "%(info.playlist_index)s",
                                                 "%(info.n_entries)s", "%(info.title)s"])
DONE_TEMPLATE = "after_move:" + SEP.join(["DONE", "%(filepath)s"])
# a single video goes straight into the chosen folder; the items of a playlist go into a folder named after the playlist
# (a "/" produced by a field's own replacement text would be sanitised away, so the two cases use two templates)
OUTPUT_SINGLE = "%(title).200B [%(id)s].%(ext)s"
OUTPUT_PLAYLIST = "%(playlist_title|Playlist).150B/%(playlist_index)03d - %(title).150B [%(id)s].%(ext)s"


def download_command(ytdlp: list[str], url: str, o: Options, *, format_selection: str, output_dir: Path, temp_dir: Path,
                     extract_audio: bool, audio_format: str, playlist: bool = False) -> list[str]:
    args = [*ytdlp, *common_args(o), "--newline", "--progress", "--no-simulate", "--no-overwrites", "--concurrent-fragments=4",
            f"--progress-template={DOWNLOAD_TEMPLATE}", f"--progress-template={POSTPROCESS_TEMPLATE}", f"--print={DONE_TEMPLATE}",
            f"--paths=home:{output_dir}", f"--paths=temp:{temp_dir}",  # partial files stay in temp_dir, so a cancel can delete them all
            f"--output={OUTPUT_PLAYLIST if playlist else OUTPUT_SINGLE}", f"--format={format_selection}"]
    if o.playlist_items:
        args.append(f"--playlist-items={o.playlist_items}")
    if extract_audio:
        args += ["--extract-audio", f"--audio-format={audio_format}"]
        if audio_format in LOSSY_AUDIO:
            args.append("--audio-quality=0")  # best quality for the codec
    elif o.container:
        args.append(f"--merge-output-format={o.container}")
    if o.embed_metadata:
        args.append("--embed-metadata")
    return [*args, "--", url]


def preset_format(height: int | None) -> str:
    """The format expression for "best up to this height". `<=?` (not `<=`) keeps formats whose height is unknown, such as plain media
    files: with `<=` they would all be excluded and the download would fail with "Requested format is not available"."""
    if not height:
        return DEFAULT_VIDEO_FORMAT
    return f"bv*[height<=?{int(height)}]+ba/b[height<=?{int(height)}]"
