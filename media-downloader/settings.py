"""Saved settings (proxy, user agent, cookies, default folder). One small JSON file in the data folder, readable only by you.

A proxy address can contain a password, so it is stored but never sent back in clear: the interface receives `socks5://***@host:1080`,
and sending that same masked text back means "keep what is saved".
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

from options import OptionError, build_options, resolve_output_dir

KEYS = ("proxy", "user_agent", "cookies_from_browser", "cookies_file", "container", "embed_metadata")


def default_data_dir() -> Path:
    if os.environ.get("MD_DATA_DIR"):
        return Path(os.environ["MD_DATA_DIR"])
    return Path.home() / ".media-downloader"


def mask_proxy(proxy: str) -> str:
    if not proxy:
        return ""
    parts = urlsplit(proxy)
    if "@" not in parts.netloc:
        return proxy
    return urlunsplit((parts.scheme, "***@" + parts.netloc.rsplit("@", 1)[1], parts.path, parts.query, parts.fragment))


class SettingsStore:
    def __init__(self, data_dir: Path) -> None:
        self.data_dir = data_dir
        self.path = data_dir / "settings.json"
        self.cookies_path = data_dir / "cookies.txt"

    def load(self) -> dict[str, Any]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (FileNotFoundError, ValueError, OSError):
            return {}

    def _save(self, data: dict[str, Any]) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)
        os.replace(tmp, self.path)

    def default_output_dir(self) -> Path:
        saved = self.load().get("default_output_dir")
        return Path(saved) if saved else Path.home() / "Downloads"

    def options_layer(self) -> dict[str, Any]:
        """The saved options, ready to be the first layer of `build_options`."""
        data = self.load()
        return {k: data[k] for k in KEYS if k in data}

    def public(self) -> dict[str, Any]:
        data = self.load()
        return {"proxy": mask_proxy(data.get("proxy", "")), "user_agent": data.get("user_agent", ""),
                "cookies_from_browser": data.get("cookies_from_browser", ""), "cookies_file": data.get("cookies_file", ""),
                "cookies_uploaded": bool(data.get("cookies_file")) and Path(data["cookies_file"]) == self.cookies_path,
                "container": data.get("container", ""), "embed_metadata": data.get("embed_metadata", True),
                "default_output_dir": str(self.default_output_dir())}

    def update(self, incoming: dict[str, Any]) -> dict[str, Any]:
        """Validate and save. Raises OptionError (nothing is saved) if any value is not acceptable."""
        current = self.load()
        merged = dict(current)
        for key in (*KEYS, "default_output_dir"):
            if key not in incoming:
                continue
            value = incoming[key]
            if key == "proxy" and isinstance(value, str) and value and value == mask_proxy(current.get("proxy", "")):
                continue  # the masked text came back unchanged: keep the saved proxy (and its password)
            merged[key] = value
        # the two cookie sources exclude each other: whichever one this update sets replaces the other
        if "cookies_file" in incoming and "cookies_from_browser" not in incoming and merged.get("cookies_file"):
            merged["cookies_from_browser"] = ""
        elif "cookies_from_browser" in incoming and "cookies_file" not in incoming and merged.get("cookies_from_browser"):
            merged["cookies_file"] = ""
        build_options({k: merged[k] for k in KEYS if k in merged})  # raises OptionError for anything invalid, before anything is saved
        if merged.get("default_output_dir"):
            merged["default_output_dir"] = str(resolve_output_dir(merged["default_output_dir"], Path.home() / "Downloads"))
        self._save(merged)
        return self.public()

    def save_cookie_file(self, content: bytes) -> dict[str, Any]:
        if len(content) > 2 * 1024 * 1024:
            raise OptionError("The cookies file is larger than 2 MB.", "invalid_cookies")
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError:
            raise OptionError("That is not a text file.", "invalid_cookies", "Export cookies in Netscape format (cookies.txt).") from None
        lines = [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
        header = text.lstrip().startswith(("# Netscape HTTP Cookie File", "# HTTP Cookie File"))
        if not header and not any(len(ln.split("\t")) >= 7 for ln in lines):
            raise OptionError("That does not look like a cookies.txt file.", "invalid_cookies",
                              "Export it in Netscape format with a browser extension such as 'Get cookies.txt'.")
        self.data_dir.mkdir(parents=True, exist_ok=True)
        fd = os.open(self.cookies_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "wb") as fh:
            fh.write(content)
        return self.update({"cookies_file": str(self.cookies_path), "cookies_from_browser": ""})

    def delete_cookie_file(self) -> dict[str, Any]:
        self.cookies_path.unlink(missing_ok=True)
        data = self.load()
        if data.get("cookies_file") == str(self.cookies_path):
            data["cookies_file"] = ""
            self._save(data)
        return self.public()
