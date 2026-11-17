/**
 * The ground: a 1D heightmap (one elevation per pixel column), how explosions reshape it,
 * and how tanks come to rest on it.
 *
 * A heightmap cannot hold caves or overhangs. That is a deliberate trade: when a blast removes
 * a slice out of the middle of a column, whatever was above it drops straight down, which is
 * both the classic artillery-game look and far cheaper than a pixel grid.
 */
import {
  DT,
  FALL_DAMAGE_MAX,
  FALL_DAMAGE_PER_PX,
  FALL_DAMAGE_THRESHOLD,
  GRAVITY,
  MAX_ELEVATION,
  MIN_ELEVATION,
  TANK_HALF_WIDTH,
  WORLD_WIDTH,
  type Tank,
} from './types';
import { nextRandom, randomBetween, type Rng } from './rng';

/** Where the two tanks start. */
export const SPAWN_X: readonly [number, number] = [130, WORLD_WIDTH - 130];
const PAD_FLAT = 34; // half-width that is completely level
const PAD_BLEND = 78; // half-width over which the pad fades back into the hills

function clampElevation(h: number): number {
  return Math.min(MAX_ELEVATION, Math.max(MIN_ELEVATION, h));
}

function smoothstep(t: number): number {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
}

/**
 * Rolling hills from a few sine waves, roughened with midpoint displacement, then gently blurred
 * so there are no one-pixel spikes. Each spawn point gets a level pad so nobody starts on a cliff.
 */
export function generateTerrain(rng: Rng, width: number = WORLD_WIDTH): Float32Array {
  const terrain = new Float32Array(width);

  // 1) multi-octave sines: the big shapes
  const octaves = [
    { amp: randomBetween(rng, 45, 75), freq: randomBetween(rng, 0.8, 1.6), phase: randomBetween(rng, 0, Math.PI * 2) },
    { amp: randomBetween(rng, 20, 36), freq: randomBetween(rng, 2.2, 3.8), phase: randomBetween(rng, 0, Math.PI * 2) },
    { amp: randomBetween(rng, 8, 16), freq: randomBetween(rng, 5, 8), phase: randomBetween(rng, 0, Math.PI * 2) },
  ];
  const base = randomBetween(rng, 170, 215);

  // 2) midpoint displacement on a power-of-two grid: the irregular detail
  const size = 257;
  const rough = new Float32Array(size);
  let step = size - 1;
  let amplitude = 46;
  while (step > 1) {
    const half = step >> 1;
    for (let i = half; i < size; i += step) {
      const left = rough[i - half] ?? 0;
      const right = rough[i + half] ?? 0;
      rough[i] = (left + right) / 2 + (nextRandom(rng) * 2 - 1) * amplitude;
    }
    amplitude *= 0.55;
    step = half;
  }

  for (let x = 0; x < width; x++) {
    const u = x / (width - 1);
    let h = base;
    for (const o of octaves) h += o.amp * Math.sin(u * Math.PI * 2 * o.freq + o.phase);
    const g = u * (size - 1);
    const gi = Math.min(size - 2, Math.floor(g));
    const gt = g - gi;
    h += (rough[gi] ?? 0) * (1 - gt) + (rough[gi + 1] ?? 0) * gt;
    terrain[x] = h;
  }

  // 3) a light blur
  for (let pass = 0; pass < 3; pass++) {
    let prev = terrain[0] ?? 0;
    for (let x = 1; x < width - 1; x++) {
      const here = terrain[x] ?? 0;
      const next = terrain[x + 1] ?? 0;
      terrain[x] = (prev + here * 2 + next) / 4;
      prev = here;
    }
  }
  for (let x = 0; x < width; x++) terrain[x] = clampElevation(terrain[x] ?? 0);

  // 4) spawn pads: level in the middle, blended into the hills at the edges
  for (const sx of SPAWN_X) {
    let sum = 0;
    let count = 0;
    for (let x = Math.round(sx - PAD_FLAT); x <= Math.round(sx + PAD_FLAT); x++) {
      sum += terrain[x] ?? 0;
      count++;
    }
    const level = clampElevation(Math.min(sum / count, MAX_ELEVATION - 60));
    for (let x = Math.round(sx - PAD_BLEND); x <= Math.round(sx + PAD_BLEND); x++) {
      if (x < 0 || x >= width) continue;
      const d = Math.abs(x - sx);
      const keep = smoothstep((d - PAD_FLAT) / (PAD_BLEND - PAD_FLAT)); // 0 on the pad, 1 outside it
      terrain[x] = level * (1 - keep) + (terrain[x] ?? 0) * keep;
    }
  }
  return terrain;
}

/** Elevation at any x (linear between columns; the edge columns extend outwards). */
export function elevationAt(terrain: Float32Array, x: number): number {
  const last = terrain.length - 1;
  if (x <= 0) return terrain[0] ?? 0;
  if (x >= last) return terrain[last] ?? 0;
  const i = Math.floor(x);
  const t = x - i;
  return (terrain[i] ?? 0) * (1 - t) + (terrain[i + 1] ?? 0) * t;
}

/** Screen y of the ground surface at x. */
export function groundY(terrain: Float32Array, worldHeight: number, x: number): number {
  return worldHeight - elevationAt(terrain, x);
}

/** Slope of the surface in screen space (dy/dx): positive means the ground goes down to the right. */
export function surfaceSlope(terrain: Float32Array, x: number): number {
  return -(elevationAt(terrain, x + 2) - elevationAt(terrain, x - 2)) / 4;
}

