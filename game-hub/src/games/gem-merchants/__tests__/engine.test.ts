import { describe, expect, it } from 'vitest';
import { CARDS, GEMS, PATRONS, cardById, type Gem } from '../cards';
import {
  MAX_TURNS, apply, bonusesOf, describe as describeAction, eligiblePatrons, isLegal, keyOf, legalActions, newGame, priceFor, replay, scoreOf, tokensOf, winnersOf, zeroCounts,
  type Action, type PlayerState, type State,
} from '../engine';

const must = (s: State, a: Action): State => {
  const next = apply(s, a);
  if (!next) throw new Error(`illegal: ${keyOf(a)}`);
  return next;
};
const give = (s: State, seat: number, patch: Partial<PlayerState>): State => ({ ...s, players: s.players.map((p, i) => (i === seat ? { ...p, ...patch } : p)) });
const gems = (patch: Partial<Record<Gem | 'gold', number>>) => ({ ...zeroCounts(), ...patch });
const cardWith = (pred: (c: (typeof CARDS)[number]) => boolean) => CARDS.find(pred) as (typeof CARDS)[number];

describe('the cards', () => {
  it('has 90 stalls: 40, 30 and 20 by level, evenly across the five colours', () => {
    expect(CARDS).toHaveLength(90);
    for (const [level, per] of [[1, 8], [2, 6], [3, 4]] as const) {
      for (const g of GEMS) expect(CARDS.filter((c) => c.level === level && c.bonus === g)).toHaveLength(per);
    }
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(90);
    CARDS.forEach((c, i) => expect(c.id).toBe(i));
  });
  it('prices stalls by level, never asks for the colour it gives, and scores more for more expensive ones', () => {
    const ranges: Record<number, { cost: [number, number]; points: [number, number] }> = {
      1: { cost: [3, 5], points: [0, 1] },
      2: { cost: [5, 8], points: [1, 3] },
      3: { cost: [7, 10], points: [3, 5] },
    };
    for (const c of CARDS) {
      const total = GEMS.reduce((n, g) => n + c.cost[g], 0);
      const r = ranges[c.level] as (typeof ranges)[number];
      expect(total).toBeGreaterThanOrEqual(r.cost[0]);
      expect(total).toBeLessThanOrEqual(r.cost[1]);
      expect(c.points).toBeGreaterThanOrEqual(r.points[0]);
      expect(c.points).toBeLessThanOrEqual(r.points[1]);
      expect(c.cost[c.bonus]).toBe(0);
    }
  });
  it('has ten patrons, each asking for 8 or 9 stalls', () => {
    expect(PATRONS).toHaveLength(10);
    for (const p of PATRONS) expect([8, 9]).toContain(Object.values(p.requires).reduce((a, b) => a + b, 0));
  });
});

describe('setting up', () => {
  it.each([[2, 4], [3, 5], [4, 7]])('%i players: %i of each gem, five gold, one more patron than players', (n, each) => {
    const s = newGame(n, 1);
    for (const g of GEMS) expect(s.supply[g]).toBe(each);
    expect(s.supply.gold).toBe(5);
    expect(s.patrons).toHaveLength(n + 1);
    expect(s.players).toHaveLength(n);
    expect(s.board.map((r) => r.filter((c) => c !== null).length)).toEqual([4, 4, 4]);
    expect(s.decks.map((d) => d.length)).toEqual([36, 26, 16]);
  });
  it('is the same for the same seed, different for another, and refuses 1 or 5 players', () => {
    expect(newGame(3, 9)).toEqual(newGame(3, 9));
    expect(newGame(3, 9).board).not.toEqual(newGame(3, 10).board);
    expect(() => newGame(1, 1)).toThrow();
    expect(() => newGame(5, 1)).toThrow();
  });
  it('deals every card exactly once across the board and the decks', () => {
    const s = newGame(4, 5);
    const all = [...s.board.flat(), ...s.decks.flat()].filter((c): c is number => c !== null);
    expect(new Set(all).size).toBe(90);
  });
});

