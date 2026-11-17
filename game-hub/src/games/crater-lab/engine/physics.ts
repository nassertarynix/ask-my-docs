/**
 * Flight: how a projectile moves, what it runs into, how it bounces and splits.
 *
 * `advanceFlight` is the single place projectiles move. The live game calls it once per tick and
 * `simulateShot` calls it in a loop, so the AI's plan and the aim preview are computed by exactly
 * the code that will later fly the real shot. Nothing here changes the terrain or hurts a tank:
 * it only reports what happened, and the caller decides what a detonation does.
 */
import {
  BARREL_LENGTH,
  DRAG,
  DT,
  GRAVITY,
  MAX_FLIGHT_TICKS,
  OUT_OF_BOUNDS_MARGIN,
  SPEED_PER_POWER,
  SUBSTEPS,
  TANK_HALF_WIDTH,
  TANK_HEIGHT,
  type PlayerIndex,
  type Projectile,
  type Tank,
  type WeaponId,
  type World,
} from './types';
import { groundY, surfaceSlope } from './terrain';

/** A rubber bomb bounces this many times, then goes off on the next touch. */
export const MAX_BOUNCES = 3;
/** Speed kept along the surface normal after a bounce. */
export const BOUNCE_RESTITUTION = 0.62;
/** Speed kept along the surface after a bounce. */
export const BOUNCE_FRICTION = 0.9;
/** The three fragments of a split shell leave at these angles from the shell's heading. */
export const SPLIT_ANGLES_DEG: readonly number[] = [-12, 0, 12];
/** A black hole pulls projectiles closer than this (px)... */
export const PULL_RANGE = 230;
/** ...with at most this acceleration (px/s²), fading to nothing at the edge of its range. */
export const PULL_STRENGTH = 620;

export interface Point {
  x: number;
  y: number;
}

const DEG = Math.PI / 180;

/** Where the barrel pivots: the middle of the tank's roof. */
export function barrelPivot(tank: Pick<Tank, 'x' | 'y'>): Point {
  return { x: tank.x, y: tank.y - TANK_HEIGHT };
}

/** Where a shot leaves the barrel. */
export function muzzlePosition(tank: Pick<Tank, 'x' | 'y'>, angleDeg: number): Point {
  const p = barrelPivot(tank);
  return { x: p.x + Math.cos(angleDeg * DEG) * BARREL_LENGTH, y: p.y - Math.sin(angleDeg * DEG) * BARREL_LENGTH };
}

/** Velocity of a shot fired at `angleDeg` (0 right, 90 up, 180 left) with `power` 0..100. */
export function launchVelocity(angleDeg: number, power: number): Point {
  const speed = power * SPEED_PER_POWER;
  return { x: Math.cos(angleDeg * DEG) * speed, y: -Math.sin(angleDeg * DEG) * speed };
}

export function createProjectile(
  id: number,
  shooter: Pick<Tank, 'x' | 'y' | 'index'>,
  angleDeg: number,
  power: number,
  weapon: WeaponId,
  autoSplit: boolean,
): Projectile {
  const at = muzzlePosition(shooter, angleDeg);
  const v = launchVelocity(angleDeg, power);
  return {
    id,
    weapon,
    owner: shooter.index,
    x: at.x,
    y: at.y,
    vx: v.x,
    vy: v.y,
    age: 0,
    bounces: 0,
    canSplit: weapon === 'splitter',
    autoSplit,
    fragment: false,
  };
}

/**
 * One integration step of length h seconds (semi-implicit Euler: velocity first, then position).
 * Forces: gravity down, wind sideways, a little drag against the motion, plus anything extra (a black hole).
 */
export function integrate(p: Projectile, wind: number, h: number, extraAx = 0, extraAy = 0): void {
  p.vx += (wind - DRAG * p.vx + extraAx) * h;
  p.vy += (GRAVITY - DRAG * p.vy + extraAy) * h;
  p.x += p.vx * h;
  p.y += p.vy * h;
}

