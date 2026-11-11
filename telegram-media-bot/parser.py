"""Turn a channel post's caption into clean, validated metadata.

Two caption styles are understood:

1. A YAML block between `---` lines (optionally inside a ``` code fence):

       ---
       title: "Attack on Titan"
       type: Anime
       year: 2013
       season: 1
       episode: 1
       resolution: 1080p
       genres: [Action, Fantasy]
       ---

2. Plain `Key: value` lines (`Title:`, `Type:`, `Year:`, `Season:`, `Episode:`, `Resolution:`) plus `#hashtags` as genres.

`parse_caption` always returns the *database* field names (`title`, `type`, `release_year`, `genre`, `season_number`,
`episode_number`, `quality_resolution`), with values cleaned and range-checked. Bad values are dropped, never stored: a wrong
season number would put an episode in the wrong place, which is worse than asking the uploader to fix the caption.
Only `yaml.safe_load` is used, so a caption cannot run code.
"""
from __future__ import annotations

import datetime
import re
from typing import Any

import yaml

MAX_TITLE = 200
MAX_QUALITY = 32
MAX_GENRE = 120
MIN_YEAR = 1880

TYPE_ALIASES = {
    "movie": "Movie", "film": "Movie", "movies": "Movie",
    "anime": "Anime",
    "show": "Show", "tv": "Show", "tv show": "Show", "tvshow": "Show", "series": "Show", "tv series": "Show",
}

# caption key (lower case) -> database field
KEY_ALIASES = {
    "title": "title", "name": "title",
    "type": "type", "kind": "type", "category": "type",
    "year": "release_year", "release_year": "release_year", "released": "release_year",
    "season": "season_number", "season_number": "season_number", "s": "season_number",
    "episode": "episode_number", "episode_number": "episode_number", "ep": "episode_number", "e": "episode_number",
    "resolution": "quality_resolution", "quality": "quality_resolution", "quality_resolution": "quality_resolution",
    "genre": "genre", "genres": "genre", "tags": "genre",
}

