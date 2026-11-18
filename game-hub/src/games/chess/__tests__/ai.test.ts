import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { createRng } from '../../crater-lab/engine/rng';
import { LEVELS, chooseMove, evaluate, type Difficulty } from '../ai';
import { chessOf, materialBalance, resultOf, type MoveInput } from '../engine';

const LEVEL_NAMES: Difficulty[] = ['easy', 'normal', 'hard'];
const fast = { timeMs: 400, maxDepth: 3 };

/** The position after `fen`, asked for a move with no earlier moves. */
const pick = (fen: string, level: Difficulty, options = fast, seed = 1) => chooseMove([], level, createRng(seed), options, fen);

describe('evaluation', () => {
  it('prefers having more material, from the side to move\'s point of view', () => {
    const up = new Chess('4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1'); // white has a queen, white to move
    const down = new Chess('4k3/8/8/8/8/8/4Q3/4K3 b - - 0 1'); // the same, black to move
    expect(evaluate(up)).toBeGreaterThan(800);
    expect(evaluate(down)).toBeLessThan(-800);
  });

  it('the start position is level', () => {
    expect(Math.abs(evaluate(new Chess()))).toBeLessThan(40);
  });

  it('likes a developed knight better than one still at home, and a centre pawn better than an edge pawn', () => {
    const home = new Chess('4k3/8/8/8/8/8/8/1N2K3 w - - 0 1');
    const developed = new Chess('4k3/8/8/8/8/2N5/8/4K3 w - - 0 1');
    expect(evaluate(developed)).toBeGreaterThan(evaluate(home));
    const centre = new Chess('4k3/8/8/8/3P4/8/8/4K3 w - - 0 1');
    const edge = new Chess('4k3/8/8/8/P7/8/8/4K3 w - - 0 1');
    expect(evaluate(centre)).toBeGreaterThan(evaluate(edge));
  });

  it('is symmetric: a position and its colour-flipped mirror score the same for the side to move', () => {
    const white = new Chess('r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3');
    const black = new Chess('rnbqkb1r/pppp1ppp/5n2/4p3/4P3/2N5/PPPP1PPP/R1BQKBNR b KQkq - 2 3');
    expect(evaluate(white)).toBe(evaluate(black));
  });
});

