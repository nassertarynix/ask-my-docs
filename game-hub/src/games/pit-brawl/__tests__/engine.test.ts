import { describe, expect, it } from 'vitest';
import { createRng, nextRandom } from '../../crater-lab/engine/rng';
import { HEROES, MAX_HAND, MAX_HP, MAX_SHIELD, cardId, defOf, deckOf, heroById, needsTarget, summary, valueOf } from '../cards';
import { MAX_TURNS, apply, describe as describeAction, aliveSeats, maxHpFor, isLegal, keyOf, legalActions, newGame, replay, type Action, type Player, type State } from '../engine';

const idOf = (hero: number, name: string): number => cardId(hero, heroById(hero).cards.findIndex((c) => c.name === name));
const set = (s: State, seat: number, p: Partial<Player>): State => ({ ...s, players: s.players.map((q, i) => (i === seat ? { ...q, ...p } : q)) });
const must = (s: State, a: Action): State => {
  const next = apply(s, a);
  if (!next) throw new Error(`illegal: ${keyOf(a)}`);
  return next;
};
/** A game of n players (heroes 0..n-1) where seat 0 is to move holding exactly these cards. */
function table(n: number, hand: number[], seed = 1): State {
  let s = newGame(Array.from({ length: n }, (_, i) => i), seed);
  s = { ...s, turn: 0 };
  return set(s, 0, { hand });
}
const P = (s: State, i: number) => s.players[i] as Player;

describe('the heroes and their cards', () => {
  it('has ten heroes with different names and colours, each with a 20-card deck', () => {
    expect(HEROES).toHaveLength(10);
    expect(new Set(HEROES.map((h) => h.name)).size).toBe(10);
    expect(new Set(HEROES.map((h) => h.colour)).size).toBe(10);
    HEROES.forEach((h, i) => {
      expect(h.id).toBe(i);
      expect(deckOf(i)).toHaveLength(20);
      expect(new Set(h.cards.map((c) => c.name)).size).toBe(h.cards.length);
      expect(h.cards.length).toBeLessThanOrEqual(10);
    });
  });
  it('identifies every card by hero and position', () => {
    for (const h of HEROES) for (const [i, def] of h.cards.entries()) expect(defOf(cardId(h.id, i))).toBe(def);
  });
  it('prices the heroes alike: no deck is much stronger than another, and every deck can hurt people', () => {
    const avg = HEROES.map((h) => h.cards.reduce((n, c) => n + c.copies * valueOf(c), 0) / 20);
    for (const a of avg) {
      expect(a).toBeGreaterThan(2.7);
      expect(a).toBeLessThan(3.3);
    }
    expect(Math.max(...avg) - Math.min(...avg)).toBeLessThan(0.45);
    for (const h of HEROES) {
      const hurting = h.cards.filter((c) => c.effects.some((e) => e.kind === 'atk' || e.kind === 'sweep')).reduce((n, c) => n + c.copies, 0);
      expect(hurting).toBeGreaterThanOrEqual(9);
    }
  });
  it('writes cards out as text', () => {
    expect(summary(defOf(idOf(0, 'Rage Swing')))).toBe('Hit 2, play 1 more');
    expect(summary(defOf(idOf(1, 'Spark Storm')))).toBe('Hit everyone 1, draw 1');
    expect(needsTarget(defOf(idOf(0, 'Cleaver Chop')))).toBe(true);
    expect(needsTarget(defOf(idOf(0, 'Iron Hide')))).toBe(false);
  });
});

