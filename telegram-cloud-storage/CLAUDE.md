# CLAUDE.md

Guidance for Claude Code (and any other agent or developer) working in this folder. Read the monorepo root `CLAUDE.md` too.

**Telegram Cloud Storage**: a desktop file manager whose storage is a private Telegram channel, indexed by local SQLite.
Tauri (Rust) window + React/Tailwind UI + Python (FastAPI, aiosqlite, Telethon) sidecar. Portfolio project by Al-Nasser Haddad
(pronouns not stated: avoid them). Keep it honest: README claims need a test or a stated caveat.

## Commands
```bash
pytest -q                      # backend, 124 tests, offline (needs backend/requirements-dev.txt)
npm test                       # vitest, frontend logic
npm run lint
TGCS_E2E_PYTHON=$(which python) npm run e2e      # Playwright; starts the backend (local-folder mode) and `vite preview`
rustc --edition 2021 --test src-tauri/src/sidecar.rs -o /tmp/sidecar_tests && /tmp/sidecar_tests
python -m backend.main --dev   # prints a random token; or set TGCS_TOKEN
node scripts/shots.mjs <outDir> / node scripts/demo/record_demo.mjs <outDir>   # need the backend (seeded) and `vite preview` running
```
Chromium and Playwright are preinstalled in the cloud container (pinned @playwright/test 1.63.0): do not reinstall. `playwright.config.js` uses
`rm -rf .e2e`, so run it from this folder.

## Architecture (see docs/ARCHITECTURE.md)
`chunker.py` (stdlib only) -> `telegram_client.py` (`StorageBackend`: `TelethonBackend`, `LocalDirBackend`) -> `service.py` -> `main.py` (FastAPI).
`database.py` is the only code that touches SQLite. The React UI talks only to the local backend (`src/lib/api.js`).

## Rules (each has a test; keep them)
- **Nothing is committed to the database until every chunk is stored**, and a failed or cancelled upload deletes the chunks it sent.
- **Download verifies size and SHA-256 before delivering**; a mismatch deletes the partial file and errors. Never stream unverified bytes.
- **Every Telegram call goes through `with_retries`** (flood wait sleeps X+1 s; network errors back off; > 15 min is not slept out). Retries must send a *fresh* buffer.
- **The API guard is not optional**: loopback `Host`, allowed `Origin`, per-launch token on every `/api/*` and the WebSocket, size caps while streaming,
  `clean_name` on every name. The host is not configurable. Do not weaken any of these.
- **Secrets** (`api_hash`, `bot_token`, session file) are written 0600 and never returned by the API; `/api/status` reports only whether they are set.
- Schema changes are new migrations appended to `MIGRATIONS`; never edit an old one. Every FK column must lead an index.
- `files.uid` is the one addition to the specified schema; it is also in every caption. Do not rename caption keys without bumping `CAPTION_VERSION`.
- Connecting to Telegram must never block start-up: it is bounded by `connect_timeout` and runs in the background; failures show in `/api/status`.
- UI: user text only through React (escaped). No request to any site but the local backend (a test enforces it). Light and dark follow the system.

## Lessons learned
- **Tests must never touch the network.** A test that configured a real Telethon client hung forever, which exposed a real bug (the app would hang
  at start-up offline). Inject `backend_factory` / `client_factory` with fakes.
- **A fake must behave like the real thing where it matters.** The fake Telethon client first failed *before* reading the upload buffer, so reusing a
  buffer across flood-wait retries looked harmless; real Telethon has already consumed part of it. The fake now reads some bytes before failing.
- **Prove tests have teeth.** Switching each protection off found two tests that passed anyway (the early Content-Length check, the fresh buffer).
- Starlette's `TestClient.websocket_connect` ignores `base_url` and uses host `testserver`: pass an absolute `ws://127.0.0.1:...` URL.
- The `react-hooks` lint rule flags setState inside an effect; load data in an async function with a `cancelled` flag, and trigger reloads with a counter.
- `eslint-plugin-react` does not support ESLint 10; `typescript-eslint` is used to parse JSX.
- Aborting the browser request does not stop the backend once the body is received, so Cancel is offered only while queued or while the file is being handed over.
- Recording video of the UI: see the root notes; this app is desktop-sized, so a plain 1280x800 viewport works (no pinch-zoom trick needed).
- The Tauri shell cannot be compiled without WebKitGTK and GTK development libraries; the std-only `sidecar.rs` is kept separate so it can be tested with plain `rustc --test`.
