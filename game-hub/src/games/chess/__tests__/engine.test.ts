import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import { START_FEN, capturedBy, chessOf, historyOf, legalMoves, materialBalance, needsPromotion, playMove, resultOf, squareName } from '../engine';

describe('the rules (chess.js, wrapped)', () => {
  it('the starting position has 20 legal moves, and 400 after two plies (a known count)', () => {
    const game = chessOf([]);
    expect(game.fen()).toBe(START_FEN);
    expect(legalMoves(game)).toHaveLength(20);
    let n = 0;
    for (const m of legalMoves(game)) n += legalMoves(chessOf([m])).length;
    expect(n).toBe(400);
  });

  it('plays moves, refuses illegal ones, and never changes the list it was given', () => {
    const start: { from: string; to: string }[] = [];
    const one = playMove(start, { from: 'e2', to: 'e4' })!;
    expect(one).toEqual([{ from: 'e2', to: 'e4', promotion: undefined }]);
    expect(start).toEqual([]);
    expect(playMove(one, { from: 'e2', to: 'e4' })).toBeNull(); // nothing there now
    expect(playMove(start, { from: 'e2', to: 'e5' })).toBeNull(); // a pawn cannot go three squares
    expect(playMove(start, { from: 'e7', to: 'e5' })).toBeNull(); // not black's turn
  });

  it('knows about castling, en passant and promotion', () => {
    // castling: clear the kingside and castle
    const castle = ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4', 'g8f6'].map((m) => ({ from: m.slice(0, 2), to: m.slice(2) }));
    const before = chessOf(castle);
    expect(legalMoves(before, 'e1').some((m) => m.san === 'O-O')).toBe(true);
    // en passant: white pawn on e5, black plays d7-d5
    const ep = ['e2e4', 'a7a6', 'e4e5', 'd7d5'].map((m) => ({ from: m.slice(0, 2), to: m.slice(2) }));
    const game = chessOf(ep);
    const takes = legalMoves(game, 'e5').find((m) => m.to === 'd6');
    expect(takes?.captured).toBe('p');
    // promotion needs a piece chosen
    const promo = new Chess('8/P6k/8/8/8/8/8/K7 w - - 0 1');
    expect(needsPromotion(promo, 'a7', 'a8')).toBe(true);
    expect(needsPromotion(promo, 'a1', 'a2')).toBe(false);
  });

  it('a move that leaves your king in check is not legal (pinned pieces cannot move)', () => {
    const game = new Chess('4k3/8/8/8/8/8/4r3/4K1R1 w - - 0 1'); // the rook on e2 attacks the king; only moves that deal with it are legal
    const moves = legalMoves(game).map((m) => m.san);
    expect(moves.every((m) => m.startsWith('K'))).toBe(true);
    const pinned = new Chess('4r1k1/8/8/8/8/8/4B3/4K3 w - - 0 1'); // the bishop is pinned against the king by the rook
    expect(legalMoves(pinned, 'e2')).toHaveLength(0);
  });
});

describe('results', () => {
  it('fool\'s mate: checkmate, and the winner is black', () => {
    const game = chessOf(['f2f3', 'e7e5', 'g2g4', 'd8h4'].map((m) => ({ from: m.slice(0, 2), to: m.slice(2) })));
    expect(resultOf(game)).toEqual({ kind: 'checkmate', winner: 'b' });
  });

  it('stalemate is a draw', () => {
    expect(resultOf(new Chess('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))).toEqual({ kind: 'draw', reason: 'stalemate' });
  });

  it('a lone king against a lone king is a draw for want of material; a queen is enough to play on', () => {
    expect(resultOf(new Chess('8/8/4k3/8/8/4K3/8/8 w - - 0 1'))).toEqual({ kind: 'draw', reason: 'insufficient material' });
    expect(resultOf(new Chess('8/8/4k3/8/8/4K3/4Q3/8 w - - 0 1')).kind).toBe('ongoing');
  });

  it('the fifty-move rule, and threefold repetition', () => {
    expect(resultOf(new Chess('4k3/8/8/8/8/8/4Q3/4K3 w - - 100 80'))).toEqual({ kind: 'draw', reason: 'fifty-move rule' });
    const shuffle = ['g1f3', 'g8f6', 'f3g1', 'f6g8', 'g1f3', 'g8f6', 'f3g1', 'f6g8'].map((m) => ({ from: m.slice(0, 2), to: m.slice(2) }));
    expect(resultOf(chessOf(shuffle))).toEqual({ kind: 'draw', reason: 'threefold repetition' });
  });

  it('check is reported while the game goes on', () => {
    const game = chessOf(['e2e4', 'f7f6', 'd1h5'].map((m) => ({ from: m.slice(0, 2), to: m.slice(2) })));
    expect(resultOf(game)).toEqual({ kind: 'ongoing', check: true });
  });
});

describe('history, captures and material', () => {
  it('records standard notation, with captures and the captured piece', () => {
    const game = ['e2e4', 'd7d5', 'e4d5'].map((m) => ({ from: m.slice(0, 2), to: m.slice(2) }));
    const history = historyOf(game);
    expect(history.map((m) => m.san)).toEqual(['e4', 'd5', 'exd5']);
    expect(history[2]).toMatchObject({ piece: 'p', captured: 'p', colour: 'w' });
  });

  it('counts what each side has taken, and the material balance', () => {
    const game = chessOf(['e2e4', 'd7d5', 'e4d5', 'd8d5', 'b1c3', 'd5a5'].map((m) => ({ from: m.slice(0, 2), to: m.slice(2) })));
    const taken = capturedBy(game);
    expect(taken.w).toEqual(['p']); // white took a pawn
    expect(taken.b).toEqual(['p']); // black took a pawn
    expect(materialBalance(game)).toBe(0);
    const up = new Chess('4k3/8/8/8/8/8/4Q3/4K3 w - - 0 1');
    expect(materialBalance(up)).toBe(9);
  });

  it('names squares', () => {
    expect(squareName(0, 0)).toBe('a1');
    expect(squareName(7, 7)).toBe('h8');
  });
});
