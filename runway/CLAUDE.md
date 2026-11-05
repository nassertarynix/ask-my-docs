# CLAUDE.md

Guidance for Claude Code (and any other agent or developer) working in this repository.

**Runway** is a cash-flow forecast that runs entirely in the browser (React, strict TypeScript, Vite). It is a
portfolio project by Al-Nasser Haddad (the owner; pronouns not stated, so avoid them). Keep it honest, tidy and
reproducible; README claims must be backed by a test.

## Commands

```bash
npm run dev | test | e2e | typecheck | lint | build
node scripts/shots.mjs <outDir>               # phone screenshots (preview on :4180)
node scripts/demo/record_demo.mjs <outDir>    # record the demo (preview on :4180)
python scripts/demo/finish_video.py <raw.webm> <out.mp4>
```
Chromium and Playwright are preinstalled in the cloud container (pinned @playwright/test 1.63.0). Do not reinstall.

## Architecture
- `src/domain/` has the logic and imports no React or browser API: `dates.ts` (string dates, month clamping),
  `forecast.ts` (`occurrences`, `forecast`), `money.ts`, `data.ts` (example, validation of untrusted input, CSV).
- `src/App.tsx` holds the screens; `src/Chart.tsx` draws the step chart in SVG sized to its container.

## Rules (keep them; each has a test)
- Money is integer cents; parse strictly, never guess.
- Month arithmetic keeps the anchor day and clamps to month end.
- Same-day order: money in before money out.
- Anything read from storage or a file goes through `readState` and is never trusted.
- No requests to other sites (fonts are self-hosted via @fontsource); an e2e test enforces it.
- Mobile first: no horizontal scroll from 320 to 1280 px, 44 px targets, 16 px inputs, light and dark.

## Lessons learned
- **Save on every valid keystroke, not on blur.** The opening balance was committed on blur only, and a fast
  user (or test) that typed and moved on lost it. Updates also use the functional form of `setState`
  (`change((prev) => ...)`) so two quick edits cannot overwrite each other.
- **A tiny negative amount rounded to whole dollars showed "-$0".** `formatMoney` now returns "$0".
- **A chart drawn in a fixed 640 px viewBox has tiny text on a phone.** The SVG is sized to its container with a ResizeObserver.
- **The example must tell a story** (a purchase pushes it below zero) or the headline never shows its main job.
- Recording video of the UI: Playwright's `recordVideo` ignores `deviceScaleFactor`, so use a 780x1848 viewport with
  a `width=390` meta viewport (pinch-zoom); check frame corners for grey (128,128,128).
- Pushing needs the Claude GitHub App installed on the repository's account.
