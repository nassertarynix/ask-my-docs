/**
 * The computer player: negamax-style search with alpha-beta pruning. Because landing in your own store gives
 * another turn, the same player may move several times in a row, so the search tracks whose turn it is rather
 * than alternating blindly.
 *
 *   easy    looks one move ahead and picks randomly among the best two
 *   normal  looks four moves ahead
 *   hard    looks ten moves ahead
 */
import { nextRandom, type Rng } from '../crater-lab/engine/rng';
import { STORE, legalMoves, move, type Player, type State } from './engine';

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DEPTH: Record<Difficulty, number> = { easy: 1, normal: 4, hard: 10 };

/** Store difference from `me`'s point of view, plus a small bonus for stones still on my side (they are mine if the game ends). */
export function evaluate(s: State, me: Player): number {
  const other: Player = me === 0 ? 1 : 0;
  const diff = (s.pits[STORE[me]] ?? 0) - (s.pits[STORE[other]] ?? 0);
  let mine = 0;
  let theirs = 0;
  for (let n = 0; n < 6; n++) {
    mine += s.pits[me * 7 + n] ?? 0;
    theirs += s.pits[other * 7 + n] ?? 0;
  }
  return diff * 10 + (mine - theirs) * 0.5;
}

function search(s: State, depth: number, alpha: number, beta: number, me: Player): number {
  if (s.over || depth === 0) return evaluate(s, me);
  const maximising = s.current === me;
  let best = maximising ? -Infinity : Infinity;
  for (const n of orderedMoves(s)) {
    const { state } = move(s, n);
    const value = search(state, depth - 1, alpha, beta, me);
    if (maximising) {
      if (value > best) best = value;
      if (best > alpha) alpha = best;
    } else {
      if (value < best) best = value;
      if (best < beta) beta = best;
    }
    if (alpha >= beta) break;
  }
  return best;
}

/** Try the pits closest to the store first: they most often end in it, which makes the pruning work better. */
function orderedMoves(s: State): number[] {
  return legalMoves(s).sort((a, b) => b - a);
}

export function chooseMove(s: State, difficulty: Difficulty, rng: Rng): number {
  const moves = legalMoves(s);
  if (moves.length === 0) throw new Error('No move to make.');
  const me = s.current;
  const scored = moves.map((n) => ({ n, value: search(move(s, n).state, DEPTH[difficulty] - 1, -Infinity, Infinity, me) }));
  scored.sort((a, b) => b.value - a.value || b.n - a.n);
  if (difficulty === 'easy' && scored.length > 1 && nextRandom(rng) < 0.5) return (scored[1] as { n: number }).n;
  return (scored[0] as { n: number }).n;
}