describe('taking gems', () => {
  it('offers the ten ways to take three different colours at the start, and a pair of any colour', () => {
    const acts = legalActions(newGame(2, 1));
    expect(acts.filter((a) => a.type === 'take3')).toHaveLength(10);
    expect(acts.filter((a) => a.type === 'take2')).toHaveLength(5);
  });
  it('moves the gems from the supply to the player and passes the turn', () => {
    const s = must(newGame(2, 1), { type: 'take3', gems: ['amber', 'jade', 'jet'] });
    expect(s.players[0]?.gems.amber).toBe(1);
    expect(s.supply.amber).toBe(3);
    expect(s.turn).toBe(1);
    expect(s.turns).toBe(1);
  });
  it('refuses the same colour twice in a three-gem take, or an unknown shape', () => {
    const s = newGame(2, 1);
    expect(apply(s, { type: 'take3', gems: ['amber', 'amber', 'jade'] })).toBeNull();
    expect(apply(s, { type: 'take3', gems: ['amber', 'jade'] })).toBeNull();
  });
  it('allows two of a colour only while four or more are left', () => {
    let s = must(newGame(2, 1), { type: 'take2', gem: 'jade' });
    expect(s.supply.jade).toBe(2);
    s = must(s, { type: 'take3', gems: ['amber', 'azure', 'pearl'] });
    expect(apply(s, { type: 'take2', gem: 'jade' })).toBeNull();
  });
  it('allows taking fewer than three colours only when fewer than three are left', () => {
    const s: State = { ...newGame(2, 1), supply: { ...gems({ gold: 5 }), amber: 2, azure: 1 } };
    expect(isLegal(s, { type: 'take3', gems: ['amber', 'azure'] })).toBe(true);
    expect(isLegal(s, { type: 'take3', gems: ['amber'] })).toBe(true);
  });
  it('never takes gold', () => {
    expect(apply(newGame(2, 1), { type: 'take3', gems: ['amber', 'azure', 'gold' as Gem] })).toBeNull();
  });
});

describe('the ten-token limit', () => {
  it('makes you hand back tokens before the turn ends, one at a time', () => {
    let s = give(newGame(2, 1), 0, { gems: gems({ amber: 3, azure: 3, jade: 3 }) });
    s = must(s, { type: 'take3', gems: ['pearl', 'jet', 'amber'] });
    expect(tokensOf(s.players[0] as PlayerState)).toBe(12);
    expect(s.phase).toBe('discard');
    expect(s.turn).toBe(0);
    expect(legalActions(s).every((a) => a.type === 'return')).toBe(true);
    s = must(s, { type: 'return', token: 'amber' });
    expect(s.phase).toBe('discard');
    s = must(s, { type: 'return', token: 'jade' });
    expect(s.phase).toBe('action');
    expect(s.turn).toBe(1);
    expect(tokensOf(s.players[0] as PlayerState)).toBe(10);
    expect(s.supply.amber).toBe(4 - 1 + 1); // taken one, handed one back
  });
  it('lets you hand back a token you just took, and cannot return one you do not hold', () => {
    let s = give(newGame(2, 1), 0, { gems: gems({ amber: 3, azure: 3, jade: 3 }) });
    s = must(s, { type: 'take3', gems: ['pearl', 'jet', 'amber'] });
    expect(apply(s, { type: 'return', token: 'gold' })).toBeNull();
    expect(apply(s, { type: 'take2', gem: 'amber' })).toBeNull(); // no other action while discarding
    expect(must(s, { type: 'return', token: 'pearl' }).phase).toBe('discard');
  });
});

