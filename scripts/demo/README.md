# Recording the demos

These scripts produced the videos in `docs/demo/`. Re-record them after the interface or
behaviour changes noticeably.

Needs: Ollama running with the two models pulled, the project dependencies, Node.js with
Playwright (`require('playwright')`), and `ffmpeg`.

## Mobile demo (a real recording)

```bash
python -m ask_my_docs ingest portfolio_docs
python -m ask_my_docs ask "warm up" -k 1 > /dev/null     # load the model first
python -m ask_my_docs serve --port 8000 &
node scripts/demo/record_web.js out/                      # writes out/*.webm and out/marks.json
python scripts/demo/finish_video.py out/*.webm out/marks.json docs/demo/web_demo.mp4
```

`record_web.js` drives a real phone-sized browser (390x844 at 2x, touch enabled). The app runs
unmodified inside an iframe on a small "stage" page that adds a caption strip above it and a
finger that shows taps and swipes, because headless browsers draw neither. It types the
questions, taps, and waits for the real model to answer. At the end it flips the colour scheme
to show both themes (`DEMO_THEME=light` starts in light mode instead).

Recording at this resolution makes the CPU-only model about twice as slow as usual, so the
stretches spent waiting for the model are marked, shown with a "2x SPEED" tag, and played at
double speed by `finish_video.py`. Keep the tag: it is what makes the speed-up honest.

## Command-line demo (a replay of real output)

```bash
python scripts/demo/capture_output.py captured.json            # runs the real commands
python scripts/demo/build_terminal.py captured.json terminal.html
node scripts/demo/record_terminal.js out/ "$(pwd)/terminal.html"
```

The output is captured from real runs. The video then types the commands and streams the
answer at a simulated speed, and a note inside the video says so. Keep that note.
