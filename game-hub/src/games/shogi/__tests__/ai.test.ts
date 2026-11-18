import { describe, expect, it } from 'vitest';
import { createRng } from '../../crater-lab/engine/rng';
import { LEVELS, chooseMove, evaluate, type Difficulty } from '../ai';
import { parseSfen, replay, usiOf, moveTo, type Move } from '../engine';

const LEVEL_NAMES: Difficulty[] = ['easy', 'normal', 'hard'];
const fast = { timeMs: 500, maxDepth: 3 };
const pick = (sfen: string, level: Difficulty, options = fast, seed = 1) => chooseMove([], level, createRng(seed), options, sfen);

describe('evaluation', () => {
  it('the start position is level, from either side', () => {
    expect(evaluate(parseSfen('lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1'))).toBe(0);
    expect(evaluate(parseSfen('lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1'))).toBe(0);
  });
  it('counts pieces in hand, and scores the side to move', () => {
    const up = evaluate(parseSfen('4k4/9/9/9/9/9/9/9/4K4 b R 1'));
    expect(up).toBeGreaterThan(1000);
    expect(evaluate(parseSfen('4k4/9/9/9/9/9/9/9/4K4 w R 1'))).toBe(-up);
  });
  it('values a promoted piece above the plain one', () => {
    expect(evaluate(parseSfen('4k4/9/9/9/4+R4/9/9/9/4K4 b - 1'))).toBeGreaterThan(evaluate(parseSfen('4k4/9/9/9/4R4/9/9/9/4K4 b - 1')));
  });
});

describe('tactics', () => {
  it.each([
    ['sente mates with a gold drop', '4k4/9/4L4/9/9/9/9/9/4K4 b G 1', 'G*5b'],
    ['gote mates with a gold drop', '4k4/9/9/9/9/9/4l4/9/4K4 w g 1', 'G*5h'],
  ])('finds mate in one (%s), at every level', (_name, sfen, usi) => {
    for (const level of LEVEL_NAMES) {
      const choice = pick(sfen, level);
      const r = replay([choice.move], sfen);
      expect(r.result.kind, `${level} played ${choice.usi}`).toBe('mate');
    }
    expect(pick(sfen, 'hard').usi).toBe(usi);
  });

  it('takes a rook that is hanging', () => {
    // the gote rook on 5e is undefended and the sente rook on 5h sees it along the file
    expect(pick('4k4/9/9/9/4r4/9/9/4R4/4K4 b - 1', 'normal').usi).toBe('5h5e');
  });

  it('does not leave a rook en prise when it can simply take the attacker', () => {
    // the gote pawn on 2d attacks the sente rook on 2e
    const sfen = '4k4/9/9/7p1/7R1/9/9/9/4K4 b - 1';
    for (let seed = 1; seed <= 12; seed++) {
      const choice = pick(sfen, 'hard', { timeMs: 100000, maxDepth: 2 }, seed);
      const p = replay([choice.move], sfen).pos;
      const takesRook = p.legalMoves().some((m) => Math.abs(p.board[moveTo(m)] as number) === 2);
      expect(takesRook, `${choice.usi} with seed ${seed}`).toBe(false);
    }
  });

  it('never plays a pawn drop that would be mate', () => {
    const sfen = '8k/9/7G1/4B4/9/9/9/9/4K4 b P 1';
    for (let seed = 1; seed <= 8; seed++) expect(pick(sfen, 'easy', fast, seed).usi).not.toBe('P*1b');
  });

  it('answers a check', () => {
    const sfen = '4r3k/9/9/9/9/9/9/9/4K4 b G 1';
    for (const level of LEVEL_NAMES) {
      const p = replay([pick(sfen, level).move], sfen).pos;
      expect(p.inCheck(0)).toBe(false);
    }
  });
});

describe('behaviour', () => {
  it('always returns a legal move, and is repeatable for the same seed', () => {
    const game: Move[] = [];
    for (let i = 0; i < 8; i++) {
      const c = chooseMove(game, 'normal', createRng(i + 1), { timeMs: 150, maxDepth: 2 });
      const p = replay(game).pos;
      expect(p.legalMoves().map(usiOf)).toContain(c.usi);
      game.push(c.move);
    }
    expect(chooseMove([], 'easy', createRng(9), { maxDepth: 1 })).toEqual(chooseMove([], 'easy', createRng(9), { maxDepth: 1 }));
  });

  it('keeps to its time budget', () => {
    const t0 = Date.now();
    chooseMove([], 'hard', createRng(1), { timeMs: 300, maxDepth: 9 });
    expect(Date.now() - t0).toBeLessThan(900);
  });

  it('looks deeper when given more time', () => {
    const quick = chooseMove([], 'hard', createRng(1), { timeMs: 40, maxDepth: 9 });
    const slow = chooseMove([], 'hard', createRng(1), { timeMs: 900, maxDepth: 9 });
    expect(slow.depth).toBeGreaterThanOrEqual(quick.depth);
    expect(slow.depth).toBeGreaterThanOrEqual(3);
  });

  it('refuses when there is no move (the game is over)', () => {
    expect(() => pick('4k4/4G4/4L4/9/9/9/9/9/4K4 w - 1', 'easy')).toThrow();
  });

  it('the levels are what the settings say', () => {
    expect(LEVELS.easy.maxDepth).toBeLessThan(LEVELS.normal.maxDepth);
    expect(LEVELS.normal.maxDepth).toBeLessThan(LEVELS.hard.maxDepth);
    expect(LEVELS.easy.variety).toBeGreaterThan(LEVELS.normal.variety);
  });
});

describe('strength', () => {
  /** Play two levels against each other until the game ends; returns sente's result: a big number for a win, else the material lead. */
  function outcome(sente: Difficulty, gote: Difficulty, seed: number): number {
    const moves: Move[] = [];
    const rng = createRng(seed);
    for (let ply = 0; ply < 200; ply++) {
      const r = replay(moves);
      if (r.result.kind !== 'ongoing') break;
      const level = r.pos.turn === 0 ? sente : gote;
      moves.push(chooseMove(moves, level, rng, { timeMs: 150, maxDepth: level === 'hard' ? 4 : 1 }).move);
    }
    const r = replay(moves);
    if (r.result.kind === 'mate' || r.result.kind === 'perpetual') return r.result.winner === 0 ? 1e6 : -1e6;
    return r.pos.turn === 0 ? evaluate(r.pos) : -evaluate(r.pos);
  }

  it('hard beats easy, from either side', () => {
    expect(outcome('hard', 'easy', 5)).toBeGreaterThan(0);
    expect(-outcome('easy', 'hard', 6)).toBeGreaterThan(0);
  }, 240_000);
});
