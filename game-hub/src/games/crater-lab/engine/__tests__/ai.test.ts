import { describe, expect, it } from 'vitest';
import { MAX_POWER, MIN_POWER, WORLD_HEIGHT, type GameState, type WeaponId } from '../types';
import { createGame, fire, runUntilSettled, selectWeapon, setAim, worldOf } from '../game';
import { simulateShot } from '../physics';
import { addMound, restingY } from '../terrain';
import { createRng } from '../rng';
import {
  DIFFICULTIES,
  addAimError,
  aimSigma,
  evaluateShot,
  expectedDamage,
  isWalledIn,
  nelderMead2D,
  netDamage,
  planShot,
  rangingFactor,
  solveShot,
  type Difficulty,
} from '../ai';
import { MOUND_HEIGHT, MOUND_RADIUS, WEAPONS } from '../weapons';
import { flatGame } from './helpers';

const WINDS = [-15, -7.5, 0, 7.5, 15];

/** Fire a planned shot in the real game and return how much the target lost. */
function fireFor(state: GameState, angle: number, power: number, weapon: WeaponId = 'standard', autoSplit = false) {
  const target = state.tanks[state.current === 0 ? 1 : 0];
  const self = state.tanks[state.current];
  const before = { target: target.hp, self: self.hp };
  selectWeapon(state, weapon);
  setAim(state, angle, power);
  fire(state, { autoSplit });
  runUntilSettled(state);
  const events = state.events.slice();
  state.events.length = 0;
  return { dealt: before.target - target.hp, taken: before.self - self.hp, events };
}

describe('Nelder-Mead', () => {
  it('finds the minimum of a bowl', () => {
    const r = nelderMead2D((a, b) => (a - 3) ** 2 + 2 * (b + 1) ** 2, [10, 10], [1, 1], 200, 1e-9);
    expect(r.point[0]).toBeCloseTo(3, 3);
    expect(r.point[1]).toBeCloseTo(-1, 3);
    expect(r.value).toBeLessThan(1e-6);
  });

  it('stops as soon as the value is good enough, and respects the iteration limit', () => {
    const early = nelderMead2D((a, b) => a * a + b * b, [0.01, 0.01], [1, 1], 200, 1);
    expect(early.evaluations).toBe(3);
    const capped = nelderMead2D((a, b) => (a - 50) ** 2 + (b - 50) ** 2, [0, 0], [1, 1], 5, 0);
    expect(capped.evaluations).toBeLessThanOrEqual(3 + 5 * 4);
  });
});