describe('reserving', () => {
  it('takes the face-up stall into your hand, refills the slot, and gives one gold', () => {
    const s0 = newGame(2, 3);
    const id = s0.board[1]?.[2] as number;
    const s = must(s0, { type: 'reserve', level: 2, slot: 2 });
    expect(s.players[0]?.reserved).toEqual([{ id, open: true }]);
    expect(s.board[1]?.[2]).not.toBe(id);
    expect(s.board[1]?.[2]).toBe(s0.decks[1]?.[0]);
    expect(s.players[0]?.gems.gold).toBe(1);
    expect(s.supply.gold).toBe(4);
  });
  it('can reserve the top of a deck, which stays secret', () => {
    const s0 = newGame(2, 3);
    const s = must(s0, { type: 'reserve', level: 3, slot: 'deck' });
    expect(s.players[0]?.reserved[0]).toEqual({ id: s0.decks[2]?.[0], open: false });
    expect(s.decks[2]).toHaveLength(15);
  });
  it('stops at three reserved stalls, and gives no gold when none is left', () => {
    let s: State = { ...newGame(2, 3), supply: { ...newGame(2, 3).supply, gold: 0 } };
    s = must(s, { type: 'reserve', level: 1, slot: 0 });
    expect(s.players[0]?.gems.gold).toBe(0);
    s = give(s, 1, {});
    s = must(s, { type: 'take3', gems: ['amber', 'azure', 'jade'] });
    s = must(s, { type: 'reserve', level: 1, slot: 1 });
    s = must(s, { type: 'take3', gems: ['amber', 'azure', 'jade'] });
    s = must(s, { type: 'reserve', level: 1, slot: 2 });
    s = must(s, { type: 'take3', gems: ['amber', 'azure', 'jade'] });
    expect(apply(s, { type: 'reserve', level: 1, slot: 3 })).toBeNull();
  });
});

describe('buying', () => {
  const cheap = cardWith((c) => c.level === 1 && c.points === 0 && GEMS.reduce((n, g) => n + c.cost[g], 0) === 3);
  const setup = (cardId: number) => {
    const s = newGame(2, 1);
    return { ...s, board: s.board.map((row, i) => (i === 0 ? [cardId, ...row.slice(1)] : row)) } as State;
  };

  it('pays the cost in gems, which go back to the supply, and gives the stall and its discount', () => {
    const need = Object.fromEntries(GEMS.map((g) => [g, cheap.cost[g]]));
    let s = give(setup(cheap.id), 0, { gems: gems(need) });
    s = must(s, { type: 'buy', from: { level: 1, slot: 0 } });
    expect(s.players[0]?.cards).toEqual([cheap.id]);
    expect(tokensOf(s.players[0] as PlayerState)).toBe(0);
    for (const g of GEMS) expect(s.supply[g]).toBe(4 + cheap.cost[g]);
    expect(bonusesOf(s.players[0] as PlayerState)[cheap.bonus]).toBe(1);
  });
  it('is not allowed without enough gems', () => {
    expect(apply(setup(cheap.id), { type: 'buy', from: { level: 1, slot: 0 } })).toBeNull();
  });
  it('uses permanent discounts, so a stall you own makes the next one cheaper', () => {
    const target = cardWith((c) => c.level === 1 && GEMS.some((g) => c.cost[g] >= 2));
    const g = GEMS.find((x) => target.cost[x] >= 2) as Gem;
    const owned = cardWith((c) => c.bonus === g);
    const rich = gems(Object.fromEntries(GEMS.map((x) => [x, 9])));
    const before = priceFor({ gems: rich, cards: [], reserved: [], patrons: [] }, target) as NonNullable<ReturnType<typeof priceFor>>;
    const after = priceFor({ gems: rich, cards: [owned.id], reserved: [], patrons: [] }, target) as NonNullable<ReturnType<typeof priceFor>>;
    expect(before.gems[g]).toBe(target.cost[g]);
    expect(after.gems[g]).toBe(target.cost[g] - 1);
  });
  it('covers a shortfall with gold, and returns the gold to the supply', () => {
    const need = Object.fromEntries(GEMS.map((g) => [g, cheap.cost[g]]));
    const missing = GEMS.find((g) => cheap.cost[g] > 0) as Gem;
    const have = { ...need, [missing]: cheap.cost[missing] - 1, gold: 1 };
    let s = give(setup(cheap.id), 0, { gems: gems(have) });
    s = must(s, { type: 'buy', from: { level: 1, slot: 0 } });
    expect(s.players[0]?.gems.gold).toBe(0);
    expect(s.supply.gold).toBe(6);
  });
  it('buys a reserved stall', () => {
    const need = Object.fromEntries(GEMS.map((g) => [g, cheap.cost[g]]));
    let s = give(newGame(2, 1), 0, { gems: gems(need), reserved: [{ id: cheap.id, open: false }] });
    s = must(s, { type: 'buy', from: { reserved: 0 } });
    expect(s.players[0]?.reserved).toHaveLength(0);
    expect(s.players[0]?.cards).toEqual([cheap.id]);
  });
});

