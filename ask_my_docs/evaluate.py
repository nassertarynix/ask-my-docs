"""Measure retrieval and answer quality against a fixed set of questions.

A case file is JSON: a list of objects with
  - "question":         the question to ask
  - "context_contains": text that a retrieved chunk should contain (case-insensitive).
                        Leave it out for questions the documents cannot answer.
  - "answer_matches":   a regular expression the answer must match (case-insensitive).
                        Leave it out to check retrieval only.
  - "known_issue":      optional note for a case that is expected to fail. It is still
                        reported, but does not make the run fail, and is flagged if it
                        starts passing so the note can be removed.

Retrieval is scored by the rank of the first chunk containing the expected text.
An answer passes if it matches the pattern and is more than a bare citation.
"""

import json
import re
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path

from .rag import retrieve
from .store import Hit, VectorStore

AnswerFn = Callable[[str, list[Hit]], Iterable[str]]


@dataclass
class Case:
    question: str
    context_contains: str | None = None
    answer_matches: str | None = None
    known_issue: str | None = None


@dataclass
class Result:
    case: Case
    rank: int | None  # 1-based rank of the first chunk containing the expected text
    answer: str | None  # None when the answer was not generated
    answer_ok: bool | None  # None when there was nothing to check


def load_cases(path: Path) -> list[Case]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list) or not data:
        raise ValueError(f"'{path}' must contain a non-empty JSON list of cases.")
    cases = []
    for number, item in enumerate(data, start=1):
        if not isinstance(item, dict) or not isinstance(item.get("question"), str):
            raise ValueError(f"Case {number} in '{path}' needs a 'question' string.")
        pattern = item.get("answer_matches")
        if pattern is not None:
            try:
                re.compile(pattern)
            except re.error as error:
                raise ValueError(f"Case {number}: invalid 'answer_matches' regex ({error}).") from error
        cases.append(Case(item["question"], item.get("context_contains"), pattern,
                          item.get("known_issue")))
    return cases


def first_match_rank(hits: list[Hit], text: str) -> int | None:
    needle = text.lower()
    for rank, hit in enumerate(hits, start=1):
        if needle in hit.chunk.text.lower():
            return rank
    return None


def answer_ok(answer: str, pattern: str) -> bool:
    """The answer matches `pattern` and is more than a bare citation like "[1]"."""
    words = re.sub(r"\[\d+\]", "", answer).split()
    return len(words) >= 3 and re.search(pattern, answer, re.IGNORECASE | re.DOTALL) is not None


def run_evaluation(store: VectorStore, cases: list[Case], k: int,
                   answer_fn: AnswerFn | None = None) -> list[Result]:
    results = []
    for case in cases:
        ranked = retrieve(store, case.question, k=len(store))  # rank over everything
        rank = first_match_rank(ranked, case.context_contains) if case.context_contains else None
        answer = ok = None
        if answer_fn is not None and case.answer_matches:
            answer = "".join(answer_fn(case.question, ranked[:k])).strip()
            ok = answer_ok(answer, case.answer_matches)
        results.append(Result(case, rank, answer, ok))
    return results


def _retrieval_ok(result: Result, k: int) -> bool | None:
    if not result.case.context_contains:
        return None
    return result.rank is not None and result.rank <= k


def _failed(result: Result, k: int) -> bool:
    return _retrieval_ok(result, k) is False or result.answer_ok is False


def all_passed(results: list[Result], k: int) -> bool:
    """True unless a case without a `known_issue` note failed."""
    return not any(_failed(r, k) and not r.case.known_issue for r in results)


def format_report(results: list[Result], k: int) -> str:
    lines = []
    for r in results:
        retrieval = _retrieval_ok(r, k)
        rank = "  -  " if retrieval is None else (f"#{r.rank}" if r.rank else "miss")
        ret_flag = "    " if retrieval is None else ("ok  " if retrieval else "FAIL")
        ans_flag = "    " if r.answer_ok is None else ("PASS" if r.answer_ok else "FAIL")
        lines.append(f"  retrieval {ret_flag} {rank:<5} answer {ans_flag}  {r.case.question}")
        if r.answer_ok is False:
            lines.append(f"      answer was: {' '.join((r.answer or '').split())[:200]}")
        if r.case.known_issue:
            if _failed(r, k):
                status = "still failing"
            elif r.answer_ok is None and r.case.answer_matches:
                status = "answer not checked in this run"  # retrieval-only mode
            else:
                status = "NOW PASSES, consider removing the note"
            lines.append(f"      known issue ({status}): {r.case.known_issue}")

    scored = [r for r in results if r.case.context_contains]
    answered = [r for r in results if r.answer_ok is not None]
    summary = ["", f"Cases: {len(results)}   top-k: {k}"]
    if scored:
        at1 = sum(1 for r in scored if r.rank == 1)
        atk = sum(1 for r in scored if r.rank and r.rank <= k)
        summary.append(f"Retrieval: hit@1 {at1}/{len(scored)}   hit@{k} {atk}/{len(scored)}"
                       f"   ({len(results) - len(scored)} unanswerable case(s) not counted)")
    if answered:
        passed = sum(1 for r in answered if r.answer_ok)
        summary.append(f"Answers:   {passed}/{len(answered)} passed")
    known = sum(1 for r in results if r.case.known_issue and _failed(r, k))
    if all_passed(results, k):
        verdict = "all checks passed" + (f" ({known} known issue(s) excluded)" if known else "")
    else:
        verdict = "some checks FAILED"
    summary.append("Result:    " + verdict)
    return "\n".join(lines + summary)
