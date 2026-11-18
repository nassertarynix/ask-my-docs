/**
 * The computer player: alpha-beta search over legal shogi moves.
 *
 *   evaluation   material (pieces in hand count a little extra, because a piece in hand can be dropped anywhere), how far
 *                pawns have advanced, and how many golds and silvers stand guard round each king
 *   search       negamax with alpha-beta, captures tried first, a capture-only search at the end of each line so it does not
 *                stop mid-exchange, one extra move of depth when in check, iterative deepening against a time budget
 *   levels       easy:   one move ahead, often plays a near-best move rather than the best
 *                normal: a few moves ahead
 *                hard:   as deep as its time budget allows
 *
 * Honest limits: it knows no openings or castle shapes and does not plan long attacks, so it plays tactically (it will
 * not hang pieces or miss a short mate) but not like a strong shogi program. Difficulty is depth and looseness, never cheating.
 */
import { nextRandom, type Rng } from '../crater-lab/engine/rng';
import { Position, isDrop, moveFrom, moveTo, movePromotes, replay, sqCol, sqRow, usiOf, START_SFEN, type Move } from './engine';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface Settings {
  maxDepth: number;
  timeMs: number;
  /** A move within this many points of the best may be chosen instead of the best. */
  variety: number;
}
export const LEVELS: Record<Difficulty, Settings> = {
  easy: { maxDepth: 1, timeMs: 300, variety: 150 },
  normal: { maxDepth: 3, timeMs: 900, variety: 30 },
  hard: { maxDepth: 6, timeMs: 2400, variety: 0 },
};

const MATE = 30000;
// by piece code: 1 K, 2 R, 3 B, 4 G, 5 S, 6 N, 7 L, 8 P, then +8 for promoted
const VALUE = [0, 0, 1040, 890, 690, 640, 450, 430, 100, 0, 1300, 1150, 0, 670, 650, 650, 520];
const GUARDS = new Set([4, 13, 14, 15, 16, 5]); // pieces that protect a king well

/** Score for the side to move: positive means it is better off. */
export function evaluate(pos: Position): number {
  let score = 0;
  const guards = [0, 0];
  for (let sq = 0; sq < 81; sq++) {
    const p = pos.board[sq] as number;
    if (p === 0) continue;
    const side = p > 0 ? 0 : 1;
    const code = Math.abs(p);
    let v = VALUE[code] as number;
    if (code === 8) {
      const advanced = side === 0 ? 6 - sqRow(sq) : sqRow(sq) - 2; // rows moved past the starting rank
      if (advanced > 0) v += 3 * advanced;
    }
    if (GUARDS.has(code)) {
      const k = pos.kings[side];
      if (k >= 0 && Math.max(Math.abs(sqRow(k) - sqRow(sq)), Math.abs(sqCol(k) - sqCol(sq))) <= 2) guards[side] = (guards[side] as number) + 1;
    }
    score += side === 0 ? v : -v;
  }
  for (let code = 2; code <= 8; code++) {
    const mine = (pos.hands[code] as number) - (pos.hands[9 + code] as number);
    score += Math.round((VALUE[code] as number) * 1.08) * mine;
  }
  score += 14 * (Math.min(4, guards[0] as number) - Math.min(4, guards[1] as number));
  return (pos.turn === 0 ? score : -score) + 0; // `+ 0` turns a negative zero into zero
}

/** Order moves so the likely best come first (better pruning): big captures by small pieces, promotions. */
function ordered(pos: Position, moves: Move[]): Move[] {
  const keyed = moves.map((m) => {
    let key = 0;
    if (!isDrop(m)) {
      const captured = Math.abs(pos.board[moveTo(m)] as number);
      if (captured) key += 10 * (VALUE[captured] as number) - (VALUE[Math.abs(pos.board[moveFrom(m)] as number)] as number) / 10 + 50;
      if (movePromotes(m)) key += 300;
    }
    return { m, key };
  });
  keyed.sort((a, b) => b.key - a.key);
  return keyed.map((k) => k.m);
}

class OutOfTime extends Error {}

interface Search {
  pos: Position;
  deadline: number;
  nodes: number;
}

function tick(s: Search): void {
  if ((++s.nodes & 255) === 0 && Date.now() > s.deadline) throw new OutOfTime();
}

