/**
 * The match: whose turn it is, firing, and the tick that moves everything forward.
 *
 *   aim  --fire-->  flight  --nothing left in the air-->  settle  --tanks at rest-->  aim (other player)
 *                                                                              \--> over (someone is out)
 *
 * The state is mutated in place (the terrain is a typed array, copying it 60 times a second would be
 * wasteful). Call `step` at a fixed 60 Hz; the UI reads the state and drains `state.events`.
 */
import {
  MAX_POWER,
  MAX_WIND,
  MIN_POWER,
  TANK_MAX_HP,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type GameState,
  type PlayerIndex,
  type Tank,
  type WeaponId,
  type World,
} from './types';
import { createRng, randomBetween } from './rng';
import { SPAWN_X, generateTerrain, restingY, settleTank } from './terrain';
import { advanceFlight, createProjectile, muzzlePosition, splitProjectile } from './physics';
import { damageTank, detonate, startingAmmo, updateSingularities } from './weapons';

export interface GameOptions {
  seed: number;
}

function createTank(index: PlayerIndex, terrain: Float32Array): Tank {
  const x = SPAWN_X[index];
  return {
    index,
    x,
    y: restingY(terrain, WORLD_HEIGHT, x),
    vy: 0,
    falling: false,
    fallStartY: 0,
    hp: TANK_MAX_HP,
    angle: index === 0 ? 60 : 120,
    power: 55,
    weapon: 'standard',
    ammo: startingAmmo(),
  };
}

/** Wind for a new turn: anywhere in [-MAX_WIND, +MAX_WIND], to one decimal place. */
function rollWind(state: Pick<GameState, 'rng'>): number {
  const rng = { state: state.rng };
  const wind = Math.round(randomBetween(rng, -MAX_WIND, MAX_WIND) * 10) / 10;
  state.rng = rng.state;
  return wind;
}

export function createGame(options: GameOptions): GameState {
  const rng = createRng(options.seed);
  const terrain = generateTerrain(rng, WORLD_WIDTH);
  const state: GameState = {
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    terrain,
    tanks: [createTank(0, terrain), createTank(1, terrain)],
    current: 0,
    wind: 0,
    phase: 'aim',
    projectiles: [],
    singularities: [],
    tick: 0,
    turn: 1,
    winner: null,
    rng: rng.state,
    nextProjectileId: 1,
    events: [],
  };
  state.wind = rollWind(state);
  return state;
}

/** The slice of the state a projectile needs. Shares the terrain and tanks; it is a view, not a copy. */
export function worldOf(state: GameState): World {
  return { width: state.width, height: state.height, terrain: state.terrain, tanks: state.tanks, wind: state.wind };
}

export function clampAngle(angle: number): number {
  return Math.min(180, Math.max(0, angle));
}

export function clampPower(power: number): number {
  return Math.min(MAX_POWER, Math.max(MIN_POWER, power));
}

/** Set the current player's aim. Ignored outside the aim phase. */
export function setAim(state: GameState, angle: number, power: number): void {
  if (state.phase !== 'aim') return;
  const tank = state.tanks[state.current];
  tank.angle = clampAngle(angle);
  tank.power = clampPower(power);
}

/** Choose the current player's ammo. Returns false if there is none left. */
export function selectWeapon(state: GameState, weapon: WeaponId): boolean {
  if (state.phase !== 'aim') return false;
  const tank = state.tanks[state.current];
  if (tank.ammo[weapon] <= 0) return false;
  tank.weapon = weapon;
  return true;
}

export interface FireOptions {
  /** Split a Tri-Splitter by itself at the top of its arc (the AI does this; a person presses fire again). */
  autoSplit?: boolean;
}

