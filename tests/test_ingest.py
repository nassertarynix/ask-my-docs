import shutil
from pathlib import Path

import numpy as np
import pytest
from pypdf import PdfWriter

from ask_my_docs import cli, config, ingest

SAMPLE_PDF = Path(__file__).resolve().parent.parent / "sample_docs" / "orbit_labs_expenses.pdf"


@pytest.fixture
def fake_embed(monkeypatch):
    seen = {}

    def embed(texts, prefix=""):
        seen["texts"], seen["prefix"] = texts, prefix
        return np.ones((len(texts), 2), dtype=np.float32)

    monkeypatch.setattr(ingest, "embed", embed)
    return seen


def blank_pdf(path: Path, encrypt_with: str | None = None) -> None:
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)  # a page with no text, like a scan
    if encrypt_with:
        writer.encrypt(encrypt_with, algorithm="RC4-128")
    with open(path, "wb") as handle:
        writer.write(handle)


# --- Markdown and text ---------------------------------------------------------

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
    documents, warnings = ingest.load_documents(tmp_path)
    assert {d.source for d in documents} == {"a.md", "sub/b.txt"}
    assert warnings == []
    assert documents[0].pages[0].number is None  # plain text has no page numbers


def test_load_documents_rejects_missing_folder(tmp_path):
    with pytest.raises(NotADirectoryError):
        ingest.load_documents(tmp_path / "nope")


def test_build_index_embeds_chunks_with_their_title(tmp_path, fake_embed):
    (tmp_path / "jobly.md").write_text("# Project: Jobly\n\nA job search app.")
    store = ingest.build_index(tmp_path)
    assert store.chunks[0].title == "Project: Jobly"
    assert store.chunks[0].page is None
    assert fake_embed["texts"][0].startswith("Project: Jobly\n\n")


# --- PDF text clean-up -----------------------------------------------------------

def test_reflow_joins_wrapped_lines_but_keeps_headings_apart():
    raw = ("Booking travel\n"
           "Flights must be booked at least 14 days ahead through the Orbit Labs\n"
           "travel portal. All other flights are booked in economy.\n"
           "Getting around\n"
           "Personal car trips are reimbursed.")
    paragraphs = ingest.reflow_pdf_text(raw).split("\n\n")
    assert paragraphs[0] == "Booking travel"
    assert paragraphs[1] == ("Flights must be booked at least 14 days ahead through the Orbit Labs "
                             "travel portal. All other flights are booked in economy.")
    assert paragraphs[2] == "Getting around"


def test_reflow_normalises_ligatures_and_line_end_hyphens():
    assert ingest.reflow_pdf_text("a ﬁctional com-\npany with ﬂights") == "a fictional company with flights"


def test_reflow_of_nothing_is_empty():
    assert ingest.reflow_pdf_text("  \n \n") == ""


# --- reading PDFs ------------------------------------------------------------------

def test_sample_pdf_is_read_page_by_page():
    title, pages = ingest.read_pdf(SAMPLE_PDF)
    assert title == "Orbit Labs Expense and Travel Policy"
    assert [p.number for p in pages] == [1, 2]
    assert "180 dollars per night" in pages[0].text
    assert "45 dollars per day" in pages[1].text
    assert "ﬁ" not in pages[0].text  # no ligature characters left


def test_pdf_title_falls_back_to_the_file_name(tmp_path):
    path = tmp_path / "quarterly_report-2024.pdf"
    shutil.copy(SAMPLE_PDF, path)
    reader_title = ingest._pdf_title(type("R", (), {"metadata": None})(), path)
    assert reader_title == "quarterly report 2024"


def test_pdf_without_text_is_skipped_with_a_warning(tmp_path):
    blank_pdf(tmp_path / "scan.pdf")
    documents, warnings = ingest.load_documents(tmp_path)
    assert documents == []
    assert "scan.pdf" in warnings[0] and "no text" in warnings[0] and "OCR" in warnings[0]


def test_damaged_pdf_is_skipped_with_a_warning(tmp_path):
    (tmp_path / "bad.pdf").write_bytes(b"this is not a pdf at all")
    documents, warnings = ingest.load_documents(tmp_path)
    assert documents == []
    assert "bad.pdf" in warnings[0] and "could not be read" in warnings[0]


def test_password_protected_pdf_is_skipped_with_a_warning(tmp_path):
    try:
        blank_pdf(tmp_path / "locked.pdf", encrypt_with="secret")
    except Exception as error:  # encryption needs an optional library in some pypdf versions
        pytest.skip(f"cannot create an encrypted test PDF here: {error}")
    documents, warnings = ingest.load_documents(tmp_path)
    assert documents == []
    assert "locked.pdf" in warnings[0] and "password" in warnings[0]


def test_a_bad_pdf_does_not_stop_the_good_files(tmp_path):
    (tmp_path / "notes.md").write_text("# Notes\n\nSome text.")
    (tmp_path / "bad.pdf").write_bytes(b"nope")
    shutil.copy(SAMPLE_PDF, tmp_path / "policy.pdf")
    documents, warnings = ingest.load_documents(tmp_path)
    assert {d.source for d in documents} == {"notes.md", "policy.pdf"}
    assert len(warnings) == 1


def test_build_index_keeps_page_numbers_and_continues_chunk_numbers(tmp_path, fake_embed):
    shutil.copy(SAMPLE_PDF, tmp_path / "policy.pdf")
    store = ingest.build_index(tmp_path)
    assert {c.page for c in store.chunks} == {1, 2}
    assert [c.index for c in store.chunks] == list(range(len(store.chunks)))
    assert all(c.title == "Orbit Labs Expense and Travel Policy" for c in store.chunks)
    assert any("180 dollars per night" in c.text and c.page == 1 for c in store.chunks)


def test_build_index_with_nothing_readable_is_an_error(tmp_path):
    with pytest.raises(ValueError, match="No readable"):
        ingest.build_index(tmp_path)
    (tmp_path / "bad.pdf").write_bytes(b"nope")
    with pytest.raises(ValueError, match="No readable"):
        ingest.build_index(tmp_path)


def test_build_index_passes_warnings_to_the_caller(tmp_path, fake_embed):
    (tmp_path / "a.md").write_text("# A\n\ntext")
    (tmp_path / "bad.pdf").write_bytes(b"nope")
    messages = []
    ingest.build_index(tmp_path, on_warning=messages.append)
    assert len(messages) == 1 and "bad.pdf" in messages[0]


def test_ingest_command_prints_warnings_to_stderr(tmp_path, monkeypatch, fake_embed, capsys):
    (tmp_path / "a.md").write_text("# A\n\ntext")
    (tmp_path / "bad.pdf").write_bytes(b"nope")
    monkeypatch.setattr(config, "INDEX_DIR", tmp_path / "index")
    assert cli.main(["ingest", str(tmp_path)]) == 0
    captured = capsys.readouterr()
    assert "Warning: Skipped bad.pdf" in captured.err
    assert "Indexed 1 chunks from 1 file(s)" in captured.out