export interface CraterResult {
  /** Total elevation removed, in px² (a cross-section area). */
  removed: number;
  /** Total elevation added by the raised rim, in px². */
  raised: number;
}

/**
 * Subtract a circle from the ground. For a column at horizontal distance dx from the centre the
 * circle spans elevations (centre ± sqrt(r² - dx²)); whatever ground lies inside that span is removed
 * and anything above it drops down. A low lip is pushed up just outside the rim, where the blast
 * was close to the surface, so craters read as craters rather than as clean bites.
 */
export function carveCrater(
  terrain: Float32Array,
  worldHeight: number,
  cx: number,
  cy: number,
  radius: number,
  lipHeight: number = radius * 0.12,
): CraterResult {
  const centre = worldHeight - cy; // elevation of the blast centre
  const lipOuter = radius * 1.45;
  const from = Math.max(0, Math.floor(cx - lipOuter));
  const to = Math.min(terrain.length - 1, Math.ceil(cx + lipOuter));
  let removed = 0;
  let raised = 0;
  for (let x = from; x <= to; x++) {
    const dx = Math.abs(x - cx);
    const h = terrain[x] ?? 0;
    if (dx <= radius) {
      const half = Math.sqrt(radius * radius - dx * dx);
      const top = Math.min(h, centre + half);
      const bottom = Math.max(MIN_ELEVATION, centre - half);
      const cut = top - bottom;
      if (cut > 0) {
        terrain[x] = h - cut;
        removed += cut;
      }
    } else if (lipHeight > 0 && Math.abs(h - centre) < radius) {
      const t = (dx - radius) / (lipOuter - radius);
      const lift = Math.min(lipHeight * Math.sin(Math.PI * t), MAX_ELEVATION - h);
      if (lift > 0) {
        terrain[x] = h + lift;
        raised += lift;
      }
    }
  }
  return { removed, raised };
}

/** A column range that new dirt must not fill (a tank is standing there). */
export interface KeepClear {
  x: number;
  halfWidth: number;
}

/**
 * Pile a hill of dirt centred on cx: a raised-cosine profile, `height` tall in the middle and
 * `radius` wide each side. Dirt does not land inside a tank's footprint, so a mound dropped on a
 * tank walls it in rather than lifting it: its low shots now hit its own wall.
 * Returns the total elevation added, in px².
 */
export function addMound(
  terrain: Float32Array,
  cx: number,
  radius: number,
  height: number,
  keepClear: readonly KeepClear[] = [],
): number {
  const from = Math.max(0, Math.floor(cx - radius));
  const to = Math.min(terrain.length - 1, Math.ceil(cx + radius));
  let added = 0;
  for (let x = from; x <= to; x++) {
    const dx = Math.abs(x - cx);
    if (dx >= radius) continue;
    let lift = height * 0.5 * (1 + Math.cos((Math.PI * dx) / radius));
    for (const k of keepClear) {
      // nothing inside the footprint, fading in over the next few pixels
      lift *= smoothstep((Math.abs(x - k.x) - k.halfWidth) / 6);
    }
    const h = terrain[x] ?? 0;
    const next = Math.min(MAX_ELEVATION, h + lift);
    if (next > h) {
      terrain[x] = next;
      added += next - h;
    }
  }
  return added;
}

/** Screen y a tank at x rests at: on the highest ground under its tracks, so it never sinks into a slope. */
export function restingY(terrain: Float32Array, worldHeight: number, x: number): number {
  const reach = TANK_HALF_WIDTH - 6;
  const elevation = Math.max(elevationAt(terrain, x - reach), elevationAt(terrain, x), elevationAt(terrain, x + reach));
  return worldHeight - elevation;
}

/** Damage for landing after dropping `drop` pixels (0 for a short drop). */
export function fallDamage(drop: number): number {
  if (drop <= FALL_DAMAGE_THRESHOLD) return 0;
  return Math.max(1, Math.min(FALL_DAMAGE_MAX, Math.round((drop - FALL_DAMAGE_THRESHOLD) * FALL_DAMAGE_PER_PX)));
}

export interface Landing {
  /** How far the tank fell, px. */
  drop: number;
  damage: number;
}

/**
 * Advance one tank by one tick. A tank with air under it falls under gravity (it does not teleport),
 * and when it lands the height of the whole fall decides the damage. If the ground rose under it
 * (a crater's rim), it is lifted with the ground. Returns the landing on the tick the tank touches down.
 */
export function settleTank(tank: Tank, terrain: Float32Array, worldHeight: number): Landing | null {
  const rest = restingY(terrain, worldHeight, tank.x);
  if (tank.y < rest - 0.01) {
    if (!tank.falling) {
      tank.falling = true;
      tank.fallStartY = tank.y;
      tank.vy = 0;
    }
    tank.vy += GRAVITY * DT;
    tank.y += tank.vy * DT;
    if (tank.y < rest) return null;
    tank.y = rest;
    tank.falling = false;
    tank.vy = 0;
    const drop = rest - tank.fallStartY;
    return { drop, damage: fallDamage(drop) };
  }
  tank.y = rest;
  if (tank.falling) {
    // the ground came up to meet it mid-fall
    tank.falling = false;
    tank.vy = 0;
    const drop = Math.max(0, rest - tank.fallStartY);
    return { drop, damage: fallDamage(drop) };
  }
  return null;
}