describe('setting up', () => {
  it.each([2, 5, 10])('%i players: full health for the table size, a hand of three, a full deck behind it', (n) => {
    const s = newGame(Array.from({ length: n }, (_, i) => i), 4);
    expect(s.players).toHaveLength(n);
    for (const p of s.players) {
      expect(p).toMatchObject({ hp: maxHpFor(n), shield: 0, alive: true, discard: [] });
      expect(p.hand).toHaveLength(3);
      expect(p.hand.length + p.drawPile.length).toBe(20);
    }
    expect(s.turn).toBeGreaterThanOrEqual(0);
    expect(s.turn).toBeLessThan(n);
  });
  it('is the same for the same seed and different for another, and varies who goes first', () => {
    const heroes = [0, 1, 2];
    expect(newGame(heroes, 9)).toEqual(newGame(heroes, 9));
    expect(newGame(heroes, 9).players[0]?.hand).not.toEqual(newGame(heroes, 10).players[0]?.hand);
    expect(new Set(Array.from({ length: 40 }, (_, k) => newGame(heroes, k).turn)).size).toBe(3);
  });
  it('refuses one player, eleven, a repeated hero and an unknown hero', () => {
    expect(() => newGame([0], 1)).toThrow();
    expect(() => newGame(Array.from({ length: 11 }, (_, i) => i), 1)).toThrow();
    expect(() => newGame([0, 0], 1)).toThrow();
    expect(() => newGame([0, 12], 1)).toThrow();
  });
});

