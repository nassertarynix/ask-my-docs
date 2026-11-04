import numpy as np
import pytest

from ask_my_docs.generate import build_messages
from ask_my_docs.store import Chunk, Hit, VectorStore


def make_store():
    chunks = [Chunk("about cats", "a.md", 0), Chunk("about dogs", "b.md", 0),
              Chunk("about fish", "c.md", 0)]
    vectors = np.array([[1, 0, 0], [0, 1, 0], [0, 0, 1]], dtype=np.float32)
    return VectorStore(chunks, vectors)


def test_search_returns_closest_first():
    hits = make_store().search(np.array([0.1, 0.9, 0.0], dtype=np.float32), k=2)
    assert [h.chunk.text for h in hits] == ["about dogs", "about cats"]
    assert hits[0].score > hits[1].score


def test_search_on_empty_store():
    empty = VectorStore([], np.zeros((0, 3), dtype=np.float32))
    assert empty.search(np.zeros(3, dtype=np.float32)) == []


def test_save_and_load_roundtrip(tmp_path):
    store = make_store()
    store.save(tmp_path)
    loaded = VectorStore.load(tmp_path)
    assert [c.text for c in loaded.chunks] == [c.text for c in store.chunks]
    assert np.array_equal(loaded.vectors, store.vectors)


def test_load_missing_index_gives_clear_error(tmp_path):
    with pytest.raises(FileNotFoundError, match="ingest"):
        VectorStore.load(tmp_path / "nope")


def test_mismatched_lengths_rejected():
    with pytest.raises(ValueError):
        VectorStore([Chunk("x", "a.md", 0)], np.zeros((2, 3), dtype=np.float32))


def test_prompt_numbers_passages_and_includes_question():
    hits = [Hit(Chunk("first text", "a.md", 0), 0.9), Hit(Chunk("second text", "b.md", 1), 0.8)]
    messages = build_messages("What is up?", hits)
    user = messages[1]["content"]
    assert "Passage 1 (a.md):\nfirst text" in user
    assert "Passage 2 (b.md):\nsecond text" in user
    assert "Question: What is up?" in user
    assert user.endswith("cite passages like [1].")


def test_embedding_text_includes_the_document_title():
    chunk = Chunk("Admins can ban users.", "jobly.md", 3, title="Project: Jobly")
    assert chunk.embedding_text == "Project: Jobly\n\nAdmins can ban users."
    assert Chunk("No title here.", "a.md", 0).embedding_text == "No title here."


def test_prompt_label_shows_title_when_present():
    hits = [Hit(Chunk("text", "jobly.md", 0, title="Project: Jobly"), 0.9)]
    assert "Passage 1 (Project: Jobly - jobly.md):" in build_messages("q", hits)[1]["content"]


def test_system_prompt_forbids_citation_only_answers():
    system = build_messages("q", [])[0]["content"]
    assert "Never reply with only a citation" in system
    assert "I don't know based on the provided documents." in system


def test_old_index_without_titles_still_loads(tmp_path):
    (tmp_path / "chunks.json").write_text('[{"text": "old", "source": "a.md", "index": 0}]')
    np.save(tmp_path / "vectors.npy", np.zeros((1, 3), dtype=np.float32))
    assert VectorStore.load(tmp_path).chunks[0].title == ""


def test_stream_answer_uses_configured_temperature(monkeypatch):
    from ask_my_docs import config, generate

    captured = {}

    class FakeCompletions:
        def create(self, **kwargs):
            captured.update(kwargs)
            return iter([])

    class FakeClient:
        def __init__(self, **kwargs):
            self.chat = type("Chat", (), {"completions": FakeCompletions()})()

    monkeypatch.setattr(generate, "OpenAI", FakeClient)
    monkeypatch.setattr(config, "TEMPERATURE", 0.0)
    assert list(generate.stream_answer("q", [])) == []
    assert captured["temperature"] == 0.0 and captured["stream"] is True
