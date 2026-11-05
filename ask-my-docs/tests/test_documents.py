import httpx
import numpy as np
import pytest
from openai import APIConnectionError
from pypdf import PdfWriter

from ask_my_docs import documents
from ask_my_docs.documents import UploadError
from ask_my_docs.store import Chunk, VectorStore
from tests.test_ingest import SAMPLE_PDF


@pytest.fixture
def fake_embed(monkeypatch):
    """Stand-in for the embedding model: every chunk gets the same 2-number vector."""
    monkeypatch.setattr(documents, "embed", lambda texts, prefix="": np.ones((len(texts), 2), dtype=np.float32))


def files_in(folder):
    return sorted(p.name for p in folder.iterdir()) if folder.exists() else []


# --- names ---------------------------------------------------------------------------

@pytest.mark.parametrize("name", ["notes.md", "Report 2024.PDF", "a.txt", "résumé.md", "x" * 100 + ".md"])
def test_valid_names_pass(name):
    assert documents.clean_name(name) == name


@pytest.mark.parametrize("name,status", [
    ("", 400), ("   ", 400), (None, 400),
    ("../secret.md", 400), ("a/b.md", 400), ("a\\b.md", 400), ("/etc/passwd.md", 400), ("..", 400),
    (".hidden.md", 400), ("bad\x00name.md", 400), ("line\nbreak.md", 400),
    ("x" * 130 + ".md", 400),
    ("virus.exe", 415), ("noextension", 415), ("archive.zip", 415), ("page.html", 415),
])
def test_bad_names_are_rejected_with_the_right_status(name, status):
    with pytest.raises(UploadError) as error:
        documents.clean_name(name)
    assert error.value.status == status


# --- content ---------------------------------------------------------------------------

def test_content_checks():
    documents.check_content("a.md", b"# hello")
    documents.check_content("a.pdf", b"%PDF-1.7\n...")
    for name, data, status in [("a.md", b"", 422), ("a.md", b"  \n ", 422),
                               ("a.pdf", b"not a pdf", 415), ("a.md", b"text\x00binary", 415)]:
        with pytest.raises(UploadError) as error:
            documents.check_content(name, data)
        assert error.value.status == status


# --- adding ------------------------------------------------------------------------------

def test_add_a_text_document(tmp_path, fake_embed):
    store, result = documents.add_document(VectorStore.empty(), tmp_path / "up", "notes.md",
                                           b"# My notes\n\nThe launch is on Friday.")
    assert (result.name, result.replaced, result.pages) == ("notes.md", False, None)
    assert result.chunks == len(store) >= 1
    assert store.chunks[0].title == "My notes" and store.chunks[0].source == "notes.md"
    assert files_in(tmp_path / "up") == ["notes.md"]  # saved, and no temporary file left behind


def test_add_a_pdf_keeps_page_numbers_and_title(tmp_path, fake_embed):
    store, result = documents.add_document(VectorStore.empty(), tmp_path / "up", "policy.pdf", SAMPLE_PDF.read_bytes())
    assert result.pages == 2
    assert {c.page for c in store.chunks} == {1, 2}
    assert store.chunks[0].title == "Orbit Labs Expense and Travel Policy"


def test_pdf_without_a_title_is_named_after_the_uploaded_file_not_the_temporary_one(tmp_path, fake_embed):
    # A PDF with text but no title: the real PDF is built by pypdf from the sample's page.
    from pypdf import PdfReader
    writer = PdfWriter()
    writer.add_page(PdfReader(SAMPLE_PDF).pages[0])
    out = tmp_path / "untitled.pdf"
    with open(out, "wb") as handle:
        writer.write(handle)
    store, _ = documents.add_document(VectorStore.empty(), tmp_path / "up", "quarterly_report.pdf", out.read_bytes())
    assert "incoming" not in store.chunks[0].title


def test_adding_a_document_with_the_same_name_replaces_it(tmp_path, fake_embed):
    up = tmp_path / "up"
    store, _ = documents.add_document(VectorStore.empty(), up, "notes.md", b"# Old\n\nOld text about apples.")
    store, result = documents.add_document(store, up, "notes.md", b"# New\n\nNew text about pears.")
    assert result.replaced is True
    assert all("apples" not in c.text for c in store.chunks) and any("pears" in c.text for c in store.chunks)
    assert (up / "notes.md").read_bytes().startswith(b"# New")
    assert files_in(up) == ["notes.md"]


def test_adding_keeps_the_other_documents(tmp_path, fake_embed):
    up = tmp_path / "up"
    store, _ = documents.add_document(VectorStore.empty(), up, "a.md", b"# A\n\nalpha")
    store, _ = documents.add_document(store, up, "b.md", b"# B\n\nbeta")
    assert {c.source for c in store.chunks} == {"a.md", "b.md"}