describe('patrons', () => {
  const stallsFor = (g: Gem, n: number) => CARDS.filter((c) => c.bonus === g).slice(0, n).map((c) => c.id);
  it('visit automatically when exactly one is eligible, for three points', () => {
    const base = newGame(2, 1);
    const patron = PATRONS[0] as (typeof PATRONS)[number]; // amber 4, azure 4
    const s0: State = { ...base, patrons: [patron.id, 5, 6] };
    const owned = [...stallsFor('amber', 4), ...stallsFor('azure', 3)];
    let s = give(s0, 0, { cards: owned });
    expect(eligiblePatrons(s, 0)).toEqual([]);
    const last = stallsFor('azure', 4)[3] as number;
    s = give(s, 0, { cards: [...owned, last], gems: gems({}) });
    expect(eligiblePatrons(s, 0)).toEqual([patron.id]);
    // end the turn with a harmless take
    s = must(s, { type: 'take3', gems: ['amber', 'azure', 'jade'] });
    expect(s.players[0]?.patrons).toEqual([patron.id]);
    expect(s.patrons).not.toContain(patron.id);
    expect(scoreOf(s, 0)).toBe(3 + owned.concat(last).reduce((n, id) => n + cardById(id).points, 0));
  });
  it('make the player choose when two are eligible', () => {
    const s0: State = { ...newGame(2, 1), patrons: [0, 1, 4] }; // amber+azure, azure+jade, jet+amber
    let s = give(s0, 0, { cards: [...stallsFor('amber', 4), ...stallsFor('azure', 4), ...stallsFor('jade', 4)] });
    s = must(s, { type: 'take3', gems: ['amber', 'azure', 'jade'] });
    expect(s.phase).toBe('patron');
    expect(s.turn).toBe(0);
    expect(legalActions(s).map(keyOf).sort()).toEqual(['patron:0', 'patron:1']);
    s = must(s, { type: 'patron', id: 1 });
    expect(s.turn).toBe(1);
    expect(s.players[0]?.patrons).toEqual([1]);
  });
});

