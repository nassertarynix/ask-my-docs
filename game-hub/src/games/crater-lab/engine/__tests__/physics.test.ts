import { describe, expect, it } from 'vitest';
import {
  BARREL_LENGTH,
  DRAG,
  DT,
  GRAVITY,
  MAX_POWER,
  SPEED_PER_POWER,
  SUBSTEPS,
  TANK_HEIGHT,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type Projectile,
} from '../types';
import {
  MAX_BOUNCES,
  advanceFlight,
  bounceOffTerrain,
  createProjectile,
  integrate,
  launchVelocity,
  muzzlePosition,
  simulateShot,
  splitProjectile,
  tankAt,
} from '../physics';
import { groundY } from '../terrain';
import { flatTerrain, makeWorld } from './helpers';

const H = WORLD_HEIGHT;

function shell(overrides: Partial<Projectile> = {}): Projectile {
  return { id: 1, weapon: 'standard', owner: 0, x: 100, y: 100, vx: 0, vy: 0, age: 0, bounces: 0, canSplit: false, autoSplit: false, fragment: false, ...overrides };
}

describe('launching', () => {
  it('0° is right, 90° is up, 180° is left, and speed scales with power', () => {
    expect(launchVelocity(0, 50).x).toBeCloseTo(50 * SPEED_PER_POWER);
    expect(launchVelocity(0, 50).y).toBeCloseTo(0);
    expect(launchVelocity(90, 50).y).toBeCloseTo(-50 * SPEED_PER_POWER); // up is negative y
    expect(launchVelocity(180, 50).x).toBeCloseTo(-50 * SPEED_PER_POWER);
    expect(Math.hypot(launchVelocity(37, 80).x, launchVelocity(37, 80).y)).toBeCloseTo(80 * SPEED_PER_POWER);
  });

  it('the shot starts at the end of the barrel, outside the tank', () => {
    const world = makeWorld(flatTerrain());
    const tank = world.tanks[0];
    for (const angle of [0, 30, 90, 150, 180]) {
      const m = muzzlePosition(tank, angle);
      expect(Math.hypot(m.x - tank.x, m.y - (tank.y - TANK_HEIGHT))).toBeCloseTo(BARREL_LENGTH);
      expect(tankAt(world.tanks, m.x, m.y - 0.01)).toBeNull();
    }
  });
});

describe('integration', () => {
  it('matches the exact solution of dv/dt = a - k·v after two seconds', () => {
    // With linear drag the velocity has a closed form: v(t) = a/k + (v0 - a/k)·e^(-kt).
    const wind = 9;
    const p = shell({ vx: 200, vy: -300 });
    const h = DT / SUBSTEPS;
    const steps = 2 / h;
    for (let i = 0; i < steps; i++) integrate(p, wind, h);
    const exact = (a: number, v0: number) => a / DRAG + (v0 - a / DRAG) * Math.exp(-DRAG * 2);
    expect(p.vx).toBeCloseTo(exact(wind, 200), 1);
    expect(p.vy).toBeCloseTo(exact(GRAVITY, -300), 1);
    // position: x(t) = (a/k)t + (v0 - a/k)(1 - e^(-kt))/k
    const exactX = (a: number, v0: number) => (a / DRAG) * 2 + ((v0 - a / DRAG) * (1 - Math.exp(-DRAG * 2))) / DRAG;
    // positions are first-order accurate: within 1.5 px of exact after two seconds of flight
    expect(Math.abs(p.x - 100 - exactX(wind, 200))).toBeLessThan(1.5);
    expect(Math.abs(p.y - 100 - exactX(GRAVITY, -300))).toBeLessThan(1.5);
  });

  it('on level ground with no wind the range is close to v²·sin(2θ)/g (drag makes it slightly shorter)', () => {
    const world = makeWorld(flatTerrain(200));
    const result = simulateShot(world, world.tanks[0], 45, 60, 'standard');
    const landed = result.impacts[0]!;
    const v = 60 * SPEED_PER_POWER;
    const ideal = (v * v) / GRAVITY;
    const range = landed.x - muzzlePosition(world.tanks[0], 45).x;
    expect(range).toBeLessThan(ideal * 1.06); // the muzzle is a little above the ground, which adds a few px
    expect(range).toBeGreaterThan(ideal * 0.94);
  });

  it('even the fastest shot moves less than 3 px between collision checks', () => {
    const perSubstep = (MAX_POWER * SPEED_PER_POWER * DT) / SUBSTEPS;
    expect(perSubstep).toBeLessThan(3);
  });
});

