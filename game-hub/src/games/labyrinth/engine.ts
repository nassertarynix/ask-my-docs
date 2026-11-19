/**
 * LABY // RINTH rules (2-4 players): race three heroes through a hedge maze to the temple at its centre while the Minotaur
 * guards it. Each turn you roll the die and do what it says:
 *
 *   3 4 5 6   move one hero exactly that many squares (straight lines, no diagonals, nothing may be crossed or stood on)
 *   wall      put a movable wall from the edge onto the maze, or move one that is already there; never block every route
 *   Minotaur  move the Minotaur eight squares; if it runs into a hero the hero goes back to its start and the Minotaur
 *             goes home to the lair
 *
 * The first player to get two of their heroes (with 2 players) or one (with 3 or 4) onto their goal squares wins. You do not
 * need the exact roll to get onto a goal square: stepping onto it ends the move.
 *
 * Pure and immutable like the other engines. All chance (who starts, each roll) comes from the seed and a counter in the state,
 * so a game is `newGame(players, seed)` plus the list of actions, which every device can replay (online play does exactly that).
 *
 * Rules the board game's booklet leaves open, decided here: a move may not visit the same square twice; a hero or the
 * Minotaur that cannot complete its full move cannot make it (and if nothing at all can be done the turn is lost); a safe
 * square (start block, goal square, the lair) cannot be entered by the Minotaur; heroes may not enter other players'
 * start blocks; walls take one square each; "never block all routes" means every player must keep a route from their start
 * block to one of their own goal squares.
 */
import { createRng, nextRandom } from '../crater-lab/engine/rng';
import { MAZE, type Maze } from './maze';

export type Face = 3 | 4 | 5 | 6 | 'wall' | 'minotaur';
export const FACES: readonly Face[] = [3, 4, 5, 6, 'wall', 'minotaur'];
export const HEROES_PER_PLAYER = 3;
export const MINOTAUR_STEPS = 8;
export const MAX_TURNS = 1500;
export const MAX_SKIPS_IN_A_ROW = 12;

export interface State {
  readonly maze: Maze;
  readonly players: number;
  /** The corner each seat plays from. */
  readonly corners: readonly number[];
  /** Where each seat's three heroes stand. */
  readonly heroes: readonly (readonly number[])[];
  readonly minotaur: number;
  readonly walls: readonly number[];
  /** Walls waiting at the edge of the board. */
  readonly wallSupply: number;
  readonly turn: number;
  /** What the player to move rolled. */
  readonly face: Face;
  readonly phase: 'play' | 'over';
  readonly winners: readonly number[];
  readonly turns: number;
  readonly seed: number;
  readonly counter: number;
  /** Turns in a row that nobody could do anything on. */
  readonly skips: number;
}

export type Action =
  | { readonly type: 'move'; readonly hero: number; readonly to: number }
  | { readonly type: 'minotaur'; readonly to: number }
  | { readonly type: 'wall'; readonly from: number | 'supply'; readonly to: number };

function roll(seed: number, counter: number): number {
  const rng = createRng((seed ^ Math.imul(counter + 1, 0x9e3779b1)) >>> 0);
  nextRandom(rng);
  return nextRandom(rng);
}
export const faceFor = (seed: number, counter: number): Face => FACES[Math.min(5, Math.floor(roll(seed, counter) * 6))] as Face;

/** How many heroes must reach the goal: two in a two-player game, one otherwise. */
export const heroesNeeded = (players: number): number => (players === 2 ? 2 : 1);

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const neighbours = (m: Maze, i: number): number[] => {
  const x = i % m.width;
  const y = Math.floor(i / m.width);
  const out: number[] = [];
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < m.width && ny < m.height) out.push(ny * m.width + nx);
  }
  return out;
};

const isStart = (c: string) => 'abcd'.includes(c);
const isGoal = (c: string) => 'ABCD'.includes(c);

