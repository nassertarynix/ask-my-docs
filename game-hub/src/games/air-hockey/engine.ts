/**
 * Air Hockey: a puck slides on a low-friction table, bounces off the walls and the two paddles, and you score by
 * sending it into the other player's goal. Pure simulation: no DOM, no clock, no Math.random. The same inputs always
 * give the same game.
 *
 * Coordinates: x runs across the table (0 to WIDTH), y runs from the top (0) to the bottom (HEIGHT). Player 0 sits at
 * the bottom and attacks the goal at the top; player 1 sits at the top.
 * One tick is 1/60 s, advanced in SUBSTEPS smaller steps so the puck cannot jump through a paddle or a wall.
 */
export const WIDTH = 400;
export const HEIGHT = 700;
export const DT = 1 / 60;
export const SUBSTEPS = 4;

export const PUCK_R = 15;
export const PADDLE_R = 30;
export const GOAL_WIDTH = 150;
export const GOAL_LEFT = (WIDTH - GOAL_WIDTH) / 2;
export const GOAL_RIGHT = (WIDTH + GOAL_WIDTH) / 2;

/** The puck loses this fraction of its speed per second to friction. */
export const FRICTION = 0.32;
/** Speed kept after a bounce off a wall, and off a paddle (relative to the paddle). */
export const WALL_BOUNCE = 0.96;
export const PADDLE_BOUNCE = 0.92;
export const MAX_PUCK_SPEED = 1250;
/** A paddle can follow its target at up to this speed (px/s) unless a different limit is given. */
export const MAX_PADDLE_SPEED = 1500;
/** Seconds between a goal and the puck being released. */
export const SERVE_DELAY = 1.1;
/** A puck that has barely moved for this long is handed to the other player (no point scored), so a game cannot stall. */
export const STALL_LIMIT = 5;
export const STALL_SPEED = 20;

export type Player = 0 | 1;