_FRONT_MATTER = re.compile(r"(?:^|\n)\s*---[ \t]*\n(.*?)\n\s*---[ \t]*(?:\n|$)", re.DOTALL)
_FENCE = re.compile(r"```[a-zA-Z]*\s*\n?")
_LEGACY = {
    "title": re.compile(r"^\s*title\s*:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE),
    "type": re.compile(r"^\s*type\s*:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE),
    "release_year": re.compile(r"^\s*year\s*:\s*(\d{4})\b", re.IGNORECASE | re.MULTILINE),
    "season_number": re.compile(r"^\s*season\s*:\s*(\d+)\b", re.IGNORECASE | re.MULTILINE),
    "episode_number": re.compile(r"^\s*episode\s*:\s*(\d+)\b", re.IGNORECASE | re.MULTILINE),
    "quality_resolution": re.compile(r"^\s*(?:resolution|quality)\s*:\s*(.+?)\s*$", re.IGNORECASE | re.MULTILINE),
}
_HASHTAG = re.compile(r"(?<!\w)#(\w+)", re.UNICODE)


def _clean_text(value: Any, limit: int) -> str | None:
    if value is None or isinstance(value, (dict, list, bool)):
        return None
    text = re.sub(r"\s+", " ", str(value).replace(" ", " ")).strip()
    text = text.strip("\"'“”‘’").strip()  # straight and curly quotes around a value
    return text[:limit] or None


def _clean_int(value: Any, low: int, high: int) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, float):
        value = int(value) if value.is_integer() else None
    if isinstance(value, str):
        value = int(value.strip()) if re.fullmatch(r"\s*\d{1,5}\s*", value) else None
    if not isinstance(value, int):
        return None
    return value if low <= value <= high else None


def normalize_type(value: Any) -> str | None:
    text = _clean_text(value, 20)
    return TYPE_ALIASES.get(text.lower()) if text else None


def normalize_resolution(value: Any) -> str | None:
    """`1080P` -> `1080p`, `4k` -> `4K`, `1080` -> `1080p`; anything else (such as `1080p Dub`) is kept as written."""
    text = _clean_text(value, MAX_QUALITY)
    if not text:
        return None
    if re.fullmatch(r"\d{3,4}", text):
        return f"{text}p"
    return re.sub(r"\b(\d{3,4})[pP]\b", lambda m: f"{m.group(1)}p", re.sub(r"\b4[kK]\b", "4K", text))


def _normalize_genre(value: Any) -> str | None:
    if isinstance(value, (list, tuple)):
        parts = [_clean_text(v, 40) for v in value]
    else:
        parts = [_clean_text(p, 40) for p in re.split(r"[,;/|]", str(value))] if value is not None else []
    seen: list[str] = []
    for part in parts:
        if part and part.lower() not in (s.lower() for s in seen):
            seen.append(part)
    return ", ".join(seen)[:MAX_GENRE] or None


def _normalize(raw: dict[str, Any], today: datetime.date | None = None) -> dict[str, Any]:
    this_year = (today or datetime.date.today()).year
    out: dict[str, Any] = {}
    fields: dict[str, Any] = {}
    for key, value in raw.items():
        field = KEY_ALIASES.get(str(key).strip().lower())
        if field and field not in fields:  # the first spelling wins if a caption uses two
            fields[field] = value
    if (title := _clean_text(fields.get("title"), MAX_TITLE)):
        out["title"] = title
    if (kind := normalize_type(fields.get("type"))):
        out["type"] = kind
    if (year := _clean_int(fields.get("release_year"), MIN_YEAR, this_year + 5)) is not None:
        out["release_year"] = year
    if (season := _clean_int(fields.get("season_number"), 0, 999)) is not None:
        out["season_number"] = season
    if (episode := _clean_int(fields.get("episode_number"), 0, 99999)) is not None:
        out["episode_number"] = episode
    if (quality := normalize_resolution(fields.get("quality_resolution"))):
        out["quality_resolution"] = quality
    if (genre := _normalize_genre(fields.get("genre"))):
        out["genre"] = genre
    return out


def _has_known_key(data: dict[Any, Any]) -> bool:
    return any(KEY_ALIASES.get(str(k).strip().lower()) for k in data)


def _yaml_block(caption: str) -> dict[str, Any] | None:
    """The first `---` block that is valid YAML *and* uses at least one key we know (so a block of unrelated notes is skipped)."""
    text = _FENCE.sub("\n", caption)  # ```yaml ... ``` fences are tolerated
    for match in _FRONT_MATTER.finditer(text):
        try:
            data = yaml.safe_load(match.group(1))
        except yaml.YAMLError:
            continue
        if isinstance(data, dict) and _has_known_key(data):
            return data
    return None


# a value that starts like this was meant as YAML structure (a tag, an anchor, a list...), not as a plain title
_YAML_INDICATORS = ("!", "&", "*", "[", "{", "|", ">", "%", "@", "`")


def _legacy(text: str, plain_only: bool = False) -> dict[str, Any]:
    raw: dict[str, Any] = {}
    for field, pattern in _LEGACY.items():
        match = pattern.search(text)
        if match and not (plain_only and match.group(1).lstrip().startswith(_YAML_INDICATORS)):
            raw[field] = match.group(1)
    return raw


def _fallback(caption: str) -> dict[str, Any]:
    """`Key: value` lines, for captions without a usable YAML block. Lines outside `---` blocks are tried first; the content of
    blocks that failed to parse is used only if it adds a title, and never when a value looks like broken YAML."""
    text = _FENCE.sub("\n", caption)
    raw = _legacy(_FRONT_MATTER.sub("\n", text))
    if "title" not in raw:
        inside = "\n".join(m.group(1) for m in _FRONT_MATTER.finditer(text))
        raw = {**_legacy(inside, plain_only=True), **raw}
    tags = _HASHTAG.findall(caption)
    if tags:
        raw["genre"] = tags
    return raw


def parse_caption(caption: str | None, today: datetime.date | None = None) -> dict[str, Any]:
    """Metadata found in `caption`, as database fields. Empty dict if the caption has none. Never raises."""
    if not caption or not isinstance(caption, str):
        return {}
    caption = caption.replace("\r\n", "\n").replace("\r", "\n")
    try:
        raw = _yaml_block(caption) or _fallback(caption)
        meta = _normalize(raw, today)
        if "genre" not in meta:  # hashtags still count as genres when the YAML block has none
            tags = _normalize_genre(_HASHTAG.findall(caption))
            if tags:
                meta["genre"] = tags
        return meta
    except Exception:  # noqa: BLE001 - a hostile or odd caption must never stop the ingestion loop
        return {}


def complete_metadata(meta: dict[str, Any]) -> tuple[dict[str, Any] | None, list[str]]:
    """Make `meta` ready to store: a title is required. A missing type is inferred (Show if it has a season or episode,
    otherwise Movie; Anime is never guessed) and the inference is reported in the notes. Episodes without a season are
    put in season 1."""
    notes: list[str] = []
    if "title" not in meta:
        return None, ["no title"]
    ready = dict(meta)
    has_ep = "season_number" in ready or "episode_number" in ready
    if "type" not in ready:
        ready["type"] = "Show" if has_ep else "Movie"
        notes.append(f"type missing, assumed {ready['type']}")
    if "episode_number" in ready and "season_number" not in ready:
        ready["season_number"] = 1
        notes.append("season missing, assumed 1")
    if ready["type"] == "Movie":
        ready.pop("season_number", None)
        ready.pop("episode_number", None)
    return ready, notes
