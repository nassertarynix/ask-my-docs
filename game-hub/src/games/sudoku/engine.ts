/**
 * Sudoku: a 9 x 9 grid where every row, column and 3 x 3 box holds 1 to 9 exactly once.
 * A grid is 81 numbers, row by row, with 0 for an empty cell. Puzzles are made from a seed and always have exactly
 * one solution.
 */
import { nextRandom, type Rng } from '../crater-lab/engine/rng';

export type Grid = readonly number[];
export type Difficulty = 'easy' | 'medium' | 'hard';

/** How many cells are given at the start. Fewer clues is harder. */
export const CLUES: Record<Difficulty, number> = { easy: 40, medium: 32, hard: 26 };

export const row = (i: number): number => Math.floor(i / 9);
export const col = (i: number): number => i % 9;
export const box = (i: number): number => Math.floor(row(i) / 3) * 3 + Math.floor(col(i) / 3);

/** The 20 other cells that share a row, column or box with a cell. */
export const PEERS: readonly (readonly number[])[] = Array.from({ length: 81 }, (_, i) => {
  const out: number[] = [];
  for (let j = 0; j < 81; j++) if (j !== i && (row(j) === row(i) || col(j) === col(i) || box(j) === box(i))) out.push(j);
  return out;
});

/** Bit n (1 to 9) is set for each digit that can still go in cell i, given the other cells. */
function candidates(grid: Grid | Int8Array, i: number): number {
  let used = 0;
  for (const p of PEERS[i] as readonly number[]) {
    const v = grid[p] as number;
    if (v) used |= 1 << v;
  }
  return ~used & 0x3fe;
}

const bits = (mask: number): number => {
  let n = 0;
  for (; mask; mask &= mask - 1) n++;
  return n;
};

/**
 * Count the solutions of a grid, stopping at `limit`. Fills the most constrained empty cell first,
 * which keeps even a sparse grid fast.
 */
export function countSolutions(grid: Grid, limit = 2): number {
  const work = Int8Array.from(grid);
  let found = 0;
  const go = (): void => {
    if (found >= limit) return;
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (work[i]) continue;
      const mask = candidates(work, i);
      const n = bits(mask);
      if (n < bestCount) {
        best = i;
        bestMask = mask;
        bestCount = n;
        if (n <= 1) break;
      }
    }
    if (best === -1) {
      found++;
      return;
    }
    for (let d = 1; d <= 9 && found < limit; d++) {
      if (!(bestMask & (1 << d))) continue;
      work[best] = d;
      go();
      work[best] = 0;
    }
  };
  go();
  return found;
}

/** The solution of a grid (the first one found), or null if it has none. */
export function solve(grid: Grid): number[] | null {
  const work = Int8Array.from(grid);
  const go = (): boolean => {
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (work[i]) continue;
      const mask = candidates(work, i);
      const n = bits(mask);
      if (n < bestCount) {
        best = i;
        bestMask = mask;
        bestCount = n;
        if (n <= 1) break;
      }
    }
    if (best === -1) return true;
    for (let d = 1; d <= 9; d++) {
      if (!(bestMask & (1 << d))) continue;
      work[best] = d;
      if (go()) return true;
      work[best] = 0;
    }
    return false;
  };
  return go() ? Array.from(work) : null;
}

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(rng) * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** A complete, valid grid, different for each seed. */
export function randomSolution(rng: Rng): number[] {
  const work = new Int8Array(81);
  const go = (i: number): boolean => {
    if (i === 81) return true;
    const mask = candidates(work, i);
    for (const d of shuffled([1, 2, 3, 4, 5, 6, 7, 8, 9], rng)) {
      if (!(mask & (1 << d))) continue;
      work[i] = d;
      if (go(i + 1)) return true;
      work[i] = 0;
    }
    return false;
  };
  go(0);
  return Array.from(work);
}

export interface Puzzle {
  /** The starting grid (0 for empty). */
  puzzle: number[];
  /** The one solution. */
  solution: number[];
}

/**
 * Make a puzzle: start from a full grid and take cells away in random order, keeping each removal only if the
 * puzzle still has exactly one solution, until the difficulty's number of clues is reached (or no more can go).
 */
export function generate(rng: Rng, difficulty: Difficulty): Puzzle {
  const solution = randomSolution(rng);
  const puzzle = [...solution];
  let clues = 81;
  for (const i of shuffled(Array.from({ length: 81 }, (_, k) => k), rng)) {
    if (clues <= CLUES[difficulty]) break;
    const keep = puzzle[i] as number;
    puzzle[i] = 0;
    if (countSolutions(puzzle, 2) !== 1) puzzle[i] = keep;
    else clues--;
  }
  return { puzzle, solution };
}

/** Cells that hold a digit also found in a cell they share a row, column or box with. */
export function conflicts(grid: Grid): Set<number> {
  const bad = new Set<number>();
  for (let i = 0; i < 81; i++) {
    const v = grid[i] as number;
    if (!v) continue;
    for (const p of PEERS[i] as readonly number[]) {
      if (grid[p] === v) {
        bad.add(i);
        bad.add(p);
      }
    }
  }
  return bad;
}

/** Every cell filled and no conflicts: a valid, solved grid. */
export function isSolved(grid: Grid): boolean {
  return grid.every((v) => v >= 1 && v <= 9) && conflicts(grid).size === 0;
}

/** The digits that could still go in a cell (a helper for pencil-mark "fill all" and for hints). */
export function possibleDigits(grid: Grid, i: number): number[] {
  const mask = candidates(grid, i);
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => mask & (1 << d));
}

/** How many of each digit are on the grid; a digit with 9 is finished. */
export function digitCounts(grid: Grid): number[] {
  const counts = new Array<number>(10).fill(0);
  for (const v of grid) counts[v] = (counts[v] ?? 0) + 1;
  return counts;
}
