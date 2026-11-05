import threading

import httpx
import numpy as np
import pytest
from fastapi.testclient import TestClient
from openai import APIConnectionError

from ask_my_docs import cli, documents, web
from ask_my_docs.store import VectorStore
from tests.test_ingest import SAMPLE_PDF

LOCAL = "http://127.0.0.1:8000"


@pytest.fixture(autouse=True)
def fake_embed(monkeypatch):
    monkeypatch.setattr(documents, "embed", lambda texts, prefix="": np.ones((len(texts), 2), dtype=np.float32))


@pytest.fixture
def index_dir(tmp_path):
    return tmp_path / "index"  # does not exist yet: the first upload must create the index


@pytest.fixture
def client(index_dir):
    return TestClient(web.create_app(index_dir=index_dir), base_url=LOCAL)


def upload(client, name, data, **kwargs):
    return client.post("/api/documents", params={"name": name}, content=data, **kwargs)


# --- building an index from nothing ---------------------------------------------------

def test_status_before_anything_is_added(client):
    info = client.get("/api/status").json()
    assert info["indexed"] is False and info["documents"] == []
    assert info["uploads"] == {"enabled": True, "max_mb": 20, "types": [".md", ".pdf", ".txt"]}


def test_the_first_upload_creates_the_index(client, index_dir):
    response = upload(client, "notes.md", b"# Notes\n\nThe launch is on Friday.")
    assert response.status_code == 200
    body = response.json()
    assert body["added"] == {"name": "notes.md", "chunks": 1, "pages": None, "replaced": False}
    assert body["indexed"] is True and body["documents"] == ["notes.md"]
    assert body["document_details"] == [{"name": "notes.md", "chunks": 1, "pages": None, "uploaded": True}]
    assert len(VectorStore.load(index_dir)) == 1          # saved to disk, not just in memory
    assert (index_dir / "uploads" / "notes.md").is_file()


def test_uploading_a_pdf_reports_its_pages(client):
    body = upload(client, "policy.pdf", SAMPLE_PDF.read_bytes()).json()
    assert body["added"]["pages"] == 2 and body["added"]["chunks"] >= 2
    assert body["document_details"][0]["pages"] == 2


def test_uploading_the_same_name_replaces_it(client):
    upload(client, "notes.md", b"# Notes\n\nOld text.")
    body = upload(client, "notes.md", b"# Notes\n\nNew text.").json()
    assert body["added"]["replaced"] is True and body["documents"] == ["notes.md"]


def test_the_page_sees_new_documents_without_a_restart(client):
    upload(client, "a.md", b"# A\n\nalpha")
    upload(client, "b.md", b"# B\n\nbeta")
    assert client.get("/api/status").json()["documents"] == ["a.md", "b.md"]


# --- removing -----------------------------------------------------------------------------

def test_remove_an_uploaded_document(client, index_dir):
    upload(client, "a.md", b"# A\n\nalpha")
    upload(client, "b.md", b"# B\n\nbeta")
    body = client.delete("/api/documents/a.md").json()
    assert body["documents"] == ["b.md"]
    assert not (index_dir / "uploads" / "a.md").exists()
    assert len(VectorStore.load(index_dir)) == 1


def test_removing_the_last_document_leaves_a_working_empty_index(client):
    upload(client, "a.md", b"# A\n\nalpha")
    body = client.delete("/api/documents/a.md").json()
    assert body["indexed"] is False and body["chunks"] == 0
    asked = client.post("/api/ask", json={"question": "anything"})
    assert asked.status_code == 409 and "no documents" in asked.json()["detail"].lower()


def test_removing_an_unknown_document_is_a_404(client):
    assert client.delete("/api/documents/nope.md").status_code == 404


def test_documents_from_ingest_cannot_be_removed_from_the_page(index_dir, tmp_path):
    from ask_my_docs.store import Chunk
    VectorStore([Chunk("x", "ingested.md", 0)], np.ones((1, 2), dtype=np.float32)).save(index_dir)
    client = TestClient(web.create_app(index_dir=index_dir), base_url=LOCAL)
    assert client.get("/api/status").json()["document_details"][0]["uploaded"] is False
    assert client.delete("/api/documents/ingested.md").status_code == 404


# --- refusing bad input -----------------------------------------------------------------------

@pytest.mark.parametrize("name,status", [
    ("../escape.md", 400), ("sub/dir.md", 400), (".hidden.md", 400), ("   ", 400),
    ("malware.exe", 415), ("noextension", 415),
])
def test_bad_file_names_are_refused(client, index_dir, name, status):
    assert upload(client, name, b"hello").status_code == status
    assert not (index_dir / "uploads").exists() or not any((index_dir / "uploads").iterdir())
    assert not (index_dir.parent / "escape.md").exists()


