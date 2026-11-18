import { describe, expect, it } from 'vitest';
import { createRng } from '../../crater-lab/engine/rng';
import { CAPACITY, canPour, colorsForLevel, generateLevel, isDone, isStuck, isWon, legalMoves, pour, solve, topRun, withExtraTube, type Tube } from '../engine';

const total = (tubes: readonly Tube[]) => tubes.reduce((n, t) => n + t.length, 0);

describe('pouring', () => {
  it('moves the top colour onto the same colour or into an empty tube', () => {
    const tubes = [[0, 1], [1, 2], [], [3, 3, 3, 3]];
    expect(canPour(tubes, 0, 1)).toBe(false); // top 1 onto top 2
    expect(canPour(tubes, 1, 0)).toBe(false); // top 2 onto top 1
    expect(canPour(tubes, 0, 2)).toBe(true); // into the empty tube
    const r = pour(tubes, 0, 2);
    expect(r.tubes).toEqual([[0], [1, 2], [1], [3, 3, 3, 3]]);
    expect(r.moved).toBe(1);
  });

  it('moves a whole run of the top colour at once', () => {
    const r = pour([[0, 1, 1, 1], [1], []], 0, 1);
    expect(r.tubes).toEqual([[0], [1, 1, 1, 1], []]);
    expect(r.moved).toBe(3);
  });

  it('moves only as much as fits', () => {
    const r = pour([[0, 1, 1, 1], [1, 1, 1]], 0, 1);
    expect(r.moved).toBe(1);
    expect(r.tubes).toEqual([[0, 1, 1], [1, 1, 1, 1]]);
  });

  it('refuses a pour into a full tube, from an empty tube, onto a different colour, or into itself', () => {
    const tubes = [[1, 1, 1, 1], [1], [], [2]];
    expect(canPour(tubes, 1, 0)).toBe(false); // full
    expect(canPour(tubes, 2, 1)).toBe(false); // from empty
    expect(canPour(tubes, 3, 1)).toBe(false); // different colour
    expect(canPour(tubes, 1, 1)).toBe(false);
    expect(canPour(tubes, 9, 1)).toBe(false);
    expect(() => pour(tubes, 1, 0)).toThrow();
  });

  it('does not offer pointless pours of a single-colour tube into an empty one', () => {
    expect(canPour([[2, 2], []], 0, 1)).toBe(false);
    expect(canPour([[3, 2, 2], []], 0, 1)).toBe(true); // it would split the stack: allowed
  });

  it('never changes the tubes it was given, and conserves the layers', () => {
    const tubes: Tube[] = [[0, 1, 1], [1], []];
    const before = JSON.stringify(tubes);
    const { tubes: after } = pour(tubes, 0, 1);
    expect(JSON.stringify(tubes)).toBe(before);
    expect(total(after)).toBe(total(tubes));
  });

  it('measures the top run', () => {
    expect(topRun([])).toBe(0);
    expect(topRun([1, 2, 2, 2])).toBe(3);
    expect(topRun([2, 1, 2])).toBe(1);
  });
});

describe('winning and being stuck', () => {
  it('a tube is done when empty or full of one colour; a win needs every tube done', () => {
    expect(isDone([])).toBe(true);
    expect(isDone([1, 1, 1, 1])).toBe(true);
    expect(isDone([1, 1, 1])).toBe(false);
    expect(isDone([1, 1, 1, 2])).toBe(false);
    expect(isWon([[0, 0, 0, 0], [1, 1, 1, 1], []])).toBe(true);
    expect(isWon([[0, 0, 0], [0, 1, 1, 1, 1].slice(1), []])).toBe(false);
  });

  it('stuck means not won and no pour available', () => {
    const stuck = [[0, 1, 0, 1], [1, 0, 1, 0]];
    expect(legalMoves(stuck)).toEqual([]);
    expect(isStuck(stuck)).toBe(true);
    expect(isStuck([[0, 0, 0, 0]])).toBe(false);
    expect(isStuck(withExtraTube(stuck))).toBe(false);
  });
});

describe('the solver', () => {
  it('solves a small position, and the moves it gives really win', () => {
    const tubes: Tube[] = [[0, 1, 0, 1], [1, 0, 1, 0], [], []];
    const moves = solve(tubes)!;
    expect(moves.length).toBeGreaterThan(0);
    let state: readonly Tube[] = tubes;
    for (const m of moves) state = pour(state, m.from, m.to).tubes;
    expect(isWon(state)).toBe(true);
  });

  it('returns an empty plan when already won, and null for an impossible position', () => {
    expect(solve([[0, 0, 0, 0], []])).toEqual([]);
    expect(solve([[0, 1, 0, 1], [1, 0, 1, 0]])).toBeNull();
  });

  it('gives up rather than running forever', () => {
    const t0 = performance.now();
    solve(generateLevel(createRng(3), 6).tubes, 50); // a tiny budget: probably null, but it must return quickly
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

describe('levels', () => {
  it('use more colours as the level goes up, to a limit', () => {
    expect([1, 2, 3, 4, 5, 20, 99].map(colorsForLevel)).toEqual([3, 3, 4, 4, 5, 12, 12]);
  });

  it.each([1, 3, 6, 10])('level %i: the right tubes and layers, not already won, and its stated solution wins', (level) => {
    const colors = colorsForLevel(level);
    const { tubes, solution } = generateLevel(createRng(level * 7), colors);
    expect(tubes).toHaveLength(colors + 2);
    expect(tubes.filter((t) => t.length === 0)).toHaveLength(2);
    expect(total(tubes)).toBe(colors * CAPACITY);
    for (let c = 0; c < colors; c++) expect(tubes.flat().filter((x) => x === c)).toHaveLength(CAPACITY);
    expect(isWon(tubes)).toBe(false);
    let state: readonly Tube[] = tubes;
    for (const m of solution) state = pour(state, m.from, m.to).tubes;
    expect(isWon(state)).toBe(true);
  });

  it('the same seed gives the same level; another seed gives another', () => {
    expect(generateLevel(createRng(5), 5)).toEqual(generateLevel(createRng(5), 5));
    expect(generateLevel(createRng(5), 5).tubes).not.toEqual(generateLevel(createRng(6), 5).tubes);
  });

  it('the extra tube is one more empty tube and changes nothing else', () => {
    const tubes: Tube[] = [[0, 1], [1]];
    const more = withExtraTube(tubes);
    expect(more).toEqual([[0, 1], [1], []]);
    expect(tubes).toHaveLength(2);
  });
});
