import { describe, expect, it } from 'vitest';
import { createRng } from '../../crater-lab/engine/rng';
import { cardId, heroById } from '../cards';
import { chooseAction, type BotLevel } from '../ai';
import { MAX_TURNS, apply, isLegal, newGame, type Action, type Player, type State } from '../engine';

const idOf = (hero: number, name: string): number => cardId(hero, heroById(hero).cards.findIndex((c) => c.name === name));
const set = (s: State, seat: number, p: Partial<Player>): State => ({ ...s, players: s.players.map((q, i) => (i === seat ? { ...q, ...p } : q)) });
function table(n: number, hand: number[]): State {
  return set({ ...newGame(Array.from({ length: n }, (_, i) => i), 1), turn: 0 }, 0, { hand });
}

function play(heroes: number[], levels: BotLevel[], seed: number): State {
  let s = newGame(heroes, seed);
  const rng = createRng(seed * 31 + 5);
  while (s.phase !== 'over') {
    const a = chooseAction(s, levels[s.turn] as BotLevel, rng);
    expect(isLegal(s, a)).toBe(true);
    s = apply(s, a) as State;
  }
  return s;
}

describe('the computer heroes', () => {
  it.each([[2, 'easy'], [5, 'normal'], [10, 'hard']] as [number, BotLevel][])('finish a %i-player game of %s players with only legal plays', (n, level) => {
    for (const seed of [1, 2, 3]) {
      const s = play(Array.from({ length: n }, (_, i) => i), Array(n).fill(level), seed);
      expect(s.turns).toBeLessThan(MAX_TURNS);
      expect(s.winners.length).toBeGreaterThan(0);
    }
  });

  it('plays the same game from the same seed', () => {
    const heroes = [0, 3, 6, 9];
    expect(play(heroes, ['hard', 'normal', 'easy', 'hard'], 4)).toEqual(play(heroes, ['hard', 'normal', 'easy', 'hard'], 4));
  });

  it('goes for a knock-out when it has one', () => {
    const chop = idOf(0, 'Cleaver Chop'); // hit 3
    let s = table(4, [chop]);
    s = set(set(s, 1, { hp: 9 }), 2, { hp: 3 });
    for (const level of ['normal', 'hard'] as BotLevel[]) expect(chooseAction(s, level, createRng(1))).toEqual({ type: 'play', card: chop, target: 2 });
  });

  it('heals when badly hurt rather than hitting for a little', () => {
    const regrowth = idOf(6, 'Regrowth'); // heal 4
    const nick = idOf(0, 'Headbutt'); // hit 2, shield 1
    let s = table(3, [regrowth, nick]);
    s = set(s, 0, { hp: 2 });
    expect(chooseAction(s, 'hard', createRng(1))).toEqual({ type: 'play', card: regrowth });
  });

  it('sweeps when that hurts several players at once', () => {
    const storm = idOf(5, 'Chain Lightning'); // sweep 2
    const chop = idOf(0, 'Cleaver Chop'); // hit 3
    const s = table(6, [storm, chop]);
    expect(chooseAction(s, 'hard', createRng(1))).toEqual({ type: 'play', card: storm });
  });

  it('prefers to hit whoever hit it last, when all else is equal', () => {
    const chop = idOf(0, 'Cleaver Chop');
    const s = { ...table(4, [chop]), hitBy: [3, null, null, null] as (number | null)[] };
    expect(chooseAction(s, 'hard', createRng(1))).toEqual({ type: 'play', card: chop, target: 3 });
  });

  it('plays an extra-play card first when it has other cards to follow with', () => {
    const lunge = idOf(8, 'Lunge'); // hit 2, play 1 more
    const parry = idOf(8, 'Parry'); // shield 3
    const a = chooseAction(table(3, [lunge, parry]), 'hard', createRng(1)) as Action;
    expect(a.card).toBe(lunge);
  });

  it('hard beats easy over a run of two-player games, from either seat', () => {
    let hard = 0;
    let easy = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const hardSeat = seed % 2;
      const levels: BotLevel[] = hardSeat === 0 ? ['hard', 'easy'] : ['easy', 'hard'];
      const s = play([seed % 10, (seed + 3) % 10], levels, seed);
      if (s.winners.length === 1 && s.winners[0] === hardSeat) hard++;
      else if (s.winners.length === 1) easy++;
    }
    expect(hard).toBeGreaterThan(easy + 4);
  }, 120_000);
});
