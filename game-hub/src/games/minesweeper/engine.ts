/**
 * Minesweeper. Reveal every square that is not a mine. A revealed square shows how many of its (up to eight)
 * neighbours are mines; a square with none opens its neighbours automatically. Flags mark suspected mines.
 *
 * Mines are placed on the first reveal, never on the square you open or its neighbours, so the first click can never
 * lose and always opens some space. Pure functions: every move returns a new state.
 */
import { nextRandom, type Rng } from '../crater-lab/engine/rng';

export interface Preset {
  id: 'beginner' | 'intermediate' | 'expert';
  name: string;
  w: number;
  h: number;
  mines: number;
}
export const PRESETS: readonly Preset[] = [
  { id: 'beginner', name: 'Beginner', w: 9, h: 9, mines: 10 },
  { id: 'intermediate', name: 'Intermediate', w: 16, h: 16, mines: 40 },
  { id: 'expert', name: 'Expert', w: 30, h: 16, mines: 99 },
];

export type Status = 'ready' | 'playing' | 'won' | 'lost';

export interface State {
  w: number;
  h: number;
  mineCount: number;
  /** 1 where there is a mine (all zero until the first reveal). */
  mines: Uint8Array;
  revealed: Uint8Array;
  flags: Uint8Array;
  status: Status;
  /** The mine that ended the game. */
  exploded: number | null;
}

export function newGame(w: number, h: number, mineCount: number): State {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 2 || h < 2 || w > 50 || h > 50) throw new Error('A board is 2 to 50 squares each way.');
  // the first click's square and its neighbours stay clear, so at most (w*h - 9) mines fit
  if (!Number.isInteger(mineCount) || mineCount < 1 || mineCount > w * h - 9) throw new Error('Too many or too few mines.');
  return { w, h, mineCount, mines: new Uint8Array(w * h), revealed: new Uint8Array(w * h), flags: new Uint8Array(w * h), status: 'ready', exploded: null };
}

export function neighbours(s: Pick<State, 'w' | 'h'>, i: number): number[] {
  const r = Math.floor(i / s.w);
  const c = i % s.w;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < s.h && cc >= 0 && cc < s.w) out.push(rr * s.w + cc);
    }
  }
  return out;
}

/** How many of a square's neighbours are mines. */
export function adjacent(s: State, i: number): number {
  return neighbours(s, i).reduce((n, j) => n + (s.mines[j] ?? 0), 0);
}

export function flagsPlaced(s: State): number {
  return s.flags.reduce((a, b) => a + b, 0);
}

function placeMines(s: State, safe: number, rng: Rng): Uint8Array {
  const banned = new Set([safe, ...neighbours(s, safe)]);
  const pool: number[] = [];
  for (let i = 0; i < s.w * s.h; i++) if (!banned.has(i)) pool.push(i);
  const mines = new Uint8Array(s.w * s.h);
  for (let k = 0; k < s.mineCount; k++) {
    const pick = Math.floor(nextRandom(rng) * pool.length);
    mines[pool[pick] as number] = 1;
    pool[pick] = pool[pool.length - 1] as number;
    pool.pop();
  }
  return mines;
}

function copy(s: State): State {
  return { ...s, mines: s.mines.slice(), revealed: s.revealed.slice(), flags: s.flags.slice() };
}

function checkWin(s: State): void {
  if (s.status !== 'playing') return;
  let hidden = 0;
  for (let i = 0; i < s.revealed.length; i++) if (!s.revealed[i] && !s.mines[i]) hidden++;
  if (hidden === 0) {
    s.status = 'won';
    for (let i = 0; i < s.mines.length; i++) if (s.mines[i]) s.flags[i] = 1; // a won board shows every mine flagged
  }
}

/** Open the squares reachable from `start` through squares with no mine neighbours (flagged squares are left alone). */
function flood(s: State, start: number): void {
  const stack = [start];
  while (stack.length > 0) {
    const i = stack.pop() as number;
    if (s.revealed[i] || s.flags[i]) continue;
    s.revealed[i] = 1;
    if (adjacent(s, i) === 0) for (const j of neighbours(s, i)) if (!s.revealed[j]) stack.push(j);
  }
}

function explode(s: State, at: number): void {
  s.status = 'lost';
  s.exploded = at;
  for (let i = 0; i < s.mines.length; i++) if (s.mines[i]) s.revealed[i] = 1;
}

/** Open a square. The first call places the mines (using `rng`). Revealing a flagged or opened square does nothing. */
export function reveal(state: State, i: number, rng: Rng): State {
  if (state.status === 'won' || state.status === 'lost') return state;
  if (!Number.isInteger(i) || i < 0 || i >= state.w * state.h) throw new Error('That square is not on the board.');
  if (state.revealed[i] || state.flags[i]) return state;
  const s = copy(state);
  if (s.status === 'ready') {
    s.mines = placeMines(s, i, rng);
    s.status = 'playing';
  }
  if (s.mines[i]) {
    explode(s, i);
    return s;
  }
  flood(s, i);
  checkWin(s);
  return s;
}

/** Put a flag on a hidden square, or take it off. Opened squares cannot be flagged. */
export function toggleFlag(state: State, i: number): State {
  if (state.status === 'won' || state.status === 'lost') return state;
  if (state.revealed[i]) return state;
  const s = copy(state);
  s.flags[i] = s.flags[i] ? 0 : 1;
  return s;
}

/**
 * "Chording": on an opened number whose flag count matches the number, open every unflagged neighbour at once.
 * A wrong flag means that opens a mine, and the game is lost, exactly as clicking each one would.
 */
export function chord(state: State, i: number, rng: Rng): State {
  if (state.status !== 'playing' || !state.revealed[i]) return state;
  const around = neighbours(state, i);
  const number = adjacent(state, i);
  if (number === 0 || around.filter((j) => state.flags[j]).length !== number) return state;
  let s = state;
  for (const j of around) {
    if (!s.flags[j] && !s.revealed[j]) s = reveal(s, j, rng);
    if (s.status === 'lost') break;
  }
  return s;
}

export const minesLeft = (s: State): number => s.mineCount - flagsPlaced(s);
