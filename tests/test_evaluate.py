import json
from pathlib import Path

import numpy as np
import pytest

from ask_my_docs import cli, evaluate
from ask_my_docs.evaluate import Case, answer_ok, first_match_rank, load_cases
from ask_my_docs.store import Chunk, Hit, VectorStore

EVALS = Path(__file__).resolve().parent.parent / "evals"


def hits(*texts):
    return [Hit(Chunk(t, "a.md", i), 1.0 - i / 10) for i, t in enumerate(texts)]


def write(tmp_path, data):
    path = tmp_path / "cases.json"
    path.write_text(json.dumps(data))
    return path


# --- loading -----------------------------------------------------------------

def test_load_cases_reads_optional_fields(tmp_path):
    path = write(tmp_path, [{"question": "q1", "context_contains": "x", "answer_matches": "y"},
                            {"question": "q2"}])
    cases = load_cases(path)
    assert cases[0] == Case("q1", "x", "y")
    assert cases[1] == Case("q2", None, None)


@pytest.mark.parametrize("data", [[], {"question": "q"}, [{"no_question": 1}], ["just a string"]])
def test_load_cases_rejects_bad_shapes(tmp_path, data):
    with pytest.raises(ValueError):
        load_cases(write(tmp_path, data))


def test_load_cases_rejects_invalid_regex(tmp_path):
    with pytest.raises(ValueError, match="regex"):
        load_cases(write(tmp_path, [{"question": "q", "answer_matches": "(unclosed"}]))


@pytest.mark.parametrize("name", ["portfolio.json", "handbook.json"])
def test_shipped_case_files_are_valid(name):
    cases = load_cases(EVALS / name)
    assert len(cases) >= 5
    assert any(c.context_contains is None for c in cases)  # includes unanswerable questions


# --- scoring -----------------------------------------------------------------

def test_first_match_rank_is_one_based_and_case_insensitive():
    found = hits("nothing here", "Contains The NEEDLE inside")
    assert first_match_rank(found, "needle") == 2
    assert first_match_rank(found, "absent") is None


def test_answer_ok_requires_a_real_answer_not_a_bare_citation():
    assert answer_ok("Jobly uses Cubit for state management. [1]", "cubit")
    assert not answer_ok("[1]", "cubit")
    assert not answer_ok("[1][3]", ".*")
    assert not answer_ok("Jobly uses Redux for state management.", "cubit")


def test_answer_ok_accepts_a_short_refusal():
    assert answer_ok("I don't know.", "don't know")


def test_answer_ok_regex_can_span_lines_and_require_several_terms():
    pattern = "(?=.*mckinsey)(?=.*ibm)"
    assert answer_ok("McKinsey program.\nAlso IBM security course.", pattern)
    assert not answer_ok("Only the McKinsey program was completed.", pattern)


# --- running -----------------------------------------------------------------

@pytest.fixture
def store():
    chunks = [Chunk("Jobly uses Cubit.", "jobly.md", 0), Chunk("Tayar uses Stripe.", "tayar.md", 0)]
    return VectorStore(chunks, np.array([[1, 0], [0, 1]], dtype=np.float32))


@pytest.fixture(autouse=True)
def fake_retrieval(monkeypatch):
    """Rank chunks by whether the question mentions Tayar, so no model is needed."""
    def retrieve(store, question, k):
        vec = np.array([0, 1] if "Tayar" in question else [1, 0], dtype=np.float32)
        return store.search(vec, k)
    monkeypatch.setattr(evaluate, "retrieve", retrieve)


def test_run_evaluation_retrieval_only(store):
    cases = [Case("What does Jobly use?", "Cubit"), Case("What does Tayar use?", "Stripe"),
             Case("Unanswerable?", None)]
    results = evaluate.run_evaluation(store, cases, k=1)
    assert [r.rank for r in results] == [1, 1, None]
    assert all(r.answer is None and r.answer_ok is None for r in results)
    assert evaluate.all_passed(results, k=1)


