import json

import numpy as np
import pytest
from fastapi.testclient import TestClient

from ask_my_docs import web
from ask_my_docs.store import Chunk, VectorStore


@pytest.fixture
def index_dir(tmp_path):
    store = VectorStore(
        [Chunk("Remote work is allowed three days a week.", "remote.md", 0),
         Chunk("Report incidents within one hour.", "security.md", 0)],
        np.array([[1, 0], [0, 1]], dtype=np.float32),
    )
    store.save(tmp_path)
    return tmp_path


@pytest.fixture
def client(index_dir, monkeypatch):
    # Replace the model calls so tests need neither Ollama nor network access.
    monkeypatch.setattr(web, "retrieve",
                        lambda store, q, k: store.search(np.array([1, 0], dtype=np.float32), k))
    monkeypatch.setattr(web, "stream_answer", lambda q, hits: iter(["Three ", "days [1]."]))
    return TestClient(web.create_app(index_dir=index_dir))


def events(response):
    return [json.loads(line) for line in response.text.splitlines() if line]


def test_home_page_is_served(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "Ask" in response.text and "<form" in response.text


def test_status_with_index(client):
    info = client.get("/api/status").json()
    assert info["indexed"] is True
    assert info["chunks"] == 2
    assert info["documents"] == ["remote.md", "security.md"]


def test_status_without_index(tmp_path):
    info = TestClient(web.create_app(index_dir=tmp_path / "missing")).get("/api/status").json()
    assert info["indexed"] is False and info["chunks"] == 0


def test_ask_streams_sources_then_tokens_then_done(client):
    response = client.post("/api/ask", json={"question": "Remote days?", "top_k": 1})
    assert response.status_code == 200
    got = events(response)
    assert [e["type"] for e in got] == ["sources", "token", "token", "done"]
    assert got[0]["sources"][0]["source"] == "remote.md"
    assert got[0]["sources"][0]["n"] == 1
    assert "".join(e["text"] for e in got if e["type"] == "token") == "Three days [1]."


def test_ask_without_llm_returns_only_sources(client):
    got = events(client.post("/api/ask", json={"question": "Remote days?", "use_llm": False}))
    assert [e["type"] for e in got] == ["sources", "done"]


@pytest.mark.parametrize("payload", [{"question": ""}, {"question": "   "},
                                     {"question": "x", "top_k": 0}, {"question": "x", "top_k": 99}])
def test_ask_rejects_invalid_requests(client, payload):
    assert client.post("/api/ask", json=payload).status_code == 422


def test_ask_without_index_is_a_clear_error(tmp_path):
    client = TestClient(web.create_app(index_dir=tmp_path / "missing"))
    response = client.post("/api/ask", json={"question": "hello"})
    assert response.status_code == 409
    assert "ingest" in response.json()["detail"]


def test_model_failure_is_reported_in_the_stream(client, monkeypatch):
    def boom(question, hits):
        raise RuntimeError("model exploded")
        yield  # pragma: no cover  (makes this a generator)

    monkeypatch.setattr(web, "stream_answer", boom)
    got = events(client.post("/api/ask", json={"question": "Remote days?"}))
    assert got[-1]["type"] == "error"
    assert "model exploded" in got[-1]["message"]