describe('the end of the game', () => {
  const withScore = (s: State, seat: number, stalls: number) => give(s, seat, { cards: CARDS.filter((c) => c.level === 3 && c.points >= 4).slice(0, stalls).map((c) => c.id) });
  it('finishes the round after someone reaches 15, so everyone has had the same number of turns', () => {
    let s = newGame(3, 1);
    s = withScore(s, 1, 4); // 16+ points on seat 1
    s = must(s, { type: 'take3', gems: ['amber', 'azure', 'jade'] }); // seat 0
    s = must(s, { type: 'take3', gems: ['amber', 'azure', 'jade'] }); // seat 1: now over 15
    expect(s.lastRound).toBe(true);
    expect(s.phase).toBe('action');
    s = must(s, { type: 'take3', gems: ['pearl', 'jet', 'azure'] }); // seat 2: the last turn of the round
    expect(s.phase).toBe('over');
    expect(s.winners).toEqual([1]);
    expect(legalActions(s)).toEqual([]);
    expect(apply(s, { type: 'pass' })).toBeNull();
  });
  it('gives a tie to the player who bought fewer stalls, and shares one that is still level', () => {
    const byPoints = (points: number, n: number) => CARDS.filter((c) => c.points === points).slice(0, n).map((c) => c.id);
    let s = give(newGame(2, 1), 0, { cards: byPoints(5, 3) }); // 15 points from three stalls
    s = give(s, 1, { cards: [...byPoints(4, 3), ...byPoints(3, 1)] }); // 15 points from four stalls
    expect([scoreOf(s, 0), scoreOf(s, 1)]).toEqual([15, 15]);
    expect(winnersOf(s)).toEqual([0]);
    s = give(s, 1, { cards: byPoints(4, 3), patrons: [0] }); // 12 + 3 = 15 from three stalls
    expect(winnersOf(s)).toEqual([0, 1]);
  });
  it('ends a game that has gone on too long', () => {
    let s: State = { ...newGame(2, 1), turns: MAX_TURNS - 1 };
    s = must(s, { type: 'take3', gems: ['amber', 'azure', 'jade'] });
    expect(s.phase).toBe('over');
  });
  it('passes only when nothing at all is possible', () => {
    const base = newGame(2, 1);
    expect(legalActions(base).some((a) => a.type === 'pass')).toBe(false);
    const stuck: State = {
      ...base,
      supply: gems({}),
      board: [[null, null, null, null], [null, null, null, null], [null, null, null, null]],
      decks: [[], [], []],
    };
    expect(legalActions(stuck)).toEqual([{ type: 'pass' }]);
    expect(must(stuck, { type: 'pass' }).turn).toBe(1);
  });
});

describe('replaying and describing', () => {
  const setup = { players: [{ name: 'Ada', kind: 'human' as const }, { name: 'Bo', kind: 'bot' as const, level: 'easy' as const }], seed: 77 };
  it('rebuilds the same state from the list of actions, and ignores moves out of turn or illegal ones', () => {
    const a1: Action = { type: 'take3', gems: ['amber', 'azure', 'jade'] };
    const a2: Action = { type: 'take2', gem: 'pearl' };
    const direct = must(must(newGame(2, 77), a1), a2);
    expect(replay(setup, [{ seat: 0, action: a1 }, { seat: 1, action: a2 }])).toEqual(direct);
    const noisy = replay(setup, [
      { seat: 1, action: a2 }, // not seat 1's turn
      { seat: 0, action: { type: 'take2', gem: 'amber' } }, // fine
      { seat: 1, action: { type: 'buy', from: { level: 3, slot: 0 } } }, // cannot afford
      { seat: 1, action: a2 },
    ]);
    expect(noisy.turns).toBe(2);
  });
  it('does not change a state when an action is applied to it', () => {
    const s = newGame(2, 1);
    const before = JSON.stringify(s);
    apply(s, { type: 'take2', gem: 'jade' });
    expect(JSON.stringify(s)).toBe(before);
  });
  it('writes a readable log line for each kind of action', () => {
    const s = newGame(2, 1);
    expect(describeAction(s, { type: 'take3', gems: ['amber', 'azure', 'jade'] }, 'Ada')).toBe('Ada took Amber, Azure, Jade');
    expect(describeAction(s, { type: 'take2', gem: 'jet' }, 'Ada')).toBe('Ada took two Jet');
    expect(describeAction(s, { type: 'reserve', level: 2, slot: 'deck' }, 'Ada')).toContain('from the deck');
    expect(describeAction(s, { type: 'buy', from: { level: 1, slot: 0 } }, 'Ada')).toMatch(/^Ada bought a level-1 \w+ stall/);
    expect(describeAction(s, { type: 'pass' }, 'Ada')).toContain('passed');
  });
});
