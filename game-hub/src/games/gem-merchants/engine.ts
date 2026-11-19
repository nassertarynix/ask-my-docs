/**
 * GEM // MERCHANTS rules (2-4 players): a gem-collecting, engine-building card game.
 *
 * On your turn you do exactly one of: take three different gems, take two of the same colour, reserve a stall (and get a
 * gold token), or buy a stall. Stalls you own give a permanent discount. Patrons visit a player whose stalls match their
 * wishes. The first to 15 points ends the round, and the most points wins.
 *
 * Pure and immutable: `apply` returns a new state and never touches the old one, and nothing here reads a clock or
 * `Math.random`. A game is `newGame(players, seed)` plus the list of actions played, which is also what goes over the
 * network: every device replays the same list and arrives at the same state.
 */
import { createRng, nextRandom } from '../crater-lab/engine/rng';
import { CARDS, GEMS, PATRONS, cardById, patronById, type Card, type Gem, type Level, type Token } from './cards';

export type Counts = Readonly<Record<Token, number>>;
export interface Reserved {
  readonly id: number;
  /** Reserved from the face-up row, so everyone saw it. A card reserved from a deck is secret to its owner. */
  readonly open: boolean;
}
export interface PlayerState {
  readonly gems: Counts;
  readonly cards: readonly number[];
  readonly reserved: readonly Reserved[];
  readonly patrons: readonly number[];
}
export type Phase = 'action' | 'discard' | 'patron' | 'over';

export interface State {
  readonly players: readonly PlayerState[];
  readonly supply: Counts;
  /** Face-down cards still in each level's deck (index 0 = level 1). The next card is `[0]`. */
  readonly decks: readonly (readonly number[])[];
  /** The face-up row of each level: four slots, `null` once the deck has run out. */
  readonly board: readonly (readonly (number | null)[])[];
  readonly patrons: readonly number[];
  readonly turn: number;
  readonly phase: Phase;
  /** Someone has reached the target: the round is played out, then the game ends. */
  readonly lastRound: boolean;
  /** Turns completed so far. */
  readonly turns: number;
  readonly winners: readonly number[];
}

export const TARGET_POINTS = 15;
export const MAX_TOKENS = 10;
export const MAX_RESERVED = 3;
export const MAX_TURNS = 600;
const SLOTS = 4;

export type Source = { readonly level: Level; readonly slot: number } | { readonly reserved: number };
export type Action =
  | { readonly type: 'take3'; readonly gems: readonly Gem[] }
  | { readonly type: 'take2'; readonly gem: Gem }
  | { readonly type: 'reserve'; readonly level: Level; readonly slot: number | 'deck' }
  | { readonly type: 'buy'; readonly from: Source }
  | { readonly type: 'return'; readonly token: Token }
  | { readonly type: 'patron'; readonly id: number }
  | { readonly type: 'pass' };

export const zeroCounts = (): Record<Token, number> => ({ amber: 0, azure: 0, jade: 0, pearl: 0, jet: 0, gold: 0 });
const total = (c: Counts): number => c.amber + c.azure + c.jade + c.pearl + c.jet + c.gold;
export const tokensOf = (p: PlayerState): number => total(p.gems);

export function supplyFor(players: number): number {
  return players === 2 ? 4 : players === 3 ? 5 : 7;
}

