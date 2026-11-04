import numpy as np
import pytest

from ask_my_docs import ingest


def test_extract_title():
    assert ingest.extract_title("intro\n# Project: Jobly\n## Sub") == "Project: Jobly"
    assert ingest.extract_title("## only a subheading") == ""
    assert ingest.extract_title("") == ""


def test_load_documents_reads_supported_files_recursively(tmp_path):
    (tmp_path / "a.md").write_text("# A\nhello")
    (tmp_path / "sub").mkdir()
    (tmp_path / "sub" / "b.txt").write_text("world")
    (tmp_path / "ignored.png").write_bytes(b"\x89PNG")
    (tmp_path / "empty.md").write_text("   \n")
    docs = dict(ingest.load_documents(tmp_path))
    assert set(docs) == {"a.md", "sub/b.txt"}


def test_load_documents_rejects_missing_folder(tmp_path):
    with pytest.raises(NotADirectoryError):
        ingest.load_documents(tmp_path / "nope")


def test_build_index_embeds_chunks_with_their_title(tmp_path, monkeypatch):
    (tmp_path / "jobly.md").write_text("# Project: Jobly\n\nA job search app.")
    seen = {}

    def fake_embed(texts, prefix=""):
        seen["texts"], seen["prefix"] = texts, prefix
        return np.ones((len(texts), 2), dtype=np.float32)

    monkeypatch.setattr(ingest, "embed", fake_embed)
    store = ingest.build_index(tmp_path)
    assert store.chunks[0].title == "Project: Jobly"
    assert seen["texts"][0].startswith("Project: Jobly\n\n")


def test_build_index_with_no_documents_is_an_error(tmp_path):
    with pytest.raises(ValueError, match="No .md or .txt"):
        ingest.build_index(tmp_path)
