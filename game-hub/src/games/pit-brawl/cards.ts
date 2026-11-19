/**
 * The heroes and cards of PIT // BRAWL: ten original heroes, each with a 20-card deck, for a free-for-all of up to ten.
 *
 * A card is a few effects played in order:
 *   atk N     hit one opponent you choose for N (shield soaks it first)
 *   sweep N   hit every other player still in the game for N
 *   shield N  gain N shield (it soaks damage until the start of your next turn)
 *   heal N    gain N health, up to the maximum
 *   draw N    draw N cards
 *   extra N   you may play N more cards this turn
 *   steal N   take N random cards from the hand of one opponent you choose
 *
 * `valueOf` is a rough price for a card (points for what it does). The test suite checks that every hero's deck costs about
 * the same, so no hero is simply better than another.
 */
export type EffectKind = 'atk' | 'sweep' | 'shield' | 'heal' | 'draw' | 'extra' | 'steal';
export interface Effect {
  readonly kind: EffectKind;
  readonly n: number;
}
export interface CardDef {
  readonly name: string;
  readonly effects: readonly Effect[];
  /** How many copies are in the deck. */
  readonly copies: number;
}
export interface Hero {
  readonly id: number;
  readonly name: string;
  readonly title: string;
  /** A CSS colour for the hero's tiles. */
  readonly colour: string;
  readonly cards: readonly CardDef[];
}

const KINDS: readonly EffectKind[] = ['atk', 'sweep', 'shield', 'heal', 'draw', 'extra', 'steal'];

/** 'atk2 shield1' -> two effects. */
function fx(text: string): Effect[] {
  return text.split(' ').map((part) => {
    const m = /^([a-z]+)(\d)$/.exec(part);
    const kind = KINDS.find((k) => k === m?.[1]);
    if (!m || !kind) throw new Error(`Bad effect: ${part}`);
    return { kind, n: Number(m[2]) };
  });
}
const c = (name: string, copies: number, effects: string): CardDef => ({ name, copies, effects: fx(effects) });

export const MAX_HP = 10;
/** Shield and hand size are capped (and shields wear off at the start of your next turn), so nobody can stall the game. */
export const MAX_SHIELD = 10;
export const MAX_HAND = 10;
export const START_HAND = 3;