export function newGame(players: number, seed: number, maze: Maze = MAZE): State {
  const corners = maze.seatCorners[players];
  if (!corners) throw new Error('LABY // RINTH is for 2 to 4 players.');
  const first = Math.floor(roll(seed, 0) * players);
  const state: State = {
    maze,
    players,
    corners,
    heroes: corners.map((c) => [...(maze.starts[c] as readonly number[])]),
    minotaur: maze.lair,
    walls: maze.walls,
    wallSupply: maze.wallSupply,
    turn: first,
    face: faceFor(seed, 1),
    phase: 'play',
    winners: [],
    turns: 0,
    seed,
    counter: 2,
    skips: 0,
  };
  return settle(state);
}

// ---------- looking at the board ----------
export const cornerOf = (s: State, seat: number): number => s.corners[seat] as number;
export const onGoal = (s: State, seat: number, hero: number): boolean => {
  const c = s.heroes[seat]?.[hero];
  return c !== undefined && (s.maze.goals[cornerOf(s, seat)] as readonly number[]).includes(c);
};
export const heroesHome = (s: State, seat: number): number => (s.heroes[seat] as readonly number[]).filter((_, h) => onGoal(s, seat, h)).length;
export const isSafeCell = (m: Maze, cell: number): boolean => {
  const c = m.cells[cell] as string;
  return isStart(c) || isGoal(c) || cell === m.lair;
};

/** Who stands on a square: `[seat, hero]`, or null. */
export function heroAt(s: State, cell: number): [number, number] | null {
  for (let seat = 0; seat < s.players; seat++) {
    const h = (s.heroes[seat] as readonly number[]).indexOf(cell);
    if (h >= 0) return [seat, h];
  }
  return null;
}

/** Squares a hero's path may use (before looking at who stands where): not hedges, walls, the lair or other players' start blocks. */
function walkable(s: State, cell: number): boolean {
  const c = s.maze.cells[cell] as string;
  if (c === '#' || c === 'M' || s.walls.includes(cell)) return false;
  return !isStart(c); // nobody walks into a start block; heroes only go home when the Minotaur sends them
}

/** Where a hero can end a move of exactly `steps` squares (or earlier, by stepping onto one of its own goal squares). */
export function heroDestinations(s: State, seat: number, hero: number, steps: number): number[] {
  const m = s.maze;
  const corner = cornerOf(s, seat);
  const origin = (s.heroes[seat] as readonly number[])[hero] as number;
  if (onGoal(s, seat, hero)) return [];
  const goals = new Set(m.goals[corner] as readonly number[]);
  const occupied = new Set<number>([...s.heroes.flat(), s.minotaur]);
  const ends = new Set<number>();
  const visited = new Set<number>([origin]);
  const firstSteps = (m.starts[corner] as readonly number[]).includes(origin) ? (m.exits[corner] as readonly number[]) : neighbours(m, origin);
  const walk = (cell: number, depth: number): void => {
    if (!walkable(s, cell) || occupied.has(cell) || visited.has(cell)) return;
    if (goals.has(cell)) {
      ends.add(cell); // landing on your own goal ends the move, whatever is left of the roll
      return;
    }
    if (depth === steps) {
      ends.add(cell);
      return;
    }
    visited.add(cell);
    for (const n of neighbours(m, cell)) walk(n, depth + 1);
    visited.delete(cell);
  };
  for (const n of firstSteps) walk(n, 1);
  return [...ends].sort((a, b) => a - b);
}

/** Where the Minotaur can go: squares exactly eight steps away, and heroes within eight steps it would run into. */
export function minotaurDestinations(s: State): { ends: number[]; hits: number[] } {
  const m = s.maze;
  const ends = new Set<number>();
  const hits = new Set<number>();
  const visited = new Set<number>([s.minotaur]);
  const walk = (cell: number, depth: number): void => {
    if (visited.has(cell)) return;
    const c = m.cells[cell] as string;
    if (c !== '.' || s.walls.includes(cell)) return; // hedges, walls and every safe square stop it
    if (heroAt(s, cell)) {
      hits.add(cell);
      return;
    }
    if (depth === MINOTAUR_STEPS) {
      ends.add(cell);
      return;
    }
    visited.add(cell);
    for (const n of neighbours(m, cell)) walk(n, depth + 1);
    visited.delete(cell);
  };
  const firstSteps = s.minotaur === m.lair ? m.lairExits : neighbours(m, s.minotaur);
  for (const n of firstSteps) walk(n, 1);
  return { ends: [...ends].sort((a, b) => a - b), hits: [...hits].sort((a, b) => a - b) };
}

