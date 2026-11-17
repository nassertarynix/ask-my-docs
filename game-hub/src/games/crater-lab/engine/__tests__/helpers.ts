import { TANK_MAX_HP, WORLD_HEIGHT, WORLD_WIDTH, type GameState, type PlayerIndex, type Tank, type World } from '../types';
import { restingY } from '../terrain';
import { startingAmmo } from '../weapons';
import { createGame } from '../game';

/** Level ground at one elevation. */
export function flatTerrain(elevation = 200, width = WORLD_WIDTH): Float32Array {
  return new Float32Array(width).fill(elevation);
}

export function makeTank(index: PlayerIndex, x: number, terrain: Float32Array): Tank {
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

export function makeWorld(terrain: Float32Array, wind = 0, xs: [number, number] = [130, 1070]): World & { tanks: [Tank, Tank] } {
  return { width: terrain.length, height: WORLD_HEIGHT, terrain, tanks: [makeTank(0, xs[0], terrain), makeTank(1, xs[1], terrain)], wind };
}

/** A real game whose ground has been replaced: by flat ground by default, or by whatever `shape` returns. */
export function flatGame(options: { wind?: number; elevation?: number; xs?: [number, number]; shape?: (x: number) => number } = {}): GameState {
  const state = createGame({ seed: 1 });
  const elevation = options.elevation ?? 200;
  for (let x = 0; x < state.terrain.length; x++) state.terrain[x] = options.shape ? options.shape(x) : elevation;
  const xs = options.xs ?? [130, 1070];
  state.tanks.forEach((t, i) => {
    t.x = xs[i] ?? t.x;
    t.y = restingY(state.terrain, state.height, t.x);
  });
  state.wind = options.wind ?? 0;
  state.events.length = 0;
  return state;
}
