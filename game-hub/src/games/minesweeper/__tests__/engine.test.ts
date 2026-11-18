import { describe, expect, it } from 'vitest';
import { createRng } from '../../crater-lab/engine/rng';
import { PRESETS, adjacent, chord, flagsPlaced, minesLeft, neighbours, newGame, reveal, toggleFlag, type State } from '../engine';

const rng = () => createRng(42);
const count = (a: Uint8Array) => a.reduce((x, y) => x + y, 0);

/** A board with mines exactly where given, already "playing", for testing rules in isolation. */
function board(w: number, h: number, mineAt: number[]): State {
  const s = newGame(w, h, Math.max(1, mineAt.length));
  const mines = new Uint8Array(w * h);
  for (const i of mineAt) mines[i] = 1;
  return { ...s, mines, status: 'playing' };
}

describe('the board', () => {
  it('a square has 3, 5 or 8 neighbours depending on where it is', () => {
    const s = { w: 5, h: 4 };
    expect(neighbours(s, 0)).toHaveLength(3); // a corner
    expect(neighbours(s, 2)).toHaveLength(5); // an edge
    expect(neighbours(s, 6)).toHaveLength(8); // inside
    expect(neighbours(s, 4)).toHaveLength(3);
    expect(neighbours(s, 19)).toHaveLength(3);
    expect(new Set(neighbours(s, 6)).size).toBe(8);
    expect(neighbours(s, 6)).not.toContain(6);
  });

  it('counts the mines around a square', () => {
    const s = board(4, 4, [0, 1, 5]);
    expect(adjacent(s, 4)).toBe(3);
    expect(adjacent(s, 2)).toBe(2);
    expect(adjacent(s, 15)).toBe(0);
  });

  it('presets are the classic three', () => {
    expect(PRESETS.map((p) => [p.w, p.h, p.mines])).toEqual([[9, 9, 10], [16, 16, 40], [30, 16, 99]]);
  });

  it('refuses silly boards', () => {
    expect(() => newGame(1, 5, 1)).toThrow();
    expect(() => newGame(9, 9, 0)).toThrow();
    expect(() => newGame(9, 9, 73)).toThrow(); // 81 - 9 is the most that leaves room for the first click
    expect(() => newGame(9, 9, 72)).not.toThrow();
    expect(() => newGame(9.5, 9, 10)).toThrow();
  });
});

describe('the first click', () => {
  it('places exactly the right number of mines and none on the square or its neighbours, whatever the seed', () => {
    for (const preset of PRESETS) {
      for (let seed = 1; seed <= 25; seed++) {
        const start = (seed * 37) % (preset.w * preset.h);
        const s = reveal(newGame(preset.w, preset.h, preset.mines), start, createRng(seed));
        expect(count(s.mines)).toBe(preset.mines);
        expect(s.mines[start]).toBe(0);
        for (const n of neighbours(s, start)) expect(s.mines[n]).toBe(0);
        expect(s.status === 'playing' || s.status === 'won').toBe(true);
        expect(s.revealed[start]).toBe(1);
      }
    }
  });

  it('opens an area, since the first square has no mine neighbours', () => {
    const s = reveal(newGame(9, 9, 10), 40, rng());
    expect(count(s.revealed)).toBeGreaterThan(9);
  });

  it('the same seed gives the same board', () => {
    const a = reveal(newGame(16, 16, 40), 100, createRng(9));
    const b = reveal(newGame(16, 16, 40), 100, createRng(9));
    expect(Array.from(a.mines)).toEqual(Array.from(b.mines));
  });

  it('a board is not changed by playing on it', () => {
    const start = newGame(9, 9, 10);
    reveal(start, 0, rng());
    expect(start.status).toBe('ready');
    expect(count(start.revealed)).toBe(0);
  });
});

