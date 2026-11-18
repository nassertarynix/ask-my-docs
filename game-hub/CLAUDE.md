# CLAUDE.md

Guidance for Claude Code (and any other agent or developer) working in this folder.

**Paper Arcade** is a zero-backend browser game hub (Vite, React, strict TypeScript) whose first game is
**CRATER // LAB**, a destructible-terrain artillery duel. It is a portfolio project by Al-Nasser Haddad (the owner;
pronouns not stated, so avoid them). Keep it honest, tidy and reproducible; README claims must be backed by a test.

## Status and handoff (read this first in a new session)

**What exists** (all pushed, CI green): the hub shell; CRATER // LAB (artillery duel, headless engine + AI);
MASTER // MIND, DOTS // BOXES, MAN // CALA, QUOR // IDOR, BATTLE // SHIP, CHESS, SHOGI (board games with computer opponents), AIR // HOCKEY (real-time); SU // DOKU,
MINE // SWEEP, WATER // SORT, PIC // ROSS (single-player puzzles); RETRO // DECK (WebAssembly emulators with nine free homebrew
games). A registry entry with `component: null` shows as a "coming soon" card; none is left at the moment.

**The owner's master list** (from their own spec; 34 titles in three tiers). Build status:
- Tier 1, custom logic games: Mastermind, Mancala, Quoridor, Dots and Boxes, Sudoku, Water Sort, Picross, Battleship, Air Hockey, Chess, Shogi DONE. TODO: Splendor (build it as a reskin, "Gem Merchants"), Hedbanz/Heads Up,
  Lego Minotaurus (reskin), Dungeon Mayhem (deferred, reskin).
- Tier 2, platformers via emulator (Mario, Sonic, DKC, Kirby, Prince of Persia, Disney 16-bit ...): the RETRO // DECK
  is the engine for these. **The owner wants to press a game and play it, using their own ROM files.** That work moves to
  a separate PRIVATE repository (the owner is creating it), because commercial ROMs must not be in a public repo.
  Do not download ROMs from the internet. See "Retro Deck rules" below.
- Tier 3, arcade staples (Icy Tower, Zuma-like, Bomberman-like, Puyo/Dr. Mario-like, Pac-Man/Tetris/Minesweeper):
  Minesweeper DONE; the rest TODO. Build under generic names and original art; Tetris, Pac-Man and similar names are
  enforced trademarks.
- Not possible in a browser emulator: PlayStation discs are heavy (js/wasm PS1 is possible but slow on phones), DOS needs
  js-dos (not built), Nintendo DS and Java ME are impractical, modern PC/console games and Windows-only games cannot run.

**Decisions already made** (keep unless the owner changes them):
- Keep the hash-routed, lazy-loaded hub; do not switch to a Vite multi-page build or Tailwind.
- Reskin proprietary board games (Splendor -> Gem Merchants, Lego Minotaurus, Dungeon Mayhem).
- The "Suggest a game" link opens `.github/ISSUE_TEMPLATE/game-suggestion.yml`; its repository URL is `src/hub/config.ts`
  and must be updated when this folder moves into its own repository.
- Difficulty is search depth or aiming noise, never cheating.
- Nothing is deployed yet. A build made with ROMs in `public/roms/` must only go somewhere private.

**Adding a small game (the routine)**: `src/games/<id>/engine.ts` (pure, immutable, with `__tests__/engine.test.ts`),
`ai.ts` if there is a computer player, `GameView.tsx` (setup screen using `RadioCards`, board, `.end-card` result,
`store.recordResult`), `index.ts` (the `GameEntry`, lazy), then one line in `src/hub/registry.ts`, an `e2e/<id>.spec.ts`
(hub card, a played game, no sideways scrolling at 320/390/1280 px), and bump the card counts in `e2e/game.spec.ts` and
`e2e/retro.spec.ts`. Update README (table and test counts) and this file's status list. Verify: `npm run typecheck`,
`npm run lint`, `npm test`, `npm run build`, `npx playwright test --trace off`.

**Known limits**: sound has never been heard by a person and the emulator ignores the hub's mute button; touch controls
are only tested in emulated phone sizes; Quoridor's AI is modest; no game has been tried on a real phone.

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
- **Sudoku generation must check uniqueness on every removal** (`countSolutions(puzzle, 2) === 1`), or a puzzle can have two
  answers and a hint can contradict the player's correct entry.
