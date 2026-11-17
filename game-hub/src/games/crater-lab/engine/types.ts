/**
 * CRATER // LAB engine types and constants.
 *
 * The engine is a plain, deterministic simulation: no DOM, no canvas, no clock, no Math.random.
 * Everything that happens is a function of the starting seed and the players' inputs, which is
 * what lets the AI plan by running the very same code, and lets the tests assert exact numbers.
 *
 * Coordinates are screen-style: x grows to the right, y grows DOWN. The terrain is stored the
 * natural way round, as an elevation above the bottom edge, so "carving a crater" lowers a number.
 */

/** Logical world size in pixels. The canvas scales this to whatever space it gets. */
export const WORLD_WIDTH = 1200;
export const WORLD_HEIGHT = 600;

/** Fixed timestep: one engine tick is always 1/60 s, whatever the display refresh rate is. */
export const DT = 1 / 60;
/** Each tick moves projectiles in this many smaller steps, so a fast shell cannot skip a thin ridge. */
export const SUBSTEPS = 4;

/** Gravity, px/s². */
export const GRAVITY = 180;
/** Air drag, 1/s (a = -DRAG * v). Small: it bends long shots slightly and bounds top speed. */
export const DRAG = 0.02;
/** Wind is a horizontal acceleration in px/s², re-rolled every turn inside [-MAX_WIND, +MAX_WIND]. */
export const MAX_WIND = 15;
/** Muzzle speed in px/s at power 1 (power runs 0..100). */
export const SPEED_PER_POWER = 5.2;
export const MIN_POWER = 5;
export const MAX_POWER = 100;

export const TANK_HALF_WIDTH = 14;
export const TANK_HEIGHT = 12;
export const BARREL_LENGTH = 20;
export const TANK_MAX_HP = 100;

/**
 * A tank that drops further than this (px) is hurt by the landing. It is deliberately deeper than the
 * biggest crater, so sliding into the hole a shell just dug is free and only real falls (off a ledge,
 * down a pit dug by several hits) cost anything.
 */
export const FALL_DAMAGE_THRESHOLD = 48;
export const FALL_DAMAGE_PER_PX = 0.35;
export const FALL_DAMAGE_MAX = 30;

/** Terrain never goes below this elevation (bedrock) or above this one (so the sky stays playable). */
export const MIN_ELEVATION = 12;
export const MAX_ELEVATION = WORLD_HEIGHT - 110;

/** A projectile this far outside the world is gone (a miss). */
export const OUT_OF_BOUNDS_MARGIN = 120;
/** Safety net: no shot may fly longer than this many ticks (30 s). */
export const MAX_FLIGHT_TICKS = 1800;

export type WeaponId = 'standard' | 'splitter' | 'mound' | 'blackhole' | 'bouncer';
export const WEAPON_IDS: readonly WeaponId[] = ['standard', 'splitter', 'mound', 'blackhole', 'bouncer'];

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** One line shown in the weapon bar. */
  blurb: string;
  /** Shots per match; Infinity for the standard shell. */
  ammo: number;
  /** Crater radius in px (0 = carves nothing). */
  craterRadius: number;
  /** Damage at the centre of the blast, falling off linearly to 0 at `blastRadius`. */
  damage: number;
  blastRadius: number;
}

export type PlayerIndex = 0 | 1;

export interface Tank {
  index: PlayerIndex;
  /** Centre of the tank's base. */
  x: number;
  /** Screen y of the tank's base (where the tracks touch the ground). */
  y: number;
  /** Downward speed while falling, px/s. */
  vy: number;
  falling: boolean;
  /** Where the current fall started, to work out fall damage on landing. */
  fallStartY: number;
  hp: number;
  /** Barrel angle in degrees: 0 points right, 90 straight up, 180 left. */
  angle: number;
  /** 0..100. */
  power: number;
  weapon: WeaponId;
  ammo: Record<WeaponId, number>;
}

export interface Projectile {
  id: number;
  weapon: WeaponId;
  owner: PlayerIndex;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Ticks since it was fired. */
  age: number;
  /** Terrain bounces so far (rubber bomb). */
  bounces: number;
  /** A tri-splitter that has not split yet. */
  canSplit: boolean;
  /** Split by itself at the top of the arc (the AI's shots, and trajectory planning). */
  autoSplit: boolean;
  /** A fragment of a split shell (smaller blast). */
  fragment: boolean;
}

/** A black hole that has landed and is pulling things in before it implodes. */
export interface Singularity {
  owner: PlayerIndex;
  x: number;
  y: number;
  /** Ticks left before the implosion. */
  ticksLeft: number;
}

export type Phase = 'aim' | 'flight' | 'settle' | 'over';
export type Winner = PlayerIndex | 'draw' | null;

/** Things the renderer and the sound engine react to. The engine only appends; the UI drains. */
export type GameEvent =
  | { type: 'fire'; owner: PlayerIndex; weapon: WeaponId; x: number; y: number; power: number }
  | { type: 'explosion'; weapon: WeaponId; x: number; y: number; radius: number }
  | { type: 'mound'; x: number; y: number; radius: number }
  | { type: 'bounce'; x: number; y: number }
  | { type: 'split'; x: number; y: number }
  | { type: 'singularity'; x: number; y: number }
  | { type: 'implosion'; x: number; y: number; radius: number }
  | { type: 'damage'; tank: PlayerIndex; amount: number; x: number; y: number; direct: boolean; cause: 'blast' | 'fall' }
  | { type: 'miss'; x: number; y: number }
  | { type: 'turn'; current: PlayerIndex; wind: number }
  | { type: 'gameover'; winner: Winner };

export interface GameState {
  width: number;
  height: number;
  /** Elevation of the ground above the bottom edge, one value per pixel column. */
  terrain: Float32Array;
  tanks: [Tank, Tank];
  current: PlayerIndex;
  /** Horizontal acceleration on every projectile this turn, px/s². */
  wind: number;
  phase: Phase;
  projectiles: Projectile[];
  singularities: Singularity[];
  tick: number;
  turn: number;
  winner: Winner;
  /** State of the seeded random generator (wind, terrain). */
  rng: number;
  nextProjectileId: number;
  events: GameEvent[];
}

/** The part of the world a projectile needs to fly: enough for the game, the AI and the aim preview. */
export interface World {
  width: number;
  height: number;
  terrain: Float32Array;
  tanks: readonly Tank[];
  wind: number;
}
