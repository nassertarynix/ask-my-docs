/** Glue between PIT // BRAWL and the room session: how to start, play, describe and (carefully) read its messages. */
import { createRng, nextRandom } from '../crater-lab/engine/rng';
import { cleanName } from '../../net/protocol';
import type { Adapter } from '../../net/session';
import { chooseAction, type BotLevel } from './ai';
import { HEROES } from './cards';
import { MAX_PLAYERS, apply, describe, newGame, type Action, type State } from './engine';

export interface BrawlSetup {
  players: { name: string; kind: 'human' | 'bot'; hero: number; level?: BotLevel }[];
  seed: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Read a play that came from the network. Anything not exactly the shape of a play is null. */
export function parseAction(raw: unknown): Action | null {
  if (!isRecord(raw) || raw.type !== 'play' || !isInt(raw.card, 0, HEROES.length * 10 - 1)) return null;
  if (raw.target === undefined) return { type: 'play', card: raw.card };
  return isInt(raw.target, 0, MAX_PLAYERS - 1) ? { type: 'play', card: raw.card, target: raw.target } : null;
}

export function parseSetup(raw: unknown): BrawlSetup | null {
  if (!isRecord(raw) || !Array.isArray(raw.players) || !isInt(raw.seed, 0, 0xffffffff)) return null;
  if (raw.players.length < 2 || raw.players.length > MAX_PLAYERS) return null;
  const players: BrawlSetup['players'] = [];
  for (const p of raw.players) {
    if (!isRecord(p) || (p.kind !== 'human' && p.kind !== 'bot') || !isInt(p.hero, 0, HEROES.length - 1)) return null;
    const name = cleanName(p.name) || (p.kind === 'bot' ? 'Computer' : 'Player');
    const level = p.level === 'easy' || p.level === 'normal' || p.level === 'hard' ? p.level : undefined;
    players.push(level ? { name, kind: p.kind, hero: p.hero, level } : { name, kind: p.kind, hero: p.hero });
  }
  if (new Set(players.map((p) => p.hero)).size !== players.length) return null;
  return { players, seed: raw.seed };
}

/** Distinct heroes for n players, in a seeded random order; `first`, if given, is the hero for seat 0. */
export function assignHeroes(n: number, seed: number, first: number | null = null): number[] {
  const rng = createRng(seed ^ 0x5bd1e995);
  const pool = HEROES.map((h) => h.id).filter((id) => id !== first);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(rng) * (i + 1));
    [pool[i], pool[j]] = [pool[j] as number, pool[i] as number];
  }
  return (first === null ? pool : [first, ...pool]).slice(0, n);
}

export const brawlAdapter: Adapter<State, Action, BrawlSetup> = {
  start: (d) => newGame(d.players.map((p) => p.hero), d.seed),
  apply: (s, seat, a) => (seat === s.turn ? apply(s, a) : null),
  turn: (s) => s.turn,
  over: (s) => s.phase === 'over',
  bot: (s, d, seat, step) => chooseAction(s, d.players[seat]?.level ?? 'normal', createRng((d.seed * 7919 + step * 104729) >>> 0)),
  seats: (d) => d.players.map((p) => p.kind),
  parseData: parseSetup,
  parseAction,
  describe: (before, _seat, action, d) => describe(before, action, d.players.map((p) => p.name)),
};
