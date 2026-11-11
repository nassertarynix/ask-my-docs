import hashlib
import io

import pytest
from starlette.testclient import TestClient

from backend.config import Settings
from backend.main import create_app
from conftest import SMALL_CHUNK as CS, TOKEN
from test_telegram_client import FakeClient
from backend.telegram_client import TelethonBackend

BASE = "http://127.0.0.1:8765"
AUTH = {"X-TGCS-Token": TOKEN}


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings), base_url=BASE, headers=AUTH) as c:
        yield c


def data(n, seed=3):
    return bytes((i * seed + i // 250) % 256 for i in range(n))


def put(client, name, body, **params):
    return client.post("/api/upload", params={"name": name, **params}, content=body)


def spool_files(settings):
    return list(settings.spool_dir.iterdir())


# ---- guard: token, host, origin ------------------------------------------------------------------------------------------
def test_health_needs_no_token_but_everything_else_does(settings):
    with TestClient(create_app(settings), base_url=BASE) as c:
        assert c.get("/api/health").json() == {"ok": True}
        for path in ("/api/status", "/api/folders", "/api/tree"):
            r = c.get(path)
            assert r.status_code == 401 and r.json()["error"]["code"] == "unauthorized"
        assert c.get("/api/status", headers={"X-TGCS-Token": "wrong" * 5}).status_code == 401
        assert c.post("/api/folders", json={"name": "x"}).status_code == 401
        assert c.request("DELETE", "/api/items", json={"file_ids": [1]}).status_code == 401
        assert c.get("/api/status", headers=AUTH).status_code == 200
        assert c.get(f"/api/status?token={TOKEN}").status_code == 200  # downloads and the socket cannot set headers


def test_a_request_for_another_host_name_is_refused_even_with_the_token(settings):
    with TestClient(create_app(settings), base_url="http://evil.example:8765", headers=AUTH) as c:
        r = c.get("/api/status")
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden_host"


def test_a_foreign_browser_origin_is_refused_but_the_app_origins_are_allowed(client):
    assert client.get("/api/status", headers={"Origin": "https://evil.example"}).status_code == 403
    assert client.get("/api/status", headers={"Origin": "null"}).status_code == 403
    ok = client.get("/api/status", headers={"Origin": "tauri://localhost"})
    assert ok.status_code == 200 and ok.headers["access-control-allow-origin"] == "tauri://localhost"
    assert client.get("/api/status", headers={"Origin": "http://localhost:1420"}).status_code == 200


def test_cors_preflight_works_for_the_app_and_not_for_strangers(client):
    pre = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "x-tgcs-token,content-type"}
    good = client.options("/api/folders", headers={**pre, "Origin": "tauri://localhost"})
    assert good.status_code == 200 and "x-tgcs-token" in good.headers["access-control-allow-headers"].lower()
    assert client.options("/api/folders", headers={**pre, "Origin": "https://evil.example"}).status_code in (400, 403)


def test_the_server_refuses_to_start_without_a_real_secret(settings):
    settings.token = "short"
    with pytest.raises(ValueError):
        create_app(settings)


def test_the_host_cannot_be_configured_away_from_loopback():
    assert Settings.from_env({"TGCS_HOST": "0.0.0.0"}).host == "127.0.0.1"


# ---- folders ---------------------------------------------------------------------------------------------------------------
def test_folder_create_list_tree_and_errors(client):
    a = client.post("/api/folders", json={"name": "Photos"})
    assert a.status_code == 201
    b = client.post("/api/folders", json={"name": "2026", "parent_id": a.json()["id"]}).json()
    assert [f["name"] for f in client.get("/api/folders").json()["folders"]] == ["Photos"]
    inner = client.get("/api/folders", params={"parent_id": a.json()["id"]}).json()
    assert [f["name"] for f in inner["folders"]] == ["2026"] and [c["name"] for c in inner["breadcrumbs"]] == ["Photos"]
    assert {(f["name"], f["parent_id"]) for f in client.get("/api/tree").json()["folders"]} == {("Photos", None), ("2026", a.json()["id"])}
    dup = client.post("/api/folders", json={"name": "photos"})
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "name_exists"
    assert client.post("/api/folders", json={"name": "a/b"}).status_code == 422
    assert client.post("/api/folders", json={"name": "x", "parent_id": 999}).status_code == 404
    assert client.get("/api/folders", params={"parent_id": 999}).status_code == 404
    assert b["parent_id"] == a.json()["id"]


# ---- upload, download, delete ----------------------------------------------------------------------------------------------
def test_upload_then_list_then_download_is_byte_identical(client, settings):
    body = data(3 * CS + 100)
    r = put(client, "movie.bin", body)
    assert r.status_code == 201
    rec = r.json()
    assert rec["total_chunks"] == 4 and rec["sha256_hash"] == hashlib.sha256(body).hexdigest()
    listing = client.get("/api/folders").json()
    assert [(f["file_name"], f["file_size"]) for f in listing["files"]] == [("movie.bin", len(body))]
    dl = client.get(f"/api/download/{rec['id']}")
    assert dl.status_code == 200 and dl.content == body
    assert "movie.bin" in dl.headers["content-disposition"]
    assert spool_files(settings) == []  # nothing left behind in the spool folder


def test_upload_into_a_folder_and_unicode_names(client):
    folder = client.post("/api/folders", json={"name": "Docs"}).json()
    r = put(client, "تقرير ✓.txt", b"hello", folder_id=folder["id"])
    assert r.status_code == 201
    files = client.get("/api/folders", params={"parent_id": folder["id"]}).json()["files"]
    assert files[0]["file_name"] == "تقرير ✓.txt"
    dl = client.get(f"/api/download/{files[0]['id']}")
    assert dl.content == b"hello"


def test_empty_upload(client):
    r = put(client, "empty", b"")
    assert r.status_code == 201 and r.json()["total_chunks"] == 0
    assert client.get(f"/api/download/{r.json()['id']}").content == b""


def test_upload_validation(client, settings):
    assert put(client, "a/b.txt", b"x").status_code == 422
    assert put(client, "..", b"x").status_code == 422
    assert put(client, "x.txt", b"x", folder_id=404).status_code == 404
    assert spool_files(settings) == []


def test_upload_over_the_limit_is_refused_and_leaves_nothing(client, settings):
    settings.max_upload_bytes = CS
    r = put(client, "huge.bin", data(2 * CS))
    assert r.status_code == 413 and r.json()["error"]["code"] == "too_large"
    assert spool_files(settings) == [] and client.get("/api/folders").json()["files"] == []
    assert list((settings.local_dir).glob("*.bin")) == []


def test_an_oversized_declared_length_is_refused_before_anything_is_read(client, settings):
    settings.max_upload_bytes = CS
    r = client.post("/api/upload", params={"name": "liar.bin"}, content=b"tiny", headers={"Content-Length": str(10 * CS)})
    assert r.status_code == 413 and r.json()["error"]["code"] == "too_large"
    assert spool_files(settings) == [] and client.get("/api/folders").json()["files"] == []


def test_chunked_body_without_content_length_is_still_capped(client, settings):
    settings.max_upload_bytes = CS

    def gen():
        for _ in range(8):
            yield b"x" * (CS // 2)

    r = client.post("/api/upload", params={"name": "stream.bin"}, content=gen())
    assert r.status_code == 413 and spool_files(settings) == []


def test_download_of_an_unknown_file(client):
    assert client.get("/api/download/12345").status_code == 404


def test_a_tampered_chunk_gives_an_error_not_a_corrupt_download(client, settings):
    rec = put(client, "t.bin", data(2 * CS)).json()
    victim = sorted(settings.local_dir.glob("*.bin"))[0]
    raw = bytearray(victim.read_bytes())
    raw[3] ^= 1
    victim.write_bytes(bytes(raw))
    r = client.get(f"/api/download/{rec['id']}")
    assert r.status_code == 502 and r.json()["error"]["code"] == "integrity_error"
    assert spool_files(settings) == []


def test_delete_items_removes_files_folders_and_their_chunks(client, settings):
    folder = client.post("/api/folders", json={"name": "Trash"}).json()
    f1 = put(client, "in-folder.bin", data(CS + 1), folder_id=folder["id"]).json()
    f2 = put(client, "loose.bin", data(10)).json()
    assert len(list(settings.local_dir.glob("*.bin"))) == 3
    r = client.request("DELETE", "/api/items", json={"file_ids": [f2["id"]], "folder_ids": [folder["id"]]})
    assert r.json() == {"files": 1, "folders": 1, "messages": 3, "orphaned": 0}
    assert list(settings.local_dir.glob("*.bin")) == []
    assert client.get("/api/folders").json() == {"folder_id": None, "breadcrumbs": [], "folders": [], "files": []}
    assert client.get(f"/api/download/{f1['id']}").status_code == 404
    assert client.request("DELETE", "/api/items", json={}).json()["files"] == 0


def test_status_reports_stats_and_hides_secrets(client):
    put(client, "a.bin", b"1234")
    s = client.get("/api/status").json()
    assert s["ready"] is True and s["stats"]["files"] == 1 and s["stats"]["bytes"] == 4 and s["chunk_size"] == CS
    assert "api_hash" not in s["config"] and "bot_token" not in s["config"]


def test_recover_rebuilds_the_index_from_the_channel(client, settings):
    body = data(2 * CS + 5)
    rec = put(client, "keep.bin", body).json()
    client.request("DELETE", "/api/items", json={"file_ids": [rec["id"]]})  # deleting removes the chunks too...
    rec = put(client, "again.bin", body).json()
    import sqlite3
    con = sqlite3.connect(settings.db_path)
    con.execute("PRAGMA foreign_keys=ON")
    con.execute("DELETE FROM files")  # ...so lose the index behind the app's back instead
    con.commit(), con.close()
    assert client.get("/api/folders").json()["files"] == []
    out = client.post("/api/recover").json()
    assert out["recovered"] == 1
    folder = client.get("/api/folders").json()["folders"][0]
    files = client.get("/api/folders", params={"parent_id": folder["id"]}).json()["files"]
    assert client.get(f"/api/download/{files[0]['id']}").content == body


# ---- live progress over the WebSocket ---------------------------------------------------------------------------------------
def test_progress_socket_streams_events_for_an_upload(client):
    with client.websocket_connect(f"ws://127.0.0.1:8765/ws/progress?token={TOKEN}") as ws:
        assert put(client, "w.bin", data(3 * CS), job_id="abc123").status_code == 201
        events = []
        while True:
            e = ws.receive_json()
            events.append(e)
            if e["phase"] == "done":
                break
    assert {e["job_id"] for e in events} == {"abc123"} and [e["phase"] for e in events][0] == "hashing"
    assert events[-1]["done"] == events[-1]["total"] == 3 * CS


def test_progress_socket_refuses_wrong_token_and_foreign_origin(client):
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("ws://127.0.0.1:8765/ws/progress?token=nope"):
            pass
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"ws://127.0.0.1:8765/ws/progress?token={TOKEN}", headers={"Origin": "https://evil.example"}):
            pass


# ---- not connected to Telegram yet -------------------------------------------------------------------------------------------
def fake_telegram(settings, cfg):
    """Same wiring as build_backend, but the Telethon client is a fake: tests never touch the network."""
    if not (cfg.get("api_id") and cfg.get("api_hash")):
        return None
    return TelethonBackend(session_path=settings.session_path, api_id=int(cfg["api_id"]), api_hash=cfg["api_hash"],
                           bot_token=cfg.get("bot_token") or None, channel=cfg.get("channel") or None, client_factory=lambda *_: FakeClient())


@pytest.fixture
def telegram_client(tmp_path):
    s = Settings(data_dir=tmp_path / "data", backend="telegram", token=TOKEN, chunk_size=CS)
    with TestClient(create_app(s, backend_factory=fake_telegram), base_url=BASE, headers=AUTH) as c:
        yield c


def test_without_a_telegram_connection_uploads_explain_what_to_do_but_browsing_still_works(telegram_client):
    status = telegram_client.get("/api/status").json()
    assert status["ready"] is False and status["backend"] == "telegram"
    r = put(telegram_client, "x.bin", b"1")
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_configured"
    assert telegram_client.post("/api/folders", json={"name": "Still works"}).status_code == 201
    assert telegram_client.post("/api/recover").status_code == 409
    assert telegram_client.post("/api/auth/send-code", json={"phone": "+10000000000"}).status_code == 409


def test_configure_saves_secrets_to_a_private_file_and_never_echoes_them(telegram_client, tmp_path):
    import os, stat
    r = telegram_client.post("/api/auth/configure", json={"api_id": 12345, "api_hash": "deadbeefdeadbeef", "bot_token": "1:SECRETTOKEN", "channel": "@store"})
    body = r.text
    assert "deadbeefdeadbeef" not in body and "SECRETTOKEN" not in body
    cfg = r.json()["config"]
    assert cfg["api_hash_set"] is True and cfg["bot_token_set"] is True and cfg["api_id"] == 12345
    path = tmp_path / "data" / "config.json"
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
    assert "SECRETTOKEN" in path.read_text()  # stored locally, owner-only; never sent back
    assert r.json()["ready"] is True  # fake bot login + channel resolved: uploads now work
    assert put(telegram_client, "via-fake-telegram.bin", data(2 * CS)).status_code == 201


def test_a_hung_telegram_connection_does_not_block_the_app(tmp_path):
    """Offline: Telegram never answers. The window must still open, browsing must work, and the error must be visible."""
    import asyncio

    class Hangs(TelethonBackend):
        async def connect(self):
            await asyncio.sleep(3600)

    def factory(settings, cfg):
        return Hangs(session_path=settings.session_path, api_id=1, api_hash="h" * 8, client_factory=lambda *_: FakeClient())

    s = Settings(data_dir=tmp_path / "data", backend="telegram", token=TOKEN, chunk_size=CS, connect_timeout=0.3)
    import time
    started = time.monotonic()
    with TestClient(create_app(s, backend_factory=factory), base_url=BASE, headers=AUTH) as c:
        assert time.monotonic() - started < 2  # startup did not wait for Telegram
        assert c.get("/api/folders").status_code == 200
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            st = c.get("/api/status").json()
            if st["connect_error"]:
                break
            time.sleep(0.05)
        assert st["ready"] is False and st["connecting"] is False and "timed out" in st["connect_error"]
        assert c.post("/api/upload", params={"name": "x"}, content=b"1").status_code == 409


def test_progress_socket_refuses_an_unexpected_host_name(client):
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"ws://evil.example:8765/ws/progress?token={TOKEN}"):
            pass


def test_configure_keeps_saved_secrets_when_they_are_left_out_and_requires_both_ids(telegram_client, tmp_path):
    r = telegram_client.post("/api/auth/configure", json={"api_id": 5})
    assert r.status_code == 400 and r.json()["error"]["code"] == "bad_request"  # hash missing and none saved
    telegram_client.post("/api/auth/configure", json={"api_id": 5, "api_hash": "0123456789abcdef", "bot_token": "9:TOK", "channel": "@a"})
    r = telegram_client.post("/api/auth/configure", json={"channel": "@b"})  # only the channel changes
    assert r.status_code == 200 and r.json()["config"]["channel"] == "@b" and r.json()["config"]["api_hash_set"] is True
    import json
    saved = json.loads((tmp_path / "data" / "config.json").read_text())
    assert (saved["api_id"], saved["api_hash"], saved["bot_token"]) == (5, "0123456789abcdef", "9:TOK")
    telegram_client.post("/api/auth/configure", json={"bot_token": ""})  # switching to a user login clears the bot token
    assert json.loads((tmp_path / "data" / "config.json").read_text())["bot_token"] == ""