describe('playing cards', () => {
  const chop = idOf(0, 'Cleaver Chop'); // hit 3
  it('hits the chosen player, and the shield takes the blow first', () => {
    let s = must(table(3, [chop]), { type: 'play', card: chop, target: 1 });
    expect(P(s, 1).hp).toBe(7);
    // (it is then that player's turn, so whatever shield is left wears off: only the health tells how much it soaked)
    s = must(set(table(3, [chop]), 1, { shield: 2 }), { type: 'play', card: chop, target: 1 });
    expect(P(s, 1).hp).toBe(9);
    s = must(set(table(3, [chop]), 1, { shield: 5 }), { type: 'play', card: chop, target: 1 });
    expect(P(s, 1).hp).toBe(10);
    s = must(set(table(3, [chop]), 2, { shield: 5 }), { type: 'play', card: chop, target: 2 });
    expect([P(s, 2).hp, P(s, 2).shield]).toEqual([10, 2]); // not their turn yet: the rest of the shield is still there
  });
  it('puts the played card on the discard pile and passes the turn on, with the next player drawing', () => {
    const before = table(3, [chop, chop]);
    const s = must(before, { type: 'play', card: chop, target: 2 });
    expect(P(s, 0).hand).toEqual([chop]);
    expect(P(s, 0).discard).toEqual([chop]);
    expect(s.turn).toBe(1);
    expect(P(s, 1).hand).toHaveLength(4); // had three, drew one
    expect(s.plays).toBe(1);
  });
  it('lets you target only opponents who are still in, and needs a target for a hit and none for anything else', () => {
    const s = set(table(3, [chop, idOf(0, 'Iron Hide')]), 2, { alive: false });
    expect(isLegal(s, { type: 'play', card: chop, target: 0 })).toBe(false); // yourself
    expect(isLegal(s, { type: 'play', card: chop, target: 2 })).toBe(false); // out of the game
    expect(isLegal(s, { type: 'play', card: chop })).toBe(false); // no target
    expect(isLegal(s, { type: 'play', card: chop, target: 1 })).toBe(true);
    expect(isLegal(s, { type: 'play', card: idOf(0, 'Iron Hide'), target: 1 })).toBe(false); // a shield has no target
    expect(isLegal(s, { type: 'play', card: idOf(0, 'Iron Hide') })).toBe(true);
    expect(apply(s, { type: 'play', card: 999 })).toBeNull(); // not in hand
  });
  it('offers each different card once per target, however many copies are held', () => {
    const acts = legalActions(table(3, [chop, chop, chop]));
    expect(acts).toHaveLength(2); // one card, two possible targets
  });
  it('shields, heals (never above ten) and draws', () => {
    const hide = idOf(0, 'Iron Hide'); // shield 4
    expect(P(must(table(2, [hide, chop]), { type: 'play', card: hide }), 0).shield).toBe(4);
    const draught = idOf(7, 'Healing Draught'); // heal 2, draw 1
    let s = set(table(2, [draught]), 0, { hp: 5 });
    s = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, hand: [draught, chop] } : p)) };
    const healed = must(s, { type: 'play', card: draught });
    expect(P(healed, 0).hp).toBe(7);
    expect(P(healed, 0).hand).toHaveLength(2); // played one, drew one
    expect(P(must(set(table(2, [draught, chop]), 0, { hp: 9 }), { type: 'play', card: draught }), 0).hp).toBe(10);
  });
  it('holds at most ten shield, and at most ten cards in hand', () => {
    const hide = idOf(0, 'Iron Hide'); // shield 4
    const s = must(set(table(2, [hide, hide]), 0, { shield: 8 }), { type: 'play', card: hide });
    expect(P(s, 0).shield).toBe(MAX_SHIELD);
    const study = idOf(1, 'Arcane Study'); // draw 2, shield 1
    const full = must(set(table(2, [study, ...Array(9).fill(idOf(0, 'Cleaver Chop'))]), 0, {}), { type: 'play', card: study });
    expect(P(full, 0).hand).toHaveLength(MAX_HAND); // nine left in hand, and only one more could be drawn
    const pick = idOf(2, 'Pickpocket');
    const stolen = must(set(set(table(2, [pick, ...Array(9).fill(idOf(0, 'Cleaver Chop'))]), 1, { hand: [11, 12] }), 0, {}), { type: 'play', card: pick, target: 1 });
    expect(P(stolen, 0).hand).toHaveLength(MAX_HAND);
    expect(P(stolen, 1).hand.length).toBeGreaterThanOrEqual(2); // nothing taken from them beyond what fitted
  });
  it('sweeps everyone else but not yourself', () => {
    const storm = idOf(5, 'Chain Lightning'); // sweep 2
    const s = must(table(4, [storm]), { type: 'play', card: storm });
    expect([0, 1, 2, 3].map((i) => P(s, i).hp)).toEqual([10, 8, 8, 8]);
  });
  it('lets a card with "play 1 more" keep the turn for one more card, and ends it when the hand runs out', () => {
    const swing = idOf(0, 'Rage Swing'); // hit 2, play 1 more
    let s = must(table(3, [swing, chop]), { type: 'play', card: swing, target: 1 });
    expect(s.turn).toBe(0);
    expect(s.plays).toBe(2 - 1);
    s = must(s, { type: 'play', card: chop, target: 2 });
    expect(s.turn).toBe(1);
    const lone = must(table(3, [swing]), { type: 'play', card: swing, target: 1 });
    expect(lone.turn).toBe(1); // nothing left to play, so the turn ends
  });
  it('steals a random card from the target\'s hand, the same one every time for the same game', () => {
    const pick = idOf(2, 'Pickpocket'); // steal 1, hit 1, shield 1
    const s0 = set(table(3, [pick], 5), 1, { hand: [11, 12, 13, 14] });
    const s = must(s0, { type: 'play', card: pick, target: 1 });
    expect(P(s, 1).hp).toBe(9);
    expect(P(s, 0).shield).toBe(1);
    expect(P(s, 0).hand).toHaveLength(1);
    expect([11, 12, 13, 14]).toContain(P(s, 0).hand[0]);
    expect(P(s, 1).hand).toHaveLength(4); // three left after the theft, and it is their turn so they drew one
    expect(must(s0, { type: 'play', card: pick, target: 1 })).toEqual(s);
    const empty = must(set(table(3, [pick]), 1, { hand: [] }), { type: 'play', card: pick, target: 1 });
    expect(P(empty, 0).hand).toHaveLength(0); // nothing to take, and the other effects still happen
    expect(P(empty, 1).hp).toBe(9);
  });
  it('remembers who hit whom', () => {
    const s = must(table(3, [chop]), { type: 'play', card: chop, target: 2 });
    expect(s.hitBy).toEqual([null, null, 0]);
  });
});

