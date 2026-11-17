/**
 * The computer opponent.
 *
 * It does not read the answer off the game state. It finds a shot the way a (very fast) player
 * would: by flying candidate shots through the real physics (`simulateShot`, with this turn's wind
 * and the terrain as it is now) and keeping the one that lands closest. First a coarse grid over
 * angle and power, then Nelder-Mead refinement from the best few grid cells. The perfect answer is
 * then blurred by Gaussian aiming error, and how much depends on the difficulty.
 */
import {
  MAX_POWER,
  MIN_POWER,
  TANK_HALF_WIDTH,
  type GameState,
  type PlayerIndex,
  type Tank,
  type WeaponId,
  type World,
} from './types';
import { randomGaussian, nextRandom, type Rng } from './rng';
import { simulateShot, type ShotResult } from './physics';
import { elevationAt } from './terrain';
import { SPLIT_FRAGMENT, WEAPONS, blastDamage, tankCentre } from './weapons';
import { worldOf } from './game';

export type Difficulty = 'recruit' | 'tactician' | 'savant';

export interface DifficultyDef {
  id: Difficulty;
  name: string;
  blurb: string;
  /** Aiming error bound in degrees: about 95% of shots are within ± this of the solved angle. */
  angleNoise: number;
  /** Power error bound as a fraction: about 95% of shots are within ± this of the solved power. */
  powerNoise: number;
  /** Rejects shots that would land in its own blast radius. */
  avoidsSelfHits: boolean;
  /** Picks ammo by expected damage and context instead of at random. */
  smartAmmo: boolean;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  recruit: {
    id: 'recruit',
    name: 'Recruit',
    blurb: 'Enthusiastic. Rarely on target.',
    angleNoise: 12,
    powerNoise: 0.15,
    avoidsSelfHits: false,
    smartAmmo: false,
  },
  tactician: {
    id: 'tactician',
    name: 'Tactician',
    blurb: 'Brackets you in a few shots.',
    angleNoise: 4,
    powerNoise: 0.05,
    avoidsSelfHits: true,
    smartAmmo: false,
  },
  savant: {
    id: 'savant',
    name: 'Artillery Savant',
    blurb: 'Does the maths. All of it.',
    angleNoise: 0.8,
    powerNoise: 0.015,
    avoidsSelfHits: true,
    smartAmmo: true,
  },
};

/** The quoted noise figures are a ±2σ band, so the standard deviation is half of them. */
const NOISE_SIGMA = 0.5;
/** A shot that leaves the world is scored as this much worse than where it left. */
const OUT_PENALTY = 240;
/** A cost this low counts as solved: a direct hit within about 3 px of the middle of the tank. */
const GOOD_ENOUGH = 0.2;
/** A direct hit costs between 0 (dead centre) and this (the very edge), so refinement centres the hit. */
const EDGE_COST = 0.9;

export interface Evaluation {
  /** What the search minimises: the miss distance, plus penalties. */
  cost: number;
  /** Distance in px from the closest warhead to the middle of the target (0 for a direct hit). */
  miss: number;
  /** Distance in px from the closest warhead to the shooter's own tank. */
  selfDistance: number;
  result: ShotResult;
}

export interface SolveOptions {
  /** Penalise shots that land within their own blast radius of the shooter. */
  avoidSelfHits?: boolean;
  /** Split a Tri-Splitter at the top of its arc (how the AI always fires one). */
  autoSplit?: boolean;
}

/** Fly one candidate shot and score it. */
export function evaluateShot(
  world: World,
  shooter: Tank,
  target: Tank,
  angle: number,
  power: number,
  weapon: WeaponId,
  options: SolveOptions = {},
): Evaluation {
  const result = simulateShot(world, shooter, angle, power, weapon, { autoSplit: options.autoSplit ?? weapon === 'splitter', skipPath: true });
  const goal = tankCentre(target);
  const self = tankCentre(shooter);
  let miss = Infinity;
  let offCentre = 0;
  let selfDistance = Infinity;
  for (const hit of result.impacts) {
    const direct = hit.tank === target.index;
    const d = direct ? 0 : Math.hypot(hit.x - goal.x, hit.y - goal.y) + (hit.out ? OUT_PENALTY : 0);
    if (d < miss) {
      miss = d;
      offCentre = direct ? (Math.min(TANK_HALF_WIDTH, Math.abs(hit.x - goal.x)) / TANK_HALF_WIDTH) * EDGE_COST : 0;
    }
    if (!hit.out) {
      const s = hit.tank === shooter.index ? 0 : Math.hypot(hit.x - self.x, hit.y - self.y);
      if (s < selfDistance) selfDistance = s;
    }
  }
  if (!Number.isFinite(miss)) miss = world.width * 2; // nothing landed at all
  let cost = miss + offCentre;
  if (options.avoidSelfHits) {
    const danger = Math.max(WEAPONS[weapon].blastRadius, 40) + 12;
    if (selfDistance < danger) cost += 150 + (danger - selfDistance) * 4;
  }
  return { cost, miss, selfDistance, result };
}

