import { describe, expect, it } from 'vitest';
import { createRng } from '../../crater-lab/engine/rng';
import { chooseShot, density, type Difficulty } from '../ai';
import { CELLS, FLEET, FLEET_SQUARES, SIZE, allSunk, fits, isSunk, isValidFleet, newBoard, randomFleet, shipAt, shipCells, shoot, shotsFired, sunkShips, type Board, type Ship } from '../engine';

/** A fixed fleet: carrier on row 0, battleship on row 2, cruiser on row 4, submarine on row 6, destroyer on row 8 (all from column 0). */
const FIXED: Ship[] = FLEET.map((t, k) => ({ id: t.id, size: t.size, cells: shipCells(t.size, k * 2, 0, true)! }));

describe('placing ships', () => {
  it('a ship covers consecutive squares to the right or downwards, and may not leave the grid', () => {
    expect(shipCells(3, 0, 0, true)).toEqual([0, 1, 2]);
    expect(shipCells(3, 0, 0, false)).toEqual([0, 10, 20]);
    expect(shipCells(5, 4, 6, true)).toBeNull(); // would run off the right edge
    expect(shipCells(5, 6, 4, false)).toBeNull();
    expect(shipCells(5, 4, 5, true)).toEqual([45, 46, 47, 48, 49]);
    expect(shipCells(2, -1, 0, true)).toBeNull();
    expect(shipCells(2, 0, 10, true)).toBeNull();
  });

  it('ships may touch but not overlap', () => {
    const fleet: Ship[] = [{ id: 'cruiser', size: 3, cells: [0, 1, 2] }];
    expect(fits(fleet, [10, 11, 12])).toBe(true); // alongside
    expect(fits(fleet, [3, 4])).toBe(true); // end to end
    expect(fits(fleet, [2, 12])).toBe(false);
  });

  it('the fleet is five ships covering 17 squares', () => {
    expect(FLEET).toHaveLength(5);
    expect(FLEET_SQUARES).toBe(17);
  });

  it('a random fleet is always valid, covers 17 distinct squares, and is the same for the same seed', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const fleet = randomFleet(createRng(seed));
      expect(isValidFleet(fleet)).toBe(true);
      expect(new Set(fleet.flatMap((s) => s.cells)).size).toBe(17);
    }
    expect(randomFleet(createRng(5))).toEqual(randomFleet(createRng(5)));
    expect(randomFleet(createRng(5))).not.toEqual(randomFleet(createRng(6)));
  });

  it('refuses fleets that are wrong: missing a ship, overlapping, bent, or off the grid', () => {
    expect(isValidFleet(FIXED)).toBe(true);
    expect(isValidFleet(FIXED.slice(1))).toBe(false);
    expect(isValidFleet(FIXED.map((s, i) => (i === 1 ? { ...s, cells: FIXED[0]!.cells.slice(0, 4) } : s)))).toBe(false); // overlap
    expect(isValidFleet(FIXED.map((s, i) => (i === 0 ? { ...s, cells: [0, 1, 2, 12, 13] } : s)))).toBe(false); // bent
    expect(isValidFleet(FIXED.map((s, i) => (i === 0 ? { ...s, cells: [8, 9, 10, 11, 12] } : s)))).toBe(false); // wraps a row end
    expect(isValidFleet(FIXED.map((s, i) => (i === 0 ? { ...s, cells: [96, 97, 98, 99, 100] } : s)))).toBe(false);
    expect(() => newBoard(FIXED.slice(1))).toThrow();
  });
});

describe('shooting', () => {
  const board = (): Board => newBoard(FIXED);

  it('a shot at water is a miss; a shot at a ship is a hit', () => {
    const miss = shoot(board(), 11); // row 1 is empty water
    expect(miss.hit).toBe(false);
    expect(miss.board.shots[11]).toBe(1);
    const hit = shoot(board(), 0);
    expect(hit.hit).toBe(true);
    expect(hit.board.shots[0]).toBe(2);
    expect(hit.sunk).toBeNull();
    expect(hit.won).toBe(false);
  });

  it('a ship is sunk by the shot that hits its last square, and the result names it', () => {
    let b = board();
    const destroyer = FIXED[4]!;
    const first = shoot(b, destroyer.cells[0]!);
    expect(first.sunk).toBeNull();
    const second = shoot(first.board, destroyer.cells[1]!);
    expect(second.sunk?.id).toBe('destroyer');
    expect(isSunk(second.board, destroyer)).toBe(true);
    expect(sunkShips(second.board)).toHaveLength(1);
    b = second.board;
    expect(shipAt(b, destroyer.cells[0]!)?.id).toBe('destroyer');
    expect(shipAt(b, 11)).toBeUndefined();
  });

  it('sinking every ship wins, and only then', () => {
    let b = board();
    let last = shoot(b, 0);
    b = last.board;
    for (const cell of FIXED.flatMap((s) => s.cells).slice(1)) {
      last = shoot(b, cell);
      b = last.board;
      expect(last.won).toBe(cell === FIXED.flatMap((s) => s.cells).at(-1));
    }
    expect(allSunk(b)).toBe(true);
    expect(shotsFired(b)).toBe(17);
  });

  it('refuses a square fired at twice, or one that is not on the grid, and never changes the board it was given', () => {
    const b = board();
    const once = shoot(b, 5).board;
    expect(() => shoot(once, 5)).toThrow('already');
    expect(() => shoot(b, 100)).toThrow();
    expect(() => shoot(b, -1)).toThrow();
    expect(() => shoot(b, 2.5)).toThrow();
    expect(b.shots[5]).toBe(0);
    expect(shotsFired(b)).toBe(0);
  });
});

