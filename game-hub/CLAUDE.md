# CLAUDE.md

Guidance for Claude Code (and any other agent or developer) working in this folder.

**Paper Arcade** is a zero-backend browser game hub (Vite, React, strict TypeScript) whose first game is
**CRATER // LAB**, a destructible-terrain artillery duel. It is a portfolio project by Al-Nasser Haddad (the owner;
pronouns not stated, so avoid them). Keep it honest, tidy and reproducible; README claims must be backed by a test.

## Commands

```bash
npm run dev | test | e2e | typecheck | lint | build
node scripts/shots.mjs docs     # README screenshots (preview must be running on :4190)
```
Chromium and Playwright are preinstalled in the cloud container (pinned @playwright/test 1.63.0). Do not reinstall.
Pass `--trace off` to Playwright unless debugging.

## Architecture (see ARCHITECTURE.md)
- `src/hub/`: registry (one `GameEntry` per game), hash routing, `GameFrame` (Back, Sound, Reset by remount).
- `src/shared/`: `audio.ts` (all sound is synthesised), `storage.ts` (guarded, validated localStorage).
- `src/games/crater-lab/engine/`: the headless simulation. `ui/`: `GameView` (turns, HUD, keyboard, AI turn) and
  `CanvasStage` (renderer, fixed-timestep clock, pointer).

- `src/retro/`: the Retro Deck. `systems.ts`, `library.ts` (shelf lists, validated), `romStore.ts` (IndexedDB),
  `RetroView.tsx` (shelf), `Player.tsx` (Nostalgist.js + self-hosted RetroArch cores in `public/retro/cores/`).

## Retro Deck rules
- **Never commit or publish a commercial ROM.** `public/roms/` is git-ignored (only its README is tracked). The only
  ROMs in the repo are the open-source homebrew games listed in THIRD_PARTY.md. Do not download ROMs from ROM sites.
- Cores are served from this site (`resolveCoreJs`/`resolveCoreWasm`); an e2e test fails on any request to another host.
- `library.json` and `manifest.json` are data: paths must be relative with no `..` or scheme (`isSafeRelativePath`).
- New third-party files need an entry in THIRD_PARTY.md. snes9x and genesis_plus_gx are non-commercial only.

## Rules (keep them; each has a test)
- **The engine imports nothing from React or the browser** and never calls `Math.random` or reads a clock. All
  randomness goes through `rng.ts` with a seed. `Math.random` is allowed only for decoration in `CanvasStage`.
- **`advanceFlight` is the only place projectiles move.** The game, the aim preview and the AI all go through it, so
  predictions equal outcomes. Do not add a second integrator.
- **The AI may not read the answer.** It only gets better by simulating (`simulateShot`) with the current wind and terrain.
- Fixed timestep: `DT = 1/60`, 4 sub-steps. Game speed must not depend on the display refresh rate.
- No external assets: no audio files, no CDN, no requests to other sites (an e2e test enforces it).
- Anything read from localStorage is parsed and validated; storage that throws must not break the page.
- Mobile first: no horizontal scroll from 320 to 1280 px; 44 px touch targets.

## Lessons learned
- **A shell fired from a buried barrel must explode where it is.** Snapping every ground contact to the surface put the
  blast on top of the wall, out of range of the tank that fired it. Only shallow contacts (3 px) snap to the surface.
- **Fall damage threshold must exceed the biggest crater**, or every direct hit quietly does extra damage when the tank
  slides into the hole.
- **A mound that hits a tank is centred on the tank**, otherwise only one wall forms (the shell touches the near edge).
- **Split fragments were too weak to ever be worth choosing.** At 20 damage each the fan beats a standard shell only
  when the fragments land together (close range, or a late manual split), which is what makes the choice interesting.
- **Among shots that hit, keep the forgiving one.** The first grid hit is often a flat, fragile shot.
- **After using a slider it keeps focus**, so Space must still fire: the key handler only yields arrow keys to inputs.
- `<output>` has the ARIA role `status`; tests select the status line by class.
- An invisible radio input laid over a card needs `z-index`, because the card gets its own layer when it transforms.
- **CSS class names are global.** The emulator screen first used `.player`, which CRATER // LAB's HUD already styles,
  and collapsed. Retro classes are prefixed (`emu-`, `cart-`, `pad-`, `shelf-`).
- `.md` is both Markdown and a Mega Drive ROM: `README.md` is excluded by name in `systems.ts` and `scripts/roms.mjs`.
- Nostalgist asks for a screen wake lock; a headless browser refuses and logs a page error. Tests ignore that one message.
- **A wall-count weight decides whether a Quoridor AI plays well.** Valuing a wall in hand at ~1.5 steps made both AIs spend
  a wall for a one-step gain until none were left, and games dragged to 100+ turns. At 12 points (a bit over a step) walls
  are kept for gains of two or more steps, or one step when the opponent is close to winning.
- **Test "this wall traps a pawn" with a real enclosure.** A corridor with an open row at the end is not enclosed; the pen
  in `quoridor/__tests__` (two vertical walls and a closing horizontal one) is.
- **Mancala: a lap of 13 stones ends in the pit it started from, which is empty, so it captures.** That is correct Kalah.
- **Dots and Boxes hard solves the endgame exactly** (`SOLVE_LIMIT` 14 free edges). At 16 the test suite took seven seconds
  per game; keep the limit low and the search memoised by the drawn-edge pattern.
- Board-game browser tests that play a whole game must wait on a deadline, not a fixed number of clicks: animation and the
  computer's thinking pause make the time vary under load.
- A full unit run takes about 12 s because the AI tests really solve shots; keep new AI tests few and targeted.

## Conventions
- Strict TypeScript, small functions, comments that explain why. A test for every behaviour change; prove a new
  protection has teeth by switching it off and seeing the test fail.
- Never commit `dist/`, `node_modules/`, test results. The folder must stay self-contained.
- Commit messages: imperative summary, then a short why. Push to `main`.
