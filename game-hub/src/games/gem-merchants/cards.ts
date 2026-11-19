/**
 * The cards of GEM // MERCHANTS: 90 stalls in three levels and 10 patrons.
 *
 * The stalls are original. They are generated once from a fixed seed (so the deck is the same in every game and every
 * browser) to the usual shape of an engine-building card game: level 1 stalls are cheap and mostly score nothing, level 2
 * cost more and score 1-3, level 3 are expensive and score 3-5. Every colour has the same number of stalls in each level.
 */
import { createRng, nextRandom, type Rng } from '../crater-lab/engine/rng';

export const GEMS = ['amber', 'azure', 'jade', 'pearl', 'jet'] as const;
export type Gem = (typeof GEMS)[number];
export type Token = Gem | 'gold';
export type Level = 1 | 2 | 3;
export type Cost = Readonly<Record<Gem, number>>;

export interface Card {
  readonly id: number;
  readonly level: Level;
  /** The permanent discount this stall gives once bought. */
  readonly bonus: Gem;
  readonly points: number;
  readonly cost: Cost;
}

export interface Patron {
  readonly id: number;
  readonly name: string;
  /** Stalls of each colour needed to attract this patron (3 points). */
  readonly requires: Readonly<Partial<Record<Gem, number>>>;
}

export const GEM_NAMES: Record<Token, string> = { amber: 'Amber', azure: 'Azure', jade: 'Jade', pearl: 'Pearl', jet: 'Jet', gold: 'Gold' };

/** [points, total cost] for each stall of one colour in a level. */
const PLAN: Record<Level, readonly (readonly [number, number])[]> = {
  1: [[0, 3], [0, 3], [0, 4], [0, 4], [0, 5], [0, 5], [0, 4], [1, 4]],
  2: [[1, 5], [1, 6], [2, 6], [2, 7], [2, 8], [3, 8]],
  3: [[3, 7], [4, 8], [4, 9], [5, 10]],
};

function split(total: number, parts: number, rng: Rng): number[] {
  const out = Array.from({ length: parts }, () => 1);
  for (let left = total - parts; left > 0; ) {
    const i = Math.floor(nextRandom(rng) * parts);
    if ((out[i] as number) < 5) {
      out[i] = (out[i] as number) + 1;
      left--;
    }
  }
  return out;
}

function costOf(level: Level, bonus: Gem, total: number, mono: boolean, rng: Rng): Cost {
  const others = GEMS.filter((g) => g !== bonus);
  const cost: Record<Gem, number> = { amber: 0, azure: 0, jade: 0, pearl: 0, jet: 0 };
  if (mono) {
    cost[others[Math.floor(nextRandom(rng) * others.length)] as Gem] = total;
    return cost;
  }
  const min = level === 1 ? 2 : level === 2 ? 2 : 3;
  const max = total >= 9 ? 4 : level === 1 ? 3 : 4;
  const parts = Math.min(max, min + Math.floor(nextRandom(rng) * (max - min + 1)));
  const pool = [...others];
  const amounts = split(total, parts, rng);
  amounts.forEach((n) => {
    const g = pool.splice(Math.floor(nextRandom(rng) * pool.length), 1)[0] as Gem;
    cost[g] = n;
  });
  return cost;
}

function build(): Card[] {
  const rng = createRng(20240611);
  const cards: Card[] = [];
  for (const level of [1, 2, 3] as Level[]) {
    for (const bonus of GEMS) {
      (PLAN[level] as readonly (readonly [number, number])[]).forEach(([points, total], k) => {
        // the one-point level-1 stall asks for a lot of a single colour
        const mono = level === 1 && points === 1 && k === (PLAN[1] as readonly unknown[]).length - 1;
        cards.push({ id: cards.length, level, bonus, points, cost: costOf(level, bonus, total, mono, rng) });
      });
    }
  }
  return cards;
}

export const CARDS: readonly Card[] = build();
export const cardById = (id: number): Card => CARDS[id] as Card;

export const PATRONS: readonly Patron[] = [
  { id: 0, name: 'The Harbourmaster', requires: { amber: 4, azure: 4 } },
  { id: 1, name: 'The Cartographer', requires: { azure: 4, jade: 4 } },
  { id: 2, name: 'The Herbalist', requires: { jade: 4, pearl: 4 } },
  { id: 3, name: 'The Lamplighter', requires: { pearl: 4, jet: 4 } },
  { id: 4, name: 'The Blacksmith', requires: { jet: 4, amber: 4 } },
  { id: 5, name: 'The Caravan Master', requires: { amber: 3, azure: 3, jade: 3 } },
  { id: 6, name: 'The Shipwright', requires: { azure: 3, jade: 3, pearl: 3 } },
  { id: 7, name: 'The Weaver', requires: { jade: 3, pearl: 3, jet: 3 } },
  { id: 8, name: 'The Glassblower', requires: { pearl: 3, jet: 3, amber: 3 } },
  { id: 9, name: 'The Banker', requires: { jet: 3, amber: 3, azure: 3 } },
];
export const patronById = (id: number): Patron => PATRONS[id] as Patron;