describe('being knocked out', () => {
  const chop = idOf(0, 'Cleaver Chop');
  it('removes a player at zero health: hand to the discard pile, shield gone, and they are skipped from then on', () => {
    let s = set(table(3, [chop]), 1, { hp: 3, hand: [21, 22] });
    s = must(s, { type: 'play', card: chop, target: 1 });
    expect(P(s, 1)).toMatchObject({ alive: false, hp: 0, shield: 0, hand: [] });
    expect(P(s, 1).discard).toEqual([21, 22]);
    expect(aliveSeats(s)).toEqual([0, 2]);
    expect(s.turn).toBe(2); // seat 1 is out, so the turn goes to seat 2
    expect(s.phase).toBe('play');
  });
  it('ends the game when one player is left standing, even when the last two fall to one sweep', () => {
    const storm = idOf(5, 'Chain Lightning');
    let s = table(3, [storm]);
    s = set(set(s, 1, { hp: 2 }), 2, { hp: 1 });
    s = must(s, { type: 'play', card: storm });
    expect(s.phase).toBe('over');
    expect(s.winners).toEqual([0]);
    expect(legalActions(s)).toEqual([]);
    expect(apply(s, { type: 'play', card: storm })).toBeNull();
  });
  it('stops a card\'s later effects from reaching a player it already knocked out', () => {
    const dart = idOf(7, 'Poison Dart'); // hit 2, then steal 1
    const s = must(set(table(3, [dart]), 1, { hp: 1, hand: [11] }), { type: 'play', card: dart, target: 1 });
    expect(P(s, 1).alive).toBe(false);
    expect(P(s, 0).hand).toHaveLength(0); // the target's hand was discarded when it fell, so there was nothing to steal
    expect(P(s, 1).discard).toEqual([11]);
  });
});

describe('the deck running out', () => {
  it('shuffles the discard pile back in', () => {
    const chop = idOf(0, 'Cleaver Chop');
    let s = table(2, [chop]);
    s = set(s, 1, { hand: [11], drawPile: [], discard: [12, 13, 14] });
    s = must(s, { type: 'play', card: chop, target: 1 });
    expect(P(s, 1).hand).toHaveLength(2);
    expect(P(s, 1).discard).toEqual([]);
    expect(P(s, 1).drawPile).toHaveLength(2);
    expect([12, 13, 14]).toContain(P(s, 1).hand[1]);
  });
  it('skips a player who has no cards and cannot draw one', () => {
    const chop = idOf(0, 'Cleaver Chop');
    let s = table(3, [chop]);
    s = set(s, 1, { hand: [], drawPile: [], discard: [] });
    s = must(s, { type: 'play', card: chop, target: 2 });
    expect(s.turn).toBe(2);
  });
  it('ends a game that has gone on far too long', () => {
    const chop = idOf(0, 'Cleaver Chop');
    const s = must({ ...table(2, [chop, chop]), turns: MAX_TURNS - 1 }, { type: 'play', card: chop, target: 1 });
    expect(s.phase).toBe('over');
    expect(s.winners).toEqual([0]);
  });
});

describe('whole games', () => {
  it.each([2, 4, 7, 10])('a %i-player game of random legal plays finishes with a winner', (n) => {
    for (const seed of [1, 2, 3]) {
      let s = newGame(Array.from({ length: n }, (_, i) => i), seed);
      const rng = createRng(seed * 13);
      let steps = 0;
      while (s.phase !== 'over' && steps++ < 20_000) {
        const acts = legalActions(s);
        s = must(s, acts[Math.floor(nextRandom(rng) * acts.length)] as Action);
      }
      expect(s.phase).toBe('over');
      expect(s.winners.length).toBeGreaterThan(0);
    }
  });
});