function shuffle<T>(items: readonly T[], seed: number): T[] {
  const rng = createRng(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(rng) * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

export function newGame(playerCount: number, seed: number): State {
  if (!Number.isInteger(playerCount) || playerCount < 2 || playerCount > 4) throw new Error('Gem Merchants is for 2 to 4 players.');
  const decks = ([1, 2, 3] as Level[]).map((level, i) =>
    shuffle(
      CARDS.filter((c) => c.level === level).map((c) => c.id),
      seed + 7919 * (i + 1),
    ),
  );
  const board = decks.map((d, i) => {
    const row: (number | null)[] = d.slice(0, SLOTS);
    decks[i] = d.slice(SLOTS);
    return row;
  });
  const n = supplyFor(playerCount);
  const players: PlayerState[] = Array.from({ length: playerCount }, () => ({ gems: zeroCounts(), cards: [], reserved: [], patrons: [] }));
  return {
    players,
    supply: { amber: n, azure: n, jade: n, pearl: n, jet: n, gold: 5 },
    decks,
    board,
    patrons: shuffle(
      PATRONS.map((p) => p.id),
      seed + 104729,
    ).slice(0, playerCount + 1),
    turn: 0,
    phase: 'action',
    lastRound: false,
    turns: 0,
    winners: [],
  };
}

// ---------- reading a state ----------
export function bonusesOf(p: PlayerState): Record<Gem, number> {
  const b: Record<Gem, number> = { amber: 0, azure: 0, jade: 0, pearl: 0, jet: 0 };
  for (const id of p.cards) b[cardById(id).bonus]++;
  return b;
}

export function scoreOf(state: State, seat: number): number {
  const p = state.players[seat] as PlayerState;
  return p.cards.reduce((s, id) => s + cardById(id).points, 0) + p.patrons.length * 3;
}

/** What it would cost this player: gems of each colour, plus the gold needed to cover any shortfall. Null if they cannot afford it. */
export function priceFor(p: PlayerState, card: Card): { gems: Record<Gem, number>; gold: number } | null {
  const bonus = bonusesOf(p);
  const gems: Record<Gem, number> = { amber: 0, azure: 0, jade: 0, pearl: 0, jet: 0 };
  let gold = 0;
  for (const g of GEMS) {
    const due = Math.max(0, card.cost[g] - bonus[g]);
    const paid = Math.min(due, p.gems[g]);
    gems[g] = paid;
    gold += due - paid;
  }
  return gold <= p.gems.gold ? { gems, gold } : null;
}

/** Colours (with how many) still missing for this card, ignoring gold. */
export function shortfall(p: PlayerState, card: Card): Record<Gem, number> {
  const bonus = bonusesOf(p);
  const out: Record<Gem, number> = { amber: 0, azure: 0, jade: 0, pearl: 0, jet: 0 };
  for (const g of GEMS) out[g] = Math.max(0, card.cost[g] - bonus[g] - p.gems[g]);
  return out;
}

export function eligiblePatrons(state: State, seat: number): number[] {
  const bonus = bonusesOf(state.players[seat] as PlayerState);
  return state.patrons.filter((id) => GEMS.every((g) => bonus[g] >= (patronById(id).requires[g] ?? 0)));
}

export const cardAt = (state: State, level: Level, slot: number): number | null => (state.board[level - 1] as readonly (number | null)[])[slot] ?? null;

function combos(items: readonly Gem[], size: number): Gem[][] {
  if (size === 0) return [[]];
  const out: Gem[][] = [];
  items.forEach((g, i) => {
    for (const rest of combos(items.slice(i + 1), size - 1)) out.push([g, ...rest]);
  });
  return out;
}

export const keyOf = (a: Action): string => {
  switch (a.type) {
    case 'take3':
      return `take3:${[...a.gems].sort((x, y) => GEMS.indexOf(x) - GEMS.indexOf(y)).join(',')}`;
    case 'take2':
      return `take2:${a.gem}`;
    case 'reserve':
      return `reserve:${a.level}:${a.slot}`;
    case 'buy':
      return 'reserved' in a.from ? `buy:r${a.from.reserved}` : `buy:${a.from.level}:${a.from.slot}`;
    case 'return':
      return `return:${a.token}`;
    case 'patron':
      return `patron:${a.id}`;
    case 'pass':
      return 'pass';
  }
};

/** Every action the player to move may take now. Empty only when the game is over. */
export function legalActions(state: State): Action[] {
  if (state.phase === 'over') return [];
  const me = state.players[state.turn] as PlayerState;
  if (state.phase === 'discard') {
    return ([...GEMS, 'gold'] as Token[]).filter((t) => me.gems[t] > 0).map((token) => ({ type: 'return', token }));
  }
  if (state.phase === 'patron') return eligiblePatrons(state, state.turn).map((id) => ({ type: 'patron', id }));

  const out: Action[] = [];
  const available = GEMS.filter((g) => state.supply[g] > 0);
  // three different colours; fewer only when fewer than three colours are left
  if (available.length >= 3) for (const gems of combos(available, 3)) out.push({ type: 'take3', gems });
  else if (available.length > 0) for (let k = 1; k <= available.length; k++) for (const gems of combos(available, k)) out.push({ type: 'take3', gems });
  for (const g of GEMS) if (state.supply[g] >= 4) out.push({ type: 'take2', gem: g });

  if (me.reserved.length < MAX_RESERVED) {
    for (const level of [1, 2, 3] as Level[]) {
      for (let slot = 0; slot < SLOTS; slot++) if (cardAt(state, level, slot) !== null) out.push({ type: 'reserve', level, slot });
      if ((state.decks[level - 1] as readonly number[]).length > 0) out.push({ type: 'reserve', level, slot: 'deck' });
    }
  }
  for (const level of [1, 2, 3] as Level[]) {
    for (let slot = 0; slot < SLOTS; slot++) {
      const id = cardAt(state, level, slot);
      if (id !== null && priceFor(me, cardById(id))) out.push({ type: 'buy', from: { level, slot } });
    }
  }
  me.reserved.forEach((r, i) => {
    if (priceFor(me, cardById(r.id))) out.push({ type: 'buy', from: { reserved: i } });
  });
  if (out.length === 0) out.push({ type: 'pass' }); // nothing at all is possible: the turn passes
  return out;
}

export const isLegal = (state: State, action: Action): boolean => {
  const key = keyOf(action);
  return legalActions(state).some((a) => keyOf(a) === key);
};

// ---------- playing ----------
function withPlayer(state: State, seat: number, p: PlayerState): State {
  return { ...state, players: state.players.map((q, i) => (i === seat ? p : q)) };
}
const add = (c: Counts, t: Token, n: number): Counts => ({ ...c, [t]: c[t] + n });

/** Take a card off the board, filling its slot from the deck. */
function takeFromBoard(state: State, level: Level, slot: number): State {
  const deck = state.decks[level - 1] as readonly number[];
  const next = deck[0] ?? null;
  return {
    ...state,
    board: state.board.map((row, i) => (i === level - 1 ? row.map((c, s) => (s === slot ? next : c)) : row)),
    decks: state.decks.map((d, i) => (i === level - 1 ? d.slice(1) : d)),
  };
}

/** Play one action for the player to move. Returns null if it is not allowed. */
export function apply(state: State, action: Action): State | null {
  if (!isLegal(state, action)) return null;
  const seat = state.turn;
  const me = state.players[seat] as PlayerState;
  let s = state;

  switch (action.type) {
    case 'take3': {
      let gems = me.gems;
      let supply = s.supply;
      for (const g of action.gems) {
        gems = add(gems, g, 1);
        supply = add(supply, g, -1);
      }
      s = withPlayer({ ...s, supply }, seat, { ...me, gems });
      break;
    }
    case 'take2':
      s = withPlayer({ ...s, supply: add(s.supply, action.gem, -2) }, seat, { ...me, gems: add(me.gems, action.gem, 2) });
      break;
    case 'reserve': {
      const gold = s.supply.gold > 0 ? 1 : 0;
      let id: number;
      let open: boolean;
      if (action.slot === 'deck') {
        id = (s.decks[action.level - 1] as readonly number[])[0] as number;
        s = { ...s, decks: s.decks.map((d, i) => (i === action.level - 1 ? d.slice(1) : d)) };
        open = false;
      } else {
        id = cardAt(s, action.level, action.slot) as number;
        s = takeFromBoard(s, action.level, action.slot);
        open = true;
      }
      s = withPlayer({ ...s, supply: add(s.supply, 'gold', -gold) }, seat, { ...me, gems: add(me.gems, 'gold', gold), reserved: [...me.reserved, { id, open }] });
      break;
    }
    case 'buy': {
      let id: number;
      if ('reserved' in action.from) id = (me.reserved[action.from.reserved] as Reserved).id;
      else id = cardAt(s, action.from.level, action.from.slot) as number;
      const price = priceFor(me, cardById(id)) as NonNullable<ReturnType<typeof priceFor>>;
      let gems = me.gems;
      let supply = s.supply;
      for (const g of GEMS) {
        gems = add(gems, g, -price.gems[g]);
        supply = add(supply, g, price.gems[g]);
      }
      gems = add(gems, 'gold', -price.gold);
      supply = add(supply, 'gold', price.gold);
      let reserved = me.reserved;
      if ('reserved' in action.from) {
        const index = action.from.reserved;
        reserved = me.reserved.filter((_, i) => i !== index);
      } else s = takeFromBoard(s, action.from.level, action.from.slot);
      s = withPlayer({ ...s, supply }, seat, { ...me, gems, reserved, cards: [...me.cards, id] });
      break;
    }
    case 'return':
      s = withPlayer({ ...s, supply: add(s.supply, action.token, 1) }, seat, { ...me, gems: add(me.gems, action.token, -1) });
      if (tokensOf(s.players[seat] as PlayerState) > MAX_TOKENS) return { ...s, phase: 'discard' };
      return endTurn({ ...s, phase: 'action' });
    case 'patron':
      s = withPlayer({ ...s, patrons: s.patrons.filter((p) => p !== action.id) }, seat, { ...me, patrons: [...me.patrons, action.id] });
      return advance(s);
    case 'pass':
      return advance(s);
  }
  return tokensOf(s.players[seat] as PlayerState) > MAX_TOKENS ? { ...s, phase: 'discard' } : endTurn(s);
}

/** After the player's action (and any discards): patrons visit, then the turn moves on. */
function endTurn(state: State): State {
  const eligible = eligiblePatrons(state, state.turn);
  if (eligible.length === 0) return advance(state);
  if (eligible.length === 1) {
    const seat = state.turn;
    const me = state.players[seat] as PlayerState;
    const id = eligible[0] as number;
    return advance(withPlayer({ ...state, patrons: state.patrons.filter((p) => p !== id) }, seat, { ...me, patrons: [...me.patrons, id] }));
  }
  return { ...state, phase: 'patron' };
}

function advance(state: State): State {
  const reached = scoreOf(state, state.turn) >= TARGET_POINTS;
  const lastRound = state.lastRound || reached;
  const turns = state.turns + 1;
  const next = (state.turn + 1) % state.players.length;
  const s: State = { ...state, lastRound, turns, turn: next, phase: 'action' };
  if ((next === 0 && lastRound) || turns >= MAX_TURNS) return { ...s, phase: 'over', winners: winnersOf(s) };
  return s;
}

/** Most points; ties go to whoever bought the fewest stalls; a tie after that is shared. */
export function winnersOf(state: State): number[] {
  const seats = state.players.map((_, i) => i);
  const best = Math.max(...seats.map((i) => scoreOf(state, i)));
  const tied = seats.filter((i) => scoreOf(state, i) === best);
  const fewest = Math.min(...tied.map((i) => (state.players[i] as PlayerState).cards.length));
  return tied.filter((i) => (state.players[i] as PlayerState).cards.length === fewest);
}

export interface Setup {
  readonly players: readonly { readonly name: string; readonly kind: 'human' | 'bot'; readonly level?: 'easy' | 'normal' | 'hard' }[];
  readonly seed: number;
}
export interface Entry {
  readonly seat: number;
  readonly action: Action;
}

/** Play a recorded game from its start. Entries that are illegal, or from a player whose turn it is not, are ignored (everyone ignores the same ones). */
export function replay(setup: Setup, entries: readonly Entry[]): State {
  let state = newGame(setup.players.length, setup.seed);
  for (const e of entries) {
    if (e.seat !== state.turn) continue;
    const next = apply(state, e.action);
    if (next) state = next;
  }
  return state;
}

/** One line for the game log, e.g. "Ada bought a level-2 stall (+1 Jade, 2 points)". `before` is the state the action was played in. */
export function describe(before: State, action: Action, name: string): string {
  const cap = (g: string) => g.charAt(0).toUpperCase() + g.slice(1);
  switch (action.type) {
    case 'take3':
      return `${name} took ${action.gems.map(cap).join(', ')}`;
    case 'take2':
      return `${name} took two ${cap(action.gem)}`;
    case 'reserve':
      return `${name} reserved a level-${action.level} stall${action.slot === 'deck' ? ' from the deck' : ''}`;
    case 'buy': {
      const me = before.players[before.turn] as PlayerState;
      const id = 'reserved' in action.from ? (me.reserved[action.from.reserved] as Reserved).id : (cardAt(before, action.from.level, action.from.slot) as number);
      const c = cardById(id);
      return `${name} bought a level-${c.level} ${cap(c.bonus)} stall${c.points ? ` (+${c.points})` : ''}`;
    }
    case 'return':
      return `${name} returned a ${cap(action.token)} token`;
    case 'patron':
      return `${name} was visited by ${patronById(action.id).name} (+3)`;
    case 'pass':
      return `${name} had nothing to do and passed`;
  }
}
