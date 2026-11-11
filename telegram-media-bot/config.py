"""Settings from the environment (.env). Secrets are masked everywhere they could be printed."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Mapping


class ConfigError(ValueError):
    """A setting is missing or wrong. The message says which one and how to fix it."""


def _ids(raw: str | None, name: str) -> frozenset[int]:
    out: set[int] = set()
    for part in (raw or "").replace(";", ",").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            out.add(int(part))
        except ValueError:
            raise ConfigError(f"{name} must be a comma-separated list of numeric Telegram user ids (got {part!r}).") from None
    return frozenset(out)


@dataclass(frozen=True)
class Config:
    api_id: int
    api_hash: str = field(repr=False)
    bot_token: str = field(repr=False)
    storage_channel_id: int
    db_path: Path = Path("library.db")
    session_name: str = "media_bot"
    admin_ids: frozenset[int] = frozenset()
    allowed_user_ids: frozenset[int] = frozenset()  # empty: anyone who finds the bot may search
    results_per_page: int = 8
    episodes_per_page: int = 50
    send_cooldown: float = 2.0  # seconds between two files sent to the same person
    max_flood_wait: int = 300  # a Telegram flood wait longer than this (seconds) is reported instead of waited out
    reindex_gap: int = 300  # /reindex stops after this many consecutive empty message ids

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Config":
        e = os.environ if env is None else env
        missing = [k for k in ("API_ID", "API_HASH", "BOT_TOKEN", "STORAGE_CHANNEL_ID") if not (e.get(k) or "").strip()]
        if missing:
            raise ConfigError(f"Missing settings: {', '.join(missing)}. Copy .env.example to .env and fill them in (see README.md).")
        try:
            api_id = int(e["API_ID"])
        except ValueError:
            raise ConfigError("API_ID must be a number (from https://my.telegram.org).") from None
        try:
            channel = int(e["STORAGE_CHANNEL_ID"])
        except ValueError:
            raise ConfigError("STORAGE_CHANNEL_ID must be the channel's numeric id, such as -1001234567890.") from None
        if channel > -1000000000000:
            raise ConfigError("STORAGE_CHANNEL_ID must start with -100 (a channel id such as -1001234567890), not a user or group id.")
        token = e["BOT_TOKEN"].strip()
        if ":" not in token:
            raise ConfigError("BOT_TOKEN does not look like a token from @BotFather (it should contain a colon).")
        return cls(
            api_id=api_id, api_hash=e["API_HASH"].strip(), bot_token=token, storage_channel_id=channel,
            db_path=Path(e.get("DB_PATH") or "library.db"), session_name=e.get("SESSION_NAME") or "media_bot",
            admin_ids=_ids(e.get("ADMIN_IDS"), "ADMIN_IDS"), allowed_user_ids=_ids(e.get("ALLOWED_USER_IDS"), "ALLOWED_USER_IDS"),
        )

    def may_use(self, user_id: int | None) -> bool:
        if not self.allowed_user_ids:
            return True
        return user_id in self.allowed_user_ids or user_id in self.admin_ids

    def is_admin(self, user_id: int | None) -> bool:
        return user_id in self.admin_ids