- **Minesweeper places mines on the first click**, never on that square or its neighbours; a wide board scrolls inside
  its own box (`.ms-scroll`) so the page never scrolls sideways.
- **Water Sort level n is always the same puzzle** (seeded by n), generated until the solver can win it; the solver has a node
  budget so a bad position cannot hang the page.
- E2E: clicking a game's control may clear transient UI (a hint highlight), so read everything you need from the page
  *before* the click that clears it.
- **A grid item with an explicit `grid-area` blocks auto-placement of the others.** Picross's drag overlay first sat in the
  grid and pushed every square out of place; it is now `position: absolute` over the squares, and the square under the
  pointer is worked out by arithmetic (an overlay also hides squares from `elementFromPoint`).
- **Picross puzzles are only kept if line logic solves them completely** (`solveByLogic`); an unsolvable-by-logic picture
  is repaired by filling some undecided squares and retrying, so generation always ends.
- **Never depend on hover for an action a finger must perform.** Battleship placement first used the hover preview's square
  to decide where a ship went, which works with a mouse and silently fails on touch (a tap fires no hover first). Work from
  the square that was clicked; use hover only for the preview.
- **Battleship's AI only uses what a player would know** (its shots and the ships it has sunk). Two-player screens put
  everything secret behind `Curtain`, which renders nothing while hidden; the e2e test asserts no grid is in the page.
- **A real-time game needs a stall rule.** Air Hockey's puck, if nobody touches it, sat still forever and a match against an
  idle player never ended. A puck still for 5 s is now handed to the other half (`STALL_LIMIT`), as in the real game.
- **Predict a sliding puck analytically.** With friction the same factor slows both velocity components, so the path is a
  straight line; only the arrival time changes (`predictCrossing`). The first version approximated it and missed by 20 px.
- **Size a fixed-shape canvas by width with `aspect-ratio`, not by height**: a fixed height plus a max-width squashed the
  4:7 table on a narrow phone. Use `width: min(100%, calc((100dvh - bars) * w / h))` and `height: auto`.
- **Canvas games: put the state the tests need in `data-*` attributes** on the canvas (puck and paddle positions, phase) and
  offer a `?fast=N` URL parameter that runs the fixed-step simulation faster, so whole matches finish in seconds.
- **chess.js builds a SAN string for every move it lists**, which made the first search ten times too slow (depth 3 in 1.8 s).
  `chess/ai.ts` therefore uses the library's internal `_moves/_makeMove/_undoMove/_board` (version pinned; `internals()`
  throws if they are missing) and asks for SAN only for the move it plays.
- **A cut-off root move's score is only a bound, and at variety 0 it ties with the best.** Picking "among the near-best"
  with `<=` chose a queen-losing pawn move at random; the filter is strict `<` plus the best move itself (a test proves it).
- Time-limited searches are not repeatable, so a failing game cannot be replayed from its seed; replay it from the move list
  (the SAN is in the log) and test at a fixed depth.
- **Shogi's engine is its own** (`shogi/engine.ts`, a mutable `Position` with make/unmake, moves packed into integers) and
  is proved by perft: 30, 900, 25470, 719731. A first run gave 719788 because the hands array was indexed `side * 8 + code`
  and gote's pawn (code 8) landed on index 16, past the end; the stride is 9. A second, naive generator in a throwaway test
  agreed on every position to three plies, which is how the bug was narrowed to the hands and not the movement.
- **Shogi UI**: tiles are SVG (pentagon plus kanji text, red when promoted); the board is turned half round (rows and columns
  reversed) when gote is at the bottom. `?sfen=` in the hub URL starts from a given position, which the e2e tests use for
  mates and drop rules. Optional promotion asks (Promote / Don't promote); forced promotion is applied silently.
- Vitest hides `console.log` unless run with `--reporter=verbose`.
- A full unit run takes about 12 s because the AI tests really solve shots; keep new AI tests few and targeted.

## Conventions
- Strict TypeScript, small functions, comments that explain why. A test for every behaviour change; prove a new
  protection has teeth by switching it off and seeing the test fail.
- Never commit `dist/`, `node_modules/`, test results. The folder must stay self-contained.
- Commit messages: imperative summary, then a short why. Push to `main`.