/** Which living tank, if any, contains the point. */
export function tankAt(tanks: readonly Tank[], x: number, y: number): Tank | null {
  for (const t of tanks) {
    if (t.hp <= 0) continue;
    if (Math.abs(x - t.x) <= TANK_HALF_WIDTH && y >= t.y - TANK_HEIGHT && y <= t.y) return t;
  }
  return null;
}

/** Reflect a projectile off the ground it has just touched, losing some speed. */
export function bounceOffTerrain(p: Projectile, terrain: Float32Array, worldHeight: number): void {
  const s = surfaceSlope(terrain, p.x);
  const len = Math.hypot(1, s);
  const tx = 1 / len;
  const ty = s / len;
  const nx = s / len; // normal pointing out of the ground (up on flat ground)
  const ny = -1 / len;
  const along = p.vx * tx + p.vy * ty;
  const into = p.vx * nx + p.vy * ny; // negative while moving into the ground
  const out = Math.abs(into) * BOUNCE_RESTITUTION;
  p.vx = tx * along * BOUNCE_FRICTION + nx * out;
  p.vy = ty * along * BOUNCE_FRICTION + ny * out;
  p.y = groundY(terrain, worldHeight, p.x) - 0.75;
  p.bounces += 1;
}

/** The three fragments a split shell turns into. */
export function splitProjectile(p: Projectile, firstId: number): Projectile[] {
  const speed = Math.hypot(p.vx, p.vy);
  const heading = Math.atan2(p.vy, p.vx);
  return SPLIT_ANGLES_DEG.map((deg, i) => ({
    ...p,
    id: firstId + i,
    vx: Math.cos(heading + deg * DEG) * speed,
    vy: Math.sin(heading + deg * DEG) * speed,
    canSplit: false,
    autoSplit: false,
    fragment: true,
  }));
}

export type FlightEvent =
  | { type: 'detonate'; projectile: Projectile; x: number; y: number; tank: PlayerIndex | null }
  | { type: 'bounce'; projectile: Projectile; x: number; y: number }
  | { type: 'split'; projectile: Projectile; x: number; y: number }
  | { type: 'out'; projectile: Projectile; x: number; y: number };

/**
 * Move every projectile forward by one tick, in SUBSTEPS smaller steps so that even the fastest
 * shell (about 2 px per sub-step) cannot pass through a thin ridge or a tank between checks.
 * The array is updated in place: detonated and lost projectiles are removed, split shells are
 * replaced by their fragments. `pulls` are active black holes.
 */
