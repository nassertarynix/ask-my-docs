/**
 * PIT // BRAWL rules: a free-for-all card brawl for 2 to 10 heroes. Last one standing wins.
 *
 * Everyone starts with 10 health (more at a big table) and three cards. On your turn you draw a card (not on the very first turn of the game),
 * then play a card, then the turn passes; some cards let you play more. A card may hit someone, shield or heal you, draw,
 * steal a card, or sweep everyone. Shield soaks damage before health does, until the start of its owner's next turn (at most 10 shield and 10 cards in hand). At 0 health you are out.
 *
 * Pure and immutable, like the other engines: `apply` returns a new state, nothing reads a clock or `Math.random`, and
 * all chance (shuffles, which card is stolen, who goes first) comes from the game's seed and a counter kept in the state.
 * A game is `newGame(heroes, seed)` plus the list of plays, so it can be replayed on any device (online play does exactly that).
 */
import { createRng, nextRandom } from '../crater-lab/engine/rng';
import { HEROES, MAX_HAND, MAX_HP, MAX_SHIELD, START_HAND, defOf, deckOf, needsTarget, summary } from './cards';

export interface Player {
  readonly hero: number;
  readonly hp: number;
  readonly shield: number;
  readonly hand: readonly number[];
  readonly drawPile: readonly number[];
  readonly discard: readonly number[];
  readonly alive: boolean;
}
export type Phase = 'play' | 'over';
export interface State {
  readonly players: readonly Player[];
  /** Starting health, and the cap for healing. */
  readonly maxHp: number;
  readonly turn: number;
  /** Cards the player to move may still play this turn. */
  readonly plays: number;
  readonly phase: Phase;
  readonly winners: readonly number[];
  readonly turns: number;
  readonly seed: number;
  /** Counts uses of chance, so each one is different but repeatable. */
  readonly counter: number;
  /** Turns in a row that were skipped because the player had no cards. */
  readonly skips: number;
  /** Who last hit each player (the bots like revenge), or null. */
  readonly hitBy: readonly (number | null)[];
}

export type Action = { readonly type: 'play'; readonly card: number; readonly target?: number };

export const MAX_PLAYERS = 10;

/** Health at the start (and the most you can heal to): 10 for up to four players, then two more for each extra player, so a big table does not wipe itself out in a few turns. */
export const maxHpFor = (players: number): number => MAX_HP + Math.max(0, players - 4) * 2;
export const MAX_TURNS = 3000;

function roll(seed: number, counter: number): number {
  const rng = createRng((seed ^ Math.imul(counter + 1, 0x9e3779b1)) >>> 0);
  nextRandom(rng);
  return nextRandom(rng);
}