describe('the computer', () => {
  /** Play a whole game against a hidden fleet; returns how many shots it took. */
  function shotsToWin(level: Difficulty, seed: number): number {
    const rng = createRng(seed);
    let board = newBoard(randomFleet(createRng(seed * 7919)));
    const fired = new Set<number>();
    for (let guard = 0; guard < CELLS + 5; guard++) {
      const shot = chooseShot({ shots: board.shots, sunk: sunkShips(board) }, level, rng);
      expect(shot).toBeGreaterThanOrEqual(0);
      expect(shot).toBeLessThan(CELLS);
      expect(fired.has(shot)).toBe(false); // never fires at the same square twice
      fired.add(shot);
      const result = shoot(board, shot);
      board = result.board;
      if (result.won) return fired.size;
    }
    throw new Error('the game did not end');
  }

  it.each(['easy', 'normal', 'hard'] as Difficulty[])('%s: always finishes, within the 100 squares of the grid', (level) => {
    for (let seed = 1; seed <= 12; seed++) expect(shotsToWin(level, seed)).toBeLessThanOrEqual(100);
  });

  it('smarter levels need fewer shots, on average over many fleets', () => {
    const average = (level: Difficulty) => {
      let total = 0;
      const n = 40;
      for (let seed = 1; seed <= n; seed++) total += shotsToWin(level, seed);
      return total / n;
    };
    const easy = average('easy');
    const normal = average('normal');
    const hard = average('hard');
    expect(easy).toBeGreaterThan(80); // random fire takes most of the grid
    expect(normal).toBeLessThan(easy - 15);
    expect(hard).toBeLessThan(normal);
    expect(hard).toBeLessThan(58);
  });

  it('after a hit it fires next to it (normal and hard)', () => {
    const shots = new Uint8Array(CELLS);
    shots[44] = 2; // a lone hit in the middle
    for (const level of ['normal', 'hard'] as Difficulty[]) {
      for (let seed = 1; seed <= 12; seed++) {
        const next = chooseShot({ shots, sunk: [] }, level, createRng(seed));
        expect([34, 54, 43, 45]).toContain(next);
      }
    }
  });

  it('two hits in a row make it carry on along the line', () => {
    const shots = new Uint8Array(CELLS);
    shots[44] = 2;
    shots[45] = 2;
    for (const level of ['normal', 'hard'] as Difficulty[]) {
      for (let seed = 1; seed <= 12; seed++) expect([43, 46]).toContain(chooseShot({ shots, sunk: [] }, level, createRng(seed)));
    }
  });

  it('does not keep chasing a ship that has been sunk', () => {
    const shots = new Uint8Array(CELLS);
    const sunk: Ship = { id: 'destroyer', size: 2, cells: [44, 45] };
    shots[44] = 2;
    shots[45] = 2;
    for (const level of ['normal', 'hard'] as Difficulty[]) {
      const next = chooseShot({ shots, sunk: [sunk] }, level, createRng(3));
      expect([34, 54, 43, 46, 35, 55]).not.toContain(next); // it goes back to hunting elsewhere
    }
  });

  it('the probability map never favours a square already shot, or one only reachable through a miss', () => {
    const shots = new Uint8Array(CELLS);
    shots[44] = 1;
    const map = density({ shots, sunk: [] });
    expect(map[44]).toBe(0);
    expect(Math.max(...map)).toBeGreaterThan(0);
    // a corner is covered by fewer placements than the middle
    expect(map[0]).toBeLessThan(map[55] as number);
  });

  it('refuses when no square is left', () => {
    expect(() => chooseShot({ shots: new Uint8Array(CELLS).fill(1), sunk: [] }, 'easy', createRng(1))).toThrow();
  });
});

describe('geometry helpers', () => {
  it('SIZE and CELLS', () => {
    expect(SIZE * SIZE).toBe(CELLS);
  });
});
