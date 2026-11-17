import { describe, expect, it } from 'vitest';
import { MAX_WIND, TANK_MAX_HP, type GameEvent, type GameState, type WeaponId } from '../types';
import { canSplitNow, createGame, fire, runUntilSettled, selectWeapon, setAim, step, triggerSplit, worldOf } from '../game';
import { simulateShot } from '../physics';
import { elevationAt, restingY } from '../terrain';
import { MOUND_HEIGHT, SINGULARITY_TICKS, SPLIT_FRAGMENT, WEAPONS, blastDamage, startingAmmo } from '../weapons';
import { flatGame } from './helpers';

function shoot(state: GameState, angle: number, power: number, weapon: WeaponId = 'standard', autoSplit = false): GameEvent[] {
  expect(selectWeapon(state, weapon)).toBe(true);
  setAim(state, angle, power);
  expect(fire(state, { autoSplit })).toBe(true);
  runUntilSettled(state);
  const events = state.events.slice();
  state.events.length = 0;
  return events;
}

const of = <T extends GameEvent['type']>(events: GameEvent[], type: T) => events.filter((e): e is Extract<GameEvent, { type: T }> => e.type === type);

/** Angle and power that put a standard shell straight onto the other tank on flat ground with no wind. */
function directHit(state: GameState): { angle: number; power: number } {
  const me = state.tanks[state.current];
  const them = state.tanks[state.current === 0 ? 1 : 0];
  const angle = them.x > me.x ? 45 : 135;
  let lo = 5;
  let hi = 100;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const hit = simulateShot(worldOf(state), me, angle, mid, 'standard').impacts[0]!;
    const short = them.x > me.x ? hit.x < them.x : hit.x > them.x;
    if (short && hit.tank === null) lo = mid;
    else hi = mid;
  }
  return { angle, power: hi };
}

describe('a new match', () => {
  it('starts with two healthy tanks on the ground, player 1 to move, wind inside the limits', () => {
    const state = createGame({ seed: 3 });
    expect(state.phase).toBe('aim');
    expect(state.current).toBe(0);
    expect(Math.abs(state.wind)).toBeLessThanOrEqual(MAX_WIND);
    for (const tank of state.tanks) {
      expect(tank.hp).toBe(TANK_MAX_HP);
      expect(tank.y).toBe(restingY(state.terrain, state.height, tank.x));
      expect(tank.ammo).toEqual(startingAmmo());
    }
    expect(state.tanks[0].x).toBeLessThan(state.tanks[1].x);
  });

  it('the same seed and the same inputs give exactly the same match', () => {
    const play = () => {
      const state = createGame({ seed: 77 });
      const log: unknown[] = [];
      const shots: [number, number, WeaponId][] = [[50, 60, 'standard'], [130, 70, 'bouncer'], [62, 66, 'splitter'], [120, 58, 'mound'], [45, 80, 'blackhole'], [133, 62, 'standard']];
      for (const [angle, power, weapon] of shots) {
        if (state.phase !== 'aim') break;
        log.push(shoot(state, angle, power, weapon, weapon === 'splitter'));
        log.push([state.wind, state.tanks[0].hp, state.tanks[1].hp, state.tanks[0].y, state.tanks[1].y]);
      }
      return { log, terrain: Array.from(state.terrain), tick: state.tick };
    };
    const a = play();
    const b = play();
    expect(a.log).toEqual(b.log);
    expect(a.terrain).toEqual(b.terrain);
    expect(a.tick).toBe(b.tick);
    expect(a.tick).toBeGreaterThan(300);
  });

  it('different seeds give different ground and wind', () => {
    const a = createGame({ seed: 1 });
    const b = createGame({ seed: 2 });
    expect(Array.from(a.terrain)).not.toEqual(Array.from(b.terrain));
  });
});

