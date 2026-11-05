# Recording the demos

These scripts produced the videos in `docs/demo/`. Re-record them after the interface or
behaviour changes noticeably.

Needs: Ollama running with the two models pulled, the project dependencies, Node.js with
Playwright (`require('playwright')`), and `ffmpeg`.

## Mobile demo (a real browser, with replayed answers)

```bash
mkdir demo_docs && cp portfolio_docs/*.md sample_docs/orbit_labs_expenses.pdf demo_docs/   # notes + a PDF
python -m ask_my_docs ingest demo_docs
python -m ask_my_docs serve --port 8000 &
node scripts/demo/capture_streams.js streams.json        # real answers + timing; run with the CPU idle
node scripts/demo/record_web.js out/ streams.json         # writes out/*.webm
python scripts/demo/finish_video.py out/*.webm docs/demo/web_demo.mp4
```

`record_web.js` drives a phone-emulated browser. It injects a caption strip, a finger that shows
taps and swipes, and nothing else into the page (headless browsers draw neither); the app's own
code is untouched. It types the questions, taps, and flips the colour scheme at the end to show
both themes (`DEMO_THEME=light` starts in light mode instead).

Two things here are not obvious:

- **Sharpness.** Playwright's video recorder ignores `deviceScaleFactor`: it draws the page at 1x
  into the top-left corner of the canvas and leaves the rest grey. So the browser gets a 780x1848
  viewport and a meta viewport of `width=390`: the app lays out as a 390 px phone but is zoomed 2x
  (like a pinch-zoom), which fills the frame and is painted sharply. After recording, check the
  corners of a few frames for grey (a pixel of `128 128 128` means the recorder drew into a corner).
- **Replayed answers.** Recording at this size uses so much CPU that the CPU-only model answers
  about 10 times slower, which makes live recording impractical on a 4-core box. So
  `capture_streams.js` first records the real streamed answers with their timing while nothing else
  is running, and `record_web.js` replays them through a small proxy that forwards everything else
  to the real app. The last caption of the video says so. Keep that caption.

## Command-line demo (a replay of real output)

```bash
python scripts/demo/capture_output.py captured.json            # runs the real commands
python scripts/demo/build_terminal.py captured.json terminal.html
node scripts/demo/record_terminal.js out/ "$(pwd)/terminal.html"
```

The output is captured from real runs. The video then types the commands and streams the
answer at a simulated speed, and a note inside the video says so. Keep that note.
