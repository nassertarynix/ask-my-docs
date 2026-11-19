/** Glue between GEM // MERCHANTS and the room session: how to start, play, describe and (carefully) read its messages. */
import { createRng } from '../crater-lab/engine/rng';
import { cleanName } from '../../net/protocol';
import type { Adapter } from '../../net/session';
import { chooseAction, type BotLevel } from './ai';
import { GEMS, PATRONS, type Gem, type Level, type Token } from './cards';
import { apply, describe, newGame, type Action, type Source, type State } from './engine';

export interface GemSetup {
  players: { name: string; kind: 'human' | 'bot'; level?: BotLevel }[];
  seed: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isGem = (v: unknown): v is Gem => typeof v === 'string' && (GEMS as readonly string[]).includes(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isLevel = (v: unknown): v is Level => v === 1 || v === 2 || v === 3;

/** Read an action that came from the network. Anything not exactly the shape of an action is null. */
export function parseAction(raw: unknown): Action | null {
  if (!isRecord(raw)) return null;
  switch (raw.type) {
    case 'take3':
      return Array.isArray(raw.gems) && raw.gems.length >= 1 && raw.gems.length <= 3 && raw.gems.every(isGem) && new Set(raw.gems).size === raw.gems.length ? { type: 'take3', gems: raw.gems as Gem[] } : null;
    case 'take2':
      return isGem(raw.gem) ? { type: 'take2', gem: raw.gem } : null;
    case 'reserve':
      return isLevel(raw.level) && (raw.slot === 'deck' || isInt(raw.slot, 0, 3)) ? { type: 'reserve', level: raw.level, slot: raw.slot as number | 'deck' } : null;
    case 'buy': {
      const from = raw.from;
      if (!isRecord(from)) return null;
      let source: Source | null = null;
      if (isLevel(from.level) && isInt(from.slot, 0, 3)) source = { level: from.level, slot: from.slot };
      else if (isInt(from.reserved, 0, 2)) source = { reserved: from.reserved };
      return source ? { type: 'buy', from: source } : null;
    }
    case 'return':
      return isGem(raw.token) || raw.token === 'gold' ? { type: 'return', token: raw.token as Token } : null;
    case 'patron':
      return isInt(raw.id, 0, PATRONS.length - 1) ? { type: 'patron', id: raw.id } : null;
    case 'pass':
      return { type: 'pass' };
    default:
      return null;
  }
}

export function parseSetup(raw: unknown): GemSetup | null {
  if (!isRecord(raw) || !Array.isArray(raw.players) || !isInt(raw.seed, 0, 0xffffffff)) return null;
  if (raw.players.length < 2 || raw.players.length > 4) return null;
  const players: GemSetup['players'] = [];
  for (const p of raw.players) {
    if (!isRecord(p) || (p.kind !== 'human' && p.kind !== 'bot')) return null;
    const name = cleanName(p.name) || (p.kind === 'bot' ? 'Computer' : 'Player');
    const level = p.level === 'easy' || p.level === 'normal' || p.level === 'hard' ? p.level : undefined;
    players.push(level ? { name, kind: p.kind, level } : { name, kind: p.kind });
  }
  return { players, seed: raw.seed };
}

export const gemAdapter: Adapter<State, Action, GemSetup> = {
  start: (d) => newGame(d.players.length, d.seed),
  apply: (s, seat, a) => (seat === s.turn ? apply(s, a) : null),
  turn: (s) => s.turn,
  over: (s) => s.phase === 'over',
  bot: (s, d, seat, step) => chooseAction(s, d.players[seat]?.level ?? 'normal', createRng((d.seed * 7919 + step * 104729) >>> 0)),
  seats: (d) => d.players.map((p) => p.kind),
  parseData: parseSetup,
  parseAction,
  describe: (before, seat, action, d) => describe(before, action, d.players[seat]?.name ?? `Player ${seat + 1}`),
};
