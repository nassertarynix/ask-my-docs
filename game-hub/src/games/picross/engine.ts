/**
 * Picross (Nonograms). Fill squares so that each row and column contains runs of filled squares of exactly the
 * lengths in its clue, in order, separated by at least one empty square. A clue "2 1" means a run of two filled
 * squares, a gap, then a run of one. The filled squares form a picture.
 *
 * Puzzles are made from a seed and kept only if they can be solved by pure line logic (looking at one row or
 * column at a time), so a puzzle never needs guessing and always has exactly one answer.
 */
import { nextRandom, type Rng } from '../crater-lab/engine/rng';

export type Size = 5 | 10 | 15;
export const SIZES: readonly Size[] = [5, 10, 15];
export const DENSITY = 0.6;

/** 0 = not known yet, 1 = filled, 2 = empty. */
export type Cell = 0 | 1 | 2;

export interface Clues {
  rows: number[][];
  cols: number[][];
}

/** The run lengths of filled squares in a line. An empty line gives []. */
export function cluesOf(line: readonly boolean[]): number[] {
  const out: number[] = [];
  let run = 0;
  for (const filled of line) {
    if (filled) run++;
    else if (run > 0) {
      out.push(run);
      run = 0;
    }
  }
  if (run > 0) out.push(run);
  return out;
}

const rowOf = (grid: readonly boolean[], n: number, r: number): boolean[] => grid.slice(r * n, r * n + n);
const colOf = (grid: readonly boolean[], n: number, c: number): boolean[] => Array.from({ length: n }, (_, r) => grid[r * n + c] as boolean);

/** Clues for a square picture (row by row, true = filled). */
export function puzzleClues(grid: readonly boolean[], n: number): Clues {
  return {
    rows: Array.from({ length: n }, (_, r) => cluesOf(rowOf(grid, n, r))),
    cols: Array.from({ length: n }, (_, c) => cluesOf(colOf(grid, n, c))),
  };
}

/**
 * Line logic: given a clue and what is known of a line, find which squares are filled in EVERY arrangement that
 * fits, and which are empty in every arrangement. Returns the improved line, or null if no arrangement fits
 * (the clue contradicts what is known).
 */
export function solveLine(clue: readonly number[], line: readonly Cell[]): Cell[] | null {
  const n = line.length;
  const mustFill = new Array<boolean>(n).fill(true);
  const mustEmpty = new Array<boolean>(n).fill(true);
  let any = false;
  const placement = new Array<boolean>(n).fill(false);

  const record = () => {
    any = true;
    for (let i = 0; i < n; i++) {
      if (placement[i]) mustEmpty[i] = false;
      else mustFill[i] = false;
    }
  };

  // place block k so that it starts at `from` or later
  const place = (k: number, from: number): void => {
    if (k === clue.length) {
      for (let i = from; i < n; i++) if (line[i] === 1) return; // a known filled square left over
      record();
      return;
    }
    const len = clue[k] as number;
    let restMin = 0;
    for (let j = k + 1; j < clue.length; j++) restMin += (clue[j] as number) + 1;
    for (let start = from; start + len + restMin <= n; start++) {
      // squares skipped before this block must not be known-filled
      let ok = true;
      for (let i = from; i < start && ok; i++) if (line[i] === 1) ok = false;
      if (!ok) break; // moving the start further right only skips more
      for (let i = start; i < start + len && ok; i++) if (line[i] === 2) ok = false;
      const gapAfter = start + len;
      if (ok && gapAfter < n && line[gapAfter] === 1) ok = false;
      if (!ok) continue;
      for (let i = start; i < start + len; i++) placement[i] = true;
      place(k + 1, gapAfter + 1);
      for (let i = start; i < start + len; i++) placement[i] = false;
    }
  };
  place(0, 0);
  if (!any) return null;
  return line.map((v, i) => (v !== 0 ? v : mustFill[i] ? 1 : mustEmpty[i] ? 2 : 0));
}

export interface LogicResult {
  grid: Cell[];
  /** Every square decided, with no contradiction. */
  solved: boolean;
  /** Clues that cannot be satisfied at all. */
  contradiction: boolean;
}

/** Solve with line logic only, repeating over all rows and columns until nothing more can be deduced. */
export function solveByLogic(clues: Clues, n: number): LogicResult {
  const grid: Cell[] = new Array<Cell>(n * n).fill(0);
  let changed = true;
  while (changed) {
    changed = false;
    for (let r = 0; r < n; r++) {
      const before = grid.slice(r * n, r * n + n) as Cell[];
      const after = solveLine(clues.rows[r] as number[], before);
      if (!after) return { grid, solved: false, contradiction: true };
      after.forEach((v, c) => {
        if (v !== before[c]) {
          grid[r * n + c] = v;
          changed = true;
        }
      });
    }
    for (let c = 0; c < n; c++) {
      const before = Array.from({ length: n }, (_, r) => grid[r * n + c] as Cell);
      const after = solveLine(clues.cols[c] as number[], before);
      if (!after) return { grid, solved: false, contradiction: true };
      after.forEach((v, r) => {
        if (v !== before[r]) {
          grid[r * n + c] = v;
          changed = true;
        }
      });
    }
  }
  return { grid, solved: grid.every((v) => v !== 0), contradiction: false };
}

export interface Puzzle {
  n: number;
  /** The picture (true = filled). */
  solution: boolean[];
  clues: Clues;
}

/**
 * Make a puzzle: draw a random picture, and if line logic cannot solve it completely, fill in the squares it could
 * not decide (which removes the ambiguity) and try again, until it can.
 */
export function generate(rng: Rng, n: Size): Puzzle {
  for (let attempt = 0; attempt < 400; attempt++) {
    const solution = Array.from({ length: n * n }, () => nextRandom(rng) < DENSITY);
    for (let fix = 0; fix < 60; fix++) {
      if (solution.every((v) => !v) || solution.every(Boolean)) break;
      const clues = puzzleClues(solution, n);
      const result = solveByLogic(clues, n);
      if (result.solved) return { n, solution, clues };
      // squares logic could not decide: fill about half of them and look again
      let flipped = false;
      result.grid.forEach((v, i) => {
        if (v === 0 && !solution[i] && nextRandom(rng) < 0.5) {
          solution[i] = true;
          flipped = true;
        }
      });
      if (!flipped) {
        const unknown = result.grid.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
        const pick = unknown[Math.floor(nextRandom(rng) * unknown.length)] as number;
        solution[pick] = !solution[pick];
      }
    }
  }
  throw new Error('Could not make a puzzle.');
}

/** Does the player's line (filled = true) match a clue exactly? */
export const lineMatches = (clue: readonly number[], filled: readonly boolean[]): boolean => {
  const got = cluesOf(filled);
  return got.length === clue.length && got.every((v, i) => v === clue[i]);
};

/** Solved when every row and every column of the player's filled squares matches its clue. */
export function isSolved(filled: readonly boolean[], clues: Clues, n: number): boolean {
  for (let r = 0; r < n; r++) if (!lineMatches(clues.rows[r] as number[], rowOf(filled, n, r))) return false;
  for (let c = 0; c < n; c++) if (!lineMatches(clues.cols[c] as number[], colOf(filled, n, c))) return false;
  return true;
}

export { rowOf, colOf };
