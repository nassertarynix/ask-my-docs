/**
 * The computer player.
 *
 *   easy    draws mostly at random, but usually grabs a box when one is on offer.
 *   normal  always grabs boxes, otherwise avoids drawing a third side (which hands the opponent a box), and when it
 *           has to give boxes away it gives the fewest.
 *   hard    plays like normal until the board is nearly full, then solves the rest exactly (it looks at every
 *           possible continuation, so it also finds the "double-dealing" sacrifices that win long chains).
 */
import { nextRandom, type Rng } from '../crater-lab/engine/rng';
import { boxesCompletedBy, edgeBoxes, freeEdges, isOver, play, sides, type State } from './engine';

export type Difficulty = 'easy' | 'normal' | 'hard';

/** With this many edges left or fewer, the hard player searches to the end of the game. */
export const SOLVE_LIMIT = 14;

/** Drawing this edge gives some box its third side, so the opponent can complete it. */
function givesBox(s: State, edge: number): boolean {
  return edgeBoxes(s.board, edge).some((box) => sides(s, box) === 2);
}

/**
 * If the opponent grabbed everything on offer after this edge, how many boxes would they get?
 * (They take every box they can, in the way that keeps taking: a simple stand-in for a chain being opened.)
 */
function boxesGivenAway(s: State, edge: number): number {
  let state = play(s, edge).state;
  const me = s.current;
  let given = 0;
  while (!isOver(state) && state.current !== me) {
    const grab = freeEdges(state).find((e) => boxesCompletedBy(state, e) > 0);
    if (grab === undefined) break;
    const result = play(state, grab);
    given += result.completed.length;
    state = result.state;
  }
  return given;
}

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.floor(nextRandom(rng) * items.length)] as T;
}

function normalMove(s: State, rng: Rng): number {
  const free = freeEdges(s);
  const grabs = free.filter((e) => boxesCompletedBy(s, e) > 0);
  if (grabs.length > 0) return pick(grabs, rng);
  const safe = free.filter((e) => !givesBox(s, e));
  if (safe.length > 0) return pick(safe, rng);
  let best = Infinity;
  let bestEdges: number[] = [];
  for (const e of free) {
    const cost = boxesGivenAway(s, e);
    if (cost < best) {
      best = cost;
      bestEdges = [e];
    } else if (cost === best) bestEdges.push(e);
  }
  return pick(bestEdges, rng);
}

/**
 * Exact value of a position for the player to move: the boxes they will win minus the boxes the opponent
 * will win from here on, if both play perfectly. Positions are remembered by which edges are drawn.
 */
function solve(s: State, memo: Map<string, number>): number {
  if (isOver(s)) return 0;
  const key = s.edges.join('');
  const known = memo.get(key);
  if (known !== undefined) return known;
  let best = -Infinity;
  for (const e of freeEdges(s)) {
    const { state, completed } = play(s, e);
    const gain = completed.length;
    const value = state.current === s.current ? gain + solve(state, memo) : gain - solve(state, memo);
    if (value > best) best = value;
  }
  memo.set(key, best);
  return best;
}

function hardMove(s: State, rng: Rng): number {
  const free = freeEdges(s);
  if (free.length > SOLVE_LIMIT) return normalMove(s, rng);
  const memo = new Map<string, number>();
  let best = -Infinity;
  let bestEdges: number[] = [];
  for (const e of free) {
    const { state, completed } = play(s, e);
    const value = state.current === s.current ? completed.length + solve(state, memo) : completed.length - solve(state, memo);
    if (value > best) {
      best = value;
      bestEdges = [e];
    } else if (value === best) bestEdges.push(e);
  }
  return pick(bestEdges, rng);
}

/** The edge the computer draws next. The game must not be over. */
export function chooseMove(s: State, difficulty: Difficulty, rng: Rng): number {
  if (isOver(s)) throw new Error('The game is over.');
  const free = freeEdges(s);
  if (difficulty === 'easy') {
    const grabs = free.filter((e) => boxesCompletedBy(s, e) > 0);
    if (grabs.length > 0 && nextRandom(rng) < 0.8) return pick(grabs, rng);
    return pick(free, rng);
  }
  return difficulty === 'normal' ? normalMove(s, rng) : hardMove(s, rng);
}

/** Exposed for tests: the exact value (box difference for the player to move) of a position. */
export function exactValue(s: State): number {
  return solve(s, new Map());
}
