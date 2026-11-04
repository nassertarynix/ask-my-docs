# CLAUDE.md

Guidance for Claude Code (and any other agent or developer) working in this repository.

## What this project is

**Ask My Docs** is a small, local **retrieval-augmented generation (RAG)** tool. You point it
at a folder of `.md` or `.txt` files, ask a question in plain language, and it answers using
only the most relevant passages, citing them as `[1]`, `[2]`. If the documents do not contain
the answer it says "I don't know based on the provided documents." Everything runs locally
with [Ollama](https://ollama.com), so no API key, no cost, and no data leaves the machine.

It is a **portfolio project** by Al-Nasser Haddad (the owner), published as a public MIT-licensed
repo at `nassertarynix/ask-my-docs`. Because it is public and meant to impress, keep it honest,
tidy, and reproducible.

Things to know about the owner's situation:
- The owner **does not intend to run the project locally**. The demo videos in `docs/demo/`
  are the project's demo; the owner adds a portfolio card linking to the repo by hand.
- The owner's pronouns are not stated: avoid pronouns for the owner in docs and messages.
- A separate private list of mistakes on the owner's portfolio website exists outside this
  repo. Do not copy it into this public repo.

## Commands

```bash
# one-time setup
ollama pull nomic-embed-text && ollama pull llama3.2:3b
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt

python -m ask_my_docs ingest portfolio_docs          # build the index (writes ./index, gitignored)
python -m ask_my_docs ask "Which state management does Jobly use?"
python -m ask_my_docs ask "..." --no-llm             # retrieval only, no chat model
python -m ask_my_docs serve                          # web UI at http://127.0.0.1:8000
python -m ask_my_docs evaluate evals/portfolio.json --retrieval-only   # fast
python -m ask_my_docs evaluate evals/portfolio.json                    # also answers, ~5 min on CPU
pytest -q                                            # 60 tests, no Ollama needed
```

## Architecture

```
ask_my_docs/
  config.py       settings from environment variables (defaults target local Ollama)
  chunking.py     chunk_text(): paragraphs -> lines -> sentences -> fixed windows, with overlap
  embeddings.py   embed(): OpenAI-compatible API, batched, L2-normalised float32 vectors
  store.py        Chunk (text, source, index, title), Hit, VectorStore (cosine search; JSON + .npy)
  ingest.py       load_documents(), extract_title(), build_index()
  rag.py          retrieve(): embed the question, return top-k hits
  generate.py     SYSTEM_PROMPT, build_messages(), stream_answer() (streams tokens)
  evaluate.py     load_cases(), run_evaluation(), format_report(); supports "known_issue"
  web.py          FastAPI app: GET /, GET /api/status, POST /api/ask (newline-delimited JSON stream)
  cli.py          argparse commands: ingest, ask, evaluate, serve
  static/index.html   the whole frontend: plain HTML/CSS/JS, no build step
sample_docs/      fictional "Orbit Labs" handbook: generic demo and test corpus
portfolio_docs/   documents about the owner, built from the public portfolio and project READMEs
evals/            JSON question sets for `evaluate` (portfolio.json, handbook.json)
tests/            pytest: chunking, store and prompt, ingest, web API (mocked), evaluation
docs/             screenshot.png and demo/ (web_demo.mp4/.gif, terminal_demo.mp4)
scripts/demo/     scripts that record the demo videos (see its README)
```

Data flow. **Ingest:** files -> chunk -> embed `title + chunk` with the `search_document: `
prefix -> `VectorStore` -> `index/`. **Ask:** question -> embed with `search_query: ` ->
top-k by dot product -> prompt (rules + numbered passages + question) -> streamed answer.

The web stream sends one JSON object per line: `{"type":"sources"}` first, then many
`{"type":"token"}`, then `{"type":"done"}` or `{"type":"error"}`.

### Design decisions (keep them unless there is a good reason)
- **No vector database.** A NumPy matrix and one matrix multiply is enough at this scale.
- **OpenAI-compatible client** so local Ollama and hosted models share one code path
  (`LLM_BASE_URL`, `LLM_API_KEY`, `CHAT_MODEL`, `EMBED_MODEL`). Clear the `EMBED_*_PREFIX`
  variables for models that do not use nomic's task prefixes.
- **No frontend framework.** Model and document text is inserted with `textContent`, never
  as HTML. Keep it that way.
- **Dependencies stay minimal:** `openai`, `numpy`, `fastapi`, `uvicorn`; dev: `pytest`, `httpx`.
- **`TEMPERATURE` defaults to 0** so answers and evaluation results are repeatable.
- The server has no authentication and binds to `127.0.0.1`. Do not suggest exposing it.

## Conventions

- Python 3.10+, type hints, small functions, a docstring that explains *why* when it is not obvious.
- **Tests must pass without Ollama or network.** Mock `retrieve`, `stream_answer`, `embed` and
  the OpenAI client (see `tests/test_web.py`, `tests/test_evaluate.py`). Add a test for every
  behaviour change.
- Never commit `index/`, `.env`, API keys, or downloaded model files (see `.gitignore`).
- Commit messages: imperative summary, then a short explanation of *why*. Push to `main`.
- README claims must be backed by something reproducible. Prefer `evaluate` output over
  anecdotes, and keep stated limitations honest.

## Lessons learned (read before changing prompts, chunking or documents)

- **Retrieval was never the bottleneck; the prompt and the small model were.** With
  `llama3.2:3b`, a vague prompt produced bare `[1]` answers, and labelling passages as
  `[1] (...)` made the model copy the label. The current prompt uses explicit rules, labels
  like `Passage 1 (title - file):`, and puts the instruction *after* the question. Re-test
  with `evaluate` after any wording change; small models are fragile.
- **Chunking:** splitting long bullet lists at arbitrary characters made orphan fragments that
  lost the project name. Split at line breaks, then sentence ends. Chunks deliberately start
  with the tail of the previous chunk (overlap), so a chunk beginning mid-sentence is expected.
- **Embedding the document title with every chunk** improved ranking: middle chunks often do
  not name what they are about.
- **Document structure matters.** Contact details buried at the end of a long profile were
  retrieved poorly. Short, separate documents with one fact per plain sentence work best.
- **Single runs of a language model mislead.** A case passed once and failed 4 of 5 repeats at
  temperature 0.1. Hence temperature 0 and the `known_issue` mechanism.
- **Known weakness:** the 3B model gets list answers wrong (the "courses completed in 2026"
  case). It is recorded as a `known_issue` in `evals/portfolio.json`. A larger or hosted
  model is the fix, via configuration only.
- **Do not tune documents or prompts just to turn a failing case green** without saying so.
  The question sets were written by the author while developing, so scores are optimistic
  and best used to catch regressions. The README states this.

## Evaluating changes

1. Changed chunking, embeddings, or documents: run `evaluate ... --retrieval-only` (seconds).
2. Changed the prompt, model, or temperature: run the full `evaluate` and read the actual
   answers, not just the score.
3. Update the results table in the README if the numbers change.
4. Re-index after changing documents or chunking: `python -m ask_my_docs ingest <folder>`.
   (`serve` reloads the index automatically when `index/chunks.json` changes.)

## `portfolio_docs/`: confirmed facts (source of truth)

These were confirmed by the owner. Keep the documents consistent with them.
- **TAYAR** was the **graduation project**: the 5th and final year (2024-2025) of the five-year
  Software Engineering degree at Damascus University (class of 2025). It has **three apps**:
  a Flutter shop app, a Flutter worker app, and a **React admin dashboard** (not Flutter).
  The backend is **Laravel**.
- **Jobly** was a **fourth-year** project, not the graduation project. React is used for its
  dashboards.
- **Tecno Library** (keep the spelling "Tecno"; the repo is named Techno-Library): a 2023
  third-year group project. Flutter + GetX frontend, **Laravel** backend, **Firebase for
  notifications**.
- The portfolio lists the stack the owner **personally worked in** on each project; the CV
  lists the full stacks the apps were built with.
- When facts are unclear, ask the owner. Do not guess, and do not invent details.

## Working in a Claude Code cloud session

The container is **ephemeral**: Ollama, the models, and anything uncommitted vanish when it is
reclaimed. Push often. To rebuild the environment:

```bash
apt-get update && apt-get install -y zstd
curl -fsSL https://ollama.com/install.sh | sh
nohup ollama serve > /tmp/ollama.log 2>&1 &
ollama pull nomic-embed-text && ollama pull llama3.2:3b
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
```

- `ollama.com` and `huggingface.co` are reachable; `api.github.com` user endpoints are not.
- The box has about 4 CPUs and 15 GB RAM. `llama3.2:3b` answers in roughly 5 to 15 seconds.
  Warm the model with one query before recording or timing anything.
- Pushing needs the Claude GitHub App installed on the `nassertarynix` account for this repo.
  A `fatal: expected 'acknowledgments'` line during push is a harmless negotiation warning.
- Re-record the demos with `scripts/demo/` if the UI or behaviour changes. Keep the note in
  the terminal demo saying that typing and streaming speed are simulated.
