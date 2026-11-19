# Paper Arcade

A minimalist browser game hub with no backend: paper background, ink borders, hard shadows, and small games that start
instantly. It has **CRATER // LAB**, a destructible-terrain artillery duel for one player against a
ballistics-solving AI or two players passing one device, and **RETRO // DECK**, a shelf of console games running in
WebAssembly emulators.

TypeScript (strict), React, Vite. CRATER // LAB is HTML5 Canvas 2D with every sound synthesised by the Web Audio API
(no game engine, no audio files). Everything builds into a static bundle for Cloudflare Pages, GitHub Pages or any static host.

| The hub | Aiming | A Tri-Splitter, split | On a phone |
| :-: | :-: | :-: | :-: |
| <img src="docs/hub.png" width="230"> | <img src="docs/match-aim.png" width="230"> | <img src="docs/match-split.png" width="230"> | <img src="docs/phone-match.png" width="110"> |

## CRATER // LAB

Two tanks on procedurally generated hills. Every shot reshapes the ground, the wind changes every turn, and the tank
that reaches zero loses.

- **Five kinds of ammunition**
  - **Standard Shell** (unlimited): a medium crater, 35 damage on a direct hit, falling off with distance.
  - **Tri-Splitter** (3): press fire again in the air to split it into three. Split late and all three land together.
  - **Dirt-Mound Builder** (2): builds a hill instead of a crater. Drop it on the enemy to wall them in, or in front of
    yourself as a shield.
  - **Black-Hole Singularity** (1): drags the enemy towards it for a second, then implodes.
  - **Bouncing Rubber Bomb** (3): bounces three times off the ground and explodes on the fourth touch.
- **Destructible terrain**: craters are circles subtracted from the ground. A tank whose ground is blown away falls, and
  a long fall hurts.
- **An AI that does not cheat**: it finds its shot by simulating candidates through the same physics, wind and terrain
  the real shot will fly through, then adds human-like aiming error. Three levels: Recruit, Tactician, Artillery Savant.
- **Controls**: drag on the field to aim (it works with a mouse, a trackpad or a finger), or use the sliders, or the
  keyboard: `←` `→` angle, `↑` `↓` power (hold `Shift` for bigger steps), `Space` to fire and to split, `1`–`5` for ammo.
- **Feel**: a dotted preview of the first quarter of the flight, wind streaks and a wind vane, particles, floating damage
  numbers, a 40 ms freeze on a direct hit and a damped screen shake. With "reduce motion" switched on in the system,
  the shake and the freeze are off.
- Your wins and streak against the AI are kept on your device and shown on the hub card.

## The small games

Ten games for one to ten players, each against a computer opponent (three levels) or a friend on the same device, and
four single-player puzzles. The rules live in plain, tested TypeScript; the screens are thin.

| Game | What it is | The interesting part |
| --- | --- | --- |
| **MASTER // MIND** | Crack a hidden code of four colours in ten guesses | A privacy curtain hides the code-maker's screen before the device is handed over; the code is not in the page while the other player guesses. Pegs carry symbols as well as colours, and there is a hint |
| **DOTS // BOXES** | Join the dots; close a box and move again | The hard level solves the end of the game exactly (every continuation, including the sacrifices that win long chains) |
| **MAN // CALA** | Mancala (Kalah): sow stones, capture, extra turns | Alpha-beta search, up to ten moves deep; stones are sown one at a time on screen |
| **AIR // HOCKEY** | Real-time air hockey: first to 5, 7 or 11 | A deterministic physics engine (fixed 1/60 s ticks, four sub-steps, so even the fastest puck cannot pass through a paddle) and a computer that predicts bounced shots. Two players use one finger each on their own half of the screen, or the keyboard |
| **BATTLE // SHIP** | Hide a five-ship fleet and hunt the other one | Two-player mode uses the privacy curtain twice over: each fleet is placed behind one, and every turn starts behind one, with the other player's board not in the page at all. The hard computer works out, for every square, how many ways the surviving ships could lie through it |
| **CHESS** | Full chess against the computer (three levels, either colour) or a friend on one screen | All the rules come from the chess.js library (castling, en passant, promotion, check, checkmate, stalemate, repetition, the fifty-move rule); the computer is an alpha-beta search with a capture search at the leaves and piece-square tables, and its levels differ only in depth and a little deliberate looseness, never in cheating. Legal squares are shown when you pick up a piece; pieces are hand-drawn SVG |
| **SHOGI** | Japanese chess against the computer (three levels, either side) or a friend on one screen, with kanji or letter tiles | The full rules written from scratch and proved with a move-count check (30, 900, 25 470 and 719 731 positions at one to four moves, the published figures): drops, optional and forced promotion, no two pawns on a file, no pawn drop that mates, perpetual check and four-fold repetition. The computer is an alpha-beta search that also reasons about pieces in hand; tap a piece to see its squares, tap a captured piece to see where it may drop |
| **GEM // MERCHANTS** | Collect gems, buy stalls that make later buys cheaper, attract patrons; first to 15 ends the round. 2 to 4 players, against computers or online with friends | An original reskin of the engine-building card genre (original stalls, colours and shapes, so it can be played without telling colours apart). The rules are a pure engine; a game is a seed plus a list of actions, so online play only has to send tiny moves and every device replays the same list. See *Online play* below |
| **PIT // BRAWL** | A fast free-for-all card brawl: ten original heroes, each with a 20-card deck, for 2 to 10 players, against computers or online | Everyone hits, shields, heals, steals and sweeps until one hero is left. Shields wear off at the start of your next turn and health scales with table size (10 up to four players, 22 for ten), because playtesting the first version showed bots turtling behind permanent shields for hundreds of turns and ten players wiping each other out in three turns each. A test keeps all ten decks equally priced |
| **LABY // RINTH** | Race three heroes through a hedge maze to the temple while the Minotaur guards it: roll to move a hero an exact number of squares, wall in your rivals, or send the Minotaur charging. 2 to 4 players, against computers or online | A race game on a grid with a data-driven maze (`src/games/labyrinth/maze.ts`). The rules are a pure engine; moves are checked by enumerating every path of exactly N squares, the wall rule keeps a route open for every player, and the Minotaur's eight-square charge sends any hero it hits back to its start. **The maze in the repo is a placeholder** (four-way symmetric, so it is fair), not the board game's own layout |
| **QUOR // IDOR** | Race a pawn across the board and wall your rival in | A wall may never completely cut a pawn off: every placement is checked with a shortest-path search; pawns jump each other |