describe('the ballistics solver hits a stationary target', () => {
  it.each([1, 2, 3, 4])('terrain %i: in every wind from -15 to +15, and the real shot then lands a direct hit', (seed) => {
    for (const wind of WINDS) {
      const state = createGame({ seed });
      state.wind = wind;
      const solution = solveShot(worldOf(state), state.tanks[0], state.tanks[1], 'standard', { avoidSelfHits: true });
      expect(solution.miss).toBeLessThanOrEqual(2); // px from the middle of the target; 0 is a direct hit
      expect(solution.power).toBeGreaterThanOrEqual(MIN_POWER);
      expect(solution.power).toBeLessThanOrEqual(MAX_POWER);
      // no cheating: fly it for real, through the game loop, and count the damage
      const real = fireFor(state, solution.angle, solution.power);
      expect(real.dealt).toBe(WEAPONS.standard.damage);
      expect(real.taken).toBe(0);
    }
  });

  it('works just as well for the player on the right shooting left', () => {
    for (const wind of [-15, 0, 15]) {
      const state = createGame({ seed: 5 });
      state.wind = wind;
      state.current = 1;
      const solution = solveShot(worldOf(state), state.tanks[1], state.tanks[0], 'standard', { avoidSelfHits: true });
      expect(solution.miss).toBeLessThanOrEqual(2);
      expect(solution.angle).toBeGreaterThan(90); // it aims left
      expect(fireFor(state, solution.angle, solution.power).dealt).toBe(WEAPONS.standard.damage);
    }
  });

  it('really accounts for the wind: the answer for one wind misses badly in the opposite wind', () => {
    const state = createGame({ seed: 2 });
    state.wind = 15;
    const world = worldOf(state);
    const tail = solveShot(world, state.tanks[0], state.tanks[1], 'standard');
    const head = solveShot({ ...world, wind: -15 }, state.tanks[0], state.tanks[1], 'standard');
    expect(Math.abs(tail.angle - head.angle) + Math.abs(tail.power - head.power)).toBeGreaterThan(3);
    const wrongWind = evaluateShot({ ...world, wind: -15 }, state.tanks[0], state.tanks[1], tail.angle, tail.power, 'standard');
    expect(wrongWind.miss).toBeGreaterThan(60);
  });

  it('lobs over a ridge that blocks the direct line', () => {
    const state = flatGame({ shape: (x) => (Math.abs(x - 600) < 40 ? 440 : 150) });
    const world = worldOf(state);
    // the straight line between the tanks is blocked...
    expect(simulateShot(world, state.tanks[0], 8, 100, 'standard').impacts[0]!.x).toBeLessThan(600);
    // ...but the solver finds the way over
    const solution = solveShot(world, state.tanks[0], state.tanks[1], 'standard');
    expect(solution.miss).toBeLessThanOrEqual(2);
    const path = simulateShot(world, state.tanks[0], solution.angle, solution.power, 'standard').path;
    const overRidge = path.filter((p) => Math.abs(p.x - 600) < 40);
    expect(overRidge.length).toBeGreaterThan(0);
    for (const p of overRidge) expect(p.y).toBeLessThan(WORLD_HEIGHT - 440);
    expect(fireFor(state, solution.angle, solution.power).dealt).toBe(WEAPONS.standard.damage);
  });

  it('solves the bouncing bomb too, bounces included', () => {
    const state = createGame({ seed: 4 });
    const solution = solveShot(worldOf(state), state.tanks[0], state.tanks[1], 'bouncer', { avoidSelfHits: true });
    expect(solution.miss).toBeLessThanOrEqual(6);
    const real = fireFor(state, solution.angle, solution.power, 'bouncer');
    expect(real.dealt).toBeGreaterThanOrEqual(22);
  });

  it('prefers a forgiving shot: nudged a degree and a half either way it still lands close', () => {
    const state = createGame({ seed: 3 });
    const world = worldOf(state);
    const s = solveShot(world, state.tanks[0], state.tanks[1], 'standard');
    for (const da of [-1.5, 1.5]) {
      expect(evaluateShot(world, state.tanks[0], state.tanks[1], s.angle + da, s.power, 'standard').miss).toBeLessThan(70);
    }
  });

  it('stays inside its budget of simulated shots', () => {
    const state = createGame({ seed: 6 });
    const solution = solveShot(worldOf(state), state.tanks[0], state.tanks[1], 'standard');
    expect(solution.simulations).toBeGreaterThan(700); // the grid alone
    expect(solution.simulations).toBeLessThan(1500);
  });

  it('does not change the world while thinking', () => {
    const state = createGame({ seed: 6 });
    const terrain = Array.from(state.terrain);
    const tanks = JSON.stringify(state.tanks);
    planShot(state, 0, 'savant', createRng(1));
    expect(Array.from(state.terrain)).toEqual(terrain);
    expect(JSON.stringify(state.tanks)).toBe(tanks);
    expect(state.phase).toBe('aim');
    expect(state.events).toHaveLength(0);
  });
});

describe('avoiding its own blast', () => {
  /** The shooter stands in a slot between two tall walls; the target is on open ground. */
  function walledShooter(): GameState {
    const state = flatGame({ xs: [300, 800] });
    addMound(state.terrain, 300, MOUND_RADIUS, MOUND_HEIGHT * 1.6, [{ x: 300, halfWidth: 16 }]);
    return state;
  }

  it('a careless flat shot from inside the walls blows up next to the shooter', () => {
    const state = walledShooter();
    const careless = evaluateShot(worldOf(state), state.tanks[0], state.tanks[1], 20, 80, 'standard');
    expect(careless.selfDistance).toBeLessThan(WEAPONS.standard.blastRadius);
    expect(netDamage(worldOf(state), state.tanks[0], state.tanks[1], 20, 80, 'standard')).toBeLessThan(0);
  });

  it('with self-hit avoidance the solver finds a shot that clears the walls and still hits', () => {
    const state = walledShooter();
    const solution = solveShot(worldOf(state), state.tanks[0], state.tanks[1], 'standard', { avoidSelfHits: true });
    expect(solution.selfDistance).toBeGreaterThan(WEAPONS.standard.blastRadius + 12);
    const real = fireFor(state, solution.angle, solution.power);
    expect(real.taken).toBe(0);
    expect(real.dealt).toBeGreaterThan(20);
  });

  it('a self-hit is always scored worse than a clean miss', () => {
    const state = walledShooter();
    const world = worldOf(state);
    const selfHit = evaluateShot(world, state.tanks[0], state.tanks[1], 20, 80, 'standard', { avoidSelfHits: true });
    const ignored = evaluateShot(world, state.tanks[0], state.tanks[1], 20, 80, 'standard');
    expect(selfHit.cost).toBeGreaterThan(ignored.cost + 150);
  });
});