function quiesce(s: Search, alpha: number, beta: number, depth: number): number {
  tick(s);
  const { pos } = s;
  const stand = evaluate(pos);
  if (stand >= beta) return stand;
  if (depth === 0) return stand;
  if (stand > alpha) alpha = stand;
  const us = pos.turn;
  for (const m of ordered(pos, pos.pseudoMoves({ capturesOnly: true }))) {
    pos.makeMove(m);
    if (pos.inCheck(us)) {
      pos.unmakeMove();
      continue;
    }
    const score = -quiesce(s, -beta, -alpha, depth - 1);
    pos.unmakeMove();
    if (score >= beta) return score;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(s: Search, depth: number, alpha: number, beta: number, ply: number): number {
  tick(s);
  const { pos } = s;
  const us = pos.turn;
  if (pos.inCheck(us) && ply < 14) depth++; // look one move further while in check, so mates are not missed at the edge
  if (depth <= 0) return quiesce(s, alpha, beta, 6);
  let best = -Infinity;
  let legal = 0;
  for (const m of ordered(pos, pos.pseudoMoves({ nearDrops: true }))) {
    pos.makeMove(m);
    if (pos.inCheck(us)) {
      pos.unmakeMove();
      continue;
    }
    legal++;
    const score = -negamax(s, depth - 1, -beta, -alpha, ply + 1);
    pos.unmakeMove();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return legal === 0 ? -MATE + ply : best; // no legal move is a loss; sooner is worse for the side that is mated
}

export interface Choice {
  move: Move;
  usi: string;
  /** The search's score for it, for the side that moved. */
  score: number;
  /** How deep the search got. */
  depth: number;
}

export interface Options {
  /** Override the level's time budget (ms) or depth, for tests. */
  timeMs?: number;
  maxDepth?: number;
}

/** The computer's move after `moves`. The game must not be over. */
export function chooseMove(moves: readonly Move[], difficulty: Difficulty, rng: Rng, options: Options = {}, sfen: string = START_SFEN): Choice {
  const level = LEVELS[difficulty];
  const pos = replay(moves, sfen).pos;
  const roots = ordered(pos, pos.legalMoves({ nearDrops: true }));
  if (roots.length === 0) throw new Error('There is no move to make.');
  const maxDepth = options.maxDepth ?? level.maxDepth;
  const s: Search = { pos, deadline: Date.now() + (options.timeMs ?? level.timeMs), nodes: 0 };
  const base = pos.plyCount;

  type Scored = { move: Move; score: number };
  let scores: Scored[] = roots.map((m) => ({ move: m, score: 0 }));
  let reached = 0;
  for (let depth = 1; depth <= maxDepth; depth++) {
    const next: Scored[] = [];
    try {
      // Moves that cannot come within `variety` of the best so far are cut off early (their score is then only an upper
      // bound, never above best - variety). Every move within the margin gets an exact score.
      let best = -Infinity;
      for (const { move } of scores) {
        pos.makeMove(move);
        const floor = best === -Infinity ? Infinity : -(best - level.variety);
        const score = -negamax(s, depth - 1, -Infinity, floor, 1);
        pos.unmakeMove();
        next.push({ move, score });
        if (score > best) best = score;
      }
    } catch (e) {
      if (!(e instanceof OutOfTime)) throw e;
      // time ran out part-way: the half-finished level is not trusted. Unwind whatever is left on the board.
      while (pos.plyCount > base) pos.unmakeMove();
      break;
    }
    next.sort((a, b) => b.score - a.score);
    scores = next;
    reached = depth;
    if (Math.abs(next[0]?.score ?? 0) > MATE - 100) break; // a forced mate is found: no need to look further
    if (Date.now() > s.deadline) break;
  }
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0] as Scored;
  // Strictly inside the margin: a cut-off move scored at most `best - variety`, so a tie with the best (always so at
  // variety 0) means "no better than that", not "as good", and must never be picked.
  const close = scores.filter((x) => x === best || (best.score - x.score < level.variety && x.score > -MATE + 1000));
  const pick = close.length > 1 && Math.abs(best.score) < MATE - 100 ? (close[Math.floor(nextRandom(rng) * close.length)] as Scored) : best;
  return { move: pick.move, usi: usiOf(pick.move), score: pick.score, depth: reached };
}