/** Fire the current player's selected weapon with their current aim. Returns false if it could not fire. */
export function fire(state: GameState, options: FireOptions = {}): boolean {
  if (state.phase !== 'aim') return false;
  const tank = state.tanks[state.current];
  if (tank.hp <= 0 || tank.ammo[tank.weapon] <= 0) return false;
  tank.ammo[tank.weapon] -= 1;
  const p = createProjectile(state.nextProjectileId++, tank, tank.angle, tank.power, tank.weapon, options.autoSplit ?? false);
  state.projectiles.push(p);
  const at = muzzlePosition(tank, tank.angle);
  state.events.push({ type: 'fire', owner: tank.index, weapon: tank.weapon, x: at.x, y: at.y, power: tank.power });
  state.phase = 'flight';
  return true;
}

/** Split any Tri-Splitter that is in the air and has not split yet. Returns true if one did. */
export function triggerSplit(state: GameState): boolean {
  if (state.phase !== 'flight') return false;
  let split = false;
  const next = [];
  for (const p of state.projectiles) {
    if (!p.canSplit) {
      next.push(p);
      continue;
    }
    state.events.push({ type: 'split', x: p.x, y: p.y });
    next.push(...splitProjectile(p, state.nextProjectileId));
    state.nextProjectileId += 3;
    split = true;
  }
  state.projectiles = next;
  return split;
}

/** True while a Tri-Splitter is in the air waiting to be split. */
export function canSplitNow(state: GameState): boolean {
  return state.phase === 'flight' && state.projectiles.some((p) => p.canSplit);
}

function settleTanks(state: GameState): boolean {
  let anyFalling = false;
  for (const tank of state.tanks) {
    const landing = settleTank(tank, state.terrain, state.height);
    if (landing && landing.damage > 0) damageTank(state, tank, landing.damage, false, 'fall');
    if (tank.falling) anyFalling = true;
  }
  return anyFalling;
}

function endTurn(state: GameState): void {
  const [a, b] = state.tanks;
  if (a.hp <= 0 || b.hp <= 0) {
    state.winner = a.hp <= 0 && b.hp <= 0 ? 'draw' : a.hp <= 0 ? 1 : 0;
    state.phase = 'over';
    state.events.push({ type: 'gameover', winner: state.winner });
    return;
  }
  state.current = state.current === 0 ? 1 : 0;
  state.turn += 1;
  state.wind = rollWind(state);
  const next = state.tanks[state.current];
  if (next.ammo[next.weapon] <= 0) next.weapon = 'standard';
  state.phase = 'aim';
  state.events.push({ type: 'turn', current: state.current, wind: state.wind });
}

/** Advance the match by one fixed tick (1/60 s). Does nothing while a player is aiming or after the end. */
export function step(state: GameState): void {
  if (state.phase === 'aim' || state.phase === 'over') return;
  state.tick += 1;

  if (state.phase === 'flight') {
    const nextId = { value: state.nextProjectileId };
    const events = advanceFlight(state.projectiles, worldOf(state), nextId, state.singularities);
    state.nextProjectileId = nextId.value;
    for (const e of events) {
      if (e.type === 'detonate') detonate(state, e.projectile, e.x, e.y, e.tank);
      else if (e.type === 'bounce') state.events.push({ type: 'bounce', x: e.x, y: e.y });
      else if (e.type === 'split') state.events.push({ type: 'split', x: e.x, y: e.y });
      else state.events.push({ type: 'miss', x: e.x, y: e.y });
    }
    updateSingularities(state);
  }

  const anyFalling = settleTanks(state);

  if (state.phase === 'flight' && state.projectiles.length === 0 && state.singularities.length === 0) {
    state.phase = 'settle';
  }
  if (state.phase === 'settle' && !anyFalling) endTurn(state);
}

/** Run ticks until the shot in flight has fully resolved (tests, and fast-forwarding). Returns the ticks used. */
export function runUntilSettled(state: GameState, maxTicks = 4000): number {
  let ticks = 0;
  while ((state.phase === 'flight' || state.phase === 'settle') && ticks < maxTicks) {
    step(state);
    ticks++;
  }
  return ticks;
}