describe('difficulty: aiming error', () => {
  it('the three tiers are the documented ±12°/±15%, ±4°/±5% and ±0.8°/±1.5%', () => {
    expect(DIFFICULTIES.recruit).toMatchObject({ angleNoise: 12, powerNoise: 0.15, avoidsSelfHits: false });
    expect(DIFFICULTIES.tactician).toMatchObject({ angleNoise: 4, powerNoise: 0.05, avoidsSelfHits: true });
    expect(DIFFICULTIES.savant).toMatchObject({ angleNoise: 0.8, powerNoise: 0.015, avoidsSelfHits: true, smartAmmo: true });
  });

  it.each(['recruit', 'tactician', 'savant'] as Difficulty[])('%s: errors are Gaussian, centred on the solved aim, with about 95%% inside the quoted band', (difficulty) => {
    const def = DIFFICULTIES[difficulty];
    const sigma = aimSigma(difficulty);
    expect(sigma.angle).toBeCloseTo(def.angleNoise / 2);
    expect(sigma.power).toBeCloseTo(def.powerNoise / 2);
    const rng = createRng(99);
    const n = 4000;
    let sumA = 0;
    let sumA2 = 0;
    let sumP = 0;
    let sumP2 = 0;
    let insideA = 0;
    let insideP = 0;
    for (let i = 0; i < n; i++) {
      const aim = addAimError(90, 50, sigma.angle, sigma.power, rng);
      const da = aim.angle - 90;
      const dp = aim.power / 50 - 1;
      sumA += da;
      sumA2 += da * da;
      sumP += dp;
      sumP2 += dp * dp;
      if (Math.abs(da) <= def.angleNoise) insideA++;
      if (Math.abs(dp) <= def.powerNoise) insideP++;
    }
    expect(Math.abs(sumA / n)).toBeLessThan(sigma.angle * 0.08); // unbiased
    expect(Math.sqrt(sumA2 / n)).toBeGreaterThan(sigma.angle * 0.94);
    expect(Math.sqrt(sumA2 / n)).toBeLessThan(sigma.angle * 1.06);
    expect(Math.abs(sumP / n)).toBeLessThan(sigma.power * 0.08);
    expect(Math.sqrt(sumP2 / n)).toBeGreaterThan(sigma.power * 0.94);
    expect(Math.sqrt(sumP2 / n)).toBeLessThan(sigma.power * 1.06);
    expect(insideA / n).toBeGreaterThan(0.93);
    expect(insideA / n).toBeLessThan(0.97);
    expect(insideP / n).toBeGreaterThan(0.93);
    expect(insideP / n).toBeLessThan(0.97);
  });

  it('errors never push the aim outside the legal range', () => {
    const rng = createRng(5);
    for (let i = 0; i < 500; i++) {
      const aim = addAimError(i % 2 ? 2 : 178, i % 3 ? 99 : 6, 6, 0.075, rng);
      expect(aim.angle).toBeGreaterThanOrEqual(0);
      expect(aim.angle).toBeLessThanOrEqual(180);
      expect(aim.power).toBeGreaterThanOrEqual(MIN_POWER);
      expect(aim.power).toBeLessThanOrEqual(MAX_POWER);
    }
  });

  it('it brackets like a person: each shot is a little tighter, down to a floor', () => {
    expect(rangingFactor(0)).toBe(1);
    expect(rangingFactor(1)).toBeCloseTo(0.9);
    expect(rangingFactor(3)).toBeLessThan(rangingFactor(2));
    expect(rangingFactor(50)).toBe(0.55);
    expect(aimSigma('tactician', 4).angle).toBeLessThan(aimSigma('tactician', 0).angle);
  });

  it('harder opponents land closer: mean miss over many shots is ordered recruit > tactician > savant', () => {
    const state = createGame({ seed: 8 });
    const world = worldOf(state);
    const ideal = solveShot(world, state.tanks[1], state.tanks[0], 'standard', { avoidSelfHits: true });
    const meanMiss = (difficulty: Difficulty) => {
      const rng = createRng(1234);
      const sigma = aimSigma(difficulty);
      let total = 0;
      for (let i = 0; i < 150; i++) {
        const aim = addAimError(ideal.angle, ideal.power, sigma.angle, sigma.power, rng);
        total += Math.min(600, evaluateShot(world, state.tanks[1], state.tanks[0], aim.angle, aim.power, 'standard').miss);
      }
      return total / 150;
    };
    const recruit = meanMiss('recruit');
    const tactician = meanMiss('tactician');
    const savant = meanMiss('savant');
    expect(recruit).toBeGreaterThan(tactician * 1.8);
    expect(tactician).toBeGreaterThan(savant * 1.8);
    expect(savant).toBeLessThan(WEAPONS.standard.blastRadius / 2); // the Savant is nearly always inside the blast
  });
});

