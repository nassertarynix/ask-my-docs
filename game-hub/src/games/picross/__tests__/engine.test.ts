import { describe, expect, it } from 'vitest';
import { createRng } from '../../crater-lab/engine/rng';
import { SIZES, cluesOf, colOf, generate, isSolved, lineMatches, puzzleClues, rowOf, solveByLogic, solveLine, type Cell } from '../engine';

const bools = (s: string): boolean[] => s.split('').map((c) => c === '#');
const cells = (s: string): Cell[] => s.split('').map((c) => (c === '#' ? 1 : c === 'x' ? 2 : 0));
const show = (line: readonly Cell[]): string => line.map((v) => (v === 1 ? '#' : v === 2 ? 'x' : '.')).join('');

describe('clues', () => {
  it.each([
    ['.....', []],
    ['#####', [5]],
    ['##.#.', [2, 1]],
    ['#.#.#', [1, 1, 1]],
    ['.###.', [3]],
    ['##.##', [2, 2]],
  ])('%s -> %j', (line, clue) => {
    expect(cluesOf(bools(line))).toEqual(clue);
  });

  it('a picture has clues for each row and column', () => {
    const grid = bools('##...' + '.#...' + '.###.' + '...#.' + '.....');
    const clues = puzzleClues(grid, 5);
    expect(clues.rows).toEqual([[2], [1], [3], [1], []]);
    expect(clues.cols).toEqual([[1], [3], [1], [2], []]);
    expect(rowOf(grid, 5, 2)).toEqual(bools('.###.'));
    expect(colOf(grid, 5, 1)).toEqual(bools('###..'));
  });
});

describe('line logic', () => {
  it('overlap: a run of 4 in 5 squares must cover the middle three', () => {
    expect(show(solveLine([4], cells('.....'))!)).toBe('.###.');
  });

  it('a clue that fills the line exactly settles every square', () => {
    expect(show(solveLine([2, 2], cells('.....'))!)).toBe('##x##'); // 2 + gap + 2 is exactly 5
    expect(show(solveLine([1, 1, 1], cells('.....'))!)).toBe('#x#x#');
    expect(show(solveLine([5], cells('.....'))!)).toBe('#####');
  });

  it('an empty clue empties the line', () => {
    expect(show(solveLine([], cells('.....'))!)).toBe('xxxxx');
  });

  it('uses what is already known: filled squares pin a run, empty squares push it', () => {
    expect(show(solveLine([3], cells('..#..'))!)).toBe('..#..'); // 0-2, 1-3 or 2-4: only the middle square is certain
    expect(show(solveLine([2], cells('#....'))!)).toBe('##xxx');
    expect(show(solveLine([2], cells('x....'))!)).toBe('x....'); // 1-2, 2-3 or 3-4: nothing certain yet
    expect(show(solveLine([1, 1], cells('#....'))!)).toBe('#x...');
    expect(show(solveLine([3], cells('xx...'))!)).toBe('xx###');
  });

  it('finds what is certain when there is slack: [2,1] in 5 squares must fill square 1', () => {
    expect(show(solveLine([2, 1], cells('.....'))!)).toBe('.#...');
  });

  it('returns null when the clue contradicts what is known', () => {
    expect(solveLine([2], cells('#.#..'))).toBeNull(); // squares 0 and 2 are both filled but a run of 2 cannot cover both
    expect(solveLine([6], cells('.....'))).toBeNull(); // does not fit
    expect(solveLine([], cells('#....'))).toBeNull(); // nothing may be filled
  });

  it('never changes a square that is already known', () => {
    const before = cells('#.x..');
    const after = solveLine([1, 1], before)!;
    expect(after[0]).toBe(1);
    expect(after[2]).toBe(2);
  });
});

describe('solving a whole puzzle by logic', () => {
  it('solves a small picture that needs several passes over rows and columns', () => {
    const picture = bools('#.###' + '#.#.#' + '###.#' + '..#.#' + '###.#');
    const clues = puzzleClues(picture, 5);
    const result = solveByLogic(clues, 5);
    expect(result.contradiction).toBe(false);
    expect(result.solved).toBe(true);
    expect(result.grid.map((v) => v === 1)).toEqual(picture);
  });

  it('reports an ambiguous picture as not solved (two pictures share these clues)', () => {
    const clues = { rows: [[1], [1]], cols: [[1], [1]] }; // a 2 x 2 with a diagonal: two answers
    const result = solveByLogic(clues, 2);
    expect(result.solved).toBe(false);
    expect(result.contradiction).toBe(false);
  });

  it('reports clues that cannot be met', () => {
    expect(solveByLogic({ rows: [[2], []], cols: [[1], []] }, 2).contradiction).toBe(true);
  });
});

describe('generating puzzles', () => {
  it.each(SIZES)('size %i: solvable by logic alone, the logic gives exactly the stated picture, and clues match it', (n) => {
    for (const seed of [1, 2, 3, 4]) {
      const puzzle = generate(createRng(seed), n);
      expect(puzzle.solution).toHaveLength(n * n);
      expect(puzzle.clues).toEqual(puzzleClues(puzzle.solution, n));
      const result = solveByLogic(puzzle.clues, n);
      expect(result.solved).toBe(true);
      expect(result.grid.map((v) => v === 1)).toEqual(puzzle.solution);
      const filled = puzzle.solution.filter(Boolean).length;
      expect(filled).toBeGreaterThan(n); // not a near-empty picture
      expect(filled).toBeLessThan(n * n);
    }
  });

  it('the same seed gives the same puzzle, and different seeds differ', () => {
    expect(generate(createRng(9), 10)).toEqual(generate(createRng(9), 10));
    expect(generate(createRng(9), 10).solution).not.toEqual(generate(createRng(10), 10).solution);
  });

  it('is quick even at 15 x 15', () => {
    const t0 = performance.now();
    for (let s = 1; s <= 3; s++) generate(createRng(s * 13), 15);
    expect(performance.now() - t0).toBeLessThan(8000);
  });
});

describe('checking the player\'s picture', () => {
  it('a line matches a clue by its runs, ignoring where the gaps are', () => {
    expect(lineMatches([2, 1], bools('##.#.'))).toBe(true);
    expect(lineMatches([2, 1], bools('.##.#'))).toBe(true);
    expect(lineMatches([2, 1], bools('###.#'))).toBe(false);
    expect(lineMatches([2, 1], bools('##...'))).toBe(false);
    expect(lineMatches([], bools('.....'))).toBe(true);
  });

  it('solved means every row and column matches; the right picture is solved, a wrong one is not', () => {
    const puzzle = generate(createRng(3), 5);
    expect(isSolved(puzzle.solution, puzzle.clues, 5)).toBe(true);
    const wrong = [...puzzle.solution];
    wrong[0] = !wrong[0];
    expect(isSolved(wrong, puzzle.clues, 5)).toBe(false);
    expect(isSolved(new Array(25).fill(false), puzzle.clues, 5)).toBe(false);
  });
});
