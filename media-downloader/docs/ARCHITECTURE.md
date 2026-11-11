# Architecture

```
browser (static/index.html)
   │  fetch()  POST /api/info, /api/download, /api/download/cancel ...
   │  EventSource  GET /api/download/stream?job_id=
   ▼
main.py  ── guard middleware (Host, Origin, CSP, no-store) ── routes
   │
   ├── options.py     validate + build the yt-dlp argument list      (no user text becomes a flag)
   ├── settings.py    ~/.media-downloader/settings.json, cookies.txt (0600), proxy masking
   └── downloader.py  JobManager ── asyncio.create_subprocess_exec ──► yt-dlp (separate process group) ──► ffmpeg
                         ▲                                              │ stdout: PROG lines   stderr: PP lines, errors
                         └──────────── parse, throttle (5/s), publish ◄─┘
errors.py   stderr text ──► {code, message, hint, retryable}
```

## One download, step by step

1. `POST /api/download` validates the link (`http(s)` only, no spaces), the options, the format selection and the audio format, resolves the folder, and asks the manager to `start`.
   The job is `queued` until one of `MD_MAX_CONCURRENT` slots (a semaphore) is free.
2. The command is `yt-dlp --ignore-config --newline --progress --no-simulate --progress-template=download:PROG\x1f... --progress-template=postprocess:PP\x1f... --print=after_move:DONE\x1f%(filepath)s
   --paths=temp:<job temp dir> --paths=home:<folder> -o <template> [-f ...] [-x --audio-format ...] -- <url>`. Fields are separated by the unit separator `\x1f`, which cannot occur in the numbers, so parsing never guesses.
3. Both pipes are read line by line. `PROG` updates percent, speed, ETA, bytes and the current stream (`part`), `PP` flips the stage to FFmpeg processing, `DONE` records a finished file,
   and `[download] Downloading item N of M` updates the playlist counter. Publishing is throttled to about 5 per second; the last state is always published.
4. Subscribers (the SSE responses) each hold a queue of length one that keeps only the newest snapshot, so a slow browser cannot make the server buffer. An idle stream gets a keep-alive comment every 15 s.
5. When the process exits, the outcome is decided **once**: completed (exit 0), completed with a "Finished with errors" note (some playlist items failed), failed (classified error), or cancelled.
   Retryable errors (network, rate limit) wait 3 s then 8 s and retry twice; the wait itself can be cancelled.
6. In `finally` the job's temp directory is removed, **then** the final state is published, so by the time a browser sees "Cancelled" or "Failed" no half-written file is left.

## Cancelling

`cancel` records the outcome as cancelled, sends SIGTERM to the process group (so FFmpeg dies with yt-dlp), waits briefly, then SIGKILL. On Windows it runs `taskkill /T /F`.
Because downloads go to `--paths=temp:`, partial files live only in the job's temp folder, which is deleted. Finished playlist items were already moved to the target folder and are kept.

## Security model

- Bound to `127.0.0.1` only (not configurable). Requests whose `Host` is not a loopback name, or whose `Origin` is present and not the app's own origin, get 403. A cross-site page or a DNS-rebinding attack cannot use the API.
- Input validation (`options.py`): URL scheme/length/whitespace; proxy scheme and shape; user agent without control characters; browser names from a list; cookie file path must exist and be a file;
  format selections limited to a safe character set and may not start with `-`; playlist items like `1,3-5`. Unknown option keys are an error.
- yt-dlp runs with `--ignore-config`, so a config file on the machine cannot add exec hooks. No `--exec`-style option exists in the API.
- Responses carry `Content-Security-Policy` (scripts only from the app and the pinned Tailwind CDN URL, no frames, no `base`), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`; API responses are `no-store`.
- Proxy passwords are masked in `GET /api/settings`; sending the masked text back keeps the stored password. Settings and uploaded cookies are written with mode 0600.
- The front end builds DOM with `createElement`/`textContent`; thumbnails are `http(s)` only and sent with `referrerpolicy="no-referrer"`.

## Format choices

The UI sends a yt-dlp format selector: *Best* = `bv*+ba/b`; a height = `bv*[height<=?H]+ba/b[height<=?H]` (`<=?` keeps formats whose height is unknown); *Audio only* = `ba/b` with `-x --audio-format`;
an exact format id = that id, plus `+ba` when it has no audio. The container option maps to `--merge-output-format`.

## Testing approach

Everything that can run the real thing does: the real yt-dlp and FFmpeg download real generated files from a local server that can throttle, drop connections, serve a playlist feed, act as a proxy
and record the request headers it saw. A fake yt-dlp covers hangs, garbage, bot checks and orphan child processes. Browser tests run the real page in Chromium. Real YouTube is opt-in (`pytest -m network`).
