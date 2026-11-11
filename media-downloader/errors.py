"""Turn yt-dlp's error text into something a person can act on.

yt-dlp reports problems as free text on stderr (`ERROR: ...`). The rules below match the messages that actually occur and
give each a stable `code` (for the interface and for tests), a plain-language message, a hint about what to do, and whether
retrying the same request could help. Anything unrecognised is shown as yt-dlp said it, never hidden.
"""
from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class ErrorInfo:
    code: str
    message: str
    hint: str = ""
    retryable: bool = False  # a retry of the same command might succeed (network drops), as opposed to "wrong URL"
    detail: str = ""  # the last relevant line from yt-dlp, trimmed

    def to_dict(self) -> dict:
        return {"code": self.code, "message": self.message, "hint": self.hint, "retryable": self.retryable, "detail": self.detail}


# (code, regex, message, hint, retryable). First match wins, so the specific rules come before the general ones.
_RULES: list[tuple[str, str, str, str, bool]] = [
    ("ffmpeg_missing", r"ffprobe and ffmpeg not found|ffmpeg(?:/avconv)? (?:is )?not (?:found|installed)|ffmpeg.*not found.*install|Postprocessing: .*(?:ffmpeg|ffprobe).*not found",
     "FFmpeg is not installed, so this download cannot be finished.",
     "Install FFmpeg and make sure it is on your PATH (see the README), then try again.", False),
    ("bot_check", r"Sign in to confirm .{0,3}you.{0,3}re not a bot|confirm you.{0,3}re not a bot",
     "YouTube is asking this connection to prove it is not a bot.",
     "Open Advanced settings and use your browser's cookies (or a cookies file), or try a different network or proxy.", False),
    ("age_restricted", r"Sign in to confirm your age|age-restricted|age restricted|inappropriate for some users",
     "This video is age-restricted and needs a signed-in account.",
     "Use your browser's cookies in Advanced settings while signed in to an account that may watch it.", False),
    ("private", r"Private video|This video is private|members-only|Join this channel|requires? (?:a )?(?:subscription|membership)|Sign in if you've been granted access",
     "This video is private or limited to members.",
     "Only the owner or members can watch it. If your account can, use your browser's cookies.", False),
    ("geo_blocked", r"not (?:made this video )?available in your country|geo.?restrict|blocked it in your country|uploader has not made this video available",
     "This video is not available in your country.",
     "A proxy in another country (Advanced settings) may help, if that is allowed for you.", False),
    ("unavailable", r"Video unavailable|has been removed|no longer available|This video is not available|account.{0,30}terminated|copyright claim|does not exist|HTTP Error 404|HTTP Error 410",
     "The video is unavailable or has been removed.",
     "Check that the link is right and that the video still exists.", False),
    ("invalid_url", r"is not a valid URL|Unsupported URL|Invalid URL|No such file or directory.*http|unable to extract.*(?:uploader|video id)|URL.*(?:malformed|invalid)",
     "That link is not supported.",
     "Paste a full video or playlist link (https://...). Pages without an embedded video cannot be downloaded.", False),
    ("extraction_failed", r"[Ss]ignature extraction failed|nsig extraction failed|Unable to extract|unable to extract|player response|Failed to extract|JSON.{0,30}(?:Expecting|decode)|Did not get any data blocks|HTTP Error 403|Requested format is not available|requested format not available|No video formats found|Only images are available",
     "yt-dlp could not read this video. This usually means the site changed or the format is not available.",
     "Update yt-dlp (Advanced settings, then Update yt-dlp) and try again. If it still fails, choose a different quality.", False),
    ("disk_full", r"No space left on device|\[Errno 28\]|disk (?:is )?full",
     "The disk is full.", "Free some space or choose another folder.", False),
    ("permission", r"Permission denied|\[Errno 13\]|Read-only file system|Operation not permitted",
     "The download folder is not writable.", "Choose a folder you can write to.", False),
    ("rate_limited", r"HTTP Error 429|Too Many Requests|rate.?limit",
     "The site is limiting how fast you can download.",
     "Wait a few minutes and try again, or use a proxy.", True),
    ("network", r"Unable to download|Connection (?:refused|reset|aborted|timed out)|Temporary failure in name resolution|Name or service not known|Network is unreachable|timed out|Timeout|TransportError|Remote end closed|IncompleteRead|SSL:|certificate verify failed|HTTP Error 5\d\d|Read timed out|getaddrinfo failed|\[Errno -?\d+\]|connection broken|Got error",
     "The connection failed or dropped.",
     "Check your internet connection (and proxy, if you use one). Downloads resume from where they stopped.", True),
    ("proxy", r"Proxy|proxy|SOCKS|socks",
     "The proxy could not be used.", "Check the proxy address in Advanced settings.", False),
    ("cookies", r"cookies?.{0,40}(?:could not|cannot|failed|not found|unable|no such|decrypt|locked)|[Cc]ould not (?:find|copy|read).{0,40}(?:cookie|browser)|Failed to decrypt|DPAPI|cookies? database|Failed to (?:read|load|parse).{0,20}cookie|keyring|Keychain",
     "The browser cookies could not be read.",
     "Close the browser (it can lock its cookie database), check the browser name, or upload a cookies file instead.", False),
    ("ytdlp_missing", r"yt-dlp.{0,20}(?:not found|is not installed)|No module named .?yt_dlp",
     "yt-dlp is not installed.", "Run: pip install yt-dlp (or install it from your package manager).", False),
]
_COMPILED = [(code, re.compile(pattern), message, hint, retry) for code, pattern, message, hint, retry in _RULES]
_ERROR_LINE = re.compile(r"^\s*(?:ERROR|error):\s*(.*)$")


def last_error_line(text: str) -> str:
    """The most useful line of stderr: the last `ERROR:` line, else the last non-empty line."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    for line in reversed(lines):
        match = _ERROR_LINE.match(line)
        if match:
            return match.group(1)
    return lines[-1] if lines else ""


def classify_error(text: str, *, returncode: int | None = None) -> ErrorInfo:
    """Classify yt-dlp's stderr. Matching runs against the ERROR lines first (warnings can mention the same words)."""
    errors_only = "\n".join(ln for ln in text.splitlines() if _ERROR_LINE.match(ln))
    detail = last_error_line(text)[:400]
    for haystack in (errors_only, text):
        if not haystack.strip():
            continue
        for code, pattern, message, hint, retryable in _COMPILED:
            if pattern.search(haystack):
                return ErrorInfo(code, message, hint, retryable, detail)
    if not detail:
        suffix = f" (exit code {returncode})" if returncode is not None else ""
        return ErrorInfo("unknown", f"yt-dlp stopped without saying why{suffix}.", "Try again, or update yt-dlp in Advanced settings.", False, "")
    return ErrorInfo("unknown", detail, "If this keeps happening, update yt-dlp in Advanced settings.", False, detail)


def spawn_error(exc: BaseException) -> ErrorInfo:
    """The process itself could not be started."""
    if isinstance(exc, FileNotFoundError):
        return ErrorInfo("ytdlp_missing", "yt-dlp was not found.", "Run: pip install yt-dlp (or install it from your package manager).", False, str(exc))
    if isinstance(exc, PermissionError):
        return ErrorInfo("permission", "yt-dlp could not be started (permission denied).", "Check the file permissions of the yt-dlp program.", False, str(exc))
    return ErrorInfo("unknown", f"yt-dlp could not be started: {exc}", "", False, str(exc))