export interface Solution {
  angle: number;
  power: number;
  cost: number;
  miss: number;
  selfDistance: number;
  /** How many candidate shots were flown to find it. */
  simulations: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Nelder-Mead simplex minimisation in two dimensions. `f` is called with clamped arguments,
 * so the simplex may wander past the bounds without ever evaluating an illegal shot.
 */
export function nelderMead2D(
  f: (a: number, b: number) => number,
  start: [number, number],
  stepSize: [number, number],
  maxIterations: number,
  goodEnough: number,
): { point: [number, number]; value: number; evaluations: number } {
  type Vertex = { p: [number, number]; v: number };
  let evaluations = 0;
  const at = (p: [number, number]): Vertex => {
    evaluations++;
    return { p, v: f(p[0], p[1]) };
  };
  let simplex: Vertex[] = [
    at(start),
    at([start[0] + stepSize[0], start[1]]),
    at([start[0], start[1] + stepSize[1]]),
  ];
  const sort = () => simplex.sort((x, y) => x.v - y.v);
  sort();
  for (let i = 0; i < maxIterations; i++) {
    const [best, mid, worst] = simplex as [Vertex, Vertex, Vertex];
    if (best.v <= goodEnough) break;
    const cx = (best.p[0] + mid.p[0]) / 2;
    const cy = (best.p[1] + mid.p[1]) / 2;
    const reflected = at([cx + (cx - worst.p[0]), cy + (cy - worst.p[1])]);
    if (reflected.v < best.v) {
      const expanded = at([cx + 2 * (cx - worst.p[0]), cy + 2 * (cy - worst.p[1])]);
      simplex = [best, mid, expanded.v < reflected.v ? expanded : reflected];
    } else if (reflected.v < mid.v) {
      simplex = [best, mid, reflected];
    } else {
      const towards = reflected.v < worst.v ? reflected : worst;
      const contracted = at([cx + 0.5 * (towards.p[0] - cx), cy + 0.5 * (towards.p[1] - cy)]);
      if (contracted.v < towards.v) {
        simplex = [best, mid, contracted];
      } else {
        // shrink everything towards the best vertex
        simplex = [
          best,
          at([best.p[0] + 0.5 * (mid.p[0] - best.p[0]), best.p[1] + 0.5 * (mid.p[1] - best.p[1])]),
          at([best.p[0] + 0.5 * (worst.p[0] - best.p[0]), best.p[1] + 0.5 * (worst.p[1] - best.p[1])]),
        ];
      }
    }
    sort();
  }
  const best = simplex[0] as Vertex;
  return { point: best.p, value: best.v, evaluations };
}

const ANGLE_MIN = 4;
const ANGLE_MAX = 176;
const GRID_ANGLE_STEP = 4;
const GRID_POWER_STEP = 5;
const REFINE_SEEDS = 5;
const REFINE_ITERATIONS = 30;
/** A candidate is also flown this far off (degrees, power) each way, to see how forgiving it is. */
const NUDGE_ANGLE = 1.5;
const NUDGE_POWER = 2;

/**
 * Find the angle and power that land `weapon` closest to `target`:
 * a coarse grid over the whole aim space, then Nelder-Mead from the best few cells.
 * Usually several quite different shots hit (a flat fast one, a high lob...). Among those the solver
 * keeps the most forgiving one: the shot that still lands closest when the aim is slightly off.
 */
export function solveShot(world: World, shooter: Tank, target: Tank, weapon: WeaponId, options: SolveOptions = {}): Solution {
  let simulations = 0;
  const cost = (angle: number, power: number): Evaluation => {
    simulations++;
    return evaluateShot(world, shooter, target, clamp(angle, ANGLE_MIN, ANGLE_MAX), clamp(power, MIN_POWER, MAX_POWER), weapon, options);
  };

  const grid: { angle: number; power: number; cost: number }[] = [];
  for (let angle = ANGLE_MIN + 2; angle <= ANGLE_MAX; angle += GRID_ANGLE_STEP) {
    for (let power = 15; power <= MAX_POWER; power += GRID_POWER_STEP) {
      grid.push({ angle, power, cost: cost(angle, power).cost });
    }
  }
  grid.sort((a, b) => a.cost - b.cost);

  // refine from the best cells, skipping cells close to one already chosen (the same basin)
  const seeds: typeof grid = [];
  for (const cell of grid) {
    if (seeds.length >= REFINE_SEEDS) break;
    if (seeds.some((s) => Math.abs(s.angle - cell.angle) <= GRID_ANGLE_STEP * 2 && Math.abs(s.power - cell.power) <= GRID_POWER_STEP * 2)) continue;
    seeds.push(cell);
  }

  const candidates = seeds.map((seed) => {
    if (seed.cost <= GOOD_ENOUGH) return seed;
    const refined = nelderMead2D(
      (a, p) => cost(a, p).cost,
      [seed.angle, seed.power],
      [GRID_ANGLE_STEP / 2, GRID_POWER_STEP / 2],
      REFINE_ITERATIONS,
      GOOD_ENOUGH,
    );
    return refined.value < seed.cost
      ? { angle: clamp(refined.point[0], ANGLE_MIN, ANGLE_MAX), power: clamp(refined.point[1], MIN_POWER, MAX_POWER), cost: refined.value }
      : seed;
  });
  candidates.sort((a, b) => a.cost - b.cost);

  let best = candidates[0] ?? { angle: 45, power: 50, cost: Infinity };
  const hits = candidates.filter((c) => c.cost < 1);
  if (hits.length > 1) {
    let bestSpread = Infinity;
    for (const c of hits) {
      const spread =
        cost(c.angle + NUDGE_ANGLE, c.power).cost +
        cost(c.angle - NUDGE_ANGLE, c.power).cost +
        cost(c.angle, c.power + NUDGE_POWER).cost +
        cost(c.angle, c.power - NUDGE_POWER).cost;
      if (spread < bestSpread) {
        bestSpread = spread;
        best = c;
      }
    }
  }
  const final = cost(best.angle, best.power);
  return { angle: best.angle, power: best.power, cost: final.cost, miss: final.miss, selfDistance: final.selfDistance, simulations };
}

/** Damage a shot would do to the target minus what it would do to the shooter, by the game's own blast rule. */
export function netDamage(world: World, shooter: Tank, target: Tank, angle: number, power: number, weapon: WeaponId): number {
  const result = simulateShot(world, shooter, angle, power, weapon, { autoSplit: weapon === 'splitter', skipPath: true });
  const goal = tankCentre(target);
  const self = tankCentre(shooter);
  let total = 0;
  for (const hit of result.impacts) {
    if (hit.out) continue;
    const blast = hit.fragment ? SPLIT_FRAGMENT : WEAPONS[weapon];
    total += blastDamage(blast.damage, blast.blastRadius, hit.tank === target.index ? 0 : Math.hypot(hit.x - goal.x, hit.y - goal.y));
    total -= blastDamage(blast.damage, blast.blastRadius, hit.tank === shooter.index ? 0 : Math.hypot(hit.x - self.x, hit.y - self.y));
  }
  return total;
}

/**
 * Average net damage of a shot if the aim is off by one standard deviation either way in angle
 * and in power (five shots: the plan itself and four nudged ones). A weapon that only works with
 * a perfect hit scores worse here than one that forgives a small error.
 */
export function expectedDamage(
  world: World,
  shooter: Tank,
  target: Tank,
  angle: number,
  power: number,
  weapon: WeaponId,
  angleSigma: number,
  powerSigma: number,
): number {
  const samples: [number, number][] = [
    [angle, power],
    [angle + angleSigma, power],
    [angle - angleSigma, power],
    [angle, power * (1 + powerSigma)],
    [angle, power * (1 - powerSigma)],
  ];
  let sum = 0;
  for (const [a, p] of samples) sum += netDamage(world, shooter, target, clamp(a, ANGLE_MIN, ANGLE_MAX), clamp(p, MIN_POWER, MAX_POWER), weapon);
  return sum / samples.length;
}

/** True when ground close to the tank on both sides already stands well above it (it is walled in). */
export function isWalledIn(terrain: Float32Array, worldHeight: number, tank: Tank): boolean {
  const base = worldHeight - tank.y;
  const wall = (dir: number) => Math.max(elevationAt(terrain, tank.x + dir * 26), elevationAt(terrain, tank.x + dir * 40)) - base;
  return wall(-1) > 30 && wall(1) > 30;
}

export interface AiShot {
  angle: number;
  power: number;
  weapon: WeaponId;
  /** The AI always lets a Tri-Splitter split at the top of its arc. */
  autoSplit: boolean;
  /** The solved shot before aiming error was added. */
  ideal: Solution;
  /** Why this ammo was chosen (shown in the UI's debug title, and asserted in tests). */
  reason: string;
}

export interface PlanOptions {
  /** How many shots this AI has already taken this match: it brackets, so its error shrinks a little each shot. */
  shotsTaken?: number;
}

/** The standard deviations of a difficulty's aiming error (degrees, and a fraction of the power). */
export function aimSigma(difficulty: Difficulty, shotsTaken = 0): { angle: number; power: number } {
  const def = DIFFICULTIES[difficulty];
  const ranging = rangingFactor(shotsTaken);
  return { angle: def.angleNoise * NOISE_SIGMA * ranging, power: def.powerNoise * NOISE_SIGMA * ranging };
}

/** Blur a solved aim with Gaussian error: additive on the angle, proportional on the power. */
export function addAimError(angle: number, power: number, angleSigma: number, powerSigma: number, rng: Rng): { angle: number; power: number } {
  return {
    angle: clamp(angle + randomGaussian(rng) * angleSigma, 0, 180),
    power: clamp(power * (1 + randomGaussian(rng) * powerSigma), MIN_POWER, MAX_POWER),
  };
}

/** How much of the aiming error is left after `shots` earlier shots (never less than 55%). */
export function rangingFactor(shots: number): number {
  return Math.max(0.55, Math.pow(0.9, Math.max(0, shots)));
}

/**
 * Plan the AI's turn: choose ammo, solve the shot, then add the difficulty's aiming error.
 * `rng` drives the error and the random ammo picks, so a seeded match replays exactly.
 */
export function planShot(state: GameState, shooterIndex: PlayerIndex, difficulty: Difficulty, rng: Rng, options: PlanOptions = {}): AiShot {
  const def = DIFFICULTIES[difficulty];
  const world = worldOf(state);
  const shooter = state.tanks[shooterIndex];
  const target = state.tanks[shooterIndex === 0 ? 1 : 0];
  const solve: SolveOptions = { avoidSelfHits: def.avoidsSelfHits };
  const { angle: angleSigma, power: powerSigma } = aimSigma(difficulty, options.shotsTaken ?? 0);
  const has = (w: WeaponId) => shooter.ammo[w] > 0;

  // A plain shell, a black hole and a mound all fly the same arc, and so does the middle fragment
  // of a shell that splits at the apex, so one solve covers four of the five ammo types.
  const plain = solveShot(world, shooter, target, 'standard', solve);
  let weapon: WeaponId = 'standard';
  let ideal = plain;
  let reason = 'standard shell';

  if (def.smartAmmo) {
    const losing = shooter.hp <= 45 && target.hp > shooter.hp;
    if (has('mound') && losing && !isWalledIn(state.terrain, state.height, target)) {
      weapon = 'mound';
      reason = 'losing: wall the enemy in';
    } else {
      // pick whatever is expected to do the most damage given its own (small) aiming error
      let bestScore = expectedDamage(world, shooter, target, plain.angle, plain.power, 'standard', angleSigma, powerSigma);
      const consider = (w: WeaponId, solution: Solution, why: string) => {
        const score = expectedDamage(world, shooter, target, solution.angle, solution.power, w, angleSigma, powerSigma);
        if (score > bestScore + 0.5) {
          bestScore = score;
          weapon = w;
          ideal = solution;
          reason = why;
        }
      };
      if (has('splitter')) consider('splitter', plain, 'a fan of three covers more ground here');
      if (has('blackhole')) consider('blackhole', plain, 'no clean hit: drag them in');
      if (has('bouncer') && plain.miss > 10) consider('bouncer', solveShot(world, shooter, target, 'bouncer', solve), 'no clean line: bounce it in');
    }
  } else {
    // less careful opponents reach for the odd ammo on a whim
    const whim = difficulty === 'recruit' ? 0.3 : 0.22;
    const specials = (['splitter', 'bouncer', 'blackhole', ...(difficulty === 'recruit' ? (['mound'] as const) : [])] as WeaponId[]).filter(has);
    if (specials.length > 0 && nextRandom(rng) < whim) {
      weapon = specials[Math.floor(nextRandom(rng) * specials.length)] ?? 'standard';
      reason = 'felt like it';
      if (weapon === 'bouncer') ideal = solveShot(world, shooter, target, 'bouncer', solve);
    }
  }

  const aim = addAimError(ideal.angle, ideal.power, angleSigma, powerSigma, rng);
  return { angle: aim.angle, power: aim.power, weapon, autoSplit: weapon === 'splitter', ideal, reason };
}
