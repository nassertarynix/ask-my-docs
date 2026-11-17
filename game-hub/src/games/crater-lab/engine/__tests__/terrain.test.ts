import { describe, expect, it } from 'vitest';
import {
  FALL_DAMAGE_MAX,
  FALL_DAMAGE_THRESHOLD,
  MAX_ELEVATION,
  MIN_ELEVATION,
  TANK_HALF_WIDTH,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../types';
import { createRng } from '../rng';
import {
  SPAWN_X,
  addMound,
  carveCrater,
  elevationAt,
  fallDamage,
  generateTerrain,
  groundY,
  restingY,
  settleTank,
  surfaceSlope,
} from '../terrain';
import { flatTerrain, makeTank } from './helpers';

const H = WORLD_HEIGHT;

describe('terrain generation', () => {
  it('is the same for the same seed and different for another', () => {
    const a = generateTerrain(createRng(7));
    const b = generateTerrain(createRng(7));
    const c = generateTerrain(createRng(8));
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it.each([1, 2, 3, 42, 999, 123456])('seed %i: right size, inside the limits, no spikes, level spawn pads', (seed) => {
    const t = generateTerrain(createRng(seed));
    expect(t).toBeInstanceOf(Float32Array);
    expect(t.length).toBe(WORLD_WIDTH);
    let steepest = 0;
    for (let x = 0; x < t.length; x++) {
      expect(t[x]).toBeGreaterThanOrEqual(MIN_ELEVATION);
      expect(t[x]).toBeLessThanOrEqual(MAX_ELEVATION);
      if (x > 0) steepest = Math.max(steepest, Math.abs(t[x]! - t[x - 1]!));
    }
    expect(steepest).toBeLessThan(8); // no one-pixel cliffs
    for (const sx of SPAWN_X) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let x = sx - 30; x <= sx + 30; x++) {
        lo = Math.min(lo, t[x]!);
        hi = Math.max(hi, t[x]!);
      }
      expect(hi - lo).toBeLessThan(0.01); // a tank starts on level ground
    }
  });

  it('actually has hills (it is not a flat line)', () => {
    const t = generateTerrain(createRng(5));
    const mid = Array.from(t.slice(250, 950));
    expect(Math.max(...mid) - Math.min(...mid)).toBeGreaterThan(40);
  });
});

describe('reading the surface', () => {
  it('interpolates between columns and extends the edges', () => {
    const t = new Float32Array([100, 110, 130]);
    expect(elevationAt(t, 0.5)).toBeCloseTo(105);
    expect(elevationAt(t, 1.25)).toBeCloseTo(115);
    expect(elevationAt(t, -50)).toBe(100);
    expect(elevationAt(t, 99)).toBe(130);
    expect(groundY(t, 600, 1)).toBe(490);
  });

  it('slope is positive where the ground falls away to the right (screen coordinates)', () => {
    const t = new Float32Array(100).map((_, x) => 300 - x); // elevation drops 1 px per px
    expect(surfaceSlope(t, 50)).toBeCloseTo(1);
    expect(surfaceSlope(flatTerrain(200, 100), 50)).toBeCloseTo(0);
  });
});

describe('carving a crater', () => {
  it('subtracts a circle: each column loses sqrt(r² - dx²) when the blast is at the surface', () => {
    const t = flatTerrain(200);
    const r = 40;
    carveCrater(t, H, 600, H - 200, r, 0);
    expect(t[600]).toBeCloseTo(200 - 40, 4);
    expect(t[600 + 24]).toBeCloseTo(200 - 32, 4); // 24-32-40 triangle
    expect(t[600 - 24]).toBeCloseTo(200 - 32, 4);
    expect(t[600 + 32]).toBeCloseTo(200 - 24, 4);
    expect(t[600 + 40]).toBeCloseTo(200, 4); // the rim itself
    expect(t[600 + 41]).toBe(200);
    expect(t[500]).toBe(200);
  });

  it('removes about half the circle\'s area when the blast is at the surface', () => {
    const t = flatTerrain(200);
    const r = 40;
    const { removed } = carveCrater(t, H, 600, H - 200, r, 0);
    expect(removed).toBeGreaterThan(0.98 * (Math.PI * r * r) / 2);
    expect(removed).toBeLessThan(1.02 * (Math.PI * r * r) / 2);
    let lost = 0;
    for (let x = 0; x < t.length; x++) lost += 200 - t[x]!;
    expect(lost).toBeCloseTo(removed, 1); // the reported number is what really left the map
  });

  it('pushes up a smooth lip just outside the rim, and nothing beyond it', () => {
    const t = flatTerrain(200);
    const r = 40;
    const { raised } = carveCrater(t, H, 600, H - 200, r);
    expect(raised).toBeGreaterThan(0);
    const lipPeak = Math.max(...Array.from(t.slice(640, 660)));
    expect(lipPeak).toBeGreaterThan(200 + r * 0.1);
    expect(lipPeak).toBeLessThanOrEqual(200 + r * 0.12 + 0.01);
    expect(t[600 + 59]).toBe(200); // 1.45 r = 58
    expect(t[600 - 59]).toBe(200);
    // smooth: the lip rises and falls without a jump
    for (let x = 641; x < 659; x++) expect(Math.abs(t[x]! - t[x - 1]!)).toBeLessThan(1.5);
  });

  it('a buried blast removes the whole chord and the dirt above drops down', () => {
    const t = flatTerrain(200);
    carveCrater(t, H, 600, H - 100, 30, 0); // centre 100 px underground
    expect(t[600]).toBeCloseTo(200 - 60, 4);
    expect(t[600 + 18]).toBeCloseTo(200 - 48, 4); // 18-24-30 triangle: chord 2 * 24
  });

  it('a blast in the air that does not reach the ground changes nothing', () => {
    const t = flatTerrain(200);
    const before = Array.from(t);
    const result = carveCrater(t, H, 600, H - 260, 40);
    expect(result).toEqual({ removed: 0, raised: 0 });
    expect(Array.from(t)).toEqual(before);
  });

  it('a blast partly in the air only removes the part that overlaps the ground', () => {
    const t = flatTerrain(200);
    carveCrater(t, H, 600, H - 220, 40, 0); // centre 20 px above the surface
    expect(t[600]).toBeCloseTo(180, 4);
    expect(t[600 + 35]).toBe(200); // at dx 35 the circle only reaches down to 220 - 19.4
  });

  it('never digs below bedrock, however many times it is hit', () => {
    const t = flatTerrain(60);
    for (let i = 0; i < 20; i++) carveCrater(t, H, 600, groundY(t, H, 600), 45);
    expect(Math.min(...Array.from(t))).toBeGreaterThanOrEqual(MIN_ELEVATION);
    expect(t[600]).toBe(MIN_ELEVATION);
  });

  it('clips cleanly at the edges of the map', () => {
    const t = flatTerrain(200);
    expect(() => carveCrater(t, H, 3, H - 200, 40)).not.toThrow();
    expect(() => carveCrater(t, H, WORLD_WIDTH + 10, H - 200, 40)).not.toThrow();
    expect(t[0]).toBeLessThan(200);
    expect(t.length).toBe(WORLD_WIDTH);
  });
});

describe('building a mound', () => {
  it('adds a raised-cosine hill: full height in the middle, nothing at the edge, symmetric', () => {
    const t = flatTerrain(150);
    const added = addMound(t, 600, 60, 80);
    expect(t[600]).toBeCloseTo(230, 4);
    expect(t[630]).toBeCloseTo(150 + 40, 3); // half way out is half height
    expect(t[570]).toBeCloseTo(t[630]!, 4);
    expect(t[660]).toBe(150);
    expect(t[540]).toBe(150);
    expect(added).toBeCloseTo(80 * 60, -1); // the area under a raised cosine is height * radius
    let gained = 0;
    for (let x = 0; x < t.length; x++) gained += t[x]! - 150;
    expect(gained).toBeCloseTo(added, 1);
  });

  it('never builds above the ceiling', () => {
    const t = flatTerrain(MAX_ELEVATION - 10);
    addMound(t, 600, 60, 80);
    expect(Math.max(...Array.from(t))).toBe(MAX_ELEVATION);
  });

  it('leaves a tank\'s footprint clear, so the tank ends up between two walls', () => {
    const t = flatTerrain(150);
    addMound(t, 600, 60, 80, [{ x: 600, halfWidth: TANK_HALF_WIDTH + 2 }]);
    for (let x = 600 - TANK_HALF_WIDTH; x <= 600 + TANK_HALF_WIDTH; x++) expect(t[x]).toBe(150);
    expect(t[600 + 26]).toBeGreaterThan(150 + 40);
    expect(t[600 - 26]).toBeGreaterThan(150 + 40);
    expect(restingY(t, H, 600)).toBe(H - 150); // the tank has not been lifted
  });

  it('a crater then a mound in the same place roughly fills the hole back in', () => {
    const t = flatTerrain(200);
    carveCrater(t, H, 600, H - 200, 40, 0);
    expect(t[600]).toBeCloseTo(160, 4);
    addMound(t, 600, 58, 74);
    expect(t[600]).toBeGreaterThan(200);
  });
});

describe('tanks settling on the ground', () => {
  it('fall damage starts past the threshold, grows with the drop and is capped', () => {
    expect(fallDamage(0)).toBe(0);
    expect(fallDamage(FALL_DAMAGE_THRESHOLD)).toBe(0);
    expect(fallDamage(FALL_DAMAGE_THRESHOLD + 1)).toBe(1);
    expect(fallDamage(88)).toBe(14);
    expect(fallDamage(120)).toBeGreaterThan(fallDamage(88));
    expect(fallDamage(5000)).toBe(FALL_DAMAGE_MAX);
  });

  it('a tank stands on the highest ground under its tracks', () => {
    const t = flatTerrain(200);
    t[608] = 215;
    expect(restingY(t, H, 600)).toBe(H - 215);
  });

  it('a tank on solid ground does not move', () => {
    const t = flatTerrain(200);
    const tank = makeTank(0, 600, t);
    expect(settleTank(tank, t, H)).toBeNull();
    expect(tank.y).toBe(400);
    expect(tank.falling).toBe(false);
  });

  it('when the ground under it is blown away it falls over several ticks, lands on the new surface and is hurt', () => {
    const t = flatTerrain(300);
    const tank = makeTank(0, 600, t);
    const startY = tank.y;
    carveCrater(t, H, 600, H - 300, 110, 0); // a 110 px hole right under it
    const target = restingY(t, H, 600);
    expect(target - startY).toBeGreaterThan(90);

    const ys: number[] = [];
    let landing = null;
    for (let i = 0; i < 300 && !landing; i++) {
      landing = settleTank(tank, t, H);
      ys.push(tank.y);
    }
    expect(ys.length).toBeGreaterThan(20); // it takes real time: no teleporting
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeGreaterThanOrEqual(ys[i - 1]!); // only ever downwards
    expect(ys[1]! - ys[0]!).toBeLessThan(ys[ys.length - 2]! - ys[ys.length - 3]!); // and accelerating
    expect(tank.y).toBe(target);
    expect(tank.falling).toBe(false);
    expect(landing!.drop).toBeCloseTo(target - startY, 5);
    expect(landing!.damage).toBe(fallDamage(target - startY));
    expect(landing!.damage).toBeGreaterThan(0);
  });

  it('a short drop does not hurt', () => {
    const t = flatTerrain(300);
    const tank = makeTank(0, 600, t);
    carveCrater(t, H, 600, H - 300, 15, 0);
    let landing = null;
    for (let i = 0; i < 100 && !landing; i++) landing = settleTank(tank, t, H);
    expect(landing!.drop).toBeGreaterThan(5);
    expect(landing!.damage).toBe(0);
  });

  it('if the ground rises under a tank (a crater rim) the tank is lifted with it', () => {
    const t = flatTerrain(200);
    const tank = makeTank(0, 600, t);
    for (let x = 590; x <= 610; x++) t[x] = 204;
    expect(settleTank(tank, t, H)).toBeNull();
    expect(tank.y).toBe(H - 204);
  });
});