describe('deterministic trajectories under wind', () => {
  it('the same shot always follows exactly the same path', () => {
    const fly = () => {
      const world = makeWorld(flatTerrain(180), 11.5);
      return simulateShot(world, world.tanks[0], 52, 71, 'standard');
    };
    const a = fly();
    const b = fly();
    expect(a.path).toEqual(b.path);
    expect(a.impacts).toEqual(b.impacts);
    expect(a.ticks).toBe(b.ticks);
    expect(a.path.length).toBeGreaterThan(100);
  });

  it('lands at a pinned position (a change here means the physics changed)', () => {
    const world = makeWorld(flatTerrain(180), 11.5);
    const result = simulateShot(world, world.tanks[0], 52, 71, 'standard');
    expect(result.impacts).toHaveLength(1);
    expect(result.impacts[0]!.x).toBeCloseTo(PINNED_X, 3);
    expect(result.ticks).toBe(PINNED_TICKS);
  });

  it('wind pushes the landing point the way it blows, more for more wind', () => {
    const landing = (wind: number) => {
      const world = makeWorld(flatTerrain(180), wind);
      return simulateShot(world, world.tanks[0], 60, 60, 'standard').impacts[0]!.x;
    };
    const xs = [-15, -7.5, 0, 7.5, 15].map(landing);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]! + 20);
    // constant acceleration: the drift is (nearly) linear in the wind
    expect(xs[4]! - xs[2]!).toBeCloseTo(xs[2]! - xs[0]!, -1);
  });

  it('a mirrored shot in mirrored wind lands mirrored', () => {
    const left = makeWorld(flatTerrain(180), 8, [300, 900]);
    const right = makeWorld(flatTerrain(180), -8, [300, 900]);
    const a = simulateShot(left, left.tanks[0], 50, 58, 'standard').impacts[0]!;
    const b = simulateShot(right, right.tanks[1], 130, 58, 'standard').impacts[0]!;
    expect(b.x - 900).toBeCloseTo(-(a.x - 300), 6);
    expect(b.y).toBeCloseTo(a.y, 6);
  });

  it('a headwind can blow a high lob back behind the shooter', () => {
    const world = makeWorld(flatTerrain(180), -15, [600, 1000]);
    const result = simulateShot(world, world.tanks[0], 88, 90, 'standard');
    expect(result.impacts[0]!.x).toBeLessThan(580);
  });

  it('simulating changes nothing in the world', () => {
    const world = makeWorld(flatTerrain(180), 5);
    const terrainBefore = Array.from(world.terrain);
    const tanksBefore = JSON.stringify(world.tanks);
    simulateShot(world, world.tanks[0], 45, 80, 'bouncer');
    simulateShot(world, world.tanks[0], 45, 80, 'splitter', { autoSplit: true });
    expect(Array.from(world.terrain)).toEqual(terrainBefore);
    expect(JSON.stringify(world.tanks)).toBe(tanksBefore);
  });
});

describe('collisions', () => {
  it('a flat-out shot does not tunnel through a ridge only 3 px thick', () => {
    const terrain = flatTerrain(100);
    for (let x = 600; x < 603; x++) terrain[x] = 420;
    const world = makeWorld(terrain, 0, [450, 1070]);
    for (const angle of [5, 10, 15, 20]) {
      const hit = simulateShot(world, world.tanks[0], angle, MAX_POWER, 'standard').impacts[0]!;
      expect(hit.x).toBeGreaterThan(596);
      expect(hit.x).toBeLessThan(604);
    }
  });

  it('a shot aimed at a tank hits the tank, not the ground behind it', () => {
    const world = makeWorld(flatTerrain(200), 0, [300, 520]);
    const hit = simulateShot(world, world.tanks[0], 3, MAX_POWER, 'standard').impacts[0]!;
    expect(hit.tank).toBe(1);
    expect(Math.abs(hit.x - 520)).toBeLessThanOrEqual(15);
  });

  it('a wreck is not solid', () => {
    const world = makeWorld(flatTerrain(200), 0, [300, 520]);
    world.tanks[1].hp = 0;
    const hit = simulateShot(world, world.tanks[0], 3, MAX_POWER, 'standard').impacts[0]!;
    expect(hit.tank).toBeNull();
    expect(hit.x).toBeGreaterThan(540);
  });

  it('straight up with no wind comes back down on the shooter', () => {
    const world = makeWorld(flatTerrain(200));
    const hit = simulateShot(world, world.tanks[0], 90, 40, 'standard').impacts[0]!;
    expect(hit.tank).toBe(0);
  });

  it('a shot that leaves the map is reported as out, not as a hit', () => {
    const world = makeWorld(flatTerrain(200), 15);
    const result = simulateShot(world, world.tanks[1], 20, MAX_POWER, 'standard');
    expect(result.impacts).toHaveLength(1);
    expect(result.impacts[0]!.out).toBe(true);
    expect(result.impacts[0]!.x).toBeGreaterThan(WORLD_WIDTH);
  });

  it('the path ends exactly where the shell lands', () => {
    const world = makeWorld(flatTerrain(200), 4);
    const result = simulateShot(world, world.tanks[0], 55, 60, 'standard');
    const end = result.path[result.path.length - 1]!;
    expect(end.x).toBeCloseTo(result.impacts[0]!.x, 6);
    expect(end.y).toBeCloseTo(groundY(world.terrain, H, end.x), 6);
    for (const p of result.path.slice(0, -1)) expect(p.y).toBeLessThan(groundY(world.terrain, H, p.x));
  });

  it('maxTicks cuts the simulation short (the aim preview)', () => {
    const world = makeWorld(flatTerrain(200), 4);
    const short = simulateShot(world, world.tanks[0], 55, 60, 'standard', { maxTicks: 30 });
    expect(short.ticks).toBe(30);
    expect(short.impacts).toHaveLength(0);
    expect(short.path).toHaveLength(31);
  });
});

