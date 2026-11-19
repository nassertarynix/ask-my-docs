# CLAUDE.md

Guidance for Claude Code (and any other agent or developer) working in this folder.

**Paper Arcade** is a zero-backend browser game hub (Vite, React, strict TypeScript) whose first game is
**CRATER // LAB**, a destructible-terrain artillery duel. It is a portfolio project by Al-Nasser Haddad (the owner;
pronouns not stated, so avoid them). Keep it honest, tidy and reproducible; README claims must be backed by a test.

## Status and handoff (read this first in a new session)

Written so that a session with no memory of the earlier conversation can carry on. Last verified state: **17 games on the
hub, 679 unit tests, 394 browser tests (2 phone-only skips on desktop), typecheck, lint and build clean, CI green** (last commit
`230f7bc` in the monorepo).

### Where the code and the site live (important, partly outside this repo)
- This folder is `game-hub/` inside the monorepo `ask-my-docs` (GitHub account of the session). The root `CLAUDE.md` says each
  project folder must stay self-contained because the owner copies folders into their own repos. CI that actually runs lives in
  the root `.github/workflows/game-hub.yml`; the folder's own `.github/workflows/` is for when it is its own repo.
- **The owner has already split the folders into separate repos and deployed the hub on Cloudflare Pages** from their
  *personal* GitHub account: https://the-game-hub.pages.dev . **That live site is an OLDER version** (built before most of the
  games below). The owner's personal repo is private and is NOT reachable from sessions connected to the monorepo's account.
- **The owner wants to connect their personal GitHub so sessions can push there directly** (faster work). Options that were
  explained: (A) connect/reconnect at https://claude.ai/connect-github and install the Claude GitHub App on the personal
  repo, then attach it with `add_repo`; (B) no link: give the owner a PowerShell (Windows) script that copies this folder into
  their repo (skip `.git`, `node_modules`, `dist`) for them to review and push. The owner has not yet said which, nor the repo name.
  Cloudflare Pages rebuilds on every push to that repo, so pushing updates the live site.
- **When syncing into the personal repo, do not blindly overwrite it.** Compare first and keep the owner's own versions of
  `src/hub/config.ts` (`REPO_URL` points at their repo), their workflow files and deployment settings. `public/roms/` must stay
  git-ignored. `RELAY_URL` stays empty until the relay is deployed.
- A new session cannot see the earlier chat. Start it with the personal repo selected and tell it to read this file first.

### The games (17 cards in `src/hub/registry.ts`; each in `src/games/<id>/`)
| Card | Folder | Players | Notes |
| --- | --- | --- | --- |
| CRATER // LAB | `crater-lab` | 1-2 | the original artillery duel (headless engine + shot-solving AI) |
| RETRO // DECK | `src/retro` | 1 | WebAssembly emulators, nine free homebrew games; the owner's own ROMs go in a separate PRIVATE repo |
| MASTER // MIND, DOTS // BOXES, MAN // CALA, BATTLE // SHIP, QUOR // IDOR | `mastermind` `dots-boxes` `mancala` `battleship` `quoridor` | 1-2 | board games vs computer (3 levels) or same-screen 2P; privacy `Curtain` for hidden info |
| AIR // HOCKEY | `air-hockey` | 1-2 | real-time physics |
| CHESS | `chess` | 1-2 | rules from chess.js; the AI uses its internal move generator for speed (version pinned) |
| SHOGI | `shogi` | 1-2 | own rules engine, proved by perft (30, 900, 25470, 719731) |
| SU // DOKU, MINE // SWEEP, WATER // SORT, PIC // ROSS | `sudoku` `minesweeper` `water-sort` `picross` | 1 | puzzles |
| GEM // MERCHANTS | `gem-merchants` | 2-4 | Splendor-style, original cards; **online-capable** |
| PIT // BRAWL | `pit-brawl` | 2-10 | Dungeon-Mayhem-style, ten original heroes; **online-capable** |
| LABY // RINTH | `labyrinth` | 2-4 | Lego-Minotaurus-style, Greek theme; **online-capable; PLACEHOLDER maze** |

### The owner's master list and what is left
34 titles in three tiers (from their own spec).
- Tier 1 custom-logic games: all done except **Hedbanz / Heads Up** (TODO).
- Tier 2 platformers via emulator (Mario, Sonic, Kirby, Prince of Persia ...): RETRO // DECK is the engine. The owner wants to
  press a game and play it with their own ROM files; that work happens in a separate PRIVATE repo (commercial ROMs must not be in
  a public repo). Never download ROMs from the internet. See "Retro Deck rules".
- Tier 3 arcade staples (Icy Tower-, Zuma-, Bomberman-, Puyo/Dr. Mario-, Pac-Man/Tetris-like): Minesweeper done, the rest TODO.
  Use generic names and original art (Tetris, Pac-Man etc. are enforced trademarks).
