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


def test_prompt_label_names_the_pdf_page():
    hits = [Hit(Chunk("text", "policy.pdf", 0, title="Travel Policy", page=3), 0.9)]
    assert "Passage 1 (Travel Policy - policy.pdf, page 3):" in build_messages("q", hits)[1]["content"]


def test_page_numbers_survive_saving_and_old_indexes_still_load(tmp_path):
    chunks = [Chunk("a", "p.pdf", 0, page=2), Chunk("b", "n.md", 0)]
    VectorStore(chunks, np.eye(2, dtype=np.float32)).save(tmp_path)
    assert [c.page for c in VectorStore.load(tmp_path).chunks] == [2, None]
    (tmp_path / "chunks.json").write_text('[{"text": "old", "source": "a.md", "index": 0}]')
    np.save(tmp_path / "vectors.npy", np.zeros((1, 2), dtype=np.float32))
    assert VectorStore.load(tmp_path).chunks[0].page is None


# --- changing a store ------------------------------------------------------------------

def test_empty_store_searches_to_nothing():
    assert len(VectorStore.empty()) == 0
    assert VectorStore.empty().search(np.ones(2, dtype=np.float32)) == []


def test_extended_adds_chunks_without_changing_the_original():
    base = VectorStore([Chunk("a", "a.md", 0)], np.array([[1, 0]], dtype=np.float32))
    bigger = base.extended([Chunk("b", "b.md", 0)], np.array([[0, 1]], dtype=np.float32))
    assert len(base) == 1 and len(bigger) == 2
    assert [c.source for c in bigger.chunks] == ["a.md", "b.md"]


def test_extended_onto_an_empty_store_takes_the_new_vector_size():
    store = VectorStore.empty().extended([Chunk("a", "a.md", 0)], np.ones((1, 5), dtype=np.float32))
    assert store.vectors.shape == (1, 5)


def test_extended_with_a_different_vector_size_is_refused():
    base = VectorStore([Chunk("a", "a.md", 0)], np.ones((1, 2), dtype=np.float32))
    with pytest.raises(ValueError, match="different model"):
        base.extended([Chunk("b", "b.md", 0)], np.ones((1, 3), dtype=np.float32))


def test_without_source_removes_only_that_document():
    store = VectorStore([Chunk("a", "a.md", 0), Chunk("b", "b.md", 0), Chunk("a2", "a.md", 1)],
                        np.eye(3, dtype=np.float32))
    smaller = store.without_source("a.md")
    assert [c.source for c in smaller.chunks] == ["b.md"] and smaller.vectors.shape == (1, 3)
    assert len(store) == 3  # the original is untouched
    assert len(store.without_source("b.md").without_source("a.md")) == 0


def test_source_summaries_count_chunks_and_pages():
    store = VectorStore([Chunk("a", "p.pdf", 0, page=1), Chunk("b", "p.pdf", 1, page=3), Chunk("c", "n.md", 0)],
                        np.eye(3, dtype=np.float32))
    assert store.source_summaries() == {"n.md": {"chunks": 1, "pages": None}, "p.pdf": {"chunks": 2, "pages": 3}}


def test_save_leaves_no_temporary_files_and_round_trips(tmp_path):
    store = VectorStore([Chunk("a", "a.md", 0)], np.array([[1, 0]], dtype=np.float32))
    store.save(tmp_path)
    assert sorted(p.name for p in tmp_path.iterdir()) == ["chunks.json", "vectors.npy"]
    assert len(VectorStore.load(tmp_path)) == 1


def test_an_empty_store_can_be_saved_and_loaded(tmp_path):
    VectorStore.empty().save(tmp_path)
    assert len(VectorStore.load(tmp_path)) == 0
