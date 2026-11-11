# CLAUDE.md

Guidance for Claude Code (and any other agent or developer) working in this folder.

**Media Downloader** is a local web app (FastAPI + one HTML page with Tailwind CDN and vanilla JS) that downloads video and audio by running
the `yt-dlp` command as a subprocess. It is a portfolio project by Al-Nasser Haddad (the owner; pronouns not stated, so avoid them). Keep it honest,
tidy and reproducible; README claims must be backed by a test. The README tells people to download only what they have the right to.

## Commands

```bash
pip install -r requirements-dev.txt && python -m playwright install chromium
python main.py --open            # http://127.0.0.1:8000 (MD_PORT, MD_DATA_DIR, MD_MAX_CONCURRENT)
pytest -q                        # unit + manager + API + browser tests (real yt-dlp and ffmpeg, local media server)
pytest -m network                # opt-in: real YouTube (a CC short film); failures there usually mean "update yt-dlp"
python scripts/shots.py docs     # retake the README screenshots from the real app
```
Chromium and Playwright are preinstalled in the cloud container: do not run `playwright install` there. Use the container's Chromium with
`MD_CHROMIUM=/opt/pw-browsers/chromium-<n>/chrome-linux64/chrome` (the Python package may be a different version from the preinstalled one).

## Architecture (see docs/ARCHITECTURE.md)
- `downloader.py`: all subprocess work (`JobManager`, `Job`, progress parser, cancel, retry, folder dialog, `normalize_info`). `options.py`: validation and
  command building. `settings.py`: saved settings and cookies. `errors.py`: stderr -> code + message + hint. `main.py`: routes and the request guard.
- `static/index.html`: the whole UI. `tests/`: `media_server.py` (local server, also a forward proxy), `fake_ytdlp.py`, `helpers.py`, `e2e/` (Playwright).

## Rules (keep them; each has a test)
- **Never `import yt_dlp`.** Always run the command with `asyncio.create_subprocess_exec` (no shell), `start_new_session=True`, and stop it by signalling the process group.
- **User input never becomes a flag.** Use `--flag=value`, put `--` before the URL, validate every value, reject unknown option keys, keep `--ignore-config`, offer no exec options.
- **Loopback only**: the host is not configurable; the `Host` and `Origin` checks and the CSP stay.
- **Cancel leaves nothing behind**: each job downloads into its own temp dir (`--paths=temp:`), removed *before* the final state is announced.
- Progress comes from `--newline --progress-template` lines: **downloads print on stdout, post-processing on stderr**, so read both.
- The final status is decided once (`job._outcome`) and published once, after cleanup.
- A proxy password is masked in every response; settings and uploaded cookies are written with mode 0600.
- Remote text (titles, errors, filenames) is rendered with `textContent`/`createElement`, never `innerHTML`. Thumbnails load only from `http(s)`.
- Format presets use `<=?` (`bv*[height<=?1080]+ba/b[height<=?1080]`) so sources with an unknown height still download.

## Lessons learned
- **`el.replaceChildren(null)` writes the text "null".** Filter out missing children (this showed up three times: thumbnail, error box, card thumbnail).
- **Tailwind's `grid`/`flex` beat the `[hidden]` attribute** (same specificity, later in the cascade). `index.html` has `[hidden]{display:none!important}`; without it the audio and video option panels showed together.
- **Grid and flex items need `min-width:0`** or a long title or an input pushes a phone's page sideways (`.grid > *, .flex > *` rule).
- Pin the Tailwind CDN version (`/3.4.17`); the unpinned URL redirects. The CDN script runs under the CSP with `script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com` (no `unsafe-eval` needed).
- `--print`/`PP` lines for post-processing go to **stderr**; an earlier `2>&1` experiment hid that.
- `[height<=N]` fails on sources without a height ("Requested format is not available"); use `<=?`.
- yt-dlp never uses a proxy for loopback addresses, so a proxy test must use a made-up host name (`media.invalid`) through the media server's forward-proxy mode.
- A format string that starts with `-` would be read as a flag; it is rejected.
- Two `conftest.py` files cannot both be imported as `conftest`; shared test helpers live in `tests/helpers.py`.
- Playwright's Python package may not match the container's browser build: pass `executable_path` (`MD_CHROMIUM`) rather than reinstalling.

## Conventions
- Strict, small functions, a comment that explains *why*. A test for every behaviour change; **prove tests have teeth**: switch the protection off, see the test fail, restore it.
- Tests must not need the internet (only `-m network` does) and must not touch the real home folder (use `MD_DATA_DIR` and a temporary `HOME`).
- Never commit `.env`, downloads, `__pycache__/`, test output. The folder must stay self-contained (no imports or paths outside it).
- Commit messages: imperative summary, then a short why. Push to `main`.