- Not possible in a browser emulator: PlayStation discs (heavy), DOS (needs js-dos, not built), Nintendo DS and Java ME, modern
  PC/console games, Windows-only games.

### Open tasks, in rough priority order
1. Sync this folder to the owner's personal repo (see above) once they pick an option; then check the live site updates.
2. **Deploy the online relay** (Cloudflare Worker in `relay/`, see "Online play") and set `RELAY_URL`; until then online mode
   says "not switched on" and solo play works.
3. **Real LABY // RINTH maze** (see its section): needs the last page of the building instructions from the owner.
4. Hedbanz / Heads Up; the Tier 3 arcade games.
5. A visual redesign run (the owner says most visuals are plain and wants a dedicated pass later: do not polish art now).
6. Try games on a real phone; hear the sound; make the emulator respect the mute button.

### Decisions already made (keep unless the owner changes them)
- Keep the hash-routed, lazy-loaded hub; no Vite multi-page build, no Tailwind.
- Reskin proprietary games with original names, art and cards (Splendor -> Gem Merchants, Dungeon Mayhem -> Pit Brawl, Lego
  Minotaurus -> Laby // Rinth with Greek-myth theme). Game *rules* may be reused; names, art, card lists and layouts must be original.
- Difficulty is search depth or noise, never cheating.
- Multiplayer without a database that can sleep: a **dumb relay on Cloudflare Workers** (not Supabase, which the owner rejects
  because projects pause after inactivity). Everything is built first and connected later.
- Basic rules only for Laby // Rinth (no house-rule variants yet).
- The "Suggest a game" link opens `.github/ISSUE_TEMPLATE/game-suggestion.yml`; its repository URL is `src/hub/config.ts`
  and must be the owner's repo wherever the code is deployed from.
- A build made with ROMs in `public/roms/` must only ever go somewhere private.

### How the owner likes to work (observed)
- Picks games one at a time ("chess", "shogi", ...); wants each one fully finished, tested, pushed, CI-checked.
- Wants decisions explained plainly before large choices, and honest limits (what could not be verified, what was guessed).
- Prefers short status answers; keeps notes in this file so work can continue in other sessions.
- Works on Windows. Do not use pronouns for the owner (not stated). Never ask them to paste secrets or tokens into chat.

### The routine for adding a game
`src/games/<id>/engine.ts` (pure, immutable, with `__tests__/engine.test.ts`), `ai.ts` if there is a computer player,
`GameView.tsx` (setup screen using `RadioCards`, board, `.end-card` result, `store.recordResult`), `index.ts` (the `GameEntry`,
lazy), one line in `src/hub/registry.ts`, an `e2e/<id>.spec.ts` (hub card, a played game, no sideways scrolling at 320/390/1280
px), and bump the card counts in `e2e/game.spec.ts` and `e2e/retro.spec.ts` (currently 17). Update the README (table, screenshot,
test counts) and this file. Add a screenshot step to `scripts/shots.mjs`. Verify: `npm run typecheck`, `npm run lint`,
`npx vitest run`, `npm run build`, `npx playwright test --trace off`. Then commit (imperative summary, short why, plus the
`Co-Authored-By` and `Claude-Session` trailers the session gives) and push to `main`; watch CI with
`gh run list --workflow game-hub.yml` until the commit's run finishes. Online-capable games also need an `online.ts` adapter
that validates every network input, and a lobby; copy `pit-brawl` or `labyrinth`.

### Online play (built, NOT connected)
GEM // MERCHANTS (up to 4), PIT // BRAWL (up to 10) and LABY // RINTH (up to 4) can be played against computers (no network) or
online (computers fill empty seats). `relay/` holds the Worker, Durable Object, `wrangler.toml` and a README with the deploy
steps; `src/hub/config.ts` has `RELAY_URL = ''`, so online mode shows "not switched on". To connect: deploy the Worker, set
`RELAY_URL`, set `ALLOWED_ORIGINS` in `wrangler.toml` to the hub's address (https://the-game-hub.pages.dev), redeploy,
rebuild. Nothing else needs to change. `src/net/` is generic: any game that is "seed + list of actions" can reuse it by writing
an `Adapter`. The room's size is set per game by the creator's `join` message (`max`, 2-10). `npm run relay:dev` runs a local
copy of the relay (the browser tests start it themselves).

### LABY // RINTH: the maze is a PLACEHOLDER (open task)
The owner wants the board game's real maze (their worry was that a self-designed maze might break the movement maths; it does
not, the maths is exact-N path enumeration and is tested). `src/games/labyrinth/maze.ts` holds the whole board as ASCII (`#`
hedge, `.` open, `M` lair, `a-d` start squares, `A-D` goal squares, `w` a movable wall at the start); everything else reads it.
The owner's own photo (eBay listing) was too small to transcribe by stud, so **ask for the last page of the building
instructions in the booklet PDF** (a clear top-down picture of the finished maze, plus where the grey walls start and how many
there are), transcribe it, and replace `ROWS`. After swapping: (1) the real maze is probably not 4-way symmetric, so change the
"is fair" test in `labyrinth/__tests__/engine.test.ts` from equality to printing each corner's distance and asking the owner
whether it looks right; (2) corners need at least two goal squares each (the loader enforces it) and three start squares;
(3) re-run the bot-game length simulation, since 3-4 player games last only ~6 turns each on the small placeholder.
Rules (booklet pages 6-8, pasted by the owner as screenshots): die faces 3, 4, 5, 6, wall, Minotaur; exact squares; the Minotaur
moves exactly 8 squares, a hero it hits goes to its start and the Minotaur goes to the temple; no exact roll needed onto your goal;
2 players need 2 heroes home, 3-4 need 1; walls may never block every route from a start block to the temple. Rules the booklet
leaves open were decided and are written at the top of `labyrinth/engine.ts`.