export const HEROES: readonly Hero[] = [
  {
    id: 0, name: 'Brakka', title: 'the Smasher', colour: '#E5484D',
    cards: [c('Cleaver Chop', 4, 'atk3'), c('Rage Swing', 3, 'atk2 extra1'), c('Crushing Blow', 2, 'atk4'), c('War Roar', 2, 'sweep1 draw1'), c('Iron Hide', 3, 'shield4'), c('Bloodlust', 3, 'atk1 heal2'), c('Headbutt', 3, 'atk2 shield1')],
  },
  {
    id: 1, name: 'Veyra', title: 'the Hexer', colour: '#7C5CFF',
    cards: [c('Spark Storm', 4, 'sweep1 draw1'), c('Fireburst', 3, 'sweep2'), c('Hex Bolt', 3, 'atk3'), c('Arcane Study', 2, 'draw2 shield1'), c('Mage Armour', 3, 'shield3 heal1'), c('Siphon', 3, 'atk1 heal2'), c('Mana Surge', 2, 'extra1 draw1')],
  },
  {
    id: 2, name: 'Pip', title: 'the Cutpurse', colour: '#16A06B',
    cards: [c('Backstab', 3, 'atk3'), c('Pickpocket', 3, 'steal1 atk1 shield1'), c('Quick Feet', 3, 'extra1 shield2'), c('Smoke Bomb', 2, 'shield2 draw1'), c('Twin Daggers', 3, 'atk2 extra1'), c('Lucky Find', 2, 'draw2'), c('Sneak Attack', 1, 'atk4'), c('Dodge', 3, 'heal2 shield1')],
  },
  {
    id: 3, name: 'Ondrel', title: 'the Cleric', colour: '#F59E0B',
    cards: [c('Mending Light', 3, 'heal3 atk1'), c('Radiant Touch', 2, 'heal4'), c('Sanctuary', 3, 'shield4'), c('Smite', 4, 'atk3'), c('Holy Wrath', 2, 'sweep2'), c('Blessing', 2, 'draw1 heal1 shield1'), c('Mace Strike', 3, 'atk2 shield1'), c('Prayer', 1, 'extra1 heal1')],
  },
  {
    id: 4, name: 'Garrik', title: 'Ironwall', colour: '#3B82F6',
    cards: [c('Tower Shield', 2, 'shield5'), c('Hold the Line', 4, 'shield3 atk1'), c('Shield Slam', 3, 'atk2 shield2'), c('Longsword', 3, 'atk3'), c('Rally', 2, 'heal2 draw1'), c('Counterstrike', 2, 'atk2 extra1'), c('Bulwark', 2, 'shield3'), c('Sweeping Cut', 2, 'sweep1 shield1')],
  },
  {
    id: 5, name: 'Nyx', title: 'the Stormcaller', colour: '#0EA5E9',
    cards: [c('Chain Lightning', 4, 'sweep2'), c('Thunderclap', 3, 'sweep1 draw1'), c('Bolt', 3, 'atk3'), c('Storm Ward', 3, 'shield3'), c('Gale', 2, 'extra1 atk1'), c('Eye of the Storm', 2, 'heal2 draw1'), c('Tempest', 1, 'sweep3'), c('Static', 2, 'atk2 shield1')],
  },
  {
    id: 6, name: 'Thistle', title: 'the Wildling', colour: '#65A30D',
    cards: [c('Thorn Lash', 4, 'atk2 heal1'), c('Bear Form', 2, 'atk4'), c('Regrowth', 2, 'heal4'), c('Bark Skin', 3, 'shield3 heal1'), c('Swarm', 3, 'sweep1 draw1'), c('Wild Growth', 2, 'draw2 shield1'), c('Pounce', 2, 'atk2 extra1'), c('Vine Snare', 2, 'atk3')],
  },
  {
    id: 7, name: 'Doran', title: 'the Alchemist', colour: '#D946EF',
    cards: [c('Acid Flask', 3, 'atk3'), c('Healing Draught', 3, 'heal2 draw1'), c('Fumes', 3, 'sweep1 draw1'), c('Transmute', 3, 'draw2 shield1'), c('Explosive Mix', 2, 'sweep2'), c('Quick Brew', 2, 'extra1 draw1'), c('Flask Barrier', 2, 'shield4'), c('Poison Dart', 2, 'atk2 steal1')],
  },
  {
    id: 8, name: 'Mirelle', title: 'the Duelist', colour: '#EC4899',
    cards: [c('Lunge', 4, 'atk2 extra1'), c('Riposte', 3, 'atk3'), c('Feint', 2, 'draw1 extra1'), c('Flourish', 3, 'atk1 draw1 shield1'), c('Parry', 3, 'shield3'), c('Killing Thrust', 1, 'atk5'), c('Bandage', 2, 'heal3'), c("Duelist's Pride", 2, 'atk2 heal1')],
  },
  {
    id: 9, name: 'Bartle', title: 'the Bard', colour: '#F97316',
    cards: [c('Sour Note', 3, 'atk2 shield1'), c('Lullaby', 3, 'heal2 draw1'), c('Ballad of Thieves', 3, 'steal1 atk1 shield1'), c('Drum Solo', 3, 'sweep1 draw1'), c('Encore', 2, 'extra1 draw1'), c('Power Chord', 3, 'atk3'), c('Crescendo', 2, 'atk2 extra1'), c('Ward Song', 1, 'shield4')],
  },
];

export const heroById = (id: number): Hero => HEROES[id] as Hero;

/** A card is identified by its hero and its place in the hero's list: `hero * 10 + index`. */
export const cardId = (hero: number, index: number): number => hero * 10 + index;
export const heroOfCard = (id: number): number => Math.floor(id / 10);
export const defOf = (id: number): CardDef => (heroById(heroOfCard(id)).cards[id % 10] as CardDef);

export function deckOf(hero: number): number[] {
  const out: number[] = [];
  heroById(hero).cards.forEach((def, index) => {
    for (let i = 0; i < def.copies; i++) out.push(cardId(hero, index));
  });
  return out;
}

const WEIGHT: Record<EffectKind, number> = { atk: 1, sweep: 1.5, shield: 0.8, heal: 0.8, draw: 1.2, extra: 1.5, steal: 1.2 };
/** A rough price for a card, in points of effect. */
export const valueOf = (def: CardDef): number => def.effects.reduce((sum, e) => sum + WEIGHT[e.kind] * e.n, 0);

export const needsTarget = (def: CardDef): boolean => def.effects.some((e) => e.kind === 'atk' || e.kind === 'steal');

/** The effects as short text for a log or a label, e.g. "Hit 3, gain 1 shield". */
export function summary(def: CardDef): string {
  const word: Record<EffectKind, (n: number) => string> = {
    atk: (n) => `hit ${n}`,
    sweep: (n) => `hit everyone ${n}`,
    shield: (n) => `${n} shield`,
    heal: (n) => `heal ${n}`,
    draw: (n) => `draw ${n}`,
    extra: (n) => `play ${n} more`,
    steal: (n) => `steal ${n} card${n === 1 ? '' : 's'}`,
  };
  const text = def.effects.map((e) => word[e.kind](e.n)).join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
