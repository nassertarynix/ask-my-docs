/**
 * The computer player. It looks a few moves ahead (alpha-beta search) and scores a position by the difference in
 * the two pawns' shortest routes to their goals, with a small credit for walls in hand. It does not try every wall
 * (there are up to 128): it only considers walls close to the other pawn's shortest route, which is where a wall
 * can actually slow it down.
 *
 *   easy    one move ahead, and sometimes just takes the second-best
 *   normal  two moves ahead
 *   hard    three moves ahead
 */
import { nextRandom, type Rng } from '../crater-lab/engine/rng';
import { WALL_GRID, apply, distance, goalRow, pawnMoves, wallProblem, type Move, type Player, type State, type Wall } from './engine';

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DEPTH: Record<Difficulty, number> = { easy: 1, normal: 2, hard: 3 };
const WIN = 10_000;
const MAX_CANDIDATES = 14;

/** Positive when `me` is ahead. */
export function evaluate(s: State, me: Player): number {
  const other: Player = me === 0 ? 1 : 0;
  if (s.winner !== null) return s.winner === me ? WIN : -WIN;
  const mine = distance(s, me);
  const theirs = distance(s, other);
  // a wall in hand is worth about one and a quarter steps, so a wall that only gains one step is not worth spending
  return (theirs - mine) * 10 + (s.wallsLeft[me] - s.wallsLeft[other]) * 12;
}

/** Walls touching squares the other pawn is likely to walk through: its shortest route, found by walking it. */
function wallsNearRoute(s: State, p: Player): Wall[] {
  const route: { r: number; c: number }[] = [];
  let probe = s;
  // follow the pawn's best steps (ignoring the other pawn) for a few squares
  let pos = s.pawns[p];
  for (let i = 0; i < 4; i++) {
    route.push(pos);
    const here = { ...probe, pawns: setPawn(probe.pawns, p, pos), current: p };
    const options = pawnMoves(here, p);
    if (options.length === 0) break;
    let best = options[0]!;
    let bestD = Infinity;
    for (const o of options) {
      const d = distance({ ...here, pawns: setPawn(here.pawns, p, o) }, p);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    pos = best;
    probe = here;
  }
  const seen = new Set<string>();
  const out: Wall[] = [];
  for (const sq of route) {
    for (const dr of [-1, 0]) {
      for (const dc of [-1, 0]) {
        const r = sq.r + dr;
        const c = sq.c + dc;
        if (r < 0 || c < 0 || r >= WALL_GRID || c >= WALL_GRID) continue;
        for (const o of ['h', 'v'] as const) {
          const key = `${o}${r},${c}`;
          if (!seen.has(key)) {
            seen.add(key);
            out.push({ o, r, c });
          }
        }
      }
    }
  }
  return out;
}

function setPawn(pawns: State['pawns'], p: Player, to: { r: number; c: number }): [{ r: number; c: number }, { r: number; c: number }] {
  const copy: [{ r: number; c: number }, { r: number; c: number }] = [pawns[0], pawns[1]];
  copy[p] = to;
  return copy;
}

/** The moves worth thinking about, best-looking first. */
export function candidateMoves(s: State): Move[] {
  const me = s.current;
  const other: Player = me === 0 ? 1 : 0;
  const scored: { move: Move; score: number }[] = [];
  for (const to of pawnMoves(s)) {
    const next = apply(s, { type: 'move', to });
    scored.push({ move: { type: 'move', to }, score: next.winner === me ? WIN : evaluate(next, me) });
  }
  if (s.wallsLeft[me] > 0) {
    const myBefore = distance(s, me);
    const theirBefore = distance(s, other);
    for (const wall of wallsNearRoute(s, other)) {
      if (wallProblem(s, wall) !== null) continue;
      const next = apply(s, { type: 'wall', wall });
      // what the wall really does to the race: steps added to their route minus steps added to mine
      const gain = distance(next, other) - theirBefore - (distance(next, me) - myBefore);
      // a wall is worth considering if it costs them two steps net, or one when they are close to winning
      if (gain >= 2 || (gain >= 1 && theirBefore <= 3)) scored.push({ move: { type: 'wall', wall }, score: evaluate(next, me) });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_CANDIDATES).map((x) => x.move);
}

function search(s: State, depth: number, alpha: number, beta: number, me: Player): number {
  if (s.winner !== null || depth === 0) return evaluate(s, me);
  const maximising = s.current === me;
  let best = maximising ? -Infinity : Infinity;
  for (const m of candidateMoves(s)) {
    const value = search(apply(s, m), depth - 1, alpha, beta, me);
    if (maximising) {
      best = Math.max(best, value);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, value);
      beta = Math.min(beta, best);
    }
    if (alpha >= beta) break;
  }
  return best;
}

export function chooseMove(s: State, difficulty: Difficulty, rng: Rng): Move {
  if (s.winner !== null) throw new Error('The game is over.');
  const me = s.current;
  const candidates = candidateMoves(s);
  // a move that wins on the spot is always taken
  for (const m of candidates) if (m.type === 'move' && m.to.r === goalRow(me)) return m;
  const scored = candidates.map((m) => ({ m, value: search(apply(s, m), DEPTH[difficulty] - 1, -Infinity, Infinity, me) }));
  scored.sort((a, b) => b.value - a.value);
  if (difficulty === 'easy' && scored.length > 1 && nextRandom(rng) < 0.35) return (scored[1] as { m: Move }).m;
  return (scored[0] as { m: Move }).m;
}
