# CLAUDE.md

Guidance for Claude Code (and any other agent or developer) working in this repository.

## What this project is

**MiniERP** is a small business-management app (products, stock, sales, purchases, invoices, payments,
reports) that runs entirely in the browser on a real SQLite database (sql.js, WebAssembly), saved in
IndexedDB. No backend, no account. It is a **portfolio project** by Al-Nasser Haddad (the owner), a public
MIT-licensed repo, so keep it honest, tidy and reproducible.

- The owner's pronouns are not stated: avoid pronouns for the owner in docs and messages.
- README claims must be backed by a test or something reproducible. Keep the limitations section honest.

## Commands

```bash
npm install
npm run dev            # Vite dev server
npm test               # Vitest: domain layer on real in-memory SQLite (66 tests)
npm run e2e            # Playwright (builds, serves `vite preview`, runs phone + desktop projects)
npm run typecheck      # tsc --noEmit (strict)
npm run lint           # ESLint
npm run build          # typecheck + static build in dist/ (base "./")
node scripts/shots.mjs <outDir>                 # phone screenshots, light and dark (preview must be running on :4173)
node scripts/demo/record_demo.mjs <outDir>      # records the demo video (preview must be running)
python scripts/demo/finish_video.py <raw.webm> <out.mp4>
```

Chromium and Playwright are preinstalled in the cloud container (Playwright is pinned to 1.63.0 to match
it). Do not run `playwright install` there.

## Architecture

```
src/domain/   business logic, no React and no browser APIs: schema.ts (migrations), db.ts (wrapper, transactions),
              money.ts, dates.ts, products, contacts, stock, sales (orders, invoices, payments), purchases,
              reports, seed (deterministic demo business), csv, errors (DomainError with a code)
src/ui/       React: App (shell, router), erp.tsx (database context, autosave), idb.ts, i18n.tsx + messages/{en,ar}.ts,
              components, charts (hand-written SVG), pages/*
tests/        Vitest, against the real domain layer and a real SQLite database
e2e/          Playwright, against the production build
```

### Rules the domain layer must keep (each has tests)
- Money is **integer cents**; tax is **basis points**; round half up **per line**.
- Stock on hand is `SUM(stock_moves.qty)`. Never store a quantity that could drift.
- Confirming a sales order is **all or nothing** and freezes unit cost on the lines.
- Invoice totals are copied at creation. Invoice **status is derived**, never stored.
- Payments cannot exceed the balance. Receiving a purchase order twice is refused.
- Weighted-average cost uses only the stock still on hand; an empty shelf starts a fresh average.
- Only drafts are editable. Writes run in transactions that roll back on any throw (nested too).
- Schema changes are **new migrations** appended to the list (`PRAGMA user_version`); never edit an old one.
  A file from a newer version is refused.
- Domain functions take a `Ctx` (database + clock). Do not call `Date.now()` in the domain; use `ctx.today()`.

### Design decisions (keep them unless there is a good reason)
- **Error messages are codes**, translated in `messages/{en,ar}.ts`. The domain never contains UI text. Every
  key must exist in both languages: `ar` is typed `Record<MessageKey, string>`, so a missing translation is a compile error.
- **Mobile first**: design at 360 to 430 px, then widen. No horizontal page scroll at any width, touch targets
  at least 44 px, inputs at least 16 px, composer/save bars respect `env(safe-area-inset-*)`, light and dark
  follow `prefers-color-scheme` (with a manual override), respect `prefers-reduced-motion`.
- **Right to left** uses CSS logical properties (`margin-inline-start`, not `margin-left`). Names and amounts are
  bidi-isolated. The Arabic text was written by an AI model and is not reviewed by a native speaker: say so, do
  not claim otherwise.
- **No requests to other sites**: fonts are self-hosted (`@fontsource`), no analytics, no CDN. An e2e test fails otherwise.
- **User text is rendered through React** (escaped); CSV export neutralises spreadsheet formulas.
- **Dependencies stay small**: react, react-dom, react-router-dom (HashRouter, so static hosting needs no rewrites),
  sql.js and fonts. Everything else is dev tooling.
- **Service worker** (`public/sw.js`) runs only in the production build and only touches same-origin GETs.
  Bump `CACHE` when its behaviour changes.

## Conventions

- Strict TypeScript, small functions, a comment that explains *why* when it is not obvious.
- Add a test for every behaviour change. Domain rules get a Vitest test; anything about layout, flow or the
  browser gets an e2e test. Tests must not need the network.
- **Prove tests have teeth**: after adding a protection, switch it off and confirm the matching test fails, then restore it.
- CI (`.github/workflows/ci.yml`): typecheck, lint, unit tests, build; then browser tests. Read-only permissions, no secrets.
- Never commit `dist/`, `node_modules/`, test results, `.env`.
- Commit messages: imperative summary, then a short explanation of *why*. Push to `main`.

## Lessons learned

- **sql.js resets pragmas on export**: `PRAGMA foreign_keys` must be switched back on after exporting the database
  (there is a test).
- **Derived beats stored**: invoice status and stock on hand are computed. Stored copies of them were the first
  thing that could have disagreed with the truth.
- **Seed data must keep the books**: the demo generator checks stock >= 0, payments <= totals and ledger = deliveries,
  and it is deterministic for a given date. Overdue invoices are kept realistic (not hundreds of days late).
- **Recording video of the UI**: Playwright's `recordVideo` ignores `deviceScaleFactor` and leaves the canvas grey.
  Use a mobile-emulated browser with a 780x1848 viewport and a `width=390` meta viewport (a pinch-zoom). The script
  injects a caption strip and a finger overlay for the video only. Verify frame corners are not grey (128,128,128).
  This demo is **live** (nothing replayed); typing speed and pauses are chosen to be readable.
- **Bidi**: mixed Arabic names and Latin digits reorder unless wrapped in an isolate; see the Arabic polish commit.
- **Offline test**: wait for the service worker to take control and fill its cache before going offline.
- **The WebAssembly file** is imported through Vite (hashed name, cached by the service worker), not copied into `public/`.

## Working in a Claude Code cloud session

The container is ephemeral. Push often. The Claude GitHub App must be installed on the repository's account
before pushes work (a 403 "Claude doesn't have GitHub access" means it is not). Foreground `sleep` is blocked;
wait with a polling loop instead.
