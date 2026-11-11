"""The inline-keyboard screens, as plain data. No Telegram objects here, so every screen can be tested.

A keyboard is a list of rows; a row is a list of `(label, callback_data)`. `bot.py` turns them into Telethon buttons.

Callback data is at most 64 bytes in Telegram, so it is a short code: `s:<token>:<page>` (a page of search results),
`m:<media>` (a title), `t:<media>:<season>:<page>` (a season's episodes; season `n` means "no season"),
`e:<media>:<season>:<episode>` (an episode; `n` for none), `q:<file>` (one specific file).
`decode` accepts only exactly these shapes: anything else, including anything a user could forge, is rejected.
"""
from __future__ import annotations

import html
import re
from typing import Iterable

Keyboard = list[list[tuple[str, str]]]

MAX_CALLBACK_BYTES = 64
MAX_BUTTONS = 100  # Telegram's limit per message
TYPE_ICON = {"Movie": "\U0001F3AC", "Anime": "\U0001F338", "Show": "\U0001F4FA"}
_TOKEN = re.compile(r"[0-9a-z]{1,12}")


def _part(value: int | None) -> str:
    return "n" if value is None else str(value)


def _unpart(text: str) -> int | None:
    return None if text == "n" else int(text)


def encode(action: str, *parts: int | str | None) -> str:
    data = ":".join([action, *[p if isinstance(p, str) else _part(p) for p in parts]])
    if len(data.encode()) > MAX_CALLBACK_BYTES:
        raise ValueError("callback data too long")
    return data


# re.ASCII: without it, \d also matches digits of other scripts (such as Arabic-Indic), which int() would happily accept
_SHAPES = {
    "s": re.compile(r"s:([0-9a-z]{1,12}):(\d{1,4})", re.ASCII),
    "m": re.compile(r"m:(\d{1,12})", re.ASCII),
    "t": re.compile(r"t:(\d{1,12}):(n|\d{1,4}):(\d{1,4})", re.ASCII),
    "e": re.compile(r"e:(\d{1,12}):(n|\d{1,4}):(n|\d{1,6})", re.ASCII),
    "q": re.compile(r"q:(\d{1,12})", re.ASCII),
    "x": re.compile(r"x", re.ASCII),  # a button that only shows a label (the "2/5" in the pager)
}


def decode(data: bytes | str | None) -> tuple[str, tuple] | None:
    """`(action, arguments)` for a well-formed callback, else None. Never raises."""
    try:
        text = data.decode("ascii") if isinstance(data, bytes) else data
        if not text:  # (no length check needed: the patterns below already cap every valid callback at 26 characters)
            return None
        shape = _SHAPES.get(text[0])
        match = shape.fullmatch(text) if shape else None
        if not match:
            return None
        action, args = text[0], match.groups()
        if action == "x":
            return action, ()
        if action == "s":
            return action, (args[0], int(args[1]))
        if action in "mq":
            return action, (int(args[0]),)
        if action == "t":
            return action, (int(args[0]), _unpart(args[1]), int(args[2]))
        return action, (int(args[0]), _unpart(args[1]), _unpart(args[2]))
    except (UnicodeDecodeError, ValueError, AttributeError):
        return None


def esc(text: object) -> str:
    """HTML-escape any text that came from a caption or a user. The bot sends with HTML formatting, so this is what keeps
    a title such as `<b>x</b> & *y*` from being interpreted."""
    return html.escape(str(text), quote=False)


def title_line(media: dict) -> str:
    year = f" ({media['release_year']})" if media.get("release_year") else ""
    return f"{esc(media['title'])}{year}"


def _label(text: str, limit: int = 60) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _grid(buttons: list[tuple[str, str]], per_row: int) -> Keyboard:
    return [buttons[i:i + per_row] for i in range(0, len(buttons), per_row)]


def _pager(prefix_prev: str | None, prefix_next: str | None, middle: str) -> list[tuple[str, str]]:
    row: list[tuple[str, str]] = []
    if prefix_prev:
        row.append(("‹ Prev", prefix_prev))
    row.append((middle, "x"))
    if prefix_next:
        row.append(("Next ›", prefix_next))
    return row


