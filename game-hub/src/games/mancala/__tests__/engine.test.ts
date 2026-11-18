import { describe, expect, it } from 'vitest';
import { createRng } from '../../crater-lab/engine/rng';
import { chooseMove, type Difficulty } from '../ai';
import { STORE, TOTAL_STONES, legalMoves, move, newGame, opposite, pitOf, score, winner, type State } from '../engine';

/** A state from a list of 14 pit counts, with player 0 (or 1) to move. */
const make = (pits: number[], current: 0 | 1 = 0): State => ({ pits, current, over: false });
const total = (s: State) => s.pits.reduce((a, b) => a + b, 0);

describe('the start', () => {
  it('has four stones in each of the twelve pits, empty stores, and player 0 to move', () => {
    const s = newGame();
    expect(s.pits).toEqual([4, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
    expect(total(s)).toBe(TOTAL_STONES);
    expect(s.current).toBe(0);
    expect(legalMoves(s)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('opposite pits pair up: 0 with 12, 5 with 7', () => {
    expect(opposite(0)).toBe(12);
    expect(opposite(5)).toBe(7);
    expect(opposite(opposite(3))).toBe(3);
    expect(pitOf(1, 0)).toBe(7);
  });
});

describe('sowing', () => {
  it('drops one stone in each following pit, counter-clockwise', () => {
    const r = move(newGame(), 0);
    expect(r.state.pits.slice(0, 6)).toEqual([0, 5, 5, 5, 5, 4]);
    expect(r.path).toEqual([1, 2, 3, 4]);
    expect(r.extraTurn).toBe(false);
    expect(r.state.current).toBe(1);
  });

  it('goes through the own store, and on round to the opponent side', () => {
    const r = move(newGame(), 5); // 4 stones from pit 5: store, then pits 7, 8, 9
    expect(r.path).toEqual([6, 7, 8, 9]);
    expect(r.state.pits[6]).toBe(1);
    expect(r.state.pits.slice(7, 10)).toEqual([5, 5, 5]);
  });

  it('skips the opponent\'s store: player 0 sowing a lot passes 13 without dropping in it', () => {
    const s = make([0, 0, 0, 0, 0, 12, 0, 1, 1, 1, 1, 1, 1, 0]);
    const r = move(s, 5); // 12 stones: 6,7,8,9,10,11,12,(skip 13),0,1,2,3,4
    expect(r.path).toEqual([6, 7, 8, 9, 10, 11, 12, 0, 1, 2, 3, 4]);
    expect(r.state.pits[13]).toBe(0);
  });

  it('player 1 skips player 0\'s store', () => {
    const s = make([1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 12, 0], 1);
    const r = move(s, 5); // pit 12: 13,0,1,2,3,4,5,(skip 6),7,8,9,10,11
    expect(r.path).toEqual([13, 0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11]);
    expect(r.state.pits[6]).toBe(0);
  });

  it('a lap of 13 stones comes back to the starting pit, which was emptied, so it captures like any empty pit', () => {
    const s = make([0, 0, 0, 0, 0, 13, 0, 1, 1, 1, 1, 1, 1, 0]);
    const r = move(s, 5);
    expect(r.path).toHaveLength(13);
    expect(r.path[12]).toBe(5);
    expect(r.captured).toBe(3); // the 2 stones now in the opposite pit 7, plus the capturing stone
    expect(r.state.pits[5]).toBe(0);
    expect(total(r.state)).toBe(total(s));
  });
});

describe('extra turns and captures', () => {
  it('the last stone in your own store gives another turn', () => {
    const r = move(newGame(), 2); // 4 stones from pit 2: 3, 4, 5, store
    expect(r.state.pits[6]).toBe(1);
    expect(r.extraTurn).toBe(true);
    expect(r.state.current).toBe(0);
  });

  it('the last stone in an empty pit of your own captures the stones opposite, plus itself', () => {
    const s = make([1, 0, 0, 0, 0, 2, 0, 3, 3, 3, 3, 5, 3, 0]);
    const r = move(s, 0); // one stone into the empty pit 1; opposite is pit 11 (5 stones)
    expect(r.captured).toBe(6);
    expect(r.state.pits[6]).toBe(6);
    expect(r.state.pits[1]).toBe(0);
    expect(r.state.pits[11]).toBe(0);
    expect(r.state.current).toBe(1);
    expect(total(r.state)).toBe(total(s));
  });

  it('no capture when the opposite pit is empty, or when the pit was not empty, or on the opponent\'s side', () => {
    const emptyOpposite = move(make([1, 0, 0, 0, 0, 2, 0, 3, 3, 3, 3, 0, 3, 0]), 0);
    expect(emptyOpposite.captured).toBe(0);
    expect(emptyOpposite.state.pits[1]).toBe(1);

    const notEmpty = move(make([1, 2, 0, 0, 0, 2, 0, 3, 3, 3, 3, 5, 3, 0]), 0);
    expect(notEmpty.captured).toBe(0);

    const theirSide = move(make([0, 0, 0, 0, 0, 3, 0, 0, 0, 1, 3, 4, 3, 0]), 5); // ends on 8: opponent's empty pit
    expect(theirSide.captured).toBe(0);
  });

  it('a capture by player 1 goes to player 1\'s store', () => {
    const s = make([3, 3, 3, 3, 4, 0, 0, 1, 0, 0, 0, 0, 2, 0], 1);
    const r = move(s, 0); // pit 7 -> pit 8 (empty); opposite of 8 is 4 (4 stones)
    expect(r.captured).toBe(5);
    expect(r.state.pits[13]).toBe(5);
  });
});

describe('the end of the game', () => {
  it('when a side runs out, the other player keeps their remaining stones, and the game ends', () => {
    const s = make([0, 0, 0, 0, 0, 1, 10, 0, 0, 0, 0, 3, 4, 7]);
    const r = move(s, 5); // the last stone goes into the store: side is empty
    expect(r.state.over).toBe(true);
    expect(r.state.pits.slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(r.state.pits.slice(7, 13)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(r.state.pits[6]).toBe(11);
    expect(r.state.pits[13]).toBe(14);
    expect(r.swept).toBe(7);
    expect(r.extraTurn).toBe(false);
    expect(winner(r.state)).toBe(1);
    expect(legalMoves(r.state)).toEqual([]);
    expect(() => move(r.state, 0)).toThrow('over');
  });

  it('a tie is a draw; no winner until it is over', () => {
    expect(winner(newGame())).toBeNull();
    expect(winner({ pits: [0, 0, 0, 0, 0, 0, 24, 0, 0, 0, 0, 0, 0, 24], current: 0, over: true })).toBe('draw');
  });

  it('refuses an empty pit, a pit that does not exist, and a move on a state it was not given', () => {
    const s = make([0, 4, 4, 4, 4, 4, 0, 4, 4, 4, 4, 4, 4, 0]);
    expect(() => move(s, 0)).toThrow('empty');
    expect(() => move(s, 6)).toThrow();
    expect(() => move(s, -1)).toThrow();
    expect(() => move(s, 1.5)).toThrow();
    move(s, 1);
    expect(s.pits[1]).toBe(4); // never mutated
  });
});

describe('whole games', () => {
  it('48 stones are always on the board, and every game ends with the stores holding all of them', () => {
    const rng = createRng(3);
    for (let g = 0; g < 60; g++) {
      let s = newGame();
      let guard = 0;
      while (!s.over && guard++ < 500) {
        const moves = legalMoves(s);
        s = move(s, moves[Math.floor((rng.state = (rng.state * 1664525 + 1013904223) >>> 0) / 4294967296 * moves.length)] as number).state;
        expect(total(s)).toBe(TOTAL_STONES);
      }
      expect(s.over).toBe(true);
      expect(score(s, 0) + score(s, 1)).toBe(TOTAL_STONES);
      expect(STORE[0] + STORE[1]).toBe(19);
    }
  });
});

describe('the computer', () => {
  it('takes an extra turn when one is on offer (normal and hard)', () => {
    const s = make([0, 0, 0, 0, 2, 1, 0, 4, 4, 4, 4, 4, 4, 0]); // pit 5 has 1 stone: straight into the store
    for (const level of ['normal', 'hard'] as Difficulty[]) expect(chooseMove(s, level, createRng(1))).toBe(5);
  });

  it('takes a big capture rather than a small move', () => {
    const s = make([1, 0, 3, 2, 3, 3, 0, 0, 0, 0, 0, 9, 0, 0]); // pit 0 -> empty pit 1, opposite pit 11 holds 9; no other pit reaches the store
    expect(chooseMove(s, 'normal', createRng(1))).toBe(0);
    expect(chooseMove(s, 'hard', createRng(1))).toBe(0);
  });

  it('only ever picks a legal move, for either player, at every level', () => {
    const rng = createRng(8);
    for (const level of ['easy', 'normal', 'hard'] as Difficulty[]) {
      let s = newGame();
      for (let i = 0; i < 12 && !s.over; i++) {
        const choice = chooseMove(s, level, rng);
        expect(legalMoves(s)).toContain(choice);
        s = move(s, choice).state;
      }
    }
  });

  it('refuses when there is nothing to play', () => {
    expect(() => chooseMove({ ...newGame(), over: true }, 'normal', createRng(1))).toThrow();
  });

  it('hard beats a random player, and normal beats easy more often than not, from either side', () => {
    const play = (a: Difficulty, b: Difficulty, seed: number, aSide: 0 | 1) => {
      const rng = createRng(seed);
      let s = newGame();
      while (!s.over) s = move(s, chooseMove(s, s.current === aSide ? a : b, rng)).state;
      const w = winner(s);
      return w === 'draw' ? 0 : w === aSide ? 1 : -1;
    };
    let hardVsEasy = 0;
    for (let g = 0; g < 8; g++) hardVsEasy += play('hard', 'easy', 40 + g, g % 2 === 0 ? 0 : 1);
    expect(hardVsEasy).toBeGreaterThanOrEqual(6);
    let normalVsEasy = 0;
    for (let g = 0; g < 8; g++) normalVsEasy += play('normal', 'easy', 80 + g, g % 2 === 0 ? 0 : 1);
    expect(normalVsEasy).toBeGreaterThanOrEqual(4);
  }, 120_000);
});