describe('replaying and describing', () => {
  const setup = { players: [0, 1, 2].map((hero) => ({ name: `P${hero}`, kind: 'human' as const, hero })), seed: 21 };
  it('rebuilds a game from its plays, ignoring plays out of turn or illegal ones', () => {
    const start = newGame([0, 1, 2], 21);
    const first = legalActions(start)[0] as Action;
    const direct = must(start, first);
    expect(replay(setup, [{ seat: start.turn, action: first }])).toEqual(direct);
    const noisy = replay(setup, [{ seat: (start.turn + 1) % 3, action: first }, { seat: start.turn, action: { type: 'play', card: 999 } }, { seat: start.turn, action: first }]);
    expect(noisy).toEqual(direct);
  });
  it('does not change the state it is given', () => {
    const s = newGame([0, 1], 3);
    const before = JSON.stringify(s);
    apply(s, legalActions(s)[0] as Action);
    expect(JSON.stringify(s)).toBe(before);
  });
  it('describes a play, with the damage and any knock-out', () => {
    const chop = idOf(0, 'Cleaver Chop');
    const names = ['Ada', 'Bo', 'Cy'];
    expect(describeAction(table(3, [chop]), { type: 'play', card: chop, target: 1 }, names)).toBe('Ada played Cleaver Chop on Bo (Bo −3)');
    expect(describeAction(set(table(3, [chop]), 1, { hp: 2 }), { type: 'play', card: chop, target: 1 }, names)).toContain('Bo is out!');
    const storm = idOf(5, 'Chain Lightning'); // sweep 2
    expect(describeAction(table(3, [storm]), { type: 'play', card: storm }, names)).toBe('Ada played Chain Lightning (Bo −2, Cy −2)');
    expect(describeAction(table(6, [storm]), { type: 'play', card: storm }, ['A', 'B', 'C', 'D', 'E', 'F'])).toBe('A played Chain Lightning (5 players −2)');
    expect(describeAction(table(3, [idOf(0, 'Iron Hide')]), { type: 'play', card: idOf(0, 'Iron Hide') }, names)).toBe('Ada played Iron Hide (+4 shield)');
  });
  it('gives bigger tables more health, so they last longer', () => {
    expect([2, 4, 5, 7, 10].map(maxHpFor)).toEqual([10, 10, 12, 16, 22]);
    expect(MAX_HP).toBe(10);
    const big = newGame(Array.from({ length: 10 }, (_, i) => i), 1);
    expect(big.maxHp).toBe(22);
  });
  it('lets a shield protect until the start of its owner\'s next turn, and no longer', () => {
    const hide = idOf(0, 'Iron Hide'); // shield 4
    const chop = idOf(0, 'Cleaver Chop');
    let s = must(table(3, [hide]), { type: 'play', card: hide });
    expect(P(s, 0).shield).toBe(4);
    s = set(s, 1, { hand: [chop] });
    s = must(s, { type: 'play', card: chop, target: 0 }); // seat 1 hits seat 0: the shield takes it
    expect([P(s, 0).hp, P(s, 0).shield]).toEqual([10, 1]);
    s = set(s, 2, { hand: [chop] });
    s = must(s, { type: 'play', card: chop, target: 0 });
    expect(P(s, 0).hp).toBe(8); // what was left of the shield went first
    expect(s.turn).toBe(0);
    expect(P(s, 0).shield).toBe(0);
    s = must(set(table(3, [hide]), 1, { hand: [chop] }), { type: 'play', card: hide });
    expect(P(s, 0).shield).toBe(4); // still there while the others play...
    s = must(s, { type: 'play', card: chop, target: 2 });
    s = set(s, 2, { hand: [hide] });
    s = must(s, { type: 'play', card: hide });
    expect(s.turn).toBe(0);
    expect(P(s, 0).shield).toBe(0); // ...gone when its owner's turn comes round
  });
});