def test_content_that_does_not_match_the_type_is_refused(client):
    assert upload(client, "fake.pdf", b"this is not a pdf").status_code == 415
    assert upload(client, "binary.md", b"abc\x00def").status_code == 415
    assert upload(client, "empty.md", b"   ").status_code == 422


def test_a_file_over_the_limit_is_refused_by_its_declared_size(index_dir):
    client = TestClient(web.create_app(index_dir=index_dir, max_upload_mb=1), base_url=LOCAL)
    response = upload(client, "big.md", b"x" * (1024 * 1024 + 1))
    assert response.status_code == 413 and "1 MB" in response.json()["detail"]


def test_a_streamed_file_with_no_declared_size_is_cut_off_at_the_limit(index_dir):
    client = TestClient(web.create_app(index_dir=index_dir, max_upload_mb=1), base_url=LOCAL)

    def pieces():
        for _ in range(3):
            yield b"y" * 600_000  # 1.8 MB in total, sent without a Content-Length

    assert upload(client, "streamed.md", pieces()).status_code == 413


def test_model_server_down_is_a_503_with_a_plain_message(client, monkeypatch):
    def down(texts, prefix=""):
        raise APIConnectionError(request=httpx.Request("POST", "http://localhost:11434/v1/embeddings"))
    monkeypatch.setattr(documents, "embed", down)
    response = upload(client, "a.md", b"# A\n\ntext")
    assert response.status_code == 503 and "Ollama" in response.json()["detail"]
    assert client.get("/api/status").json()["indexed"] is False


# --- who may change the documents ------------------------------------------------------------------

def test_uploads_can_be_turned_off(index_dir):
    client = TestClient(web.create_app(index_dir=index_dir, uploads_enabled=False), base_url=LOCAL)
    assert upload(client, "a.md", b"# A\n\ntext").status_code == 403
    assert client.delete("/api/documents/a.md").status_code == 403
    assert client.get("/api/status").json()["uploads"]["enabled"] is False


def test_a_request_from_another_site_is_refused(client):
    refused = upload(client, "a.md", b"# A\n\ntext", headers={"Origin": "http://evil.example"})
    assert refused.status_code == 403 and "another site" in refused.json()["detail"]
    assert client.delete("/api/documents/a.md", headers={"Origin": "http://evil.example"}).status_code == 403
    assert upload(client, "a.md", b"# A\n\ntext", headers={"Origin": "null"}).status_code == 403


def test_a_request_from_the_apps_own_page_is_accepted(client):
    assert upload(client, "a.md", b"# A\n\ntext", headers={"Origin": LOCAL}).status_code == 200


def test_a_request_with_a_non_local_host_name_is_refused(index_dir):
    """Protects against DNS rebinding: a hostile name that points at 127.0.0.1."""
    client = TestClient(web.create_app(index_dir=index_dir), base_url="http://attacker.example:8000")
    assert upload(client, "a.md", b"# A\n\ntext").status_code == 403


def test_two_uploads_at_the_same_time_both_land(index_dir):
    app = web.create_app(index_dir=index_dir)
    results = []

    def send(name):
        results.append(upload(TestClient(app, base_url=LOCAL), name, f"# {name}\n\ntext of {name}".encode()).status_code)

    threads = [threading.Thread(target=send, args=(n,)) for n in ("a.md", "b.md", "c.md")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert results == [200, 200, 200]
    assert TestClient(app, base_url=LOCAL).get("/api/status").json()["documents"] == ["a.md", "b.md", "c.md"]
    assert len(VectorStore.load(index_dir)) == 3


# --- the command line decides whether uploads are allowed ---------------------------------------------

@pytest.mark.parametrize("args,expected", [
    (["serve"], True),
    (["serve", "--host", "localhost"], True),
    (["serve", "--no-uploads"], False),
    (["serve", "--host", "0.0.0.0"], False),
])
def test_serve_turns_uploads_off_unless_the_server_is_local(monkeypatch, capsys, args, expected):
    seen = {}
    monkeypatch.setattr(web, "create_app", lambda **kwargs: seen.update(kwargs) or object())
    import uvicorn
    monkeypatch.setattr(uvicorn, "run", lambda *a, **k: None)
    assert cli.main(args) == 0
    assert seen["uploads_enabled"] is expected
    if "0.0.0.0" in args:
        assert "reachable from other machines" in capsys.readouterr().err
