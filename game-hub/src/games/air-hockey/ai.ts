/**
 * The computer paddle. Each tick it looks at the table and says where it would like its paddle to be.
 * It sees only what a player sees: the puck's position and velocity, and its own paddle.
 *
 *   defending  it works out where an incoming puck will cross its defence line (bounces included) and goes there
 *   attacking  when the puck is slow on its half, it gets behind the puck and drives through it
 *
 * Difficulty changes how fast the paddle can move, how accurate its prediction is, whether it tracks the puck
 * ahead of time at all, and whether it aims its shots at the far corners of the goal.
 */
import { createRng, randomGaussian } from '../crater-lab/engine/rng';
import { GOAL_LEFT, GOAL_RIGHT, HEIGHT, PADDLE_R, PUCK_R, WIDTH, paddleBounds, predictCrossing, type Player, type State } from './engine';

export type Difficulty = 'easy' | 'normal' | 'hard';

interface Profile {
  /** Fastest the paddle may move (px/s). */
  speed: number;
  /** Standard deviation of the prediction error, px. */
  noise: number;
  /** Predicts where the puck will arrive (otherwise it just follows the puck's x). */
  predicts: boolean;
  /** Attacks only if the puck is moving slower than this (px/s). */
  attackBelow: number;
  /** Aims drives at the corners of the goal. */
  aims: boolean;
}

export const PROFILES: Record<Difficulty, Profile> = {
  easy: { speed: 430, noise: 38, predicts: false, attackBelow: 160, aims: false },
  normal: { speed: 820, noise: 20, predicts: true, attackBelow: 300, aims: false },
  hard: { speed: 1350, noise: 5, predicts: true, attackBelow: 520, aims: true },
};

export interface Target {
  x: number;
  y: number;
  speed: number;
}

/** Where player `p`'s paddle should head for. */
export function aiTarget(s: State, p: Player, difficulty: Difficulty): Target {
  const profile = PROFILES[difficulty];
  const puck = s.puck;
  const me = s.paddles[p];
  const toward = p === 1 ? 1 : -1; // the direction of the opponent's goal along y
  const defendY = p === 1 ? 80 : HEIGHT - 80;
  const ownHalf = p === 1 ? puck.y < HEIGHT / 2 : puck.y > HEIGHT / 2;
  const speed = Math.hypot(puck.vx, puck.vy);
  const comingAtMe = toward * puck.vy < -25;
  // the same slice of error for 0.5 s at a time, so the paddle does not jitter
  const rng = createRng((Math.floor(s.tick / 30) * 2654435761 + p * 97) >>> 0);
  const error = randomGaussian(rng) * profile.noise;

  const bounds = paddleBounds(p);
  const clampTarget = (x: number, y: number): Target => ({
    x: Math.min(bounds.maxX, Math.max(bounds.minX, x)),
    y: Math.min(bounds.maxY, Math.max(bounds.minY, y)),
    speed: profile.speed,
  });

  const infrontOfPaddle = toward * (puck.y - me.y) > 2; // the puck is between the paddle and the opponent's goal
  const dangerous = comingAtMe && speed > profile.attackBelow * 1.4;

  if (ownHalf && !dangerous && speed < profile.attackBelow && s.phase !== 'over') {
    if (infrontOfPaddle) {
      // drive through the puck, towards the opponent's goal (or a corner of it, when aiming)
      let aimX = WIDTH / 2;
      if (profile.aims) aimX = puck.x < WIDTH / 2 ? GOAL_RIGHT - 25 : GOAL_LEFT + 25; // cross-table, away from the puck's side
      const goalY = p === 1 ? HEIGHT : 0;
      const dx = aimX - puck.x;
      const dy = goalY - puck.y;
      const len = Math.hypot(dx, dy) || 1;
      const reach = PADDLE_R + PUCK_R;
      // stand just behind the puck on the line to the aim point, then go through it
      const behindX = puck.x - (dx / len) * (reach - 6);
      const behindY = puck.y - (dy / len) * (reach - 6);
      const close = Math.hypot(me.x - behindX, me.y - behindY) < 22;
      return close ? clampTarget(puck.x + (dx / len) * 60, puck.y + (dy / len) * 60) : clampTarget(behindX, behindY);
    }
    // the puck is behind the paddle (nearer our own goal): swing round to the far side of it first
    return clampTarget(puck.x + (puck.x < WIDTH / 2 ? 70 : -70), puck.y - toward * 40);
  }

  // defend: go where the puck is going to cross the defence line
  if (profile.predicts && comingAtMe) {
    const hit = predictCrossing(puck, defendY);
    if (hit) return clampTarget(hit.x + error, defendY);
  }
  // otherwise shadow the puck from a central position near the goal
  const follow = profile.predicts ? 0.9 : 1;
  return clampTarget(WIDTH / 2 + (puck.x - WIDTH / 2) * follow + error * 0.5, defendY);
}

/** Apply the AI's choice to the game for player p. */
export function steerAi(s: State, p: Player, difficulty: Difficulty): void {
  const t = aiTarget(s, p, difficulty);
  s.paddles[p].maxSpeed = t.speed;
  s.paddles[p].tx = t.x;
  s.paddles[p].ty = t.y;
}
