/**
 * Chess rules, from the chess.js library (move generation, check, checkmate, stalemate, castling, en passant,
 * promotion, repetition and the fifty-move rule). This file wraps it so the rest of the game deals in plain data:
 * a game is the list of moves played so far, and everything else (position, whose turn, result, captured pieces) is
 * worked out from that list. Rebuilding from the list is cheap and means a position is never changed behind your back.
 */
import { Chess, type Move as LibMove } from 'chess.js';

export type Colour = 'w' | 'b';
export type PieceType = 'p' | 'n' | 'b' | 'r' | 'q' | 'k';
export type Promotion = 'q' | 'r' | 'b' | 'n';

export interface MoveInput {
  from: string;
  to: string;
  promotion?: Promotion;
}

export interface PlayedMove extends MoveInput {
  san: string;
  piece: PieceType;
  captured?: PieceType;
  colour: Colour;
}

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** The library game after these moves (from the start, or from `fen`). Throws if a move is illegal. */
export function chessOf(moves: readonly MoveInput[], fen: string = START_FEN): Chess {
  const game = new Chess(fen);
  for (const m of moves) game.move({ from: m.from, to: m.to, promotion: m.promotion });
  return game;
}

const played = (m: LibMove): PlayedMove => ({
  from: m.from,
  to: m.to,
  promotion: m.promotion as Promotion | undefined,
  san: m.san,
  piece: m.piece as PieceType,
  captured: m.captured as PieceType | undefined,
  colour: m.color as Colour,
});

export type Result =
  | { kind: 'ongoing'; check: boolean }
  | { kind: 'checkmate'; winner: Colour }
  | { kind: 'draw'; reason: 'stalemate' | 'insufficient material' | 'threefold repetition' | 'fifty-move rule' | 'draw' };

export function resultOf(game: Chess): Result {
  if (game.isCheckmate()) return { kind: 'checkmate', winner: game.turn() === 'w' ? 'b' : 'w' };
  if (game.isStalemate()) return { kind: 'draw', reason: 'stalemate' };
  if (game.isInsufficientMaterial()) return { kind: 'draw', reason: 'insufficient material' };
  if (game.isThreefoldRepetition()) return { kind: 'draw', reason: 'threefold repetition' };
  if (game.isDraw()) return { kind: 'draw', reason: game.fen().split(' ')[4] && Number(game.fen().split(' ')[4]) >= 100 ? 'fifty-move rule' : 'draw' };
  return { kind: 'ongoing', check: game.inCheck() };
}

/** Every legal move for the side to move, from a given square (or all of them). */
export function legalMoves(game: Chess, from?: string): PlayedMove[] {
  return (from ? game.moves({ square: from as never, verbose: true }) : game.moves({ verbose: true })).map(played);
}

/** Does this move need a promotion piece chosen? (A pawn reaching the last rank.) */
export const needsPromotion = (game: Chess, from: string, to: string): boolean => legalMoves(game, from).some((m) => m.to === to && m.promotion);

/** Play a move on a copy of the moves list. Returns the new list, or null if the move is not legal. */
export function playMove(moves: readonly MoveInput[], move: MoveInput, fen: string = START_FEN): MoveInput[] | null {
  const game = chessOf(moves, fen);
  try {
    game.move({ from: move.from, to: move.to, promotion: move.promotion });
  } catch {
    return null;
  }
  return [...moves, { from: move.from, to: move.to, promotion: move.promotion }];
}

/** The moves played so far, with their standard notation, in order. */
export function historyOf(moves: readonly MoveInput[], fen: string = START_FEN): PlayedMove[] {
  return chessOf(moves, fen).history({ verbose: true }).map(played);
}

export const VALUES: Record<PieceType, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const START_COUNTS: Record<PieceType, number> = { p: 8, n: 2, b: 2, r: 2, q: 1, k: 1 };

/** What each side has captured so far (pieces of the other colour missing from the board; promotions make this approximate). */
export function capturedBy(game: Chess): { w: PieceType[]; b: PieceType[] } {
  const have: Record<Colour, Record<PieceType, number>> = {
    w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
    b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 },
  };
  for (const row of game.board()) for (const sq of row) if (sq) have[sq.color as Colour][sq.type as PieceType]++;
  const missing = (c: Colour): PieceType[] => {
    const out: PieceType[] = [];
    for (const t of ['q', 'r', 'b', 'n', 'p'] as PieceType[]) for (let i = have[c][t]; i < START_COUNTS[t]; i++) out.push(t);
    return out;
  };
  // white captured the black pieces that are missing, and vice versa
  return { w: missing('b'), b: missing('w') };
}

/** Material on the board, in pawns, from white's point of view. */
export function materialBalance(game: Chess): number {
  let sum = 0;
  for (const row of game.board()) for (const sq of row) if (sq) sum += (sq.color === 'w' ? 1 : -1) * VALUES[sq.type as PieceType];
  return sum;
}

export const FILES = 'abcdefgh';
export const squareName = (file: number, rank: number): string => `${FILES[file]}${rank + 1}`;
