/**
 * A small, safe, typed wrapper around localStorage for per-game stats and settings.
 *
 * "Safe" means two things. Storage can be missing or throw (private windows, blocked site data,
 * a full quota), so every read and write is guarded and the app simply works without it. And what
 * comes back is never trusted: it is parsed and checked field by field, so a hand-edited or
 * out-of-date value cannot put a string where a number is expected.
 */

/** The part of the Storage interface this module needs; tests pass a plain object. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface GameStats {
  /** Finished matches of any kind. */
  plays: number;
  /** Results against the computer. */
  wins: number;
  losses: number;
  draws: number;
  /** Wins in a row against the computer, right now. */
  streak: number;
  bestStreak: number;
  /** ISO date-time of the last finished match, or null. */
  lastPlayed: string | null;
}

export type MatchResult = 'win' | 'loss' | 'draw' | 'played';

export interface HubSettings {
  muted: boolean;
}

export const EMPTY_STATS: GameStats = { plays: 0, wins: 0, losses: 0, draws: 0, streak: 0, bestStreak: 0, lastPlayed: null };
export const DEFAULT_SETTINGS: HubSettings = { muted: false };

const PREFIX = 'paper-arcade';
const MAX_COUNT = 1_000_000;

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(MAX_COUNT, Math.floor(value)) : 0;
}

/** Turn anything at all into valid stats. */
export function parseStats(value: unknown): GameStats {
  if (typeof value !== 'object' || value === null) return { ...EMPTY_STATS };
  const v = value as Record<string, unknown>;
  const streak = count(v.streak);
  return {
    plays: count(v.plays),
    wins: count(v.wins),
    losses: count(v.losses),
    draws: count(v.draws),
    streak,
    bestStreak: Math.max(streak, count(v.bestStreak)),
    lastPlayed: typeof v.lastPlayed === 'string' && !Number.isNaN(Date.parse(v.lastPlayed)) ? v.lastPlayed : null,
  };
}

/** The stats after one more finished match. 'played' is a match with no winner to record (two players on one device). */
export function applyResult(stats: GameStats, result: MatchResult, now: Date = new Date()): GameStats {
  const next: GameStats = { ...stats, plays: stats.plays + 1, lastPlayed: now.toISOString() };
  if (result === 'win') {
    next.wins += 1;
    next.streak += 1;
    next.bestStreak = Math.max(next.bestStreak, next.streak);
  } else if (result === 'loss') {
    next.losses += 1;
    next.streak = 0;
  } else if (result === 'draw') {
    next.draws += 1;
    next.streak = 0;
  }
  return next;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // some browsers throw on the property access itself
  }
}

export interface Store {
  loadStats(gameId: string): GameStats;
  recordResult(gameId: string, result: MatchResult, now?: Date): GameStats;
  resetStats(gameId: string): void;
  loadSettings(): HubSettings;
  saveSettings(settings: HubSettings): void;
  /** A game's own small settings object (last mode, difficulty...), merged over `defaults` key by key. */
  loadGameSettings<T extends Record<string, string | number | boolean>>(gameId: string, defaults: T): T;
  saveGameSettings<T extends Record<string, string | number | boolean>>(gameId: string, settings: T): void;
}

export function createStore(storage: StorageLike | null = defaultStorage()): Store {
  const read = (key: string): unknown => {
    if (!storage) return null;
    try {
      const raw = storage.getItem(`${PREFIX}:${key}`);
      return raw === null ? null : (JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  };
  const write = (key: string, value: unknown): void => {
    if (!storage) return;
    try {
      storage.setItem(`${PREFIX}:${key}`, JSON.stringify(value));
    } catch {
      /* quota or blocked: the page carries on without saving */
    }
  };

  return {
    loadStats: (gameId) => parseStats(read(`stats:${gameId}`)),
    recordResult(gameId, result, now) {
      const next = applyResult(parseStats(read(`stats:${gameId}`)), result, now);
      write(`stats:${gameId}`, next);
      return next;
    },
    resetStats(gameId) {
      if (!storage) return;
      try {
        storage.removeItem(`${PREFIX}:stats:${gameId}`);
      } catch {
        /* nothing to do */
      }
    },
    loadSettings() {
      const v = read('settings');
      const muted = typeof v === 'object' && v !== null && (v as Record<string, unknown>).muted === true;
      return { muted };
    },
    saveSettings: (settings) => write('settings', { muted: settings.muted === true }),
    loadGameSettings(gameId, defaults) {
      const v = read(`game:${gameId}`);
      const out = { ...defaults };
      if (typeof v !== 'object' || v === null) return out;
      for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
        const saved = (v as Record<string, unknown>)[key as string];
        // only take a saved value of the same type as the default it replaces
        if (typeof saved === typeof defaults[key]) out[key] = saved as (typeof defaults)[typeof key];
      }
      return out;
    },
    saveGameSettings: (gameId, settings) => write(`game:${gameId}`, settings),
  };
}

/** The store every game uses. */
export const store: Store = createStore();