describe('planning a turn', () => {
  it('the same seed gives the same plan; a different seed gives a different error', () => {
    const state = createGame({ seed: 9 });
    const a = planShot(state, 1, 'tactician', createRng(42));
    const b = planShot(state, 1, 'tactician', createRng(42));
    const c = planShot(state, 1, 'tactician', createRng(43));
    expect(a).toEqual(b);
    expect(a.ideal.angle).toBe(c.ideal.angle); // the same solved shot...
    expect(a.angle).not.toBe(c.angle); // ...a different human error
  });

  it('the plan is always a legal shot with ammo the tank really has', () => {
    for (const difficulty of ['recruit', 'tactician', 'savant'] as Difficulty[]) {
      const state = createGame({ seed: 10 });
      const tank = state.tanks[1];
      tank.ammo = { standard: Infinity, splitter: 0, mound: 0, blackhole: 0, bouncer: 0 };
      const rng = createRng(7);
      for (let i = 0; i < 6; i++) {
        const plan = planShot(state, 1, difficulty, rng, { shotsTaken: i });
        expect(plan.weapon).toBe('standard');
        expect(plan.autoSplit).toBe(false);
        expect(plan.angle).toBeGreaterThanOrEqual(0);
        expect(plan.angle).toBeLessThanOrEqual(180);
        expect(plan.power).toBeGreaterThanOrEqual(MIN_POWER);
        expect(plan.power).toBeLessThanOrEqual(MAX_POWER);
      }
    }
  });

  it('less careful opponents sometimes reach for the odd ammo, and a splitter is always set to split itself', () => {
    const state = createGame({ seed: 10 });
    const rng = createRng(3);
    const picks = new Set<WeaponId>();
    for (let i = 0; i < 40; i++) {
      const plan = planShot(state, 1, 'recruit', rng);
      picks.add(plan.weapon);
      expect(plan.autoSplit).toBe(plan.weapon === 'splitter');
    }
    expect(picks.has('standard')).toBe(true);
    expect(picks.size).toBeGreaterThan(2);
  });
});

