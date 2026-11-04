import pytest

from ask_my_docs.chunking import chunk_text


def test_short_text_is_one_chunk():
    assert chunk_text("Hello world.", size=100, overlap=10) == ["Hello world."]


def test_empty_text_gives_no_chunks():
    assert chunk_text("  \n\n  ", size=100, overlap=10) == []


def test_paragraphs_are_packed_until_size():
    text = "\n\n".join(["a" * 40, "b" * 40, "c" * 40])
    chunks = chunk_text(text, size=100, overlap=0)
    assert len(chunks) == 2
    assert chunks[0] == "a" * 40 + "\n\n" + "b" * 40
    assert chunks[1] == "c" * 40


def test_overlap_repeats_end_of_previous_chunk():
    text = "alpha bravo charlie delta\n\n" + "echo foxtrot golf hotel"
    chunks = chunk_text(text, size=30, overlap=12)
    assert len(chunks) == 2
    # The second chunk starts with words from the end of the first.
    assert "delta" in chunks[1]
    assert chunks[1].endswith("echo foxtrot golf hotel")


def test_long_paragraph_is_split():
    chunks = chunk_text("x" * 250, size=100, overlap=20)
    assert len(chunks) >= 3
    # size + overlap + 2-character paragraph separator
    assert all(len(c) <= 100 + 20 + 2 for c in chunks)
    # The whole paragraph is still covered, with the overlap applied once.
    assert chunks[0] == "x" * 100
    assert chunks[1] == "x" * 20 + "\n\n" + "x" * 100


def test_invalid_arguments():
    with pytest.raises(ValueError):
        chunk_text("text", size=0, overlap=0)
    with pytest.raises(ValueError):
        chunk_text("text", size=50, overlap=50)
