/**
 * The computer heroes. Every legal action is scored and the best is played (with a little noise at the easier levels).
 *
 *   moving     steps gained towards the goal, a big bonus for stepping onto it (and for winning), a small penalty for ending
 *              where the Minotaur could reach next turn
 *   Minotaur   hitting an opponent's hero is worth how far that hero had got, more for the opponent who is ahead; hitting your
 *              own hero is a costly mistake; with nothing to hit it moves towards advanced opponent heroes and away from its own
 *   walls      how many steps the walls add to the opponents' routes (the leaders count most), minus any they add to its own
 *
 * They see exactly what a player sees and never cheat. Easy plays a random legal action about 4 times in 10.
 */
import { nextRandom, type Rng } from '../crater-lab/engine/rng';
import { cellX, cellY } from './maze';
import { HEROES_PER_PLAYER, distancesToGoal, heroAt, heroesHome, heroesNeeded, legalActions, onGoal, type Action, type State } from './engine';

export type BotLevel = 'easy' | 'normal' | 'hard';
const RANDOM_PLAY: Record<BotLevel, number> = { easy: 0.4, normal: 0.05, hard: 0 };
const NOISE: Record<BotLevel, number> = { easy: 2, normal: 1, hard: 0.15 };

const manhattan = (s: State, a: number, b: number) => Math.abs(cellX(s.maze, a) - cellX(s.maze, b)) + Math.abs(cellY(s.maze, a) - cellY(s.maze, b));

/** How far from home a seat's hero is, in steps (a hero in its start block counts from the block). */
function remaining(dist: number[], cell: number): number {
  const d = dist[cell] as number;
  return d < 0 ? 99 : d;
}

/** Squares the Minotaur could reach in eight steps (ignoring who stands where): a guess at where a hero is in danger. */
function threatened(s: State): Set<number> {
  const m = s.maze;
  const seen = new Map<number, number>([[s.minotaur, 0]]);
  const queue = [s.minotaur];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head] as number;
    const d = seen.get(cell) as number;
    if (d >= 8) continue;
    const next = cell === m.lair ? m.lairExits : [cell + 1, cell - 1, cell + m.width, cell - m.width];
    for (const n of next) {
      if (n < 0 || n >= m.cells.length || seen.has(n) || m.cells[n] !== '.' || s.walls.includes(n)) continue;
      if (Math.abs((n % m.width) - (cell % m.width)) > 1) continue; // do not wrap round the edge of the board
      seen.set(n, d + 1);
      queue.push(n);
    }
  }
  return new Set(seen.keys());
}

function scoreOf(s: State, a: Action, dists: number[][], danger: Set<number>): number {
  const me = s.turn;
  if (a.type === 'move') {
    const from = (s.heroes[me] as readonly number[])[a.hero] as number;
    const dist = dists[me] as number[];
    let score = remaining(dist, from) - remaining(dist, a.to);
    const goal = (s.maze.goals[s.corners[me] as number] as readonly number[]).includes(a.to);
    if (goal) score += 8 + (heroesHome(s, me) + 1 >= heroesNeeded(s.players) ? 100 : 0);
    else if (danger.has(a.to) && s.minotaur !== a.to) score -= 1.2;
    score += (20 - remaining(dist, a.to)) * 0.03; // a slight liking for the hero that is already furthest on
    return score;
  }
  if (a.type === 'minotaur') {
    const hit = heroAt(s, a.to);
    if (hit) {
      const [victim, hero] = hit;
      const cell = (s.heroes[victim] as readonly number[])[hero] as number;
      const home = (s.maze.starts[s.corners[victim] as number] as readonly number[])[hero] as number;
      const lost = Math.max(0, remaining(dists[victim] as number[], home) - remaining(dists[victim] as number[], cell));
      if (victim === me) return -3 - lost * 1.5;
      const ahead = Array.from({ length: s.players }, (_, i) => i).filter((i) => i !== me).every((i) => i === victim || heroesHome(s, victim) >= heroesHome(s, i));
      return 2 + lost + (ahead ? 3 : 0) + heroesHome(s, victim) * 0.5;
    }
    let score = 0;
    for (let seat = 0; seat < s.players; seat++) {
      (s.heroes[seat] as readonly number[]).forEach((c, h) => {
        if (onGoal(s, seat, h)) return;
        const progress = Math.max(0, 40 - remaining(dists[seat] as number[], c));
        const near = 1 / (1 + manhattan(s, a.to, c));
        score += (seat === me ? -1 : 1) * near * progress * 0.12;
      });
    }
    return score;
  }
  // a wall: how much longer it makes the opponents' routes, and mine
  const walls = a.from === 'supply' ? [...s.walls, a.to] : s.walls.map((w) => (w === a.from ? a.to : w));
  const after: State = { ...s, walls };
  let score = 0;
  for (let seat = 0; seat < s.players; seat++) {
    const before = dists[seat] as number[];
    const next = distancesToGoal(after, seat);
    const weight = seat === me ? -1.6 : 1 + heroesHome(s, seat) * 0.5;
    (s.heroes[seat] as readonly number[]).forEach((c, h) => {
      if (onGoal(s, seat, h)) return;
      score += weight * (remaining(next, c) - remaining(before, c)) * (h === 0 ? 1 : 1);
    });
  }
  return score / HEROES_PER_PLAYER;
}

export function chooseAction(state: State, level: BotLevel, rng: Rng): Action {
  const legal = legalActions(state);
  if (legal.length === 0) throw new Error('There is no action to take.');
  if (nextRandom(rng) < RANDOM_PLAY[level]) return legal[Math.floor(nextRandom(rng) * legal.length)] as Action;
  const dists = Array.from({ length: state.players }, (_, seat) => distancesToGoal(state, seat));
  const danger = threatened(state);
  let best = legal[0] as Action;
  let bestScore = -Infinity;
  for (const a of legal) {
    const sc = scoreOf(state, a, dists, danger) + nextRandom(rng) * NOISE[level];
    if (sc > bestScore) {
      bestScore = sc;
      best = a;
    }
  }
  return best;
}
