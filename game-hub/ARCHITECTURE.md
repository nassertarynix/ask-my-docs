# Architecture

Paper Arcade is a static site: Vite + React + strict TypeScript, no backend, no game engine and no audio files.
`npm run build` produces a self-contained `dist/` (relative asset paths) that works on Cloudflare Pages, GitHub Pages
or any static host.

```
src/
├── main.tsx, App.tsx        entry; App picks the hub or a game from the URL hash
├── styles.css               the whole look: paper, 2px ink borders, hard offset shadows
├── hub/
│   ├── types.ts             GameEntry and GameProps: the contract between the hub and a game
│   ├── registry.ts          the list of games. Adding a game = one entry here
│   ├── route.ts             #/ and #/play/<id> (hash routing: works on any static host, no rewrites)
│   ├── HubHome.tsx          the card grid, with wins and streak from saved stats
│   └── GameFrame.tsx        the top bar every game gets: Back, title, Sound, Reset
├── shared/
│   ├── audio.ts             every sound, synthesised with the Web Audio API
│   └── storage.ts           guarded, validated localStorage: per-game stats and settings
└── games/crater-lab/
    ├── index.ts             the GameEntry (the game's code is lazy-loaded)
    ├── engine/              the simulation: no React, no DOM, no canvas, no clock, no Math.random
    │   ├── types.ts         state types and every tuning constant
    │   ├── rng.ts           seeded random numbers (mulberry32)
    │   ├── terrain.ts       heightmap generation, craters, mounds, tanks settling and fall damage
    │   ├── physics.ts       projectile integration, collisions, bounces, splits, simulateShot
    │   ├── weapons.ts       the five ammo types and what each does on landing
    │   ├── game.ts          the match: turns, fire, the 60 Hz step
    │   ├── ai.ts            the ballistics solver and the three difficulty tiers
    │   └── __tests__/       Vitest: 121 tests
    └── ui/
        ├── GameView.tsx     setup screen, HUD, weapon bar, keyboard, the AI's turn, results
        ├── CanvasStage.tsx  the 60 fps Canvas 2D renderer, the game clock and the pointer
        └── CardArt.tsx      the picture on the hub card
```

## The rule that shapes everything: the engine is headless and deterministic

`engine/` imports nothing from React or the browser. Everything that happens in a match is a function of the seed
and the players' inputs. That buys three things:

1. **It is testable.** The tests assert exact numbers (a crater column loses `sqrt(r² - dx²)`, a pinned landing
   position) and replay whole matches twice to check they are identical.
2. **The AI can plan honestly.** It finds its shot by flying candidates through the same code that flies the real shot.
3. **The UI stays thin.** React and the canvas read the state; they never decide anything.

### State and time

`GameState` (types.ts) is one mutable object: the terrain is a `Float32Array` of 1200 elevations, and copying it 60 times
a second would be wasteful. `step(state)` advances exactly 1/60 s. The phases:

```
aim ──fire──▶ flight ──nothing left in the air──▶ settle ──tanks at rest──▶ aim (other player)
                                                                       └──▶ over
```

The engine appends `GameEvent`s (`fire`, `explosion`, `damage`, `bounce`, `split`, `turn`, `gameover`...) to
`state.events`. The UI drains that list each frame and turns it into particles, numbers, shake and sound.

### Terrain (terrain.ts)

A 1D heightmap: one elevation per pixel column. Generated from three octaves of sine plus midpoint displacement, lightly
blurred, with a level pad at each spawn point.
`carveCrater` subtracts a circle: a column at distance `dx` loses whatever ground lies within `centre ± sqrt(r² - dx²)`,
and anything above drops down (a heightmap has no overhangs). A smooth lip is pushed up just outside the rim.
`addMound` adds a raised-cosine hill and leaves a tank's footprint clear, so a mound dropped on a tank walls it in.
`settleTank` makes a tank with air under it fall under gravity over several ticks; a drop deeper than the biggest crater
(48 px) costs fall damage.

### Flight (physics.ts)

Semi-implicit Euler with gravity, per-turn wind (-15..+15 px/s²) and a little linear drag. Each tick is 4 sub-steps, so
the fastest shell moves about 2 px between collision checks and cannot tunnel through a 3 px ridge or a tank.
`advanceFlight` is the only place projectiles move: it handles collisions, rubber-bomb bounces and tri-splitter splits,
and reports what happened. The live game calls it once per tick; `simulateShot` calls it in a loop without touching the
world. The aim preview and the AI both use `simulateShot`, so what they predict is exactly what happens (there is a test).

### Weapons (weapons.ts)

| Ammo | Per match | On landing |
| --- | --- | --- |
| Standard Shell | unlimited | 38 px crater, 35 damage falling linearly to 0 at 62 px |
| Tri-Splitter | 3 | splits on a second press (or at the apex for the AI) into three at -12°, 0°, +12°; 20 damage each |
| Dirt-Mound Builder | 2 | adds a 74 px hill instead of a crater, no damage |
| Black-Hole Singularity | 1 | pulls projectiles and drags nearby tanks for 1.1 s, then implodes for up to 32 |
| Bouncing Rubber Bomb | 3 | bounces 3 times, explodes on the 4th touch or a direct hit |

### The AI (ai.ts)

