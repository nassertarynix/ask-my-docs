# Media Downloader

A local web app for downloading videos and audio from YouTube and the many other sites that
[yt-dlp](https://github.com/yt-dlp/yt-dlp) supports. You run it on your own computer, open it in your browser, paste a link,
pick a quality, and watch the download with a live progress bar. Nothing is uploaded anywhere and there is no account.

Python (FastAPI, Uvicorn) on the back end; one HTML page with Tailwind CSS (CDN) and plain JavaScript on the front end.

| Choose quality and folder | Live queue | Advanced settings | On a phone |
| :-: | :-: | :-: | :-: |
| <img src="docs/desktop-details.png" width="220"> | <img src="docs/desktop-queue.png" width="220"> | <img src="docs/desktop-settings.png" width="220"> | <img src="docs/phone-queue.png" width="130"> |

The screenshots were taken from the real app downloading a short generated test video from a local test server, not from a website.

> **Only download what you have the right to download.** Many videos are protected by copyright and most sites' terms of service
> forbid saving their content. This tool does not bypass paywalls or DRM; it is meant for your own uploads, Creative Commons and
> public-domain media, and other content you are allowed to keep. You are responsible for how you use it.

## What it does

- **Details first**: paste a link and press *Fetch details* to see the title, thumbnail, length and the qualities that exist. A playlist
  or channel shows its items with checkboxes, so you can download some of them.
- **Video or audio**: pick a quality (1080p, 4K, ... only the ones the video really has), a file type (MP4, MKV, WebM), or *Audio only* as MP3, M4A, FLAC, Opus,
  WAV, AAC or Vorbis. Merging separate video and audio streams and converting audio use FFmpeg.
- **Live progress**: percentage, speed, ETA, size, which stage it is in (downloading, FFmpeg processing), and which playlist item it is on.
  Several downloads can be queued; two run at a time.
- **Cancel really cancels**: the download process and everything it started are stopped, and the half-written files are removed. Items of a playlist that
  had already finished are kept.
- **Choose where it goes**: type a folder, or press *Browse...* for the computer's own folder dialog. On a machine without one (a server, a container)
  the page shows its own folder browser instead.
- **Anti-bot settings** (*Advanced settings*): use your browser's cookies (Chrome, Firefox, Edge, Brave, ...) or a `cookies.txt` file, a custom user agent, an HTTP or SOCKS5 proxy,
  and an *Update yt-dlp* button (sites change often, and an out-of-date yt-dlp is the usual reason a download suddenly stops working).
- **Honest errors**: an invalid link, a private or removed video, a region block, an age or "confirm you're not a bot" check, a dropped connection (retried twice
  before giving up), a full disk, a missing FFmpeg or a YouTube signature-extraction failure each get a plain explanation and a suggestion, not a stack trace.
- **Survives a page reload**: the queue is rebuilt from the server and running downloads keep updating.

## Run it

You need Python 3.10 or newer and **FFmpeg** on your `PATH` (`sudo apt install ffmpeg`, `brew install ffmpeg`, or `winget install ffmpeg`).
FFmpeg is only needed for audio extraction and for joining separate video and audio streams, and the page tells you if it is missing.

```bash
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python main.py --open                                  # http://127.0.0.1:8000
```

| Setting | How | Default |
| --- | --- | --- |
| Port | `MD_PORT=8080 python main.py` | 8000 |
| Where settings and uploaded cookies are kept | `MD_DATA_DIR=/path` | `~/.media-downloader` |
| Downloads running at once | `MD_MAX_CONCURRENT=3` | 2 |
| Log level | `LOG_LEVEL=DEBUG` | INFO |

The download folder defaults to `~/Downloads` and can be changed in *Advanced settings* or per download.

### Cookies, proxy and user agent

- **Browser cookies** let yt-dlp act as your signed-in browser (age-restricted or members-only videos, "confirm you're not a bot" checks). Pick the browser (and a profile name if you use
  more than one). The browser may need to be closed on some systems, and on macOS or Windows you may be asked to unlock the key store.
- **cookies.txt**: export one with a browser extension, then upload it or give the path of the file. An uploaded file is stored in the data folder, readable only by you.
- **Proxy**: `http://host:port`, `socks5://host:port`, or with a login: `http://user:password@host:port`. The password is never sent back to the page; it shows as `***@host`.
- Only one cookie source is used at a time; choosing one replaces the other.

## How it is built

```
main.py         FastAPI app: the routes, the security checks, the page, the progress stream
downloader.py   everything that runs yt-dlp: command execution, progress parsing, jobs, cancel, retry, folder dialog, JSON clean-up
options.py      turns user input into yt-dlp arguments, with strict validation (no user text can ever become a flag)
settings.py     saved settings, uploaded cookies, proxy masking
errors.py       yt-dlp's error text -> a short code, a message and a hint
static/index.html   the whole front end
tests/          unit, manager, API and browser tests (tests/e2e)
```

Choices, and why (more in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)):

