# CLAUDE.md

This repository is a monorepo of four independent portfolio projects (four folders) by Al-Nasser Haddad (the owner; pronouns not
stated, so avoid them). Work inside one project folder at a time and read that folder's own `CLAUDE.md` first:

- `ask-my-docs/`: Python, local RAG tool (own `CLAUDE.md`, 150 pytest tests)
- `minierp/`: TypeScript, a small ERP on SQLite in the browser (own `CLAUDE.md`)
- `runway/`: TypeScript, a cash-flow forecast (own `CLAUDE.md`)
- `telegram-cloud-storage/`: Tauri + React + Python, a file manager backed by a private Telegram channel (own `CLAUDE.md`)

Rules for the monorepo as a whole:
- **Each folder must stay self-contained.** No imports, scripts or paths may reach across folders: the owner will copy each
  folder out into its own GitHub repository. Each folder keeps its own `README.md`, `LICENSE`, `.gitignore` and
  `.github/workflows/` (which is inert here and correct when the folder becomes its own repo).
- **CI that actually runs here lives in the root `.github/workflows/`**, one file per project with
  `defaults.run.working-directory` and a `paths` filter. If you change a project's own workflow, change the root one to match.
- `PORTFOLIO_WEBSITE_FIXES.md` at the root is a checklist about the owner's portfolio website, not about any project.
- Do not commit `node_modules/`, `dist/`, `index/`, `.env`, or test results.
- Commit messages: imperative summary, then a short why. Push to `main`.
