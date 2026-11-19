/**
 * The computer merchants. One heuristic player at three strengths; none of them cheats (they see only what the board
 * shows, plus their own reserved stalls).
 *
 *   buying      the best affordable stall: points first, then colours that help towards a patron
 *   otherwise   pick a target stall (good value for how little is still missing), then take the gems it needs, or reserve it
 *               when a gold token would finish the purchase
 *   discarding  hands back whichever token is least useful for its targets
 *   hard        also reserves a high-scoring stall an opponent could buy right now
 *   easy        plays a random legal action about a third of the time
 */
import { nextRandom, type Rng } from '../crater-lab/engine/rng';
import { GEMS, cardById, patronById, type Card, type Gem } from './cards';
import { bonusesOf, keyOf, legalActions, priceFor, shortfall, tokensOf, MAX_TOKENS, type Action, type PlayerState, type State } from './engine';

export type BotLevel = 'easy' | 'normal' | 'hard';
const RANDOMNESS: Record<BotLevel, number> = { easy: 0.35, normal: 0.1, hard: 0 };

const sum = (r: Record<Gem, number>): number => GEMS.reduce((n, g) => n + r[g], 0);

/** How much this stall is worth to the player: points, a little for any discount, extra for patrons it moves closer. */
function worth(state: State, me: PlayerState, card: Card): number {
  const bonus = bonusesOf(me);
  let v = card.points * 4 + 2;
  for (const id of state.patrons) {
    const need = patronById(id).requires[card.bonus] ?? 0;
    if (need > bonus[card.bonus]) v += 1.5;
  }
  // a colour we already have lots of is worth less than a new one
  v -= Math.max(0, bonus[card.bonus] - 3) * 0.5;
  return v;
}

function stallsIn(state: State, me: PlayerState): { card: Card; source: Action | null }[] {
  const out: { card: Card; source: Action | null }[] = [];
  state.board.forEach((row, li) =>
    row.forEach((id, slot) => {
      if (id !== null) out.push({ card: cardById(id), source: { type: 'reserve', level: (li + 1) as 1 | 2 | 3, slot } });
    }),
  );
  me.reserved.forEach((r) => out.push({ card: cardById(r.id), source: null }));
  return out;
}

/** The stall the player should be saving up for. */
function targets(state: State, me: PlayerState): { card: Card; missing: Record<Gem, number>; score: number; source: Action | null }[] {
  return stallsIn(state, me)
    .map(({ card, source }) => {
      const missing = shortfall(me, card);
      const gap = Math.max(0, sum(missing) - me.gems.gold);
      return { card, missing, score: worth(state, me, card) / (1 + gap * 0.8), source };
    })
    .sort((a, b) => b.score - a.score);
}

function chooseReturn(state: State, me: PlayerState, legal: Action[]): Action {
  const wanted: Record<Gem, number> = { amber: 0, azure: 0, jade: 0, pearl: 0, jet: 0 };
  const bonus = bonusesOf(me);
  for (const t of targets(state, me).slice(0, 2)) for (const g of GEMS) wanted[g] = Math.max(wanted[g], Math.max(0, t.card.cost[g] - bonus[g]));
  let best: Action | null = null;
  let bestSpare = -Infinity;
  for (const a of legal) {
    if (a.type !== 'return') continue;
    const spare = a.token === 'gold' ? -50 : me.gems[a.token] - wanted[a.token];
    if (spare > bestSpare) {
      bestSpare = spare;
      best = a;
    }
  }
  return best ?? (legal[0] as Action);
}

function takeScore(a: Action, missing: Record<Gem, number>, second: Record<Gem, number>, held: number): number {
  const gemsTaken: Gem[] = a.type === 'take3' ? [...a.gems] : a.type === 'take2' ? [a.gem, a.gem] : [];
  let score = 0;
  const left = { ...missing };
  for (const g of gemsTaken) {
    if (left[g] > 0) {
      score += 3 + left[g];
      left[g]--;
    } else score += second[g] > 0 ? 1 : 0.2;
  }
  score -= Math.max(0, held + gemsTaken.length - MAX_TOKENS) * 2.5; // tokens we would have to hand straight back
  return score;
}

export function chooseAction(state: State, level: BotLevel, rng: Rng): Action {
  const legal = legalActions(state);
  if (legal.length === 0) throw new Error('There is no action to take.');
  const me = state.players[state.turn] as PlayerState;
  if (state.phase === 'discard') return chooseReturn(state, me, legal);
  if (state.phase === 'patron' || legal[0]?.type === 'pass') return legal[0] as Action;
  if (nextRandom(rng) < RANDOMNESS[level]) return legal[Math.floor(nextRandom(rng) * legal.length)] as Action;

  // 1. buy the best stall we can afford
  const buys = legal.filter((a) => a.type === 'buy');
  if (buys.length > 0) {
    let best = buys[0] as Action;
    let bestValue = -Infinity;
    for (const a of buys) {
      if (a.type !== 'buy') continue;
      const id = 'reserved' in a.from ? (me.reserved[a.from.reserved]?.id as number) : (state.board[a.from.level - 1]?.[a.from.slot] as number);
      const price = priceFor(me, cardById(id)) as NonNullable<ReturnType<typeof priceFor>>;
      const value = worth(state, me, cardById(id)) - 0.15 * (sum(price.gems) + price.gold * 2);
      if (value > bestValue) {
        bestValue = value;
        best = a;
      }
    }
    return best;
  }

  // 2. hard: take away a high-scoring stall an opponent could buy this turn
  if (level === 'hard' && me.reserved.length < 3 && state.supply.gold > 0) {
    let deny: Action | null = null;
    let denyPoints = 2;
    state.players.forEach((other, i) => {
      if (i === state.turn) return;
      state.board.forEach((row, li) =>
        row.forEach((id, slot) => {
          if (id === null) return;
          const card = cardById(id);
          if (card.points > denyPoints && priceFor(other, card)) {
            denyPoints = card.points;
            deny = { type: 'reserve', level: (li + 1) as 1 | 2 | 3, slot };
          }
        }),
      );
    });
    if (deny) return deny;
  }

  // 3. work towards the best target
  const [first, second] = targets(state, me);
  const reservable = me.reserved.length < 3 && state.supply.gold > 0;
  if (first && reservable && first.source && sum(first.missing) - me.gems.gold <= 2 && tokensOf(me) <= MAX_TOKENS - 1 && first.card.points >= 1) {
    if (legal.some((a) => keyOf(a) === keyOf(first.source as Action))) return first.source;
  }
  const takes = legal.filter((a) => a.type === 'take3' || a.type === 'take2');
  if (takes.length > 0) {
    const missing = first ? first.missing : ({ amber: 0, azure: 0, jade: 0, pearl: 0, jet: 0 } as Record<Gem, number>);
    const other = second ? second.missing : missing;
    let best = takes[0] as Action;
    let bestScore = -Infinity;
    for (const a of takes) {
      const sc = takeScore(a, missing, other, tokensOf(me));
      if (sc > bestScore) {
        bestScore = sc;
        best = a;
      }
    }
    return best;
  }
  return legal[0] as Action;
}

