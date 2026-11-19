/**
 * The computer heroes. Each legal play (a card and, if it needs one, a target) is scored for what it would achieve, and the
 * best is played. They see only what a player sees: health, shields, hand sizes, and their own hand.
 *
 *   hitting    damage dealt, a big bonus for a knock-out, a lean towards weak targets and towards whoever hit them last
 *   sweeping   the same, added up over everyone
 *   defending  shield and healing count for more the lower their health is
 *   engine     drawing and extra plays count for something, extra plays only if there are cards left to play
 *   levels     easy: plays a random legal card about 4 times in 10;  normal: some noise in its scores;  hard: almost none
 */
import { nextRandom, type Rng } from '../crater-lab/engine/rng';
import { MAX_SHIELD, defOf } from './cards';
import { legalActions, type Action, type Player, type State } from './engine';

export type BotLevel = 'easy' | 'normal' | 'hard';
const RANDOM_PLAY: Record<BotLevel, number> = { easy: 0.4, normal: 0.08, hard: 0 };
const NOISE: Record<BotLevel, number> = { easy: 1.5, normal: 1.2, hard: 0.25 };

/** What a hit of n is worth against a player: damage that gets through counts in full, damage the shield soaks counts for half. */
function damage(n: number, t: Player): number {
  const soaked = Math.min(n, t.shield);
  return Math.min(n - soaked, t.hp) + soaked * 0.5;
}

function scoreOf(state: State, a: Action): number {
  const me = state.players[state.turn] as Player;
  const def = defOf(a.card);
  let total = 0;
  for (const e of def.effects) {
    switch (e.kind) {
      case 'atk': {
        const t = state.players[a.target as number] as Player;
        const left = t.hp + t.shield;
        total += damage(e.n, t) + (e.n >= left ? 7 : 0) + Math.max(0, state.maxHp - left) * 0.1 + (state.hitBy[state.turn] === a.target ? 1.5 : 0);
        break;
      }
      case 'sweep':
        state.players.forEach((t, i) => {
          if (i === state.turn || !t.alive) return;
          total += damage(e.n, t) * 0.9 + (e.n >= t.hp + t.shield ? 6 : 0);
        });
        break;
      case 'shield': {
        const low = me.hp / state.maxHp;
        total += Math.min(e.n, MAX_SHIELD - me.shield) * 0.9 * (low <= 0.4 ? 1.4 : low <= 0.7 ? 1 : 0.7);
        break;
      }
      case 'heal':
        total += Math.min(e.n, state.maxHp - me.hp) * (me.hp / state.maxHp <= 0.4 ? 1.5 : 1);
        break;
      case 'draw':
        total += me.drawPile.length + me.discard.length > 0 ? e.n * 1.1 : 0;
        break;
      case 'extra':
        total += me.hand.length > 1 ? e.n * 1.5 : 0.1;
        break;
      case 'steal': {
        const t = state.players[a.target as number] as Player;
        total += t.hand.length > 0 ? 1.3 : 0;
        break;
      }
    }
  }
  return total;
}

export function chooseAction(state: State, level: BotLevel, rng: Rng): Action {
  const legal = legalActions(state);
  if (legal.length === 0) throw new Error('There is no play to make.');
  if (nextRandom(rng) < RANDOM_PLAY[level]) return legal[Math.floor(nextRandom(rng) * legal.length)] as Action;
  let best = legal[0] as Action;
  let bestScore = -Infinity;
  for (const a of legal) {
    const s = scoreOf(state, a) + nextRandom(rng) * NOISE[level];
    if (s > bestScore) {
      bestScore = s;
      best = a;
    }
  }
  return best;
}