<img src="docs/mastermind.png" width="190"> <img src="docs/dots-boxes.png" width="190"> <img src="docs/mancala.png" width="190"> <img src="docs/quoridor.png" width="190"> <img src="docs/battleship.png" width="190"> <img src="docs/air-hockey.png" width="150"> <img src="docs/chess.png" width="190"> <img src="docs/shogi.png" width="190"> <img src="docs/gem-merchants.png" width="190"> <img src="docs/pit-brawl.png" width="190"> <img src="docs/labyrinth.png" width="190">

| Puzzle | What it is | The interesting part |
| --- | --- | --- |
| **SU // DOKU** | Sudoku at three difficulties, with pencil notes, undo, hints and a "check" | Every puzzle is generated from a seed and **proven to have exactly one solution** (the generator only removes a clue if a solver still finds one answer) |
| **MINE // SWEEP** | Minesweeper: beginner, intermediate, expert | The first click is always safe, mines are placed after it; flood-fill opening, flags (right-click or long-press) and chording |
| **PIC // ROSS** | Picross (Nonograms): number clues beside each row and column reveal a pixel picture | Pictures are generated from a seed and kept only if **line logic alone solves them**, so there is never any guessing; drag to paint, mark squares empty, clues grey out when a line is right |
| **WATER // SORT** | Pour coloured layers until every tube is one colour | Levels are made from the level number and checked with a solver, so each can be won and the **hint** is the solver's next move; progress is remembered |

<img src="docs/sudoku.png" width="190"> <img src="docs/minesweeper.png" width="190"> <img src="docs/water-sort.png" width="190"> <img src="docs/picross.png" width="190">

## Online play (GEM // MERCHANTS, PIT // BRAWL and LABY // RINTH, not connected yet)

The hub stays a static site. Rooms need a small relay, written for **Cloudflare Workers** (`relay/`, free plan, does not pause when
idle). It is deliberately dumb: it keeps rooms and seats and an ordered log of actions and forwards each action to everyone.
It never looks at a game's rules. Every device replays the same log through the same engine, so devices agree, and an
illegal or out-of-turn action changes nothing for anyone.

- A room has a five-letter code and an invite link. The game sets the room's size (GEM // MERCHANTS 4, PIT // BRAWL 10, LABY // RINTH 4); empty seats are computers played by the host's device.
- A refreshed or sleeping tab rejoins its seat (the browser keeps a token) and replays the log; if the host leaves, the next
  player's device plays the computers.
- Everything from the network is size-checked and parsed before use; names are cleaned; actions are checked field by field.
- The Worker is a thin wrapper around `src/net/roomCore.ts`, which is unit-tested and also drives a local development relay
  (`npm run relay:dev`) that the browser tests use to play two real tabs against each other.
- **To connect it:** deploy the Worker (`relay/README.md`, three commands) and set `RELAY_URL` in `src/hub/config.ts`.

## RETRO // DECK

Console games running in the browser: NES, Super NES, Mega Drive / Genesis, Game Boy, Game Boy Color and Game Boy
Advance. The emulators are RetroArch cores compiled to WebAssembly and served from the hub itself, so playing makes no
request to any other site. Click a card and the game starts.

<img src="docs/retro-shelf.png" width="380"> <img src="docs/retro-play.png" width="380">

- **Nine free games are included** so it works straight away, at least one for each console the deck was tested on:
  Nova the Squirrel, Thwaite and Concentration Room (NES), Colour Maths Demo (Super NES), Miniplanets and Dragon's Castle
  (Mega Drive), µCity (Game Boy Color), and Attack on Voxelburg and Galactic Quest (Game Boy Advance). All are open-source
  homebrew; each card links to its source.