describe('revealing', () => {
  it('a zero opens all connected squares and the numbered border, and stops there', () => {
    // 5 x 5, one mine in the far corner: opening square 0 reveals everything except the mine
    const s = board(5, 5, [24]);
    const next = reveal(s, 0, rng());
    expect(count(next.revealed)).toBe(24);
    expect(next.revealed[24]).toBe(0);
    expect(next.status).toBe('won'); // that was every safe square
  });

  it('stops at numbers: a wall of mines keeps the other side shut', () => {
    // a column of mines down the middle of a 5 x 3 board
    const s = board(5, 3, [2, 7, 12]);
    const next = reveal(s, 0, rng());
    expect(next.revealed[0]).toBe(1);
    expect(next.revealed[1]).toBe(1); // a number next to the wall
    expect(next.revealed[3]).toBe(0); // the far side stays closed
    expect(next.status).toBe('playing');
  });

  it('a number opens only itself', () => {
    const s = board(4, 4, [0, 1]);
    const next = reveal(s, 5, rng());
    expect(count(next.revealed)).toBe(1);
  });

  it('a flagged square is not opened, and flood-fill goes round flags', () => {
    const s = toggleFlag(board(4, 4, [15]), 5);
    expect(reveal(s, 5, rng())).toBe(s);
    const opened = reveal(s, 0, rng());
    expect(opened.revealed[5]).toBe(0);
  });

  it('opening a mine loses, and shows every mine', () => {
    const s = board(4, 4, [3, 12]);
    const lost = reveal(s, 3, rng());
    expect(lost.status).toBe('lost');
    expect(lost.exploded).toBe(3);
    expect(lost.revealed[12]).toBe(1);
  });

  it('nothing can be done after the game ends', () => {
    const lost = reveal(board(4, 4, [3]), 3, rng());
    expect(reveal(lost, 0, rng())).toBe(lost);
    expect(toggleFlag(lost, 0)).toBe(lost);
    expect(chord(lost, 0, rng())).toBe(lost);
  });

  it('refuses a square that is off the board', () => {
    expect(() => reveal(newGame(4, 4, 2), 16, rng())).toThrow();
    expect(() => reveal(newGame(4, 4, 2), -1, rng())).toThrow();
  });

  it('winning flags every mine', () => {
    const won = reveal(board(5, 5, [24]), 0, rng());
    expect(won.status).toBe('won');
    expect(won.flags[24]).toBe(1);
    expect(minesLeft(won)).toBe(0);
  });
});

describe('flags', () => {
  it('toggle on and off, count, and cannot sit on an opened square', () => {
    let s = newGame(5, 5, 3);
    s = toggleFlag(s, 3);
    expect(flagsPlaced(s)).toBe(1);
    expect(minesLeft(s)).toBe(2);
    s = toggleFlag(s, 3);
    expect(flagsPlaced(s)).toBe(0);
    const opened = reveal(board(4, 4, [15]), 0, rng());
    expect(toggleFlag(opened, 0)).toBe(opened);
  });

  it('the mines-left counter can go negative if too many flags are placed', () => {
    let s = newGame(5, 5, 1);
    s = toggleFlag(toggleFlag(s, 0), 1);
    expect(minesLeft(s)).toBe(-1);
  });
});

describe('chording', () => {
  it('opens the neighbours of a number when the flags match it', () => {
    // mines at 0 and 2 in a 3-wide board; square 1 (between them) shows 2... use a 4x4: the number 5 has mines 0 and 2 around it
    let s = board(4, 4, [0, 2, 15]);
    s = reveal(s, 5, rng()); // opens the number (mines 0 and 2 are neighbours: 2)
    expect(adjacent(s, 5)).toBe(2);
    s = toggleFlag(toggleFlag(s, 0), 2);
    const chorded = chord(s, 5, rng());
    expect(chorded.revealed[1]).toBe(1);
    expect(chorded.revealed[4]).toBe(1);
    expect(chorded.revealed[6]).toBe(1);
    expect(chorded.status).toBe('playing');
  });

  it('does nothing when the flag count is wrong, or on a hidden square, or on a zero', () => {
    let s = reveal(board(4, 4, [0, 2, 15]), 5, rng());
    expect(chord(s, 5, rng())).toBe(s); // no flags yet
    s = toggleFlag(s, 0);
    expect(chord(s, 5, rng())).toBe(s); // one of two
    expect(chord(s, 9, rng())).toBe(s); // 9 is hidden
  });

  it('with a WRONG flag it opens a mine and loses, as clicking would', () => {
    let s = reveal(board(4, 4, [0, 2, 15]), 5, rng());
    s = toggleFlag(toggleFlag(s, 1), 2); // flag the safe square 1 instead of the mine at 0
    const lost = chord(s, 5, rng());
    expect(lost.status).toBe('lost');
    expect(lost.exploded).toBe(0);
  });
});

describe('whole games', () => {
  it('a solver that only uses the safe first click and flood fill can never lose on the first move, over many boards', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const preset = PRESETS[seed % 3]!;
      const s = reveal(newGame(preset.w, preset.h, preset.mines), (seed * 53) % (preset.w * preset.h), createRng(seed));
      expect(s.status).not.toBe('lost');
    }
  });
});
