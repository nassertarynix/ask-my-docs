# Recording the demos

These scripts produced the videos in `docs/demo/`. Re-record them after the interface or
behaviour changes noticeably.

Needs: Ollama running with the two models pulled, the project dependencies, Node.js with
Playwright (`require('playwright')`), and `ffmpeg`.

## Web interface demo (a real recording)

```bash
python -m ask_my_docs ingest portfolio_docs
python -m ask_my_docs ask "warm up" -k 1 > /dev/null     # load the model first
python -m ask_my_docs serve --port 8000 &
node scripts/demo/record_web.js out/                      # writes a .webm into out/
ffmpeg -ss 0.9 -i out/*.webm -c:v libx264 -crf 22 -pix_fmt yuv420p -movflags +faststart -an docs/demo/web_demo.mp4
```

`record_web.js` drives a real browser: it types the questions, clicks, and waits for the
real model to answer. A cursor and short captions are injected into the page for the video
only; the app itself is unchanged. Window size is 1180x740 so the interface is readable.

## Command-line demo (a replay of real output)

```bash
python scripts/demo/capture_output.py captured.json            # runs the real commands
python scripts/demo/build_terminal.py captured.json terminal.html
node scripts/demo/record_terminal.js out/ "$(pwd)/terminal.html"
```

The output is captured from real runs. The video then types the commands and streams the
answer at a simulated speed, and a note inside the video says so. Keep that note.