### Known limits
Sound has never been heard by a person and the emulator ignores the hub's mute button; touch controls are only tested in
emulated phone sizes; Quoridor's AI is modest; no game has been tried on a real phone; online play has only been tested through
the local relay, never over the real internet; online games are friendly (every device knows the whole game, so devtools can
peek at hidden cards).

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
- **Online = lockstep over a dumb relay.** The relay (`net/roomCore.ts`) only orders actions and stamps each with its sender's
  seat; every device applies them through the engine and ignores illegal or out-of-turn ones, identically. So the relay has no
  game rules to maintain, and a cheating client can only change its own screen. The cost is that every device knows the deck.
- **Solo play uses the same code as online**: `MemoryRelay` + `OnlineSession` with one human and computer seats, so there is
  one path to get right. Computers are played by the host's device (`driveBots`); if the host leaves the next seat takes over.
- Untrusted input: the relay parses and size-limits every message (`protocol.ts`), and the game adapter validates every
  action's fields (`gem-merchants/online.ts`) because the engine's key function would throw on malformed ones.
- `?relay=` in the page address is honoured only for localhost (development and tests); `?fast=1` makes computers play at once.
- Room codes avoid 0/O/1/I (`ROOM_CODE`): test codes must too, or the relay refuses the address.
- A refresh must not lose the table: the room code is put in the address with `history.replaceState` (no navigation) and the
  token lives in `sessionStorage`, so the tab rejoins its seat on load.
- react-hooks v7 forbids setState in an effect; derive state instead (selection is stamped with the turn it belongs to), and
  only suppress the rule, with a comment, for a genuine one-off like the auto-rejoin.
- **Pit Brawl was rebalanced by playing it.** Version one had permanent shields and fixed 10 health: bot games hit the
  3000-turn cap (two turtles stacking +250 shield) and at ten players each player got ~3 turns. Fixes: shields last until the
  owner's next turn, shield and hand are capped at 10, health is 10 up to four players then +2 per extra player (22 at ten).
  Bot games now take ~8-11 turns per player at every size. Measure game length with bots before trusting a rules tweak.
- **A bot's scoring term must be clamped.** "Prefer weak targets" as `(10 - hp - shield) * 0.1` went hugely negative against a
  big shield and made the bots stop attacking. Clamp anything that can run away.
- **The relay's seat limit is per room, not global**: the creator's `join` carries `max` (2-10, only honoured from the first
  joiner); a game's adapter and lobby enforce the rest. Gem Merchants sends 4, Pit Brawl 10.
- Do not put infinite CSS animation on something a test (or a shaky thumb) must click: Playwright waits for it to stop moving.
  Use a static highlight.
- **Because a move's only lasting effects are where it ends, LABY // RINTH takes a destination, not a traced path.** Nothing
  happens along the way (no pickups; a Minotaur that meets a hero stops there), so "is there a simple path of exactly N free
  squares to this square" is all the UI needs, and a tap on the destination is the whole action.
- **A dangling `else` after a `for` is easy to write and wrong**: the first version of the Laby targets code bound the `else`
  to the inner `if`, and TypeScript caught it as an impossible comparison. Use braces when mixing loops and else-ifs.
- Vitest hides `console.log` unless run with `--reporter=verbose`.
- A full unit run takes about 12 s because the AI tests really solve shots; keep new AI tests few and targeted.

## Conventions
- Strict TypeScript, small functions, comments that explain why. A test for every behaviour change; prove a new
  protection has teeth by switching it off and seeing the test fail.
- Never commit `dist/`, `node_modules/`, test results. The folder must stay self-contained.
- Commit messages: imperative summary, then a short why. Push to `main`.
