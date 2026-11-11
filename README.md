# Portfolio projects by Al-Nasser Haddad

Six separate projects in one repository. Each folder is self-contained, with its own README, tests,
CI workflow, `CLAUDE.md` and demo, so a folder can be copied out into a repository of its own.

| Folder | What it is | Stack | Demo |
| --- | --- | --- | --- |
| [`ask-my-docs/`](ask-my-docs) | **Ask My Docs**: ask questions about your own `.md`, `.txt` and `.pdf` files and get answers that cite their sources. Runs locally with Ollama: no API key, no cost, no data leaves the machine. | Python, FastAPI, NumPy, Ollama | [web demo](ask-my-docs/docs/demo/web_demo.mp4), [terminal demo](ask-my-docs/docs/demo/terminal_demo.mp4) |
| [`minierp/`](minierp) | **MiniERP**: products, stock, sales orders, invoices, payments, purchases and reports on a real SQLite database running in the browser. English and Arabic (right to left), works offline. | TypeScript, React, SQLite (WebAssembly) | [demo](minierp/docs/demo/minierp_demo.mp4) |
| [`runway/`](runway) | **Runway**: a cash-flow forecast. List what comes in and goes out, and see the balance month by month and the date the money runs out. | TypeScript, React | [demo](runway/demo/runway_demo.mp4) |
| [`telegram-cloud-storage/`](telegram-cloud-storage) | **Telegram Cloud Storage**: a desktop file manager that keeps files in a private Telegram channel, split into verified chunks and indexed by local SQLite. Folders, drag and drop, live progress, index recovery from the channel. | Tauri (Rust), React, Tailwind, Python (FastAPI, SQLite, Telethon) | [demo](telegram-cloud-storage/docs/demo/telegram_cloud_storage_demo.mp4) |
| [`telegram-media-bot/`](telegram-media-bot) | **Telegram Movie & Anime Library Bot**: post videos to a private channel with a metadata caption; the bot indexes them into SQLite and users search and receive them through inline menus (title, season, episode, quality). Survives expired file ids by re-fetching the post. | Python, Telethon, SQLite | [simulated walkthrough](telegram-media-bot/docs/walkthrough.txt) |
| [`media-downloader/`](media-downloader) | **Media Downloader**: a local web app that downloads video and audio from YouTube and other sites supported by yt-dlp, with live progress, cancel, playlist selection, cookies, proxy and user-agent settings. yt-dlp runs as a subprocess, never as a library. | Python, FastAPI, SSE, Tailwind (CDN), vanilla JS | [screenshots](media-downloader/docs) |

Each project's README explains what it does, how to run it, how it is tested, and its honest limitations.

## Checks

Each project has its own workflow in `.github/workflows/` that runs only when that folder changes:
`ask-my-docs.yml` (pytest, Python 3.10 to 3.13), `minierp.yml` and `runway.yml` (type check, lint, unit tests, build, then browser tests), `telegram-media-bot.yml` (pytest on Python 3.10 to 3.13), `media-downloader.yml` (pytest with FFmpeg and Playwright on Python 3.10 to 3.13), and `telegram-cloud-storage.yml` (backend tests on Python 3.11 to 3.13, frontend lint, tests and build, browser tests, the Rust sidecar tests).

## Taking one project into its own repository

Copy the folder out and push it. Each folder already contains its own `.github/workflows` and `.gitignore`:

```bash
git clone https://github.com/nassertarynix/ask-my-docs.git
cp -r ask-my-docs/minierp ~/minierp     # or ask-my-docs/ask-my-docs, or ask-my-docs/runway
cd ~/minierp && git init -b main && git add . && git commit -m "Initial commit"
git remote add origin https://github.com/<you>/<new-repo>.git && git push -u origin main
```

(Inside this repository the project folder `ask-my-docs/` has the same name as the repository itself, so the path above is `ask-my-docs/ask-my-docs` for that one.)

`PORTFOLIO_WEBSITE_FIXES.md` is a separate checklist of corrections for the portfolio website and the project READMEs it shows; it belongs to none of the projects.

## Licence

MIT. Each project folder has its own `LICENSE`.