# --- failures leave nothing behind ----------------------------------------------------------

def test_a_damaged_pdf_is_refused_and_leaves_no_file(tmp_path, fake_embed):
    with pytest.raises(UploadError) as error:
        documents.add_document(VectorStore.empty(), tmp_path / "up", "bad.pdf", b"%PDF-1.4 this is garbage")
    assert error.value.status == 422 and "bad.pdf" in error.value.message
    assert files_in(tmp_path / "up") == []


def test_a_scanned_pdf_with_no_text_is_refused_with_a_clear_reason(tmp_path, fake_embed):
    blank = tmp_path / "scan.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    with open(blank, "wb") as handle:
        writer.write(handle)
    with pytest.raises(UploadError) as error:
        documents.add_document(VectorStore.empty(), tmp_path / "up", "scan.pdf", blank.read_bytes())
    assert error.value.status == 422 and "no text" in error.value.message and "OCR" in error.value.message
    assert files_in(tmp_path / "up") == []


def test_a_failed_replacement_keeps_the_previous_version(tmp_path, fake_embed):
    up = tmp_path / "up"
    good = SAMPLE_PDF.read_bytes()
    store, _ = documents.add_document(VectorStore.empty(), up, "p.pdf", good)
    before = len(store)
    with pytest.raises(UploadError):
        documents.add_document(store, up, "p.pdf", b"%PDF-1.4 garbage")
    assert (up / "p.pdf").read_bytes() == good and len(store) == before
    assert files_in(up) == ["p.pdf"]


def test_model_server_down_gives_a_clear_error_and_leaves_nothing(tmp_path, monkeypatch):
    def down(texts, prefix=""):
        raise APIConnectionError(request=httpx.Request("POST", "http://localhost:11434/v1/embeddings"))
    monkeypatch.setattr(documents, "embed", down)
    with pytest.raises(UploadError) as error:
        documents.add_document(VectorStore.empty(), tmp_path / "up", "a.md", b"# A\n\ntext")
    assert error.value.status == 503 and "Ollama" in error.value.message
    assert files_in(tmp_path / "up") == []


def test_other_embedding_failures_are_reported_not_crashed(tmp_path, monkeypatch):
    def broken(texts, prefix=""):
        raise RuntimeError("model not found")
    monkeypatch.setattr(documents, "embed", broken)
    with pytest.raises(UploadError) as error:
        documents.add_document(VectorStore.empty(), tmp_path / "up", "a.md", b"# A\n\ntext")
    assert error.value.status == 502 and "model not found" in error.value.message


def test_embedding_with_a_different_model_is_refused(tmp_path, fake_embed):
    store = VectorStore([Chunk("old", "old.md", 0)], np.ones((1, 3), dtype=np.float32))  # 3 numbers, not 2
    with pytest.raises(UploadError) as error:
        documents.add_document(store, tmp_path / "up", "new.md", b"# New\n\ntext")
    assert error.value.status == 409 and "ingest" in error.value.message
    assert files_in(tmp_path / "up") == []


# --- removing and listing --------------------------------------------------------------------

def test_remove_a_document_added_from_the_page(tmp_path, fake_embed):
    up = tmp_path / "up"
    store, _ = documents.add_document(VectorStore.empty(), up, "a.md", b"# A\n\nalpha")
    store, _ = documents.add_document(store, up, "b.md", b"# B\n\nbeta")
    store = documents.remove_document(store, up, "a.md")
    assert {c.source for c in store.chunks} == {"b.md"} and files_in(up) == ["b.md"]
    assert len(documents.remove_document(store, up, "b.md")) == 0  # the last one: an empty store


def test_documents_from_ingest_cannot_be_removed_here(tmp_path):
    store = VectorStore([Chunk("x", "from_ingest.md", 0)], np.ones((1, 2), dtype=np.float32))
    with pytest.raises(UploadError) as error:
        documents.remove_document(store, tmp_path / "up", "from_ingest.md")
    assert error.value.status == 404


def test_remove_rejects_hostile_names(tmp_path):
    for name in ["../outside.md", "a/b.md", ""]:
        with pytest.raises(UploadError):
            documents.remove_document(VectorStore.empty(), tmp_path / "up", name)


def test_describe_marks_which_documents_were_uploaded(tmp_path, fake_embed):
    up = tmp_path / "up"
    store, _ = documents.add_document(VectorStore.empty(), up, "mine.md", b"# Mine\n\ntext")
    store = store.extended([Chunk("x", "sub/ingested.md", 0)], np.ones((1, 2), dtype=np.float32))
    details = {d["name"]: d for d in documents.describe(store, up)}
    assert details["mine.md"]["uploaded"] is True
    assert details["sub/ingested.md"]["uploaded"] is False