describe('taking turns', () => {
  it('a shot hands the turn over, re-rolls the wind and announces it', () => {
    const state = flatGame();
    const winds = new Set<number>();
    for (let i = 0; i < 12; i++) {
      const mover = state.current;
      const events = shoot(state, mover === 0 ? 45 : 135, 30); // harmless: lands well short
      expect(state.phase).toBe('aim');
      expect(state.current).toBe(mover === 0 ? 1 : 0);
      expect(Math.abs(state.wind)).toBeLessThanOrEqual(MAX_WIND);
      expect(of(events, 'turn')).toEqual([{ type: 'turn', current: state.current, wind: state.wind }]);
      winds.add(state.wind);
    }
    expect(winds.size).toBeGreaterThan(8); // it really changes
    expect(state.turn).toBe(13);
  });

  it('nothing can be fired, aimed or selected while a shot is in the air', () => {
    const state = flatGame();
    setAim(state, 60, 60);
    expect(fire(state)).toBe(true);
    expect(state.phase).toBe('flight');
    expect(fire(state)).toBe(false);
    expect(selectWeapon(state, 'bouncer')).toBe(false);
    setAim(state, 10, 10);
    expect(state.tanks[0].angle).toBe(60);
    expect(state.projectiles).toHaveLength(1);
  });

  it('aim is clamped to the legal range', () => {
    const state = flatGame();
    setAim(state, 400, 400);
    expect(state.tanks[0].angle).toBe(180);
    expect(state.tanks[0].power).toBe(100);
    setAim(state, -5, -5);
    expect(state.tanks[0].angle).toBe(0);
    expect(state.tanks[0].power).toBe(5);
  });

  it('step does nothing while a player is aiming', () => {
    const state = flatGame();
    step(state);
    step(state);
    expect(state.tick).toBe(0);
  });

  it('a shot off the map is a miss and still ends the turn', () => {
    const state = flatGame({ wind: -15 });
    const events = shoot(state, 160, 100);
    expect(of(events, 'miss')).toHaveLength(1);
    expect(of(events, 'explosion')).toHaveLength(0);
    expect(state.current).toBe(1);
  });
});

describe('ammo', () => {
  it('the standard shell never runs out; the others are counted down', () => {
    const state = flatGame();
    for (let i = 0; i < 6; i++) shoot(state, state.current === 0 ? 45 : 135, 30);
    expect(state.tanks[0].ammo.standard).toBe(Infinity);
    shoot(state, 45, 30, 'blackhole');
    expect(state.tanks[0].ammo.blackhole).toBe(0);
    shoot(state, 135, 30); // player 2
    expect(selectWeapon(state, 'blackhole')).toBe(false); // player 1 has none left
    expect(state.tanks[0].weapon).toBe('standard'); // and was switched back automatically
    expect(state.tanks[1].ammo.blackhole).toBe(1); // player 2's is untouched
  });

  it('every special weapon has the documented number of shots', () => {
    expect(startingAmmo()).toEqual({ standard: Infinity, splitter: 3, mound: 2, blackhole: 1, bouncer: 3 });
  });
});

