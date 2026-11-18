import { describe, expect, it } from 'vitest';
import { createRng } from '../../crater-lab/engine/rng';
import { COLORS, MAX_TURNS, PEGS, allCodes, guess, hintPeg, isConsistent, isValidCode, newGame, randomSecret, remainingCodes, score } from '../engine';

describe('scoring', () => {
  it.each([
    [[0, 1, 2, 3], [0, 1, 2, 3], 4, 0],
    [[0, 1, 2, 3], [3, 2, 1, 0], 0, 4],
    [[0, 1, 2, 3], [4, 4, 5, 5], 0, 0],
    [[0, 1, 2, 3], [0, 1, 3, 2], 2, 2],
    [[0, 0, 1, 1], [0, 1, 0, 1], 2, 2],
    // repeats: a secret peg can only be matched once
    [[0, 0, 0, 1], [0, 0, 0, 0], 3, 0],
    [[0, 1, 2, 3], [0, 0, 0, 0], 1, 0],
    [[0, 0, 1, 2], [1, 1, 0, 0], 0, 3],
    [[1, 1, 2, 2], [2, 2, 1, 1], 0, 4],
    [[1, 2, 3, 4], [1, 1, 1, 1], 1, 0],
    [[5, 5, 5, 5], [5, 5, 5, 0], 3, 0],
    [[0, 1, 1, 2], [1, 0, 2, 1], 0, 4],
  ])('secret %j, guess %j -> %i exact, %i misplaced', (secret, guessCode, exact, misplaced) => {
    expect(score(secret!, guessCode!)).toEqual({ exact, misplaced });
  });

  it('is symmetric in the totals: exact + misplaced is the colour overlap, whichever way round', () => {
    for (const a of allCodes().filter((_, i) => i % 37 === 0)) {
      for (const b of allCodes().filter((_, i) => i % 41 === 0)) {
        const f = score(a, b);
        const g = score(b, a);
        expect(f.exact).toBe(g.exact);
        expect(f.misplaced).toBe(g.misplaced);
        expect(f.exact + f.misplaced).toBeLessThanOrEqual(PEGS);
      }
    }
  });
});

describe('codes', () => {
  it('accepts only PEGS colours in range', () => {
    expect(isValidCode([0, 1, 2, 3])).toBe(true);
    expect(isValidCode([0, 1, 2])).toBe(false);
    expect(isValidCode([0, 1, 2, 3, 4])).toBe(false);
    expect(isValidCode([0, 1, 2, 6])).toBe(false);
    expect(isValidCode([0, 1, 2, -1])).toBe(false);
    expect(isValidCode([0, 1, 2, 1.5])).toBe(false);
    expect(() => newGame([0, 1, 2])).toThrow();
  });

  it('there are 6^4 = 1296 of them, all different', () => {
    const all = allCodes();
    expect(all).toHaveLength(COLORS ** PEGS);
    expect(new Set(all.map((c) => c.join(''))).size).toBe(1296);
    expect(all.every(isValidCode)).toBe(true);
  });

  it('a random secret is valid, repeatable from a seed, and covers every colour over many draws', () => {
    expect(randomSecret(createRng(5))).toEqual(randomSecret(createRng(5)));
    const rng = createRng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const code = randomSecret(rng);
      expect(isValidCode(code)).toBe(true);
      code.forEach((c) => seen.add(c));
    }
    expect(seen.size).toBe(COLORS);
  });

  it('without repeats every colour in a secret is different', () => {
    const rng = createRng(3);
    for (let i = 0; i < 200; i++) expect(new Set(randomSecret(rng, false)).size).toBe(PEGS);
  });
});

describe('a game', () => {
  it('is won by guessing the code, and records every turn', () => {
    let game = newGame([0, 1, 2, 3]);
    game = guess(game, [3, 2, 1, 0]);
    expect(game.status).toBe('playing');
    game = guess(game, [0, 1, 2, 3]);
    expect(game.status).toBe('won');
    expect(game.turns).toHaveLength(2);
    expect(game.turns[0]!.feedback).toEqual({ exact: 0, misplaced: 4 });
  });

  it('is lost after ten wrong guesses', () => {
    let game = newGame([0, 1, 2, 3]);
    for (let i = 0; i < MAX_TURNS - 1; i++) {
      game = guess(game, [5, 5, 5, 5]);
      expect(game.status).toBe('playing');
    }
    game = guess(game, [5, 5, 5, 5]);
    expect(game.status).toBe('lost');
    expect(game.turns).toHaveLength(MAX_TURNS);
  });

  it('winning on the last turn is a win, not a loss', () => {
    let game = newGame([4, 4, 4, 4]);
    for (let i = 0; i < MAX_TURNS - 1; i++) game = guess(game, [0, 0, 0, 0]);
    expect(guess(game, [4, 4, 4, 4]).status).toBe('won');
  });

  it('refuses a bad guess and a guess after the end, and never changes the game it was given', () => {
    const game = newGame([0, 1, 2, 3]);
    expect(() => guess(game, [0, 1, 2])).toThrow();
    const after = guess(game, [0, 0, 0, 0]);
    expect(game.turns).toHaveLength(0);
    expect(after.turns).toHaveLength(1);
    const won = guess(game, [0, 1, 2, 3]);
    expect(() => guess(won, [0, 0, 0, 0])).toThrow('over');
  });

  it('a guess is copied, so changing the array afterwards does not rewrite history', () => {
    const mine = [0, 0, 0, 0];
    const game = guess(newGame([0, 1, 2, 3]), mine);
    mine[0] = 5;
    expect(game.turns[0]!.guess).toEqual([0, 0, 0, 0]);
  });
});

describe('what is still possible', () => {
  it('the true secret is always consistent with its own feedback', () => {
    const rng = createRng(21);
    for (let i = 0; i < 30; i++) {
      let game = newGame(randomSecret(rng));
      for (let t = 0; t < 4 && game.status === 'playing'; t++) game = guess(game, randomSecret(rng));
      expect(isConsistent(game.secret, game.turns)).toBe(true);
    }
  });

  it('no turns means all 1296 are possible; one turn narrows it a lot', () => {
    expect(remainingCodes([])).toBe(1296);
    const game = guess(newGame([0, 1, 2, 3]), [0, 0, 1, 1]);
    const left = remainingCodes(game.turns);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(400);
  });

  it('a simple consistent-guess strategy always solves it within the ten turns', () => {
    const all = allCodes();
    const rng = createRng(77);
    let worst = 0;
    for (let i = 0; i < 40; i++) {
      let game = newGame(randomSecret(rng));
      while (game.status === 'playing') {
        const next = all.find((c) => isConsistent(c, game.turns))!;
        game = guess(game, next);
      }
      expect(game.status).toBe('won');
      worst = Math.max(worst, game.turns.length);
    }
    expect(worst).toBeLessThanOrEqual(8);
  });

  it('a hint gives a peg of the secret at a position that is not right yet', () => {
    let game = newGame([0, 1, 2, 3]);
    expect(hintPeg(game)).toEqual({ position: 0, color: 0 });
    game = guess(game, [0, 5, 5, 5]);
    expect(hintPeg(game)).toEqual({ position: 1, color: 1 });
    game = guess(game, [0, 1, 2, 3]);
    expect(hintPeg(game)).toBeNull();
  });
});