describe('a buried barrel', () => {
  it('a shell that starts inside the ground goes off where it is, not on the surface above', () => {
    const terrain = flatTerrain(200);
    for (let x = 140; x < 200; x++) terrain[x] = 330; // a wall right in front of the barrel
    const world = makeWorld(terrain);
    const muzzle = muzzlePosition(world.tanks[0], 10);
    const hit = simulateShot(world, world.tanks[0], 10, 80, 'standard').impacts[0]!;
    expect(Math.hypot(hit.x - muzzle.x, hit.y - muzzle.y)).toBeLessThan(4);
    expect(hit.y).toBeGreaterThan(groundY(terrain, H, hit.x) + 50); // well below the top of the wall
  });
});

describe('the bouncing rubber bomb', () => {
  it('bounces three times and goes off on the fourth touch', () => {
    const world = makeWorld(flatTerrain(200), 0, [100, 1150]);
    const projectiles = [createProjectile(1, world.tanks[0], 60, 45, 'bouncer', false)];
    const bounces: number[] = [];
    let detonation: { x: number } | null = null;
    for (let i = 0; i < 3000 && projectiles.length > 0; i++) {
      for (const e of advanceFlight(projectiles, world, { value: 2 })) {
        if (e.type === 'bounce') bounces.push(e.x);
        if (e.type === 'detonate') detonation = e;
      }
    }
    expect(bounces).toHaveLength(MAX_BOUNCES);
    expect(detonation).not.toBeNull();
    // each hop is shorter than the one before, and it keeps travelling forwards
    const hops = [bounces[1]! - bounces[0]!, bounces[2]! - bounces[1]!, detonation!.x - bounces[2]!];
    expect(hops[0]).toBeGreaterThan(hops[1]!);
    expect(hops[1]).toBeGreaterThan(hops[2]!);
    expect(hops[2]).toBeGreaterThan(5);
  });

  it('a standard shell does not bounce', () => {
    const world = makeWorld(flatTerrain(200));
    const result = simulateShot(world, world.tanks[0], 60, 45, 'standard');
    const bouncer = simulateShot(world, world.tanks[0], 60, 45, 'bouncer');
    expect(bouncer.impacts[0]!.x).toBeGreaterThan(result.impacts[0]!.x + 50);
    expect(bouncer.ticks).toBeGreaterThan(result.ticks);
  });

  it('goes off at once on a direct tank hit, bounces left or not', () => {
    const world = makeWorld(flatTerrain(200), 0, [300, 520]);
    const hit = simulateShot(world, world.tanks[0], 3, MAX_POWER, 'bouncer').impacts[0]!;
    expect(hit.tank).toBe(1);
  });

  it('reflects about the surface: straight down onto a 45° slope leaves sideways, slower', () => {
    const terrain = new Float32Array(WORLD_WIDTH).map((_, x) => 400 - x); // falls away to the right
    const p = shell({ weapon: 'bouncer', x: 200, y: H - 200, vx: 0, vy: 100 });
    bounceOffTerrain(p, terrain, H);
    expect(p.vx).toBeGreaterThan(40); // kicked downhill
    expect(Math.hypot(p.vx, p.vy)).toBeLessThan(100); // it lost energy
    expect(p.bounces).toBe(1);
    expect(p.y).toBeLessThan(groundY(terrain, H, p.x)); // and sits just above the surface
  });

  it('on flat ground a bounce keeps most of the sideways speed and reverses the vertical', () => {
    const p = shell({ weapon: 'bouncer', x: 200, y: 400, vx: 100, vy: 80 });
    bounceOffTerrain(p, flatTerrain(200), H);
    expect(p.vx).toBeCloseTo(90);
    expect(p.vy).toBeCloseTo(-80 * 0.62);
  });
});