describe('standard shell', () => {
  it('a direct hit does exactly 35 damage and digs a crater under the target', () => {
    const state = flatGame({ xs: [300, 800] });
    const aim = directHit(state);
    const events = shoot(state, aim.angle, aim.power);
    const damage = of(events, 'damage');
    expect(damage).toHaveLength(1);
    expect(damage[0]).toMatchObject({ tank: 1, amount: 35, direct: true, cause: 'blast' });
    expect(state.tanks[1].hp).toBe(65);
    expect(state.tanks[0].hp).toBe(100);
    expect(elevationAt(state.terrain, 800)).toBeLessThan(200 - 10);
    expect(state.tanks[1].y).toBe(restingY(state.terrain, state.height, 800)); // it settled into the crater
  });

  it('damage falls off linearly with distance and is zero outside the blast radius', () => {
    const w = WEAPONS.standard;
    expect(blastDamage(w.damage, w.blastRadius, 0)).toBe(35);
    expect(blastDamage(w.damage, w.blastRadius, w.blastRadius / 2)).toBe(18); // 17.5 rounded
    expect(blastDamage(w.damage, w.blastRadius, w.blastRadius * 0.8)).toBe(7);
    expect(blastDamage(w.damage, w.blastRadius, w.blastRadius)).toBe(0);
    expect(blastDamage(w.damage, w.blastRadius, 500)).toBe(0);
  });

  it('a near miss hurts less than a hit, a far miss not at all', () => {
    const near = flatGame({ xs: [300, 800] });
    const aim = directHit(near);
    const nearEvents = shoot(near, aim.angle, aim.power - 2.2);
    const nearDamage = of(nearEvents, 'damage')[0]!;
    expect(nearDamage.direct).toBe(false);
    expect(nearDamage.amount).toBeGreaterThan(0);
    expect(nearDamage.amount).toBeLessThan(35);

    const far = flatGame({ xs: [300, 800] });
    const farEvents = shoot(far, aim.angle, aim.power - 12);
    expect(of(farEvents, 'damage')).toHaveLength(0);
    expect(far.tanks[1].hp).toBe(100);
  });

  it('what the simulation predicts is exactly what the real shot does', () => {
    const state = createGame({ seed: 11 });
    const predicted = simulateShot(worldOf(state), state.tanks[0], 57, 64, 'standard').impacts[0]!;
    const events = shoot(state, 57, 64);
    const boom = of(events, 'explosion')[0]!;
    expect(boom.x).toBe(predicted.x);
    expect(boom.y).toBe(predicted.y);
  });
});

describe('tri-splitter', () => {
  it('pressing fire again mid-flight splits it into three smaller blasts', () => {
    const state = flatGame();
    selectWeapon(state, 'splitter');
    setAim(state, 60, 60);
    fire(state);
    for (let i = 0; i < 50; i++) step(state);
    expect(canSplitNow(state)).toBe(true);
    expect(triggerSplit(state)).toBe(true);
    expect(state.projectiles).toHaveLength(3);
    expect(canSplitNow(state)).toBe(false);
    expect(triggerSplit(state)).toBe(false); // only once
    runUntilSettled(state);
    const booms = of(state.events, 'explosion');
    expect(booms).toHaveLength(3);
    expect(booms.every((b) => b.radius === SPLIT_FRAGMENT.craterRadius)).toBe(true);
    expect(of(state.events, 'split')).toHaveLength(1);
  });

  it('left alone it lands as one medium shell', () => {
    const state = flatGame();
    const events = shoot(state, 60, 60, 'splitter');
    const booms = of(events, 'explosion');
    expect(booms).toHaveLength(1);
    expect(booms[0]!.radius).toBe(WEAPONS.splitter.craterRadius);
  });

  it('the AI\'s auto-split goes off at the top of the arc', () => {
    const state = flatGame();
    const events = shoot(state, 60, 60, 'splitter', true);
    expect(of(events, 'split')).toHaveLength(1);
    expect(of(events, 'explosion')).toHaveLength(3);
  });

  it('there is nothing to split for other weapons or before firing', () => {
    const state = flatGame();
    expect(triggerSplit(state)).toBe(false);
    setAim(state, 60, 60);
    fire(state);
    for (let i = 0; i < 20; i++) step(state);
    expect(canSplitNow(state)).toBe(false);
    expect(triggerSplit(state)).toBe(false);
  });
});

