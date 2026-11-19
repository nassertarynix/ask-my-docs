/** Glue between LABY // RINTH and the room session: how to start, play, describe and (carefully) read its messages. */
import { createRng } from '../crater-lab/engine/rng';
import { cleanName } from '../../net/protocol';
import type { Adapter } from '../../net/session';
import { chooseAction, type BotLevel } from './ai';
import { apply, describe, newGame, type Action, type State } from './engine';
import { MAZE } from './maze';

export interface LabySetup {
  players: { name: string; kind: 'human' | 'bot'; level?: BotLevel }[];
  seed: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const CELLS = MAZE.width * MAZE.height;

/** Read an action that came from the network. Anything not exactly the shape of an action is null. */
export function parseAction(raw: unknown): Action | null {
  if (!isRecord(raw)) return null;
  if (raw.type === 'move') return isInt(raw.hero, 0, 2) && isInt(raw.to, 0, CELLS - 1) ? { type: 'move', hero: raw.hero, to: raw.to } : null;
  if (raw.type === 'minotaur') return isInt(raw.to, 0, CELLS - 1) ? { type: 'minotaur', to: raw.to } : null;
  if (raw.type === 'wall') return (raw.from === 'supply' || isInt(raw.from, 0, CELLS - 1)) && isInt(raw.to, 0, CELLS - 1) ? { type: 'wall', from: raw.from as number | 'supply', to: raw.to } : null;
  return null;
}

export function parseSetup(raw: unknown): LabySetup | null {
  if (!isRecord(raw) || !Array.isArray(raw.players) || !isInt(raw.seed, 0, 0xffffffff)) return null;
  if (raw.players.length < 2 || raw.players.length > 4) return null;
  const players: LabySetup['players'] = [];
  for (const p of raw.players) {
    if (!isRecord(p) || (p.kind !== 'human' && p.kind !== 'bot')) return null;
    const name = cleanName(p.name) || (p.kind === 'bot' ? 'Computer' : 'Player');
    const level = p.level === 'easy' || p.level === 'normal' || p.level === 'hard' ? p.level : undefined;
    players.push(level ? { name, kind: p.kind, level } : { name, kind: p.kind });
  }
  return { players, seed: raw.seed };
}

export const labyAdapter: Adapter<State, Action, LabySetup> = {
  start: (d) => newGame(d.players.length, d.seed),
  apply: (s, seat, a) => (seat === s.turn ? apply(s, a) : null),
  turn: (s) => s.turn,
  over: (s) => s.phase === 'over',
  bot: (s, d, seat, step) => chooseAction(s, d.players[seat]?.level ?? 'normal', createRng((d.seed * 7919 + step * 104729) >>> 0)),
  seats: (d) => d.players.map((p) => p.kind),
  parseData: parseSetup,
  parseAction,
  describe: (before, _seat, action, d) => describe(before, action, d.players.map((p) => p.name)),
};