- **yt-dlp is never imported, only run as a process** (`asyncio.create_subprocess_exec`). A crash or a hang in an extractor cannot take the server down, downloads do not compete for
  Python's GIL, and cancelling is a signal to a process group rather than a flag you hope the library checks.
- **Progress is parsed from yt-dlp's own output** using `--newline` and a `--progress-template`, so the numbers are exactly what yt-dlp reports, for the download stage and for the FFmpeg stage.
- **Live updates use Server-Sent Events** (`EventSource`), written by hand with a streaming response, so there is no extra dependency. Updates are throttled to about five a second, and a slow
  browser only ever receives the latest state.
- **It only listens on `127.0.0.1`**, and the host is not configurable. The server also refuses requests whose `Host` or `Origin` is not the app itself, so another website you have open cannot
  drive it (that is what stops a "DNS rebinding" or cross-site request from starting downloads on your machine).
- **User text never becomes a command-line flag.** Every value is validated, passed as `--flag=value`, and the link comes after `--`. Unknown option names are refused, config files are ignored
  (`--ignore-config`) and options that could run programs are not offered.
- **Text from other websites is never rendered as HTML.** Titles, error messages and the like are written with `textContent`, thumbnails only load from `http(s)`, and a Content Security Policy is sent.

## API

| Endpoint | Purpose |
| --- | --- |
| `POST /api/info` `{url}` | Title, thumbnail, duration, `is_playlist`, `entries` (playlists), `formats` (resolution, fps, bitrate, codecs) and `available_heights` |
| `POST /api/download` `{url, format_selection, output_path, extract_audio, audio_format, options}` | Queue a download, returns `{job_id}` |
| `GET /api/download/stream?job_id=` | Server-Sent Events: `update` (status `queued`, `downloading`, `post-processing`, `completed`, `failed`, `cancelled`, percent, speed, ETA, stage, ...) and a final `end` |
| `POST /api/download/cancel` `{job_id}` | Stop a download and remove its partial files |
| `GET /api/jobs`, `DELETE /api/jobs/{id}` | The queue, and removing a finished entry |
| `GET /api/browse-directory` | The native folder dialog (501 if there is none); `?mode=list&path=` lists sub-folders for the built-in browser |
| `GET /api/system/status`, `POST /api/system/update-ytdlp` | Versions of yt-dlp and FFmpeg; `yt-dlp -U`, or `pip install --upgrade yt-dlp` when it was installed with pip |
| `GET/PUT /api/settings`, `POST/DELETE /api/settings/cookies` | Saved cookies, proxy, user agent, folder |

`options` accepts `proxy`, `user_agent`, `cookies_from_browser`, `cookies_file`, `no_playlist`, `playlist_items`, `container` and `embed_metadata`, and overrides the saved settings for that one request.
The interactive API docs are switched off on purpose (less surface); the table above is the whole API.

## Tests

```bash
pip install -r requirements-dev.txt
python -m playwright install chromium     # once, for the browser tests
pytest -q                                 # everything except the real-YouTube tests
pytest -m network                         # opt in: real YouTube (a Creative Commons short film)
```

The tests run the **real yt-dlp and FFmpeg** against a small local web server (real generated video files, a playlist feed, a throttled route, routes that fail on purpose, and a proxy), plus a
fake yt-dlp for the cases that are hard to produce for real (hangs, garbage output, bot checks, child processes that outlive their parent). The browser tests drive the real page in Chromium:
fetching details, video and audio downloads, cancelling, playlists, settings, the folder browser, layout from 320 to 1280 px, and that text from other websites stays text.
Set `MD_CHROMIUM` to use a Chromium that is not Playwright's own. `python scripts/shots.py docs` retakes the screenshots.

## Honest limitations

- **Sites change and yt-dlp has to keep up.** If downloads start failing with "signature extraction" or "403" errors, press *Update yt-dlp* first. The real-YouTube tests are opt-in because they depend on
  YouTube's behaviour that day.
- **YouTube increasingly asks to prove you are not a bot**, especially from data-centre addresses. Cookies from a signed-in browser are the usual fix; nothing here can guarantee a download.
  The author's own check from a cloud sandbox is a good example: fetching a video's details from YouTube worked, but the media fragments came back `HTTP 403` (also with plain `yt-dlp`), so a full real-YouTube
  download was **not** verified end to end there. The download path itself is tested thoroughly against a local server; the opt-in `pytest -m network` run skips with the reason when YouTube refuses.
- **The native folder dialog needs a desktop session** with Python's `tkinter`. Without it the page falls back to its own folder browser, which lists the folders of the computer the app runs on.
- Only one user and one computer: it is a local tool, with no login and no way to reach it from another machine (by design).
- The queue lives in memory: restarting the app forgets the list (finished files stay on disk). A download interrupted by a restart is not resumed.
- Live streams and DRM-protected media are not supported. Windows is handled in the code (process-tree termination) but the automated tests run on Linux.

## Licence

MIT. See [LICENSE](LICENSE). yt-dlp is released under the Unlicense, FFmpeg under the LGPL/GPL depending on its build; neither is bundled here.