describe('Artillery Savant: choosing ammo by context', () => {
  it('long range, clear shot: the standard shell', () => {
    const state = flatGame();
    const plan = planShot(state, 0, 'savant', createRng(1));
    expect(plan.weapon).toBe('standard');
    expect(plan.ideal.miss).toBe(0);
  });

  it('close range: the Tri-Splitter, because all three fragments land on the target', () => {
    const state = flatGame({ xs: [300, 520] });
    const world = worldOf(state);
    const plan = planShot(state, 0, 'savant', createRng(1));
    expect(plan.weapon).toBe('splitter');
    expect(plan.autoSplit).toBe(true);
    const sigma = aimSigma('savant');
    const asSplitter = expectedDamage(world, state.tanks[0], state.tanks[1], plan.ideal.angle, plan.ideal.power, 'splitter', sigma.angle, sigma.power);
    const asStandard = expectedDamage(world, state.tanks[0], state.tanks[1], plan.ideal.angle, plan.ideal.power, 'standard', sigma.angle, sigma.power);
    expect(asSplitter).toBeGreaterThan(asStandard);
    // and it is right: the real shot does more than a standard shell could
    const real = fireFor(state, plan.angle, plan.power, plan.weapon, plan.autoSplit);
    expect(real.dealt).toBeGreaterThan(WEAPONS.standard.damage);
    expect(real.events.filter((e) => e.type === 'split')).toHaveLength(1);
  });

  it('close range but out of splitters: back to the standard shell', () => {
    const state = flatGame({ xs: [300, 520] });
    state.tanks[0].ammo.splitter = 0;
    expect(planShot(state, 0, 'savant', createRng(1)).weapon).not.toBe('splitter');
  });

  it('losing badly: a Dirt-Mound on the enemy to wall them in', () => {
    const state = flatGame();
    state.tanks[0].hp = 30;
    state.tanks[1].hp = 90;
    const plan = planShot(state, 0, 'savant', createRng(1));
    expect(plan.weapon).toBe('mound');
    expect(plan.reason).toMatch(/wall/);
    expect(isWalledIn(state.terrain, state.height, state.tanks[1])).toBe(false);
    const real = fireFor(state, plan.angle, plan.power, plan.weapon);
    expect(real.events.filter((e) => e.type === 'mound')).toHaveLength(1);
    expect(isWalledIn(state.terrain, state.height, state.tanks[1])).toBe(true);
    // the enemy's direct line is now blocked by its own wall
    const blocked = simulateShot(worldOf(state), state.tanks[1], 172, 100, 'standard').impacts[0]!;
    expect(blocked.x).toBeGreaterThan(state.tanks[1].x - 60);
  });

  it('does not waste a second mound on an enemy that is already walled in, or use one when ahead', () => {
    const walled = flatGame();
    walled.tanks[0].hp = 30;
    addMound(walled.terrain, walled.tanks[1].x, MOUND_RADIUS, MOUND_HEIGHT, [{ x: walled.tanks[1].x, halfWidth: 16 }]);
    expect(planShot(walled, 0, 'savant', createRng(1)).weapon).not.toBe('mound');

    const ahead = flatGame();
    ahead.tanks[1].hp = 30;
    expect(planShot(ahead, 0, 'savant', createRng(1)).weapon).not.toBe('mound');

    const none = flatGame();
    none.tanks[0].hp = 30;
    none.tanks[0].ammo.mound = 0;
    expect(planShot(none, 0, 'savant', createRng(1)).weapon).not.toBe('mound');
  });

  it('the Tactician does not use the mound at all', () => {
    const state = flatGame();
    state.tanks[0].hp = 30;
    const rng = createRng(2);
    for (let i = 0; i < 25; i++) expect(planShot(state, 0, 'tactician', rng).weapon).not.toBe('mound');
  });
});

describe('whole matches, AI against AI', () => {
  function match(seed: number, left: Difficulty, right: Difficulty) {
    const state = createGame({ seed });
    const rng = createRng(seed * 31 + 7);
    const shots = [0, 0];
    while (state.phase !== 'over' && state.turn < 120) {
      const who = state.current;
      const plan = planShot(state, who, who === 0 ? left : right, rng, { shotsTaken: shots[who] });
      shots[who]! += 1;
      expect(selectWeapon(state, plan.weapon)).toBe(true);
      setAim(state, plan.angle, plan.power);
      expect(fire(state, { autoSplit: plan.autoSplit })).toBe(true);
      runUntilSettled(state);
      state.events.length = 0;
      // tanks always end a turn standing on the ground, inside the map
      for (const tank of state.tanks) {
        expect(tank.y).toBe(restingY(state.terrain, state.height, tank.x));
        expect(tank.x).toBeGreaterThan(0);
        expect(tank.x).toBeLessThan(state.width);
      }
    }
    return state;
  }

  it('the Savant beats the Recruit, from either side', () => {
    for (const seed of [1, 2, 3]) {
      expect(match(seed, 'savant', 'recruit').winner).toBe(0);
      expect(match(seed, 'recruit', 'savant').winner).toBe(1);
    }
  });

  it('a match between two Recruits still ends', () => {
    const state = match(4, 'recruit', 'recruit');
    expect(state.phase).toBe('over');
    expect(state.winner).not.toBeNull();
  });
});