describe('dirt-mound builder', () => {
  it('adds a hill where it lands and hurts nobody', () => {
    const state = flatGame();
    const predicted = simulateShot(worldOf(state), state.tanks[0], 60, 55, 'mound').impacts[0]!;
    const events = shoot(state, 60, 55, 'mound');
    expect(of(events, 'mound')).toHaveLength(1);
    expect(of(events, 'explosion')).toHaveLength(0);
    expect(of(events, 'damage')).toHaveLength(0);
    expect(elevationAt(state.terrain, predicted.x)).toBeCloseTo(200 + MOUND_HEIGHT, 0);
    expect(state.tanks[0].ammo.mound).toBe(1);
  });

  it('dropped on the enemy it walls them in: their flat shot now blows up in their own face', () => {
    const state = flatGame({ xs: [300, 800] });
    const aim = directHit(state);
    shoot(state, aim.angle, aim.power, 'mound');
    expect(state.tanks[1].hp).toBe(100);
    expect(state.tanks[1].y).toBe(400); // not lifted, not buried
    expect(elevationAt(state.terrain, 800 - 28)).toBeGreaterThan(235); // a wall on each side, well above the barrel
    expect(elevationAt(state.terrain, 800 + 28)).toBeGreaterThan(235);
    expect(elevationAt(state.terrain, 800 - 28)).toBeCloseTo(elevationAt(state.terrain, 800 + 28), 3); // centred on the tank
    // player 2 now tries a flat shot at player 1
    const events = shoot(state, 170, 80);
    const hurt = of(events, 'damage');
    expect(hurt.some((d) => d.tank === 1)).toBe(true);
    expect(state.tanks[0].hp).toBe(100);
  });

  it('can be used as a shield: a shell that would have hit now hits the hill', () => {
    const state = flatGame({ xs: [300, 800] });
    const aim = directHit(state);
    void aim;
    shoot(state, 45, 30, 'mound'); // player 1 builds a hill in front of itself
    shoot(state, 135, 30); // player 2 wastes a shot
    shoot(state, 135, 30); // player 1 passes (fires away from everything)
    const hpBefore = state.tanks[0].hp;
    const events = shoot(state, 176, 100); // player 2: flat and fast
    const boom = of(events, 'explosion')[0]!;
    expect(boom.x).toBeGreaterThan(330); // stopped by the hill, short of the tank
    expect(state.tanks[0].hp).toBeGreaterThanOrEqual(hpBefore - 12);
  });
});

describe('black-hole singularity', () => {
  it('lands, drags the enemy towards it, then implodes and deals damage', () => {
    const state = flatGame({ xs: [300, 800] });
    const aim = directHit(state);
    selectWeapon(state, 'blackhole');
    setAim(state, aim.angle, aim.power - 5.5); // land it short of the tank
    fire(state);
    while (state.singularities.length === 0 && state.phase === 'flight') step(state);
    const hole = state.singularities[0]!;
    expect(hole.ticksLeft).toBe(SINGULARITY_TICKS - 1);
    const gap = Math.abs(state.tanks[1].x - hole.x);
    expect(gap).toBeGreaterThan(40);
    expect(gap).toBeLessThan(120);
    expect(state.tanks[1].hp).toBe(100); // nothing yet: the damage is delayed

    let ticks = 0;
    while (state.singularities.length > 0) {
      expect(state.phase).toBe('flight'); // the turn waits for the implosion
      step(state);
      ticks++;
    }
    expect(ticks).toBe(SINGULARITY_TICKS - 1);
    const dragged = gap - Math.abs(state.tanks[1].x - hole.x);
    expect(dragged).toBeGreaterThan(15); // yanked towards the centre
    expect(state.tanks[1].x).toBeLessThan(800);
    expect(of(state.events, 'singularity')).toHaveLength(1);
    expect(of(state.events, 'implosion')).toHaveLength(1);
    const hit = of(state.events, 'damage').find((d) => d.tank === 1)!;
    // the damage is what the blast rule gives for where the tank ended up, more than where it started
    expect(hit.amount).toBeGreaterThan(blastDamage(WEAPONS.blackhole.damage, WEAPONS.blackhole.blastRadius, gap));
    runUntilSettled(state);
    expect(state.phase).toBe('aim');
    expect(state.tanks[1].y).toBe(restingY(state.terrain, state.height, state.tanks[1].x));
  });

  it('does not reach a tank that is far away', () => {
    const state = flatGame({ xs: [300, 1000] });
    shoot(state, 45, 40, 'blackhole');
    expect(state.tanks[1].x).toBe(1000);
    expect(state.tanks[1].hp).toBe(100);
  });
});