function shuffled<T>(items: readonly T[], seed: number, counter: number): T[] {
  const rng = createRng((seed ^ Math.imul(counter + 7, 0x85ebca6b)) >>> 0);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(rng) * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export function newGame(heroes: readonly number[], seed: number): State {
  if (heroes.length < 2 || heroes.length > MAX_PLAYERS) throw new Error('PIT // BRAWL is for 2 to 10 players.');
  if (new Set(heroes).size !== heroes.length || heroes.some((h) => !Number.isInteger(h) || h < 0 || h >= HEROES.length)) throw new Error('Every player needs a different hero.');
  const players: Player[] = heroes.map((hero, seat) => {
    const deck = shuffled(deckOf(hero), seed, 1000 + seat);
    return { hero, hp: maxHpFor(heroes.length), shield: 0, hand: deck.slice(0, START_HAND), drawPile: deck.slice(START_HAND), discard: [], alive: true };
  });
  return {
    players,
    maxHp: maxHpFor(heroes.length),
    turn: Math.floor(roll(seed, 0) * heroes.length),
    plays: 1,
    phase: 'play',
    winners: [],
    turns: 0,
    seed,
    counter: 1,
    skips: 0,
    hitBy: heroes.map(() => null),
  };
}

const patch = (s: State, seat: number, p: Partial<Player>): State => ({ ...s, players: s.players.map((q, i) => (i === seat ? { ...q, ...p } : q)) });
export const aliveSeats = (s: State): number[] => s.players.flatMap((p, i) => (p.alive ? [i] : []));

/** Draw up to n cards, shuffling the discard pile into the draw pile when it runs out. */
function drawCards(s: State, seat: number, n: number): State {
  let state = s;
  for (let i = 0; i < n; i++) {
    let p = state.players[seat] as Player;
    if (p.hand.length >= MAX_HAND) break; // a full hand cannot take another card
    if (p.drawPile.length === 0 && p.discard.length > 0) {
      state = { ...patch(state, seat, { drawPile: shuffled(p.discard, state.seed, state.counter), discard: [] }), counter: state.counter + 1 };
      p = state.players[seat] as Player;
    }
    const top = p.drawPile[0];
    if (top === undefined) break;
    state = patch(state, seat, { hand: [...p.hand, top], drawPile: p.drawPile.slice(1) });
  }
  return state;
}

function hit(s: State, attacker: number, target: number, n: number): State {
  const p = s.players[target] as Player;
  if (!p.alive) return s;
  const soaked = Math.min(p.shield, n);
  const hp = p.hp - (n - soaked);
  let state: State = { ...s, hitBy: s.hitBy.map((h, i) => (i === target ? attacker : h)) };
  if (hp <= 0) {
    // out of the game: the hand goes to the discard pile and the shield is lost
    return patch(state, target, { hp: 0, shield: 0, alive: false, discard: [...p.discard, ...p.hand], hand: [] });
  }
  state = patch(state, target, { hp, shield: p.shield - soaked });
  return state;
}

/** Every legal play: each different card in hand, with each opponent still in the game as its target if it needs one. */
export function legalActions(s: State): Action[] {
  if (s.phase === 'over') return [];
  const me = s.players[s.turn] as Player;
  const targets = aliveSeats(s).filter((i) => i !== s.turn);
  const out: Action[] = [];
  for (const card of [...new Set(me.hand)].sort((a, b) => a - b)) {
    if (needsTarget(defOf(card))) for (const target of targets) out.push({ type: 'play', card, target });
    else out.push({ type: 'play', card });
  }
  return out;
}

export const keyOf = (a: Action): string => `play:${a.card}:${a.target ?? '-'}`;
export const isLegal = (s: State, a: Action): boolean => legalActions(s).some((x) => keyOf(x) === keyOf(a));

/** Play a card for the player to move. Returns null if it is not allowed. */
export function apply(state: State, action: Action): State | null {
  if (!isLegal(state, action)) return null;
  const seat = state.turn;
  const def = defOf(action.card);
  const me = state.players[seat] as Player;
  const at = me.hand.indexOf(action.card);
  let s: State = patch(state, seat, { hand: me.hand.filter((_, i) => i !== at), discard: [...me.discard, action.card] });
  let extra = 0;

  for (const e of def.effects) {
    switch (e.kind) {
      case 'atk':
        if (action.target !== undefined) s = hit(s, seat, action.target, e.n);
        break;
      case 'sweep':
        for (const other of aliveSeats(s)) if (other !== seat) s = hit(s, seat, other, e.n);
        break;
      case 'shield':
        s = patch(s, seat, { shield: Math.min(MAX_SHIELD, (s.players[seat] as Player).shield + e.n) });
        break;
      case 'heal':
        s = patch(s, seat, { hp: Math.min(s.maxHp, (s.players[seat] as Player).hp + e.n) });
        break;
      case 'draw':
        s = drawCards(s, seat, e.n);
        break;
      case 'extra':
        extra += e.n;
        break;
      case 'steal': {
        const target = action.target;
        for (let i = 0; i < e.n && target !== undefined; i++) {
          const victim = s.players[target] as Player;
          if (!victim.alive || victim.hand.length === 0 || (s.players[seat] as Player).hand.length >= MAX_HAND) break;
          const k = Math.floor(roll(s.seed, s.counter) * victim.hand.length);
          const taken = victim.hand[k] as number;
          s = { ...s, counter: s.counter + 1 };
          s = patch(s, target, { hand: victim.hand.filter((_, j) => j !== k) });
          s = patch(s, seat, { hand: [...(s.players[seat] as Player).hand, taken] });
        }
        break;
      }
    }
  }

  const alive = aliveSeats(s);
  if (alive.length <= 1) return { ...s, phase: 'over', winners: alive, skips: 0 };
  s = { ...s, plays: s.plays - 1 + extra, skips: 0 };
  if (s.plays <= 0 || (s.players[seat] as Player).hand.length === 0) return endTurn(s);
  return s;
}

/** Pass the turn to the next player still in the game, who draws a card. Players with nothing to play are skipped. */
function endTurn(s: State): State {
  const alive = aliveSeats(s);
  let next = s.turn;
  do next = (next + 1) % s.players.length;
  while (!(s.players[next] as Player).alive);
  // a shield lasts until the start of its owner's next turn, so nobody can build a permanent wall
  let state: State = patch({ ...s, turn: next, plays: 1, turns: s.turns + 1 }, next, { shield: 0 });
  state = drawCards(state, next, 1);
  if (state.turns >= MAX_TURNS) return finishByHealth(state);
  if ((state.players[next] as Player).hand.length === 0) {
    state = { ...state, skips: state.skips + 1 };
    if (state.skips >= alive.length) return finishByHealth(state); // nobody has a card and none can be drawn
    return endTurn(state);
  }
  return state;
}

/** The game is stuck or has gone on too long: whoever has the most health and shield left wins. */
function finishByHealth(s: State): State {
  const alive = aliveSeats(s);
  const total = (i: number) => (s.players[i] as Player).hp + (s.players[i] as Player).shield;
  const best = Math.max(...alive.map(total));
  return { ...s, phase: 'over', winners: alive.filter((i) => total(i) === best) };
}

export interface Setup {
  readonly players: readonly { readonly name: string; readonly kind: 'human' | 'bot'; readonly level?: 'easy' | 'normal' | 'hard'; readonly hero: number }[];
  readonly seed: number;
}
export interface Entry {
  readonly seat: number;
  readonly action: Action;
}

/** Play a recorded game from its start. Plays that are illegal, or from a player whose turn it is not, are ignored (everyone ignores the same ones). */
export function replay(setup: Setup, entries: readonly Entry[]): State {
  let state = newGame(setup.players.map((p) => p.hero), setup.seed);
  for (const e of entries) {
    if (e.seat !== state.turn) continue;
    const next = apply(state, e.action);
    if (next) state = next;
  }
  return state;
}

/** One line for the game log. `before` is the state the play was made in. */
export function describe(before: State, action: Action, names: readonly string[]): string {
  const seat = before.turn;
  const def = defOf(action.card);
  const after = apply(before, action);
  let text = `${names[seat]} played ${def.name}`;
  if (action.target !== undefined) text += ` on ${names[action.target]}`;
  const details: string[] = [];
  if (after) {
    const hurt: { name: string; lost: number }[] = [];
    before.players.forEach((p, i) => {
      const lost = p.hp + p.shield - ((after.players[i] as Player).hp + (after.players[i] as Player).shield);
      if (i !== seat && lost > 0) hurt.push({ name: names[i] as string, lost });
      if (p.alive && !(after.players[i] as Player).alive) details.push(`${names[i]} is out!`);
    });
    if (hurt.length <= 3) details.unshift(...hurt.map((h) => `${h.name} −${h.lost}`));
    else {
      // a sweep at a big table: "8 players −2" rather than every name
      const byAmount = new Map<number, number>();
      for (const h of hurt) byAmount.set(h.lost, (byAmount.get(h.lost) ?? 0) + 1);
      details.unshift(...[...byAmount].map(([lost, count]) => `${count} players −${lost}`));
    }
    const mine = before.players[seat] as Player;
    const healed = (after.players[seat] as Player).hp - mine.hp;
    if (healed > 0) details.push(`+${healed} health`);
    const shielded = (after.players[seat] as Player).shield - mine.shield;
    if (shielded > 0) details.push(`+${shielded} shield`);
  }
  return details.length ? `${text} (${details.join(', ')})` : `${text} (${summary(def).toLowerCase()})`;
}