export function advanceFlight(
  projectiles: Projectile[],
  world: World,
  nextId: { value: number },
  pulls: readonly Point[] = [],
): FlightEvent[] {
  const events: FlightEvent[] = [];
  const h = DT / SUBSTEPS;
  const survivors: Projectile[] = [];

  for (const p of projectiles) {
    let alive = true;
    const risingBefore = p.vy < 0;
    for (let s = 0; s < SUBSTEPS && alive; s++) {
      let ax = 0;
      let ay = 0;
      for (const hole of pulls) {
        const dx = hole.x - p.x;
        const dy = hole.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d < PULL_RANGE && d > 1) {
          const a = PULL_STRENGTH * (1 - d / PULL_RANGE);
          ax += (dx / d) * a;
          ay += (dy / d) * a;
        }
      }
      integrate(p, world.wind, h, ax, ay);

      const hit = tankAt(world.tanks, p.x, p.y);
      if (hit) {
        events.push({ type: 'detonate', projectile: p, x: p.x, y: p.y, tank: hit.index });
        alive = false;
        break;
      }
      const ground = groundY(world.terrain, world.height, p.x);
      if (p.y >= ground) {
        if (p.weapon === 'bouncer' && p.bounces < MAX_BOUNCES) {
          bounceOffTerrain(p, world.terrain, world.height);
          events.push({ type: 'bounce', projectile: p, x: p.x, y: p.y });
          continue;
        }
        // A normal landing is a pixel or two past the surface: snap it onto the surface. A shell that is
        // deep inside the ground (fired from a barrel that has been buried) goes off where it is.
        events.push({ type: 'detonate', projectile: p, x: p.x, y: p.y - ground <= 3 ? ground : p.y, tank: null });
        alive = false;
        break;
      }
      if (p.x < -OUT_OF_BOUNDS_MARGIN || p.x > world.width + OUT_OF_BOUNDS_MARGIN || p.y > world.height + OUT_OF_BOUNDS_MARGIN) {
        events.push({ type: 'out', projectile: p, x: p.x, y: p.y });
        alive = false;
        break;
      }
    }
    if (!alive) continue;
    p.age += 1;
    if (p.age >= MAX_FLIGHT_TICKS) {
      events.push({ type: 'out', projectile: p, x: p.x, y: p.y });
      continue;
    }
    // a self-splitting shell splits on the tick it stops rising: the top of its arc
    if (p.canSplit && p.autoSplit && risingBefore && p.vy >= 0) {
      events.push({ type: 'split', projectile: p, x: p.x, y: p.y });
      const parts = splitProjectile(p, nextId.value);
      nextId.value += parts.length;
      survivors.push(...parts);
      continue;
    }
    survivors.push(p);
  }
  projectiles.length = 0;
  projectiles.push(...survivors);
  return events;
}

export interface Impact {
  x: number;
  y: number;
  /** The tank that was hit directly, if any. */
  tank: PlayerIndex | null;
  /** A fragment of a split shell. */
  fragment: boolean;
  /** The projectile left the world instead of landing. */
  out: boolean;
}

export interface ShotResult {
  /** Position of the shell at each tick up to its first split or impact (bounces included). */
  path: Point[];
  /** Where each warhead ended up (three for a shell that split). */
  impacts: Impact[];
  /** Ticks until the last warhead was done. */
  ticks: number;
}

export interface ShotOptions {
  /** Split a tri-splitter at the top of its arc. */
  autoSplit?: boolean;
  /** Stop after this many ticks (used for the short aim preview). */
  maxTicks?: number;
  /** Skip recording the path (the AI's search only needs where things land). */
  skipPath?: boolean;
}

/**
 * Fly a shot to the end without touching the world: no craters, no damage. This is what the AI
 * searches over and what the dotted aim preview draws.
 */
export function simulateShot(
  world: World,
  shooter: Pick<Tank, 'x' | 'y' | 'index'>,
  angleDeg: number,
  power: number,
  weapon: WeaponId,
  options: ShotOptions = {},
): ShotResult {
  const first = createProjectile(0, shooter, angleDeg, power, weapon, options.autoSplit ?? false);
  const projectiles: Projectile[] = [first];
  const nextId = { value: 1 };
  const path: Point[] = [{ x: first.x, y: first.y }];
  const impacts: Impact[] = [];
  const limit = options.maxTicks ?? MAX_FLIGHT_TICKS + 1;
  let tracking = !options.skipPath;
  let ticks = 0;
  while (projectiles.length > 0 && ticks < limit) {
    ticks++;
    const events = advanceFlight(projectiles, world, nextId);
    for (const e of events) {
      if (e.type === 'detonate') impacts.push({ x: e.x, y: e.y, tank: e.tank, fragment: e.projectile.fragment, out: false });
      else if (e.type === 'out') impacts.push({ x: e.x, y: e.y, tank: null, fragment: e.projectile.fragment, out: true });
      if (e.projectile === first && e.type !== 'bounce') {
        if (tracking) path.push({ x: e.x, y: e.y });
        tracking = false;
      }
    }
    if (tracking) path.push({ x: first.x, y: first.y });
  }
  return { path, impacts, ticks };
}
