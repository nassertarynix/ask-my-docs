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
    assert "[1] (source: a.md)" in user and "first text" in user
    assert "[2] (source: b.md)" in user
    assert user.endswith("Question: What is up?")
