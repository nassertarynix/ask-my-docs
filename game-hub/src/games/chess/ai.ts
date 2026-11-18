/**
 * The computer player: a standard alpha-beta search over chess.js moves.
 *
 *   evaluation   material plus where each piece stands (piece-square tables), so it develops pieces, castles and keeps
 *                its pawns and king sensible, not just counts pieces
 *   search       negamax with alpha-beta pruning, captures tried first, a short capture search at the leaves so it does
 *                not stop in the middle of an exchange, and iterative deepening against a time budget
 *   levels       easy:  one move ahead, often plays a near-best move rather than the best
 *                normal: a few moves ahead, a short time budget
 *                hard:  as deep as the time budget allows
 */
import type { Chess } from 'chess.js';
import { nextRandom, type Rng } from '../crater-lab/engine/rng';
import { chessOf, type Colour, type MoveInput, type PieceType, type Promotion } from './engine';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Settings {
  maxDepth: number;
  timeMs: number;
  /** A move within this many centipawns of the best may be chosen instead of the best. */
  variety: number;
}
export const LEVELS: Record<Difficulty, Settings> = {
  easy: { maxDepth: 1, timeMs: 200, variety: 90 },
  normal: { maxDepth: 3, timeMs: 700, variety: 18 },
  hard: { maxDepth: 6, timeMs: 1800, variety: 0 },
};