# ---- screens -------------------------------------------------------------------------------------------------------------
def search_screen(query: str, rows: list[dict], total: int, token: str, page: int, per_page: int) -> tuple[str, Keyboard]:
    if total == 0:
        return f"No titles match <b>{esc(query)}</b>.\nTry fewer or different words.", []
    pages = -(-total // per_page)
    text = f"Found <b>{total}</b> title{'s' if total != 1 else ''} for <b>{esc(query)}</b>."
    keyboard: Keyboard = []
    for row in rows:
        year = f" ({row['release_year']})" if row.get("release_year") else ""
        keyboard.append([(_label(f"{TYPE_ICON.get(row['type'], '')} {row['title']}{year}"), encode("m", row["id"]))])
    if pages > 1:
        keyboard.append(_pager(encode("s", token, page - 1) if page > 0 else None, encode("s", token, page + 1) if page + 1 < pages else None, f"{page + 1}/{pages}"))
    return text, keyboard


def media_header(media: dict) -> str:
    extra = f"\n<i>{esc(media['genre'])}</i>" if media.get("genre") else ""
    return f"<b>{title_line(media)}</b> · {esc(media['type'])}{extra}"


def seasons_screen(media: dict, seasons: list[dict], back: str | None) -> tuple[str, Keyboard]:
    buttons = []
    for s in seasons:
        name = "Episodes" if s["season_number"] is None else ("Specials" if s["season_number"] == 0 else f"Season {s['season_number']}")
        count = s["episodes"] or s["files"]
        buttons.append((f"{name} · {count}", encode("t", media["id"], s["season_number"], 0)))
    keyboard = _grid(buttons, 2)
    if back:
        keyboard.append([("‹ Back to results", back)])
    return f"{media_header(media)}\nChoose a season:", keyboard


def episodes_screen(media: dict, season: int | None, episodes: list[dict], total: int, page: int, per_page: int, has_seasons: bool) -> tuple[str, Keyboard]:
    buttons = []
    for ep in episodes:
        label = "File" if ep["episode_number"] is None else f"E{ep['episode_number']}"
        buttons.append((label, encode("e", media["id"], season, ep["episode_number"])))
    keyboard = _grid(buttons, 5)
    pages = max(1, -(-total // per_page))
    if pages > 1:
        keyboard.append(_pager(encode("t", media["id"], season, page - 1) if page > 0 else None,
                               encode("t", media["id"], season, page + 1) if page + 1 < pages else None, f"{page + 1}/{pages}"))
    keyboard.append([("‹ Back to seasons" if has_seasons else "‹ Back", encode("m", media["id"]))])
    season_name = "" if season is None else f" · Season {season}" if season else " · Specials"
    return f"{media_header(media)}{season_name}\nChoose an episode:", keyboard


def qualities_screen(media: dict, season: int | None, episode: int | None, files: Iterable[dict]) -> tuple[str, Keyboard]:
    seen: dict[str, int] = {}
    buttons = []
    for f in files:
        base = f["quality_resolution"] or "File"
        seen[base] = seen.get(base, 0) + 1
        label = base if seen[base] == 1 else f"{base} ({seen[base]})"
        buttons.append((_label(label), encode("q", f["id"])))
    where = "" if season is None and episode is None else f" · S{season or 0}E{episode}" if episode is not None else f" · Season {season}"
    back = encode("t", media["id"], season, 0) if episode is not None else encode("m", media["id"])
    return f"{media_header(media)}{where}\nChoose a quality:", _grid(buttons, 3) + [[("‹ Back", back)]]


def file_caption(file: dict) -> str:
    """The caption under a file the bot sends."""
    parts = [title_line(file)]
    if file.get("season_number") is not None and file.get("episode_number") is not None:
        parts.append(f"S{file['season_number']:02d}E{file['episode_number']:02d}")
    elif file.get("episode_number") is not None:
        parts.append(f"E{file['episode_number']}")
    if file.get("quality_resolution"):
        parts.append(esc(file["quality_resolution"]))
    return " · ".join(parts)


HELP_TEXT = (
    "<b>Media library</b>\n"
    "Send me part of a title, or use <code>/search attack titan</code>, and pick it from the list.\n"
    "Movies are sent straight away; shows and anime let you choose a season, then an episode."
)
