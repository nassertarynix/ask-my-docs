"""Settings from environment variables, and the small JSON file that remembers the Telegram connection.

Secrets (bot token, API hash) are stored only in `config.json` inside the data folder, created with owner-only
permissions (0600). They are never returned by the API and never logged. An OS keychain would be better; that is listed
as a limitation in the README.
"""
from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

from .chunker import DEFAULT_CHUNK_SIZE, check_chunk_size

SECRET_FIELDS = ("api_hash", "bot_token")


def default_data_dir() -> Path:
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
    return base / "telegram-cloud-storage"


@dataclass
class Settings:
    data_dir: Path = field(default_factory=default_data_dir)
    host: str = "127.0.0.1"
    port: int = 8765
    token: str = ""
    chunk_size: int = DEFAULT_CHUNK_SIZE
    max_upload_bytes: int = 20 * 1024**3
    connect_timeout: float = 20.0  # seconds to wait for Telegram before reporting "could not connect" (the app stays usable)
    backend: str = "telegram"  # "telegram" or "local" (a folder standing in for the channel: tests, development, demos)
    local_dir: Path | None = None
    local_throttle: float | None = None  # bytes/second, demos only
    allowed_origins: tuple[str, ...] = (
        "tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://localhost:1420", "http://127.0.0.1:1420",
    )

    @property
    def db_path(self) -> Path:
        return self.data_dir / "index.db"

    @property
    def spool_dir(self) -> Path:
        return self.data_dir / "spool"

    @property
    def session_path(self) -> Path:
        return self.data_dir / "telegram.session"

    @property
    def config_path(self) -> Path:
        return self.data_dir / "config.json"

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "Settings":
        e = os.environ if env is None else env
        s = cls()
        if e.get("TGCS_DATA_DIR"):
            s.data_dir = Path(e["TGCS_DATA_DIR"])
        s.host = "127.0.0.1"  # not configurable on purpose: the API has no login and must never leave this machine
        s.port = int(e.get("TGCS_PORT", s.port))
        s.token = e.get("TGCS_TOKEN", "")
        if e.get("TGCS_CHUNK_MB"):
            s.chunk_size = check_chunk_size(int(float(e["TGCS_CHUNK_MB"]) * 1024 * 1024))
        if e.get("TGCS_MAX_UPLOAD_GB"):
            s.max_upload_bytes = int(float(e["TGCS_MAX_UPLOAD_GB"]) * 1024**3)
        s.backend = e.get("TGCS_BACKEND", s.backend)
        if s.backend not in ("telegram", "local"):
            raise ValueError("TGCS_BACKEND must be 'telegram' or 'local'")
        if e.get("TGCS_LOCAL_DIR"):
            s.local_dir = Path(e["TGCS_LOCAL_DIR"])
        if e.get("TGCS_LOCAL_THROTTLE_KBPS"):
            s.local_throttle = float(e["TGCS_LOCAL_THROTTLE_KBPS"]) * 1024
        if e.get("TGCS_ALLOWED_ORIGINS"):
            s.allowed_origins = tuple(o.strip() for o in e["TGCS_ALLOWED_ORIGINS"].split(",") if o.strip())
        return s


class ConfigStore:
    """Telegram connection details. `public()` is what the API may show: secrets are reported only as set / not set."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> dict:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except (FileNotFoundError, ValueError):
            return {}

    def save(self, values: dict) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(values, fh, indent=2)
        os.replace(tmp, self.path)

    def update(self, **values) -> dict:
        merged = {**self.load(), **{k: v for k, v in values.items() if v is not None}}
        self.save(merged)
        return merged

    def public(self) -> dict:
        data = self.load()
        shown = {k: v for k, v in data.items() if k not in SECRET_FIELDS}
        for key in SECRET_FIELDS:
            shown[f"{key}_set"] = bool(data.get(key))
        return shown
