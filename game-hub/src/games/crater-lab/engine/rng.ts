/**
 * A tiny seeded random generator (mulberry32). The engine never calls Math.random, so the same
 * seed always produces the same terrain, the same winds and the same AI mistakes.
 * The state is one 32-bit number, kept by the caller, so it can live inside the game state.
 */
export interface Rng {
  state: number;
}

export function createRng(seed: number): Rng {
  return { state: seed >>> 0 };
}

/** Next number in [0, 1). */
export function nextRandom(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomBetween(rng: Rng, min: number, max: number): number {
  return min + (max - min) * nextRandom(rng);
}

/** Normally distributed number with mean 0 and standard deviation 1 (Box-Muller). */
export function randomGaussian(rng: Rng): number {
  const u = Math.max(nextRandom(rng), 1e-12);
  const v = nextRandom(rng);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