const MATE = 30000;
const PIECE_VALUE: Record<PieceType, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Piece-square tables from white's point of view, rank 8 first (the "simplified evaluation function" values).
const PST: Record<PieceType, number[]> = {
  p: [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5, 0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  n: [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30, -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  b: [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10, -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  r: [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  q: [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5, 0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
  k: [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20],
};

/**
 * chess.js builds a SAN string (which means making the move and testing for check) for every move it returns, which is
 * about ten times slower than the search can afford. Its internal generator hands back plain numeric moves, so the
 * search uses that and asks for SAN only for the one move it finally plays. The version is pinned in package-lock.json;
 * `internals()` fails loudly if a different build lacks them.
 */
interface RawMove {
  from: number;
  to: number;
  piece: PieceType;
  captured?: PieceType;
  promotion?: PieceType;
}
interface Internals {
  _board: ({ type: PieceType; color: Colour } | undefined)[];
  _moves(options?: { legal?: boolean }): RawMove[];
  _makeMove(move: RawMove): void;
  _undoMove(): unknown;
}
function internals(game: Chess): Internals {
  const g = game as unknown as Internals;
  if (!Array.isArray(g._board) || typeof g._moves !== 'function' || typeof g._makeMove !== 'function' || typeof g._undoMove !== 'function') {
    throw new Error('This chess.js build does not offer the internals the search needs; keep the version in package-lock.json.');
  }
  return g;
}
const squareOf = (sq: number) => `${'abcdefgh'[sq & 15]}${8 - (sq >> 4)}`;

/** Score for the side to move, in centipawns: positive means it is better off. */
export function evaluate(game: Chess): number {
  const board = internals(game)._board;
  let score = 0;
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const sq = board[rank * 16 + file];
      if (!sq) continue;
      // the tables are written with white at the bottom; a black piece reads its table from the other side
      const index = sq.color === 'w' ? rank * 8 + file : (7 - rank) * 8 + file;
      const value = PIECE_VALUE[sq.type] + (PST[sq.type][index] as number);
      score += sq.color === 'w' ? value : -value;
    }
  }
  // `+ 0` turns a negative zero into zero, so equal positions compare equal
  return (game.turn() === 'w' ? score : -score) + 0;
}

/** Order moves so the likely best are searched first (better pruning): big captures by small pieces, promotions. */
function ordered(moves: RawMove[]): RawMove[] {
  const key = (m: RawMove) => (m.captured ? 10 * PIECE_VALUE[m.captured] - PIECE_VALUE[m.piece] / 10 : 0) + (m.promotion ? 800 : 0);
  return moves.sort((a, b) => key(b) - key(a));
}

class OutOfTime extends Error {}

interface Search {
  game: Chess;
  raw: Internals;
  deadline: number;
  nodes: number;
}

function tick(s: Search): void {
  if ((++s.nodes & 127) === 0 && Date.now() > s.deadline) throw new OutOfTime();
}

function quiesce(s: Search, alpha: number, beta: number, depth: number): number {
  tick(s);
  const stand = evaluate(s.game);
  if (stand >= beta) return stand;
  if (depth === 0) return stand;
  if (stand > alpha) alpha = stand;
  const captures = ordered(s.raw._moves().filter((m) => m.captured || m.promotion));
  for (const m of captures) {
    s.raw._makeMove(m);
    const score = -quiesce(s, -beta, -alpha, depth - 1);
    s.raw._undoMove();
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(s: Search, depth: number, alpha: number, beta: number, ply: number): number {
  tick(s);
  const moves = s.raw._moves();
  if (moves.length === 0) return s.game.inCheck() ? -MATE + ply : 0; // checkmate (sooner is worse for the mated side) or stalemate
  if (depth === 0) return quiesce(s, alpha, beta, 4);
  let best = -Infinity;
  for (const m of ordered(moves)) {
    s.raw._makeMove(m);
    const score = -negamax(s, depth - 1, -beta, -alpha, ply + 1);
    s.raw._undoMove();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

export interface Choice extends MoveInput {
  san: string;
  /** The search's score for it, in centipawns, for the side that moved. */
  score: number;
  /** How deep the search got. */
  depth: number;
}

export interface Options {
  /** Override the level's time budget (ms) or depth, for tests. */
  timeMs?: number;
  maxDepth?: number;
}

/** The computer's move in the position after `moves`. The game must not be over. */
export function chooseMove(moves: readonly MoveInput[], difficulty: Difficulty, rng: Rng, options: Options = {}, fen?: string): Choice {
  const level = LEVELS[difficulty];
  const game = chessOf(moves, fen);
  const raw = internals(game);
  const roots = ordered(raw._moves());
  if (roots.length === 0) throw new Error('There is no move to make.');
  const maxDepth = options.maxDepth ?? level.maxDepth;
  const s: Search = { game, raw, deadline: Date.now() + (options.timeMs ?? level.timeMs), nodes: 0 };

  type Scored = { move: RawMove; score: number };
  let scores: Scored[] = roots.map((m) => ({ move: m, score: 0 }));
  let reached = 0;
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next: Scored[] = [];
    try {
      // Moves that cannot come within `variety` of the best so far are cut off early (their score is then only an upper
      // bound, but it is below the margin, so they are never picked). Every move within the margin gets an exact score.
      let best = -Infinity;
      for (const { move } of scores) {
        raw._makeMove(move);
        const floor = best === -Infinity ? Infinity : -(best - level.variety);
        const score = -negamax(s, depth - 1, -Infinity, floor, 1);
        raw._undoMove();
        next.push({ move, score });
        if (score > best) best = score;
      }
    } catch (e) {
      if (!(e instanceof OutOfTime)) throw e;
      // the time ran out part-way: the half-finished level is not trusted. Unwind whatever is left on the board.
      while (game.history().length > moves.length) raw._undoMove();
      break;
    }
    next.sort((a, b) => b.score - a.score);
    scores = next;
    reached = depth;
    if (Math.abs(next[0]!.score) > MATE - 100) break; // a forced mate is found: no need to look further
    if (Date.now() > s.deadline) break;
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0]!;
  // a little variety for the weaker levels: pick among the moves that are nearly as good (never a worse blunder than the margin)
  // Strictly inside the margin: a move that was cut off scored at most `best - variety`, so a tie with the best (always
  // the case at variety 0) means "no better than that", not "as good", and must never be picked.
  const close = scores.filter((x) => x === best || (best.score - x.score < level.variety && x.score > -MATE + 1000));
  const pick = close.length > 1 && Math.abs(best.score) < MATE - 100 ? close[Math.floor(nextRandom(rng) * close.length)]! : best;
  const m = pick.move;
  const from = squareOf(m.from);
  const to = squareOf(m.to);
  // SAN is needed only for this one move, so ask chess.js's public API for it
  const verbose = game.moves({ verbose: true }).find((v) => v.from === from && v.to === to && (v.promotion ?? undefined) === m.promotion);
  if (!verbose) throw new Error('The search chose a move chess.js does not list.');
  return { from, to, promotion: m.promotion as Promotion | undefined, san: verbose.san, score: pick.score, depth: reached };
}
