/**
 * The five ammo types: their numbers, and what each does when it goes off.
 * How they fly (bouncing, splitting) is in physics.ts; this file is about the landing.
 */
import {
  DT,
  TANK_HALF_WIDTH,
  TANK_HEIGHT,
  type GameState,
  type PlayerIndex,
  type Projectile,
  type Tank,
  type WeaponDef,
  type WeaponId,
} from './types';
import { addMound, carveCrater, restingY } from './terrain';

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  standard: {
    id: 'standard',
    name: 'Standard Shell',
    blurb: 'Reliable arc, honest crater.',
    ammo: Infinity,
    craterRadius: 38,
    damage: 35,
    blastRadius: 62,
  },
  splitter: {
    id: 'splitter',
    name: 'Tri-Splitter',
    blurb: 'Fire again mid-flight to split it in three.',
    ammo: 3,
    craterRadius: 30,
    damage: 26,
    blastRadius: 50,
  },
  mound: {
    id: 'mound',
    name: 'Dirt-Mound Builder',
    blurb: 'Builds a hill. Wall them in, or hide behind it.',
    ammo: 2,
    craterRadius: 0,
    damage: 0,
    blastRadius: 0,
  },
  blackhole: {
    id: 'blackhole',
    name: 'Black-Hole Singularity',
    blurb: 'Drags the enemy in, then implodes.',
    ammo: 1,
    craterRadius: 44,
    damage: 32,
    blastRadius: 95,
  },
  bouncer: {
    id: 'bouncer',
    name: 'Bouncing Rubber Bomb',
    blurb: 'Three bounces, then boom.',
    ammo: 3,
    craterRadius: 32,
    damage: 30,
    blastRadius: 56,
  },
};

/** One fragment of a split Tri-Splitter: three small blasts instead of one medium one. */
export const SPLIT_FRAGMENT = { craterRadius: 22, damage: 20, blastRadius: 48 } as const;

export const MOUND_RADIUS = 58;
export const MOUND_HEIGHT = 74;

/** Ticks between a black hole landing and its implosion (1.1 s). */
export const SINGULARITY_TICKS = 66;
/** A black hole hovers this far above where it landed. */
export const SINGULARITY_LIFT = 14;
/** Tanks closer than this (px, horizontally) are dragged towards a black hole... */
export const TANK_PULL_RANGE = 190;
/** ...at up to this speed (px/s), fading to nothing at the edge of the range. */
export const TANK_PULL_SPEED = 62;

export function startingAmmo(): Record<WeaponId, number> {
  return {
    standard: WEAPONS.standard.ammo,
    splitter: WEAPONS.splitter.ammo,
    mound: WEAPONS.mound.ammo,
    blackhole: WEAPONS.blackhole.ammo,
    bouncer: WEAPONS.bouncer.ammo,
  };
}

/** The blast numbers for a projectile (a split fragment is weaker than the whole shell). */
export function blastOf(p: Pick<Projectile, 'weapon' | 'fragment'>): { craterRadius: number; damage: number; blastRadius: number } {
  return p.fragment ? SPLIT_FRAGMENT : WEAPONS[p.weapon];
}

/** The point blast distance is measured to: the middle of the tank's body. */
export function tankCentre(tank: Pick<Tank, 'x' | 'y'>): { x: number; y: number } {
  return { x: tank.x, y: tank.y - TANK_HEIGHT / 2 };
}

/**
 * Damage from a blast of `damage` at its centre and nothing at `blastRadius`, linear in between.
 * A direct hit counts as distance 0.
 */
export function blastDamage(damage: number, blastRadius: number, distance: number): number {
  if (blastRadius <= 0 || distance >= blastRadius) return 0;
  return Math.round(damage * (1 - Math.max(0, distance) / blastRadius));
}

export function damageTank(
  state: GameState,
  tank: Tank,
  amount: number,
  direct: boolean,
  cause: 'blast' | 'fall',
): void {
  if (amount <= 0 || tank.hp <= 0) return;
  tank.hp = Math.max(0, tank.hp - amount);
  const c = tankCentre(tank);
  state.events.push({ type: 'damage', tank: tank.index, amount, x: c.x, y: c.y - TANK_HEIGHT, direct, cause });
}

/** Carve the crater and hurt every tank in range. */
export function explode(
  state: GameState,
  x: number,
  y: number,
  blast: { craterRadius: number; damage: number; blastRadius: number },
  weapon: WeaponId,
  directHit: PlayerIndex | null,
): void {
  if (blast.craterRadius > 0) carveCrater(state.terrain, state.height, x, y, blast.craterRadius);
  state.events.push({ type: 'explosion', weapon, x, y, radius: blast.craterRadius });
  for (const tank of state.tanks) {
    const direct = directHit === tank.index;
    const c = tankCentre(tank);
    const distance = direct ? 0 : Math.hypot(c.x - x, c.y - y);
    damageTank(state, tank, blastDamage(blast.damage, blast.blastRadius, distance), direct, 'blast');
  }
}

/** A projectile has landed at (x, y), possibly straight on a tank: do what its ammo type does. */
export function detonate(state: GameState, p: Projectile, x: number, y: number, directHit: PlayerIndex | null): void {
  if (p.weapon === 'mound') {
    const keepClear = state.tanks.filter((t) => t.hp > 0).map((t) => ({ x: t.x, halfWidth: TANK_HALF_WIDTH + 2 }));
    // a mound that lands on a tank is centred on it, so a wall rises on both sides
    const centre = directHit === null ? x : state.tanks[directHit].x;
    addMound(state.terrain, centre, MOUND_RADIUS, MOUND_HEIGHT, keepClear);
    state.events.push({ type: 'mound', x: centre, y, radius: MOUND_RADIUS });
    return;
  }
  if (p.weapon === 'blackhole') {
    const hole = { owner: p.owner, x, y: y - SINGULARITY_LIFT, ticksLeft: SINGULARITY_TICKS };
    state.singularities.push(hole);
    state.events.push({ type: 'singularity', x: hole.x, y: hole.y });
    return;
  }
  explode(state, x, y, blastOf(p), p.weapon, directHit);
}

/**
 * One tick of every active black hole: drag nearby tanks towards it along the ground, count down,
 * and implode when the count reaches zero. The implosion is an ordinary blast, so a tank that was
 * dragged right up to the centre takes nearly the full damage.
 */
export function updateSingularities(state: GameState): void {
  if (state.singularities.length === 0) return;
  const remaining = [];
  for (const hole of state.singularities) {
    for (const tank of state.tanks) {
      if (tank.hp <= 0) continue;
      const dx = hole.x - tank.x;
      const d = Math.abs(dx);
      if (d >= TANK_PULL_RANGE || d < 0.5) continue;
      const move = Math.min(d, TANK_PULL_SPEED * (1 - d / TANK_PULL_RANGE) * DT);
      tank.x = Math.min(state.width - TANK_HALF_WIDTH, Math.max(TANK_HALF_WIDTH, tank.x + Math.sign(dx) * move));
      // dragged uphill it rides up the slope; dragged over an edge, settling makes it fall
      const rest = restingY(state.terrain, state.height, tank.x);
      if (rest < tank.y) tank.y = rest;
    }
    hole.ticksLeft -= 1;
    if (hole.ticksLeft > 0) {
      remaining.push(hole);
      continue;
    }
    state.events.push({ type: 'implosion', x: hole.x, y: hole.y, radius: WEAPONS.blackhole.craterRadius });
    explode(state, hole.x, hole.y, WEAPONS.blackhole, 'blackhole', null);
  }
  state.singularities = remaining;
}
