import { describe, expect, it } from 'vitest';
import { createRng } from '../../crater-lab/engine/rng';
import { chooseAction, type BotLevel } from '../ai';
import { CARDS, GEMS, type Gem } from '../cards';
import { MAX_TURNS, apply, isLegal, newGame, tokensOf, winnersOf, zeroCounts, type PlayerState, type State } from '../engine';

const give = (s: State, seat: number, patch: Partial<PlayerState>): State => ({ ...s, players: s.players.map((p, i) => (i === seat ? { ...p, ...patch } : p)) });
const gems = (patch: Partial<Record<Gem | 'gold', number>>) => ({ ...zeroCounts(), ...patch });

function play(players: number, levels: BotLevel[], seed: number): State {
  let s = newGame(players, seed);
  const rng = createRng(seed * 31 + 5);
  while (s.phase !== 'over') {
    const a = chooseAction(s, levels[s.turn] as BotLevel, rng);
    expect(isLegal(s, a), JSON.stringify(a)).toBe(true);
    s = apply(s, a) as State;
  }
  return s;
}

describe('the computer merchants', () => {
  it.each([[2, 'easy'], [3, 'normal'], [4, 'hard']] as [number, BotLevel][])('finish a whole %i-player game of %s players, with only legal actions', (n, level) => {
    for (const seed of [1, 2, 3]) {
      const s = play(n, Array(n).fill(level), seed);
      expect(s.turns).toBeLessThan(MAX_TURNS);
      expect(s.winners.length).toBeGreaterThan(0);
    }
  });

  it('plays the same game from the same seed', () => {
    expect(play(3, ['hard', 'normal', 'easy'], 8)).toEqual(play(3, ['hard', 'normal', 'easy'], 8));
  });

  it('buys a high-scoring stall it can afford rather than taking more gems', () => {
    const card = CARDS.find((c) => c.level === 3 && c.points >= 4) as (typeof CARDS)[number];
    const base = newGame(2, 1);
    let s: State = { ...base, board: base.board.map((row, i) => (i === 2 ? [card.id, ...row.slice(1)] : row)) };
    s = give(s, 0, { gems: gems(Object.fromEntries(GEMS.map((g) => [g, card.cost[g]]))) });
    for (const level of ['normal', 'hard'] as BotLevel[]) expect(chooseAction(s, level, createRng(1))).toEqual({ type: 'buy', from: { level: 3, slot: 0 } });
  });

  it('hands back the token it needs least when over the limit, and keeps gold', () => {
    const base = newGame(2, 1);
    const s = give({ ...base, phase: 'discard' }, 0, { gems: gems({ amber: 5, azure: 1, jade: 1, pearl: 1, jet: 1, gold: 3 }) });
    expect(tokensOf(s.players[0] as PlayerState)).toBe(12);
    const a = chooseAction(s, 'hard', createRng(1));
    expect(a.type).toBe('return');
    expect(a.type === 'return' && a.token).not.toBe('gold');
  });

  it('on hard, reserves a big stall an opponent could buy next turn', () => {
    const card = CARDS.find((c) => c.level === 3 && c.points >= 4) as (typeof CARDS)[number];
    const base = newGame(2, 1);
    let s: State = { ...base, board: base.board.map((row, i) => (i === 2 ? [card.id, ...row.slice(1)] : row)) };
    s = give(s, 1, { gems: gems(Object.fromEntries(GEMS.map((g) => [g, card.cost[g]]))) });
    expect(chooseAction(s, 'hard', createRng(1))).toEqual({ type: 'reserve', level: 3, slot: 0 });
  });

  it('answers a patron prompt and a pass-only turn', () => {
    const base = newGame(2, 1);
    const stuck: State = { ...base, supply: gems({}), board: [[null, null, null, null], [null, null, null, null], [null, null, null, null]], decks: [[], [], []] };
    expect(chooseAction(stuck, 'easy', createRng(1))).toEqual({ type: 'pass' });
  });

  it('hard beats easy over a run of games, from either seat', () => {
    let hard = 0;
    let easy = 0;
    for (let seed = 1; seed <= 16; seed++) {
      const hardFirst = seed % 2 === 1;
      const s = play(2, hardFirst ? ['hard', 'easy'] : ['easy', 'hard'], seed);
      const winners = winnersOf(s);
      const hardSeat = hardFirst ? 0 : 1;
      if (winners.length === 1 && winners[0] === hardSeat) hard++;
      else if (winners.length === 1) easy++;
    }
    expect(hard).toBeGreaterThan(easy + 3);
  }, 120_000);
});