`solveShot` runs a coarse grid over angle and power (about 770 simulated shots), refines the best cells with Nelder-Mead,
and among shots that hit keeps the most forgiving one (the one that still lands close when nudged). `planShot` then
chooses ammo and adds Gaussian aiming error:

| Tier | Angle error | Power error | Notes |
| --- | --- | --- | --- |
| Recruit | ±12° | ±15% | does not avoid hitting itself; uses odd ammo on a whim |
| Tactician | ±4° | ±5% | avoids self-hits |
| Artillery Savant | ±0.8° | ±1.5% | avoids self-hits; picks ammo by expected damage; walls you in with a mound when losing |

The quoted figures are treated as a ±2σ band (about 95% of shots fall inside), and the error shrinks a little with each
shot the AI has taken, as a person's would. A solve takes roughly 50 to 100 ms on a laptop.

## The UI layer

`GameView` owns turn-taking. It keeps the engine state in one `useState` (never replaced) and a small `hud` snapshot that
it refreshes whenever something visible changes; React renders from the snapshot. `CanvasStage` runs
`requestAnimationFrame` with a fixed-timestep accumulator (so game speed does not depend on the display's refresh rate),
freezes for 40 ms on a direct hit, and draws. On screens narrower than the 2:1 field, the camera follows the action.
Controls: drag on the field, the sliders, or the keyboard (arrows, Space, 1 to 5).

## The Retro Deck (`src/retro/`)

Not a game but a second kind of hub entry: a shelf of ROMs and a player.

```
src/retro/
├── index.ts        the hub card (lazy)
├── systems.ts      consoles -> libretro core, file extensions, screen shape, buttons
├── library.ts      the shelf: bundled homebrew + the owner's local files, both validated as untrusted data
├── romStore.ts     IndexedDB: imported ROMs, battery saves and quick-saves
├── RetroView.tsx   the shelf, import by button or drag and drop
└── Player.tsx      Nostalgist.js + a RetroArch core, toolbar, touch pad
public/retro/cores/     the cores (.js + .wasm), self-hosted
public/retro/homebrew/  nine open-source games, listed in public/retro/library.json
public/roms/            the owner's own files: git-ignored, listed into manifest.json by scripts/roms.mjs
```

- **No third-party requests.** Nostalgist normally downloads cores from a CDN; `resolveCoreJs` / `resolveCoreWasm`
  point it at `./retro/cores/` instead. The emulator library itself is a separate chunk loaded when a game starts.
- **Three sources, one shelf.** `bundled` (shipped), `local` (`public/roms/`, picked up by `npm run dev`/`build`),
  `imported` (dropped on the page, stored in IndexedDB under a hash of the contents, so duplicates collapse).
- **Saves** are keyed by the ROM's id. The battery save is copied out every 15 s, on pause and on leaving.
- To add a console: add an entry to `SYSTEMS`, put its core's two files in `public/retro/cores/`, and list its licence
  in THIRD_PARTY.md.

## Add Game #2 in under 5 minutes

A game is a React component plus one registry entry. The hub gives it a frame (Back, Sound, Reset), a URL, lazy loading,
sound and saved stats.

**1. Create the game** at `src/games/my-game/ui/GameView.tsx`:

```tsx
import type { GameProps } from '../../../hub/types';
import { sfx } from '../../../shared/audio';
import { store } from '../../../shared/storage';

export default function GameView({ onExit }: GameProps) {
  return (
    <div>
      <button className="btn btn-primary" onClick={() => { sfx.click(); store.recordResult('my-game', 'win'); }}>
        I win
      </button>
      <button className="btn" onClick={onExit}>Back</button>
    </div>
  );
}
```

**2. Describe it** in `src/games/my-game/index.ts`:

```ts
import { lazy } from 'react';
import { Rocket } from 'lucide-react';
import type { GameEntry } from '../../hub/types';

export const myGame: GameEntry = {
  id: 'my-game',                 // the URL (#/play/my-game) and the key for saved stats
  title: 'MY // GAME',
  tagline: 'One sentence that makes someone click.',
  playerBadge: '1P',
  accentColor: '#7DD3A8',
  art: Rocket,                   // any component that fills its box: a lucide icon or your own SVG
  component: lazy(() => import('./ui/GameView')),
};
```

**3. Register it** in `src/hub/registry.ts`: import `myGame` and add it to `GAMES`. To turn a "coming soon" card into a
real game, replace that entry.

That is all. The card appears on the hub, `#/play/my-game` opens it inside the frame, and its code is a separate chunk
loaded on demand.

What the hub does for a game, so the game does not have to:

- **Reset** remounts the component with a new React key. Put all state inside the component (not in module variables)
  and Reset works with no code.
- **Sound**: call `sfx.*` from `shared/audio.ts`, or add a recipe there built from `tone()` and `burst()`. Mute is global
  and remembered.
- **Stats**: `store.recordResult(id, 'win' | 'loss' | 'draw' | 'played')`. The hub card shows wins and the streak.
  `store.loadGameSettings(id, defaults)` / `saveGameSettings` hold a game's own small settings.
- **Styling**: `.btn`, `.btn-primary`, `--accent` (set to the game's `accentColor` inside the frame), `--ink`, `--paper`,
  `--shadow`.

Recommended, as CRATER // LAB does: keep the rules in a headless `engine/` folder with tests, seed all randomness, and
let the UI only read state and send inputs.
