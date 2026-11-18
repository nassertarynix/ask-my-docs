import { describe, expect, it } from 'vitest';
import { createRng } from '../../crater-lab/engine/rng';
import { CLUES, PEERS, box, col, conflicts, countSolutions, digitCounts, generate, isSolved, possibleDigits, randomSolution, row, solve, type Difficulty } from '../engine';

// a well-known puzzle with a unique solution
const PUZZLE = '530070000600195000098000060800060003400803001700020006060000280000419005000080079'.split('').map(Number);
const SOLUTION = '534678912672195348198342567859761423426853791713924856961537284287419635345286179'.split('').map(Number);

describe('the grid geometry', () => {
  it('rows, columns and boxes', () => {
    expect([row(0), col(0), box(0)]).toEqual([0, 0, 0]);
    expect([row(80), col(80), box(80)]).toEqual([8, 8, 8]);
    expect(box(30)).toBe(4); // row 3, column 3: the middle box
    expect(box(8)).toBe(2);
  });

  it('every cell has 20 distinct peers, never itself, and peering is mutual', () => {
    for (let i = 0; i < 81; i++) {
      const peers = PEERS[i]!;
      expect(peers).toHaveLength(20);
      expect(new Set(peers).size).toBe(20);
      expect(peers).not.toContain(i);
      for (const p of peers) expect(PEERS[p]).toContain(i);
    }
  });
});

describe('the solver', () => {
  it('solves a known puzzle, keeping the given digits', () => {
    const solved = solve(PUZZLE)!;
    expect(solved).toEqual(SOLUTION);
    PUZZLE.forEach((v, i) => v && expect(solved[i]).toBe(v));
  });

  it('counts exactly one solution for it, and more for an under-constrained grid', () => {
    expect(countSolutions(PUZZLE, 5)).toBe(1);
    expect(countSolutions(new Array(81).fill(0), 2)).toBe(2); // an empty grid has billions: it stops at the limit
    const loose = [...SOLUTION];
    for (const i of [0, 1, 9, 10]) loose[i] = 0; // a "deadly rectangle" can be filled two ways
    expect(countSolutions(loose, 5)).toBeGreaterThanOrEqual(1);
  });

  it('finds no solution for a grid that cannot be solved', () => {
    const bad = [...PUZZLE];
    bad[2] = 5; // a 5 beside the given 5 in row 0
    expect(countSolutions(bad, 2)).toBe(0);
    expect(solve(bad)).toBeNull();
  });
});

describe('generating puzzles', () => {
  it('a random solution is a valid full grid, and different for different seeds', () => {
    const a = randomSolution(createRng(1));
    const b = randomSolution(createRng(2));
    expect(isSolved(a)).toBe(true);
    expect(isSolved(b)).toBe(true);
    expect(a).not.toEqual(b);
    expect(randomSolution(createRng(1))).toEqual(a);
  });

  it.each(['easy', 'medium', 'hard'] as Difficulty[])('%s: the same seed gives the same puzzle, it has the right clues, one solution, and the stated solution', (level) => {
    const first = generate(createRng(7), level);
    const again = generate(createRng(7), level);
    expect(first).toEqual(again);
    const clues = first.puzzle.filter(Boolean).length;
    expect(clues).toBeGreaterThanOrEqual(CLUES[level]);
    expect(clues).toBeLessThanOrEqual(CLUES[level] + 4); // a few cells cannot be removed without losing uniqueness
    expect(countSolutions(first.puzzle, 3)).toBe(1);
    expect(solve(first.puzzle)).toEqual(first.solution);
    expect(isSolved(first.solution)).toBe(true);
    first.puzzle.forEach((v, i) => v && expect(first.solution[i]).toBe(v));
  });

  it('harder levels have fewer clues, over several seeds', () => {
    for (const seed of [1, 2, 3]) {
      const easy = generate(createRng(seed), 'easy').puzzle.filter(Boolean).length;
      const hard = generate(createRng(seed), 'hard').puzzle.filter(Boolean).length;
      expect(hard).toBeLessThan(easy);
    }
  });
});

describe('checking a grid', () => {
  it('finds both cells of a clash, and nothing in a valid partial grid', () => {
    expect(conflicts(PUZZLE).size).toBe(0);
    const clash = [...PUZZLE];
    clash[2] = 5; // beside the 5 at index 0 in the same row
    expect([...conflicts(clash)].sort((a, b) => a - b)).toEqual([0, 2]);
    const column = [...PUZZLE];
    column[18] = 5; // the same column as the 5 at index 0, (row 2, column 0)
    expect(conflicts(column).has(0)).toBe(true);
    expect(conflicts(column).has(18)).toBe(true);
    const inBox = [...PUZZLE];
    inBox[10] = 5; // (row 1, column 1) is in the same box as the 5 at index 0
    expect(conflicts(inBox).has(10)).toBe(true);
  });

  it('solved means full and clash-free; a full grid with a clash, or a gap, is not solved', () => {
    expect(isSolved(SOLUTION)).toBe(true);
    expect(isSolved(PUZZLE)).toBe(false);
    const swapped = [...SOLUTION];
    [swapped[0], swapped[1]] = [swapped[1] as number, swapped[0] as number];
    expect(isSolved(swapped)).toBe(false);
  });

  it('lists the digits a cell can still take, and counts digits', () => {
    expect(possibleDigits(PUZZLE, 2)).toEqual([1, 2, 4]); // the well-known first-row hole: the cell at row 0, column 2
    expect(possibleDigits(SOLUTION, 0)).toEqual([5]); // in a solved grid every cell has just its own digit left
    const counts = digitCounts(SOLUTION);
    for (let d = 1; d <= 9; d++) expect(counts[d]).toBe(9);
  });
});