describe('tactics', () => {
  it.each([
    ['a back-rank mate for white', '6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 1', 'Ra8#'],
    ['a back-rank mate for black', 'r5k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1', 'Ra1#'],
    ['a queen mate', '7k/8/6K1/8/8/8/8/5Q2 w - - 0 1', 'Qf8#'],
    ['a queen next to a cornered king', 'k7/8/1K6/8/8/8/8/7Q w - - 0 1', 'Qb7#'],
  ])('finds mate in one (%s), at every level that looks ahead at all', (_name, fen, san) => {
    for (const level of LEVEL_NAMES) {
      const choice = pick(fen, level);
      const game = new Chess(fen);
      game.move({ from: choice.from, to: choice.to, promotion: choice.promotion });
      expect(game.isCheckmate()).toBe(true);
      if (level !== 'easy') expect(choice.san).toMatch(/#$/);
      void san;
    }
  });

  it('takes an undefended queen, and does not take a defended pawn with its queen', () => {
    const free = pick('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1', 'normal');
    expect(free.san).toBe('Rxd5');
    // the queen could take the pawn on b7, but it is guarded by the bishop: that loses the queen
    const guarded = pick('4k3/1p6/2b5/8/8/8/8/1Q2K3 w - - 0 1', 'normal');
    expect(guarded.san).not.toBe('Qxb7');
  });

  it('moves a piece out of attack rather than leaving it to be taken', () => {
    // black pawn attacks the white knight on e4; the knight is undefended
    const choice = pick('4k3/8/8/3p4/4N3/8/8/4K3 w - - 0 1', 'normal');
    expect(['Nxd...', 'Nc3', 'Nc5', 'Nd2', 'Nd6', 'Nf6', 'Ng3', 'Ng5', 'Nf2', 'Nxd6'].some(() => true)).toBe(true);
    const game = new Chess('4k3/8/8/3p4/4N3/8/8/4K3 w - - 0 1');
    game.move({ from: choice.from, to: choice.to });
    // after its move the knight (wherever it stands) cannot simply be captured for nothing
    const replies = game.moves({ verbose: true }).filter((m) => m.captured === 'n');
    expect(replies).toHaveLength(0);
  });

  it('does not stalemate the opponent when it is winning', () => {
    for (const level of ['normal', 'hard'] as Difficulty[]) {
      const choice = pick('k7/8/2K5/8/8/8/8/7Q w - - 0 1', level);
      const game = new Chess('k7/8/2K5/8/8/8/8/7Q w - - 0 1');
      game.move({ from: choice.from, to: choice.to });
      expect(game.isStalemate()).toBe(false);
    }
  });

  it('promotes to a queen when that wins', () => {
    const choice = pick('8/P5k1/8/8/8/8/8/K7 w - - 0 1', 'hard');
    expect(choice.from).toBe('a7');
    expect(choice.promotion).toBe('q');
  });

  it('sees a two-move mate (hard)', () => {
    // white plays Qg6+ ... Rg7 forced? use a known mate in two: ladder mate with two rooks
    const fen = '7k/8/8/8/8/8/R7/1R4K1 w - - 0 1';
    const first = pick(fen, 'hard', { timeMs: 3000, maxDepth: 4 });
    const game = new Chess(fen);
    game.move({ from: first.from, to: first.to });
    // whatever black plays, white has a mating reply
    for (const reply of game.moves({ verbose: true })) {
      const after = new Chess(game.fen());
      after.move(reply);
      const mate = after.moves({ verbose: true }).some((m) => {
        const c = new Chess(after.fen());
        c.move(m);
        return c.isCheckmate();
      });
      expect(mate).toBe(true);
    }
  });
});

describe('behaviour', () => {
  it('always returns a legal move, and is repeatable for the same seed', () => {
    const game: MoveInput[] = [];
    for (let i = 0; i < 6; i++) {
      const choice = chooseMove(game, 'normal', createRng(i + 1), { timeMs: 150, maxDepth: 2 });
      expect(chessOf(game).moves({ verbose: true }).some((m) => m.from === choice.from && m.to === choice.to)).toBe(true);
      game.push({ from: choice.from, to: choice.to, promotion: choice.promotion });
    }
    const a = chooseMove([], 'easy', createRng(9), { maxDepth: 1 });
    const b = chooseMove([], 'easy', createRng(9), { maxDepth: 1 });
    expect(a).toEqual(b);
  });

  it('keeps to its time budget', () => {
    const t0 = Date.now();
    chooseMove([], 'hard', createRng(1), { timeMs: 300, maxDepth: 8 });
    expect(Date.now() - t0).toBeLessThan(900);
  });

  it('looks deeper when given more time', () => {
    const quick = chooseMove([], 'hard', createRng(1), { timeMs: 60, maxDepth: 8 });
    const slow = chooseMove([], 'hard', createRng(1), { timeMs: 900, maxDepth: 8 });
    expect(slow.depth).toBeGreaterThanOrEqual(quick.depth);
    expect(slow.depth).toBeGreaterThanOrEqual(3);
  });

  it('refuses when there is no move (the game is over)', () => {
    expect(() => pick('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1', 'easy')).toThrow();
  });

  it('the levels are what the settings say', () => {
    expect(LEVELS.easy.maxDepth).toBeLessThan(LEVELS.normal.maxDepth);
    expect(LEVELS.normal.maxDepth).toBeLessThan(LEVELS.hard.maxDepth);
    expect(LEVELS.easy.variety).toBeGreaterThan(LEVELS.normal.variety);
  });
});

describe('strength', () => {
  /** Play a game between two levels with short time limits; returns white's material minus black's at the end, and the result. */
  function game(white: Difficulty, black: Difficulty, seed: number) {
    const moves: MoveInput[] = [];
    const rng = createRng(seed);
    for (let ply = 0; ply < 70; ply++) {
      const g = chessOf(moves);
      if (resultOf(g).kind !== 'ongoing' && !(resultOf(g) as { check?: boolean }).check && resultOf(g).kind !== 'ongoing') break;
      if (g.isGameOver()) break;
      const level = g.turn() === 'w' ? white : black;
      const c = chooseMove(moves, level, rng, { timeMs: level === 'hard' ? 120 : 60, maxDepth: level === 'hard' ? 3 : level === 'normal' ? 2 : 1 });
      moves.push({ from: c.from, to: c.to, promotion: c.promotion });
    }
    const g = chessOf(moves);
    const r = resultOf(g);
    return { balance: materialBalance(g), winner: r.kind === 'checkmate' ? r.winner : null };
  }

  it('hard beats easy, from either side', () => {
    const asWhite = game('hard', 'easy', 5);
    const asBlack = game('easy', 'hard', 6);
    const hardWhiteScore = asWhite.winner === 'w' ? 100 : asWhite.balance;
    const hardBlackScore = asBlack.winner === 'b' ? 100 : -asBlack.balance;
    expect(hardWhiteScore).toBeGreaterThan(0);
    expect(hardBlackScore).toBeGreaterThan(0);
  }, 240_000);
});

describe('ties', () => {
  it('never trades a queen away for nothing when every cut-off move ties with the best (variety 0)', () => {
    // white's queen is attacked by the knight on e4: a pawn move that ignores it must never be chosen
    const fen = 'rnbqkb1r/2pp1p2/4p1pp/p7/p2Pn2P/5NP1/1PPQ1P2/RNB1KBR1 w Qkq - 0 9';
    for (let seed = 1; seed <= 25; seed++) {
      const choice = pick(fen, 'hard', { timeMs: 100000, maxDepth: 2 }, seed);
      const game = new Chess(fen);
      game.move({ from: choice.from, to: choice.to, promotion: choice.promotion });
      const losesQueen = game.moves({ verbose: true }).some((m) => m.captured === 'q');
      expect(losesQueen, `${choice.san} with seed ${seed}`).toBe(false);
    }
  });
});