def test_run_evaluation_detects_retrieval_miss_and_bad_answer(store):
    cases = [Case("What does Jobly use?", "Stripe", "stripe")]  # Stripe is in the other chunk
    results = evaluate.run_evaluation(store, cases, k=1, answer_fn=lambda q, h: ["Redux is used. [1]"])
    assert results[0].rank == 2
    assert results[0].answer_ok is False
    assert not evaluate.all_passed(results, k=1)
    assert evaluate.all_passed(results[:0], k=1)  # nothing to fail


def test_answer_function_receives_only_top_k_hits(store):
    seen = {}

    def answer_fn(question, top):
        seen["n"] = len(top)
        return ["Cubit is used for state. [1]"]

    evaluate.run_evaluation(store, [Case("What does Jobly use?", "Cubit", "cubit")], k=1, answer_fn=answer_fn)
    assert seen["n"] == 1


def test_report_lists_metrics_and_failing_answers(store):
    cases = [Case("What does Jobly use?", "Cubit", "cubit"), Case("What does Tayar use?", "Stripe", "stripe")]
    results = evaluate.run_evaluation(store, cases, k=2,
                                      answer_fn=lambda q, h: ["It uses Stripe for payments. [1]"])
    report = evaluate.format_report(results, k=2)
    assert "hit@1 2/2" in report and "hit@2 2/2" in report
    assert "Answers:   1/2 passed" in report
    assert "answer was: It uses Stripe" in report
    assert "some checks FAILED" in report


# --- command line --------------------------------------------------------------

def test_cli_evaluate_exit_codes(tmp_path, store, monkeypatch, capsys):
    index = tmp_path / "index"
    store.save(index)
    monkeypatch.setattr(cli.config, "INDEX_DIR", index)

    ok = write(tmp_path, [{"question": "What does Jobly use?", "context_contains": "Cubit"}])
    assert cli.main(["evaluate", str(ok), "--retrieval-only", "-k", "1"]) == 0
    assert "all checks passed" in capsys.readouterr().out

    bad = write(tmp_path, [{"question": "What does Jobly use?", "context_contains": "Stripe"}])
    assert cli.main(["evaluate", str(bad), "--retrieval-only", "-k", "1"]) == 1


def test_cli_evaluate_reports_missing_index(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(cli.config, "INDEX_DIR", tmp_path / "none")
    path = write(tmp_path, [{"question": "q"}])
    assert cli.main(["evaluate", str(path), "--retrieval-only"]) == 1
    assert "ingest" in capsys.readouterr().err


# --- known issues ----------------------------------------------------------------

def test_known_issue_is_reported_but_does_not_fail_the_run(store):
    case = Case("What does Jobly use?", "Cubit", "redux", known_issue="model gets this wrong")
    results = evaluate.run_evaluation(store, [case], k=1, answer_fn=lambda q, h: ["It uses Cubit. [1]"])
    assert results[0].answer_ok is False
    assert evaluate.all_passed(results, k=1)
    report = evaluate.format_report(results, k=1)
    assert "known issue (still failing): model gets this wrong" in report
    assert "1 known issue(s) excluded" in report


def test_known_issue_that_starts_passing_is_flagged(store):
    case = Case("What does Jobly use?", "Cubit", "cubit", known_issue="old problem")
    results = evaluate.run_evaluation(store, [case], k=1, answer_fn=lambda q, h: ["It uses Cubit. [1]"])
    assert "NOW PASSES" in evaluate.format_report(results, k=1)


def test_failure_without_known_issue_still_fails(store):
    case = Case("What does Jobly use?", "Cubit", "redux")
    results = evaluate.run_evaluation(store, [case], k=1, answer_fn=lambda q, h: ["It uses Cubit. [1]"])
    assert not evaluate.all_passed(results, k=1)


def test_load_cases_reads_known_issue(tmp_path):
    path = write(tmp_path, [{"question": "q", "known_issue": "why"}])
    assert load_cases(path)[0].known_issue == "why"


def test_known_issue_is_not_reported_as_fixed_when_answers_were_not_checked(store):
    case = Case("What does Jobly use?", "Cubit", "redux", known_issue="model gets this wrong")
    results = evaluate.run_evaluation(store, [case], k=1)  # retrieval only: no answer generated
    report = evaluate.format_report(results, k=1)
    assert "answer not checked in this run" in report
    assert "NOW PASSES" not in report