export interface Puck {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
export interface Paddle {
  x: number;
  y: number;
  /** Velocity, worked out from how far the paddle moved this tick: what it hands to the puck on a hit. */
  vx: number;
  vy: number;
  /** Where the player wants the paddle to be. */
  tx: number;
  ty: number;
  /** The fastest it may move (px/s). */
  maxSpeed: number;
}

export type GameEvent =
  | { type: 'wall'; x: number; y: number; speed: number }
  | { type: 'paddle'; player: Player; x: number; y: number; speed: number }
  | { type: 'goal'; scorer: Player }
  | { type: 'serve'; to: Player }
  | { type: 'gameover'; winner: Player };

export interface State {
  puck: Puck;
  paddles: [Paddle, Paddle];
  scores: [number, number];
  phase: 'serve' | 'play' | 'over';
  /** Seconds left until the puck is released. */
  serveTimer: number;
  /** Who the puck was served to. */
  server: Player;
  /** Seconds the puck has been (nearly) still during play. */
  stillFor: number;
  winner: Player | null;
  target: number;
  tick: number;
  events: GameEvent[];
}

/** The y range a paddle may move in: its own half, with a gap at the centre line. */
export function paddleBounds(p: Player): { minX: number; maxX: number; minY: number; maxY: number } {
  const gap = 4;
  return p === 0
    ? { minX: PADDLE_R, maxX: WIDTH - PADDLE_R, minY: HEIGHT / 2 + PADDLE_R + gap, maxY: HEIGHT - PADDLE_R }
    : { minX: PADDLE_R, maxX: WIDTH - PADDLE_R, minY: PADDLE_R, maxY: HEIGHT / 2 - PADDLE_R - gap };
}

const homeOf = (p: Player): { x: number; y: number } => ({ x: WIDTH / 2, y: p === 0 ? HEIGHT - 90 : 90 });

function newPaddle(p: Player): Paddle {
  const h = homeOf(p);
  return { x: h.x, y: h.y, vx: 0, vy: 0, tx: h.x, ty: h.y, maxSpeed: MAX_PADDLE_SPEED };
}

export function createGame(target = 7): State {
  if (!Number.isInteger(target) || target < 1 || target > 21) throw new Error('A game is first to 1 to 21 goals.');
  return {
    puck: { x: WIDTH / 2, y: HEIGHT / 2 + 110, vx: 0, vy: 0 },
    paddles: [newPaddle(0), newPaddle(1)],
    scores: [0, 0],
    phase: 'serve',
    serveTimer: SERVE_DELAY,
    server: 0,
    stillFor: 0,
    winner: null,
    target,
    tick: 0,
    events: [],
  };
}

/** Say where a player wants their paddle. It is held inside its own half, and the paddle moves there at its top speed. */
export function setTarget(s: State, p: Player, x: number, y: number): void {
  const b = paddleBounds(p);
  const paddle = s.paddles[p];
  paddle.tx = Math.min(b.maxX, Math.max(b.minX, x));
  paddle.ty = Math.min(b.maxY, Math.max(b.minY, y));
}

export function setPaddleSpeed(s: State, p: Player, speed: number): void {
  s.paddles[p].maxSpeed = speed;
}

function clampSpeed(puck: Puck): void {
  const speed = Math.hypot(puck.vx, puck.vy);
  if (speed > MAX_PUCK_SPEED) {
    puck.vx *= MAX_PUCK_SPEED / speed;
    puck.vy *= MAX_PUCK_SPEED / speed;
  }
}

function movePaddle(p: Paddle, h: number, bounds: ReturnType<typeof paddleBounds>): void {
  const dx = p.tx - p.x;
  const dy = p.ty - p.y;
  const dist = Math.hypot(dx, dy);
  const step = Math.min(dist, p.maxSpeed * h);
  if (dist > 1e-9) {
    p.x += (dx / dist) * step;
    p.y += (dy / dist) * step;
  }
  p.x = Math.min(bounds.maxX, Math.max(bounds.minX, p.x));
  p.y = Math.min(bounds.maxY, Math.max(bounds.minY, p.y));
  p.vx = (dx / (dist || 1)) * (step / h);
  p.vy = (dy / (dist || 1)) * (step / h);
}

/** Bounce the puck off a paddle if they overlap. Returns the speed of the hit, or 0. */
function collide(puck: Puck, paddle: Paddle): number {
  const dx = puck.x - paddle.x;
  const dy = puck.y - paddle.y;
  const dist = Math.hypot(dx, dy);
  const reach = PUCK_R + PADDLE_R;
  if (dist >= reach) return 0;
  // the normal points from the paddle to the puck (straight up if they are exactly on top of each other)
  const nx = dist > 1e-9 ? dx / dist : 0;
  const ny = dist > 1e-9 ? dy / dist : paddle.y > HEIGHT / 2 ? -1 : 1;
  puck.x = paddle.x + nx * reach;
  puck.y = paddle.y + ny * reach;
  // the speed along the normal, relative to the paddle (which has "infinite" mass and carries its own velocity)
  const rel = (puck.vx - paddle.vx) * nx + (puck.vy - paddle.vy) * ny;
  if (rel < 0) {
    puck.vx -= (1 + PADDLE_BOUNCE) * rel * nx;
    puck.vy -= (1 + PADDLE_BOUNCE) * rel * ny;
  }
  clampSpeed(puck);
  return Math.hypot(puck.vx, puck.vy);
}

function goalScored(s: State, scorer: Player): void {
  s.scores[scorer] += 1;
  s.events.push({ type: 'goal', scorer });
  if (s.scores[scorer] >= s.target) {
    s.phase = 'over';
    s.winner = scorer;
    s.puck.vx = 0;
    s.puck.vy = 0;
    s.events.push({ type: 'gameover', winner: scorer });
    return;
  }
  // serve to the player who conceded
  const to: Player = scorer === 0 ? 1 : 0;
  serveTo(s, to, SERVE_DELAY);
}

/** Put the puck at rest on a player's half and hold it for a moment before play resumes. */
function serveTo(s: State, to: Player, delay: number): void {
  s.phase = 'serve';
  s.serveTimer = delay;
  s.server = to;
  s.stillFor = 0;
  s.puck = { x: WIDTH / 2, y: to === 0 ? HEIGHT / 2 + 110 : HEIGHT / 2 - 110, vx: 0, vy: 0 };
  s.events.push({ type: 'serve', to });
}

/** Advance one tick (1/60 s). */
export function step(s: State): void {
  if (s.phase === 'over') return;
  s.tick += 1;
  const h = DT / SUBSTEPS;
  const puck = s.puck;
  for (let i = 0; i < SUBSTEPS; i++) {
    movePaddle(s.paddles[0], h, paddleBounds(0));
    movePaddle(s.paddles[1], h, paddleBounds(1));
    if (s.phase === 'serve') continue;
    puck.x += puck.vx * h;
    puck.y += puck.vy * h;

    // side walls
    if (puck.x < PUCK_R) {
      puck.x = PUCK_R;
      if (puck.vx < 0) {
        s.events.push({ type: 'wall', x: puck.x, y: puck.y, speed: Math.abs(puck.vx) });
        puck.vx = -puck.vx * WALL_BOUNCE;
      }
    } else if (puck.x > WIDTH - PUCK_R) {
      puck.x = WIDTH - PUCK_R;
      if (puck.vx > 0) {
        s.events.push({ type: 'wall', x: puck.x, y: puck.y, speed: Math.abs(puck.vx) });
        puck.vx = -puck.vx * WALL_BOUNCE;
      }
    }
    // end walls, with a gap for each goal: a puck whose centre is between the posts goes through
    const inMouth = puck.x > GOAL_LEFT + PUCK_R * 0.4 && puck.x < GOAL_RIGHT - PUCK_R * 0.4;
    if (puck.y < PUCK_R && !inMouth) {
      puck.y = PUCK_R;
      if (puck.vy < 0) {
        s.events.push({ type: 'wall', x: puck.x, y: puck.y, speed: Math.abs(puck.vy) });
        puck.vy = -puck.vy * WALL_BOUNCE;
      }
    } else if (puck.y > HEIGHT - PUCK_R && !inMouth) {
      puck.y = HEIGHT - PUCK_R;
      if (puck.vy > 0) {
        s.events.push({ type: 'wall', x: puck.x, y: puck.y, speed: Math.abs(puck.vy) });
        puck.vy = -puck.vy * WALL_BOUNCE;
      }
    }
    if (puck.y < -PUCK_R) {
      goalScored(s, 0);
      return;
    }
    if (puck.y > HEIGHT + PUCK_R) {
      goalScored(s, 1);
      return;
    }

    for (const p of [0, 1] as Player[]) {
      const speed = collide(puck, s.paddles[p]);
      if (speed > 0) s.events.push({ type: 'paddle', player: p, x: puck.x, y: puck.y, speed });
    }
  }

  if (s.phase === 'serve') {
    s.serveTimer -= DT;
    if (s.serveTimer <= 0) s.phase = 'play';
  } else {
    const keep = Math.exp(-FRICTION * DT);
    puck.vx *= keep;
    puck.vy *= keep;
    // nobody is playing it: after a while the puck goes to the other player, as in the real game
    s.stillFor = Math.hypot(puck.vx, puck.vy) < STALL_SPEED ? s.stillFor + DT : 0;
    if (s.stillFor >= STALL_LIMIT) serveTo(s, puck.y > HEIGHT / 2 ? 1 : 0, SERVE_DELAY * 0.6);
  }
}

/**
 * Where the puck will cross the horizontal line y = `line` if nothing touches it, bouncing off the side walls on the
 * way. Returns null if it is not moving towards that line. Used by the computer player.
 */
export function predictCrossing(puck: Puck, line: number): { x: number; time: number } | null {
  if (Math.abs(puck.vy) < 1e-6) return null;
  const dy = line - puck.y;
  if (dy / puck.vy <= 0) return null; // moving away from the line
  // Friction slows both velocity components by the same factor, so the path is a straight line whatever the friction;
  // it only changes how long the trip takes (and the puck may stop before getting there).
  const remaining = 1 - (dy * FRICTION) / puck.vy;
  if (remaining <= 0) return null;
  const time = -Math.log(remaining) / FRICTION;
  const travel = puck.x + (puck.vx * dy) / puck.vy;
  // unfold the bounces: reflect the straight-line position back into the table
  const span = WIDTH - 2 * PUCK_R;
  let u = (travel - PUCK_R) % (2 * span);
  if (u < 0) u += 2 * span;
  const x = PUCK_R + (u <= span ? u : 2 * span - u);
  return { x, time };
}