describe('the tri-splitter', () => {
  it('splits into three fragments fanned at -12°, 0° and +12°, at the same speed', () => {
    const p = shell({ weapon: 'splitter', vx: 100, vy: 0, canSplit: true });
    const parts = splitProjectile(p, 10);
    expect(parts.map((q) => q.id)).toEqual([10, 11, 12]);
    const headings = parts.map((q) => (Math.atan2(q.vy, q.vx) * 180) / Math.PI);
    expect(headings[0]).toBeCloseTo(-12);
    expect(headings[1]).toBeCloseTo(0);
    expect(headings[2]).toBeCloseTo(12);
    for (const q of parts) {
      expect(Math.hypot(q.vx, q.vy)).toBeCloseTo(100);
      expect(q.fragment).toBe(true);
      expect(q.canSplit).toBe(false);
      expect(q.x).toBe(p.x);
    }
  });

  it('with autoSplit it splits at the top of the arc and lands in three places', () => {
    const world = makeWorld(flatTerrain(200), 0, [100, 1150]);
    const result = simulateShot(world, world.tanks[0], 60, 60, 'splitter', { autoSplit: true });
    expect(result.impacts).toHaveLength(3);
    expect(result.impacts.every((i) => i.fragment)).toBe(true);
    const xs = result.impacts.map((i) => i.x).sort((a, b) => a - b);
    expect(xs[1]! - xs[0]!).toBeGreaterThan(15);
    expect(xs[2]! - xs[1]!).toBeGreaterThan(15);
    // the recorded path stops at the split, which is the highest point
    const top = Math.min(...result.path.map((p) => p.y));
    expect(result.path[result.path.length - 1]!.y).toBeCloseTo(top, 0);
  });

  it('the middle fragment lands exactly where an unsplit shell would (the AI relies on this)', () => {
    const world = makeWorld(flatTerrain(200), 7, [100, 1150]);
    const plain = simulateShot(world, world.tanks[0], 58, 63, 'standard').impacts[0]!;
    const split = simulateShot(world, world.tanks[0], 58, 63, 'splitter', { autoSplit: true }).impacts;
    const middle = [...split].sort((a, b) => a.x - b.x)[1]!;
    expect(middle.x).toBeCloseTo(plain.x, 4);
  });

  it('without autoSplit and with nobody pressing fire it lands in one piece', () => {
    const world = makeWorld(flatTerrain(200));
    const result = simulateShot(world, world.tanks[0], 60, 60, 'splitter');
    expect(result.impacts).toHaveLength(1);
    expect(result.impacts[0]!.fragment).toBe(false);
  });
});

describe('black-hole pull on projectiles', () => {
  it('bends a passing shell towards the hole', () => {
    const world = makeWorld(flatTerrain(100));
    const free = [shell({ x: 300, y: 200, vx: 150, vy: 0 })];
    const pulled = [shell({ x: 300, y: 200, vx: 150, vy: 0 })];
    for (let i = 0; i < 40; i++) {
      advanceFlight(free, world, { value: 9 });
      advanceFlight(pulled, world, { value: 9 }, [{ x: 400, y: 100 }]); // a hole up and to the right
    }
    expect(pulled[0]!.y).toBeLessThan(free[0]!.y - 10); // lifted against gravity
  });

  it('has no effect beyond its range', () => {
    const world = makeWorld(flatTerrain(100));
    const free = [shell({ x: 300, y: 200, vx: 50, vy: 0 })];
    const far = [shell({ x: 300, y: 200, vx: 50, vy: 0 })];
    for (let i = 0; i < 20; i++) {
      advanceFlight(free, world, { value: 9 });
      advanceFlight(far, world, { value: 9 }, [{ x: 1100, y: 100 }]);
    }
    expect(far[0]!.x).toBe(free[0]!.x);
    expect(far[0]!.y).toBe(free[0]!.y);
  });
});

// Recorded from a known-good run; see the 'pinned position' test.
const PINNED_X = 927.424021;
const PINNED_TICKS = 198;