- **Your own games, one click each.** Put the ROM files in `public/roms/` (sub-folders are fine) and run `npm run dev`.
  They appear on the shelf as cards, titled from the file name. That folder is ignored by git, so your files are never
  committed.
- **Or add a file in the browser**: the *Add a game file* button, or drop files on the page. The game is kept in that
  browser (IndexedDB), is not uploaded anywhere, and is on the shelf from then on.
- **Saves**: a game's own battery save is kept automatically; there is also one quick-save slot per game.
- **Controls**: keyboard (arrows, `X` `Z` `S` `A`, `Enter`, `Shift`), a gamepad, or an on-screen pad on touch screens.

**About commercial games.** No commercial ROM is included, and none should be committed or published: they are
copyrighted. A build made on your machine contains whatever is in `public/roms/`, so only deploy such a build somewhere
private and access-controlled (or deploy without that folder and add games per browser). Third-party licences are in
[THIRD_PARTY.md](THIRD_PARTY.md); note that the Super NES and Mega Drive cores are for non-commercial use only.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
```

```bash
npm test             # 679 unit tests (Vitest): the artillery engine and AI, the board games and their AIs, storage, the ROM shelf
npm run e2e          # 394 browser tests (Playwright), at phone and desktop sizes; they really boot the emulators
npm run typecheck && npm run lint
npm run build        # static files in dist/
```

The first `npm run e2e` needs a browser: `npx playwright install chromium`.
`#/play/crater-lab?seed=7` plays a fixed map.

## Deploy

`dist/` is self-contained and uses relative paths, so it works at a domain root or in a sub-folder.

```bash
npm run build
npx wrangler pages deploy dist        # Cloudflare Pages
```

For GitHub Pages, publish the contents of `dist/`.

## How it is built

The game's rules live in `src/games/crater-lab/engine/`, which has no React, DOM or canvas in it and is fully
deterministic for a given seed. The canvas and the HUD only read the state and send inputs. The hub is a registry:
a game is one component and one entry. [ARCHITECTURE.md](ARCHITECTURE.md) explains the engine and gives the exact steps
to add a second game in under five minutes.

What the tests check, among other things (the board games are covered the same way: exact rule cases, whole games between
computers, and "the computer never makes an illegal move"):

- a crater column loses exactly `sqrt(r² - dx²)`; a mound adds exactly its raised-cosine profile;
- the same shot in the same wind always follows the same path, and matches the closed-form solution of the equations;
- a full-power shot does not pass through a ridge 3 px thick;
- the AI's solver lands a direct hit on four different maps in winds from -15 to +15, and firing that shot in the real
  game does the 35 damage the solver predicted;
- each difficulty's aiming error has the documented spread, and the Savant beats the Recruit from either side;
- corrupted or blocked localStorage never breaks the page.

## Honest limitations

- Thirteen original games and the emulator deck so far.
- LABY // RINTH is playable but uses a **placeholder maze**; the real layout is to be transcribed from the board game's building instructions (see `CLAUDE.md`).
- Online play is built and tested but **not connected**: the room relay (`relay/`, a Cloudflare Worker) has not been deployed, so
  `RELAY_URL` is empty and the game says online play is not switched on. Solo play against computers needs no relay.
- Online games are between friends: every device holds the whole game (so a determined player could read the deck order in
  the browser's developer tools). Making that cheat-proof would need the host to deal each player only their own view.
- Shogi's computer knows no openings or castle shapes, so it is tactically sound but not a strong shogi program; there is no
  "impasse" (both kings in the enemy camp) rule, only a 512-move limit that ends a game as a draw.
- The board-game AIs are search-based and honest about it: Dots and Boxes (hard) and Mancala (hard) are strong, Quoridor's
  levels are modest (it only considers walls near your pawn's route), and none of them has been tuned against human players.
- The emulators were checked by automated browser tests: every core (NES, Super NES, Mega Drive, Game Boy Color, Game
  Boy Advance) boots a free game, draws a picture and answers input. The original Game Boy core shares its code with the
  Color one but had no game of its own to run. Nobody has judged sound or speed by ear or on a real phone, and the Super
  NES had only a small demo, not a full game.
- PlayStation, DOS, Nintendo DS and Windows games are not supported.
- The emulator's sound does not follow the hub's mute button.
- No online play: two players share one device.
- The terrain is a heightmap, so there are no caves or overhangs. Dirt above a blast drops straight down.
- The Artillery Savant is hard on purpose: it usually hits, and three hits end a match.
- The AI thinks for 50 to 100 ms on a laptop (longer on a slow phone), on the main thread. It happens while the
  computer is "aiming", so it shows as a brief pause rather than a stutter in play.
- Sound was checked only by its code paths in automated tests (browsers there have no speakers); it has not been
  tuned by ear on many devices.
- The screenshots are from the real build. "Inspired by" neal.fun means the clean, playful look; nothing is copied
  from it.

## Licence

MIT. See [LICENSE](LICENSE).