/** Does every player still have a route from their start block to one of their own goal squares? (Heroes and the Minotaur are ignored: only hedges and walls count.) */
export function routesOpen(m: Maze, corners: readonly number[], walls: readonly number[]): boolean {
  const wallSet = new Set(walls);
  return corners.every((corner) => {
    const goals = new Set(m.goals[corner] as readonly number[]);
    const queue = (m.exits[corner] as readonly number[]).filter((c) => !wallSet.has(c));
    const seen = new Set<number>(queue);
    while (queue.length) {
      const cell = queue.pop() as number;
      if (goals.has(cell)) return true;
      for (const n of neighbours(m, cell)) {
        const c = m.cells[n] as string;
        if (seen.has(n) || wallSet.has(n) || c === '#' || c === 'M' || isStart(c)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    return false;
  });
}

/** Squares a wall may be put on: open squares with nothing on them. */
export function wallSquares(s: State): number[] {
  const occupied = new Set<number>([...s.heroes.flat(), s.minotaur, ...s.walls]);
  return s.maze.cells.flatMap((c, i) => (c === '.' && !occupied.has(i) ? [i] : []));
}

export const keyOf = (a: Action): string => (a.type === 'move' ? `move:${a.hero}:${a.to}` : a.type === 'minotaur' ? `minotaur:${a.to}` : `wall:${a.from}:${a.to}`);

/** Everything the player to move may do with the roll. Empty only when the roll cannot be used (the turn is then lost) or the game is over. */
export function legalActions(s: State): Action[] {
  if (s.phase === 'over') return [];
  const out: Action[] = [];
  if (typeof s.face === 'number') {
    for (let hero = 0; hero < HEROES_PER_PLAYER; hero++) for (const to of heroDestinations(s, s.turn, hero, s.face)) out.push({ type: 'move', hero, to });
  } else if (s.face === 'minotaur') {
    const { ends, hits } = minotaurDestinations(s);
    for (const to of [...hits, ...ends]) out.push({ type: 'minotaur', to });
  } else {
    const targets = wallSquares(s);
    const sources: (number | 'supply')[] = [...(s.wallSupply > 0 ? (['supply'] as const) : []), ...s.walls];
    for (const from of sources) {
      const rest = from === 'supply' ? s.walls : s.walls.filter((w) => w !== from);
      for (const to of targets) if (routesOpen(s.maze, s.corners, [...rest, to])) out.push({ type: 'wall', from, to });
    }
  }
  return out;
}

export const isLegal = (s: State, a: Action): boolean => legalActions(s).some((x) => keyOf(x) === keyOf(a));

/** Play an action for the player to move. Returns null if it is not allowed. */
export function apply(state: State, action: Action): State | null {
  if (!isLegal(state, action)) return null;
  const seat = state.turn;
  let s = state;
  if (action.type === 'move') {
    s = { ...s, heroes: s.heroes.map((hs, i) => (i === seat ? hs.map((c, h) => (h === action.hero ? action.to : c)) : hs)) };
    if (heroesHome(s, seat) >= heroesNeeded(s.players)) return { ...s, phase: 'over', winners: [seat], skips: 0 };
  } else if (action.type === 'minotaur') {
    const hit = heroAt(s, action.to);
    if (hit) {
      const [victim, hero] = hit;
      const home = (s.maze.starts[cornerOf(s, victim)] as readonly number[])[hero] as number;
      s = { ...s, minotaur: s.maze.lair, heroes: s.heroes.map((hs, i) => (i === victim ? hs.map((c, h) => (h === hero ? home : c)) : hs)) };
    } else s = { ...s, minotaur: action.to };
  } else {
    const walls = action.from === 'supply' ? [...s.walls, action.to] : s.walls.map((w) => (w === action.from ? action.to : w));
    s = { ...s, walls, wallSupply: action.from === 'supply' ? s.wallSupply - 1 : s.wallSupply };
  }
  return settle(nextTurn({ ...s, skips: 0 }));
}

/** Pass the turn on and roll for the next player. */
function nextTurn(s: State): State {
  return { ...s, turn: (s.turn + 1) % s.players, face: faceFor(s.seed, s.counter), counter: s.counter + 1, turns: s.turns + 1 };
}

/** If the roll cannot be used the turn is lost, and so on, until somebody has something to do. */
function settle(state: State): State {
  let s = state;
  for (;;) {
    if (s.turns >= MAX_TURNS || s.skips >= MAX_SKIPS_IN_A_ROW) return finishByProgress(s);
    if (legalActions(s).length > 0) return s;
    s = nextTurn({ ...s, skips: s.skips + 1 });
  }
}

/** The game is stuck or has gone on too long: the most heroes home wins, then whoever is closest. */
function finishByProgress(s: State): State {
  const score = (seat: number) => heroesHome(s, seat) * 1000 + (s.heroes[seat] as readonly number[]).reduce((n, _c, h) => n + Math.max(0, 200 - (distancesToGoal(s, seat)[(s.heroes[seat] as readonly number[])[h] as number] ?? 200)), 0);
  const best = Math.max(...Array.from({ length: s.players }, (_, i) => score(i)));
  return { ...s, phase: 'over', winners: Array.from({ length: s.players }, (_, i) => i).filter((i) => score(i) === best) };
}

/** Steps from every square to the nearest goal square of this seat, going round hedges and walls (heroes ignored). -1 if unreachable. */
export function distancesToGoal(s: State, seat: number): number[] {
  const m = s.maze;
  const corner = cornerOf(s, seat);
  const d: number[] = Array(m.cells.length).fill(-1);
  const queue: number[] = [];
  for (const g of m.goals[corner] as readonly number[]) {
    d[g] = 0;
    queue.push(g);
  }
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head] as number;
    for (const n of neighbours(m, cell)) {
      const c = m.cells[n] as string;
      if (d[n] !== -1 || c === '#' || c === 'M' || s.walls.includes(n)) continue;
      if (isStart(c) && !(m.starts[corner] as readonly number[]).includes(n)) continue;
      d[n] = (d[cell] as number) + 1;
      queue.push(n);
    }
  }
  // a hero in its own start block leaves by any exit, so the block is one square further than its best exit
  for (const st of m.starts[corner] as readonly number[]) {
    const best = Math.min(...(m.exits[corner] as readonly number[]).map((e) => (d[e] === -1 ? Infinity : (d[e] as number))));
    d[st] = best === Infinity ? -1 : best + 1;
  }
  return d;
}

export interface Setup {
  readonly players: readonly { readonly name: string; readonly kind: 'human' | 'bot'; readonly level?: 'easy' | 'normal' | 'hard' }[];
  readonly seed: number;
}
export interface Entry {
  readonly seat: number;
  readonly action: Action;
}

/** Play a recorded game from its start. Actions that are illegal, or from a player whose turn it is not, are ignored (everyone ignores the same ones). */
export function replay(setup: Setup, entries: readonly Entry[], maze: Maze = MAZE): State {
  let state = newGame(setup.players.length, setup.seed, maze);
  for (const e of entries) {
    if (e.seat !== state.turn) continue;
    const next = apply(state, e.action);
    if (next) state = next;
  }
  return state;
}

/** One line for the game log. `before` is the state the action was played in. */
export function describe(before: State, action: Action, names: readonly string[]): string {
  const who = names[before.turn];
  const faceText = typeof before.face === 'number' ? `${before.face}` : before.face === 'wall' ? 'a wall' : 'the Minotaur';
  if (action.type === 'move') {
    const after = apply(before, action);
    const arrived = onGoal(before, before.turn, action.hero) ? false : (before.maze.goals[cornerOf(before, before.turn)] as readonly number[]).includes(action.to);
    return `${who} rolled ${faceText} and moved a hero${arrived ? ' onto the temple!' : ''}${after?.phase === 'over' ? ' and wins' : ''}`;
  }
  if (action.type === 'minotaur') {
    const hit = heroAt(before, action.to);
    return hit ? `${who} rolled the Minotaur: it hit ${names[hit[0]]}'s hero, who goes back to start` : `${who} rolled the Minotaur and moved it eight squares`;
  }
  return action.from === 'supply' ? `${who} rolled a wall and placed one` : `${who} rolled a wall and moved one`;
}