describe('bouncing rubber bomb', () => {
  it('bounces three times, then explodes once', () => {
    const state = flatGame({ xs: [100, 1150] });
    const events = shoot(state, 60, 45, 'bouncer');
    expect(of(events, 'bounce')).toHaveLength(3);
    const booms = of(events, 'explosion');
    expect(booms).toHaveLength(1);
    expect(booms[0]!.weapon).toBe('bouncer');
    const xs = of(events, 'bounce').map((b) => b.x);
    expect(booms[0]!.x).toBeGreaterThan(xs[2]!);
  });
});

describe('falling', () => {
  it('a tank whose ground is shot away falls and takes fall damage on top of the blast', () => {
    // a tank on a tall thin pillar: one hit in the side of the pillar takes a big slice out from under it
    const state = flatGame({ xs: [300, 800], shape: (x) => (Math.abs(x - 800) <= 10 ? 330 : 150) });
    expect(state.tanks[1].y).toBe(270);
    // (the pillar is far taller than the fall-damage threshold)
    // dig the pillar out from under it with shells aimed at the pillar's foot
    const world = worldOf(state);
    let best = { angle: 45, power: 50, d: Infinity };
    for (let power = 40; power <= 80; power += 0.25) {
      const hit = simulateShot(world, state.tanks[0], 45, power, 'standard').impacts[0]!;
      const d = Math.hypot(hit.x - 790, hit.y - 380);
      if (d < best.d) best = { angle: 45, power, d };
    }
    const events = shoot(state, best.angle, best.power);
    const falls = of(events, 'damage').filter((d) => d.cause === 'fall');
    expect(state.tanks[1].y).toBeGreaterThan(300); // it came down
    expect(falls).toHaveLength(1);
    expect(falls[0]!.tank).toBe(1);
    expect(falls[0]!.amount).toBeGreaterThan(0);
    expect(state.phase).toBe('aim'); // and the turn only moved on once it had landed
  });
});

describe('the end of a match', () => {
  it('the tank that reaches zero loses, and the match stops', () => {
    const state = flatGame({ xs: [300, 800] });
    state.tanks[1].hp = 20;
    const aim = directHit(state);
    const events = shoot(state, aim.angle, aim.power);
    expect(state.tanks[1].hp).toBe(0);
    expect(state.phase).toBe('over');
    expect(state.winner).toBe(0);
    expect(of(events, 'gameover')).toEqual([{ type: 'gameover', winner: 0 }]);
    expect(of(events, 'turn')).toHaveLength(0);
    expect(fire(state)).toBe(false);
    const tick = state.tick;
    step(state);
    expect(state.tick).toBe(tick);
  });

  it('shooting yourself loses the match', () => {
    const state = flatGame();
    state.tanks[0].hp = 10;
    shoot(state, 90, 30);
    expect(state.winner).toBe(1);
  });

  it('if one blast finishes both tanks it is a draw', () => {
    const state = flatGame({ xs: [600, 640] });
    state.tanks[0].hp = 5;
    state.tanks[1].hp = 5;
    shoot(state, 80, 14); // a lob that drops between them
    expect(state.tanks[0].hp).toBe(0);
    expect(state.tanks[1].hp).toBe(0);
    expect(state.winner).toBe('draw');
    expect(state.phase).toBe('over');
  });

  it('hit points never go below zero', () => {
    const state = flatGame({ xs: [300, 800] });
    state.tanks[1].hp = 3;
    const aim = directHit(state);
    shoot(state, aim.angle, aim.power);
    expect(state.tanks[1].hp).toBe(0);
  });
});
