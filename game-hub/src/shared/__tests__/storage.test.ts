import { describe, expect, it } from 'vitest';
import { EMPTY_STATS, applyResult, createStore, parseStats, type StorageLike } from '../storage';

function memory(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

const NOW = new Date('2026-11-16T10:00:00.000Z');

describe('stats', () => {
  it('start empty', () => {
    expect(createStore(memory()).loadStats('crater-lab')).toEqual(EMPTY_STATS);
  });

  it('wins build a streak, a loss or a draw ends it, and the best streak is remembered', () => {
    const store = createStore(memory());
    store.recordResult('g', 'win', NOW);
    store.recordResult('g', 'win', NOW);
    expect(store.loadStats('g')).toMatchObject({ plays: 2, wins: 2, streak: 2, bestStreak: 2 });
    store.recordResult('g', 'loss', NOW);
    expect(store.loadStats('g')).toMatchObject({ plays: 3, wins: 2, losses: 1, streak: 0, bestStreak: 2 });
    store.recordResult('g', 'win', NOW);
    store.recordResult('g', 'draw', NOW);
    expect(store.loadStats('g')).toMatchObject({ plays: 5, wins: 3, losses: 1, draws: 1, streak: 0, bestStreak: 2, lastPlayed: NOW.toISOString() });
  });

  it('a two-player match counts as played and leaves the streak alone', () => {
    const after = applyResult({ ...EMPTY_STATS, wins: 2, streak: 2, bestStreak: 2, plays: 2 }, 'played', NOW);
    expect(after).toMatchObject({ plays: 3, wins: 2, streak: 2, losses: 0 });
  });

  it('each game has its own stats, and they survive a new store on the same storage', () => {
    const storage = memory();
    createStore(storage).recordResult('a', 'win', NOW);
    const again = createStore(storage);
    expect(again.loadStats('a').wins).toBe(1);
    expect(again.loadStats('b')).toEqual(EMPTY_STATS);
    again.resetStats('a');
    expect(again.loadStats('a')).toEqual(EMPTY_STATS);
  });

  it.each([
    ['not json', 'this is {not json'],
    ['a string', '"hello"'],
    ['null', 'null'],
    ['an array', '[1,2,3]'],
    ['wrong types', '{"plays":"12","wins":-4,"streak":null,"bestStreak":"x","lastPlayed":12}'],
    ['absurd numbers', '{"plays":1e999,"wins":NaN}'],
  ])('a corrupted value (%s) reads as clean stats, never as garbage', (_name, raw) => {
    const stats = createStore(memory({ 'paper-arcade:stats:g': raw })).loadStats('g');
    for (const key of ['plays', 'wins', 'losses', 'draws', 'streak', 'bestStreak'] as const) {
      expect(Number.isInteger(stats[key])).toBe(true);
      expect(stats[key]).toBeGreaterThanOrEqual(0);
    }
    expect(stats.lastPlayed).toBeNull();
  });

  it('keeps the valid parts of a partly damaged value', () => {
    expect(parseStats({ plays: 7.9, wins: 3, streak: 5, bestStreak: 2, lastPlayed: '2026-01-02T03:04:05.000Z', extra: true })).toEqual({
      plays: 7,
      wins: 3,
      losses: 0,
      draws: 0,
      streak: 5,
      bestStreak: 5, // can never be lower than the current streak
      lastPlayed: '2026-01-02T03:04:05.000Z',
    });
  });
});

describe('storage that is missing or broken', () => {
  it('with no storage at all everything still works, it just does not persist', () => {
    const store = createStore(null);
    expect(store.loadStats('g')).toEqual(EMPTY_STATS);
    expect(store.recordResult('g', 'win', NOW).wins).toBe(1);
    expect(store.loadStats('g')).toEqual(EMPTY_STATS);
    expect(store.loadSettings()).toEqual({ muted: false });
    expect(() => store.saveSettings({ muted: true })).not.toThrow();
    expect(() => store.resetStats('g')).not.toThrow();
  });

  it('storage that throws on every call never breaks the caller', () => {
    const angry: StorageLike = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    const store = createStore(angry);
    expect(store.loadStats('g')).toEqual(EMPTY_STATS);
    expect(() => store.recordResult('g', 'loss', NOW)).not.toThrow();
    expect(() => store.saveSettings({ muted: true })).not.toThrow();
    expect(() => store.resetStats('g')).not.toThrow();
    expect(store.loadGameSettings('g', { mode: 'ai' })).toEqual({ mode: 'ai' });
  });
});

describe('settings', () => {
  it('mute is remembered', () => {
    const storage = memory();
    createStore(storage).saveSettings({ muted: true });
    expect(createStore(storage).loadSettings()).toEqual({ muted: true });
  });

  it('only a real true mutes', () => {
    expect(createStore(memory({ 'paper-arcade:settings': '{"muted":"yes"}' })).loadSettings()).toEqual({ muted: false });
  });

  it('a game\'s own settings are merged over its defaults, ignoring unknown keys and wrong types', () => {
    const storage = memory({ 'paper-arcade:game:g': '{"mode":"pvp","difficulty":7,"hacked":true}' });
    const loaded = createStore(storage).loadGameSettings('g', { mode: 'ai', difficulty: 'tactician' });
    expect(loaded).toEqual({ mode: 'pvp', difficulty: 'tactician' });
    createStore(storage).saveGameSettings('g', { mode: 'ai', difficulty: 'savant' });
    expect(createStore(storage).loadGameSettings('g', { mode: 'pvp', difficulty: 'recruit' })).toEqual({ mode: 'ai', difficulty: 'savant' });
  });

  it('all keys live under one prefix', () => {
    const storage = memory();
    const store = createStore(storage);
    store.saveSettings({ muted: true });
    store.recordResult('g', 'win', NOW);
    store.saveGameSettings('g', { mode: 'ai' });
    expect(Object.keys(storage.data).every((k) => k.startsWith('paper-arcade:'))).toBe(true);
    expect(Object.keys(storage.data)).toHaveLength(3);
  });
});
