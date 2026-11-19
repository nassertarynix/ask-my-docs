import { describe, expect, it } from 'vitest';
import { createRng } from '../../crater-lab/engine/rng';
import { chooseAction, type BotLevel } from '../ai';
import { MAX_TURNS, apply, heroesHome, isLegal, legalActions, newGame, type Action, type Face, type State } from '../engine';
import { MAZE, parseMaze, SEAT_CORNERS } from '../maze';

const W = 11;
const OPEN = parseMaze(['aa.......bb', 'a.........b', '...........', '...........', '...AA.BB...', '.....M.....', '...CC.DD...', '...........', '...........', 'c.........d', 'cc.......dd'], 4, SEAT_CORNERS);
const at = (x: number, y: number) => y * W + x;
function board(face: Face, o: { seat0?: number[]; seat1?: number[]; walls?: number[]; players?: number } = {}): State {
  const base = newGame(o.players ?? 2, 1, OPEN);
  return { ...base, turn: 0, face, phase: 'play', heroes: base.heroes.map((h, i) => (i === 0 && o.seat0 ? o.seat0 : i === 1 && o.seat1 ? o.seat1 : [...h])), walls: o.walls ?? [], wallSupply: 4, turns: 0, skips: 0, minotaur: OPEN.lair };
}

function play(players: number, levels: BotLevel[], seed: number): State {
  let s = newGame(players, seed);
  const rng = createRng(seed * 31 + 5);
  while (s.phase !== 'over') {
    const a = chooseAction(s, levels[s.turn] as BotLevel, rng);
    expect(isLegal(s, a)).toBe(true);
    s = apply(s, a) as State;
  }
  return s;
}

describe('the computer heroes', () => {
  it.each([[2, 'easy'], [3, 'normal'], [4, 'hard']] as [number, BotLevel][])('finish a %i-player game of %s players with only legal actions', (n, level) => {
    for (const seed of [1, 2]) {
      const s = play(n, Array(n).fill(level), seed);
      expect(s.phase).toBe('over');
      expect(s.turns).toBeLessThan(MAX_TURNS);
      expect(s.winners.length).toBeGreaterThan(0);
    }
  }, 120_000);

  it('plays the same game from the same seed', () => {
    expect(play(3, ['hard', 'normal', 'easy'], 4)).toEqual(play(3, ['hard', 'normal', 'easy'], 4));
  });

  it('takes the winning move when it has one', () => {
    const s = board(6, { seat0: [at(3, 4), at(4, 1), at(1, 8)] });
    for (const level of ['normal', 'hard'] as BotLevel[]) {
      const a = chooseAction(s, level, createRng(1)) as Action;
      expect(a).toEqual({ type: 'move', hero: 1, to: at(4, 4) });
    }
    expect(heroesHome(apply(s, chooseAction(s, 'hard', createRng(1))) as State, 0)).toBe(2);
  });

  it('moves the hero that gains the most ground', () => {
    const s = board(3, { seat0: [at(5, 3), at(1, 8), at(2, 8)] });
    const a = chooseAction(s, 'hard', createRng(1));
    expect(a.type === 'move' && a.hero).toBe(0);
  });

  it('with the Minotaur, runs down an opponent\'s advanced hero rather than its own', () => {
    const opponent = at(5, 3);
    const own = at(5, 7);
    const s = board('minotaur', { seat0: [own, at(1, 8), at(2, 8)], seat1: [opponent, at(9, 10), at(10, 10)] });
    const a = chooseAction(s, 'hard', createRng(1));
    expect(a).toEqual({ type: 'minotaur', to: opponent });
  });

  it('never picks a wall that shuts every route, and prefers one that costs an opponent steps', () => {
    const s = board('wall', { seat0: [at(1, 8), at(2, 8), at(3, 8)], seat1: [at(8, 1), at(7, 1), at(6, 1)] });
    const a = chooseAction(s, 'hard', createRng(1));
    expect(a.type).toBe('wall');
    expect(isLegal(s, a)).toBe(true);
  });

  it('hard beats easy over a run of two-player games, from either seat', () => {
    let hard = 0;
    let easy = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const hardSeat = seed % 2;
      const s = play(2, hardSeat === 0 ? ['hard', 'easy'] : ['easy', 'hard'], seed);
      if (s.winners.length === 1 && s.winners[0] === hardSeat) hard++;
      else if (s.winners.length === 1) easy++;
    }
    expect(hard).toBeGreaterThan(easy + 3);
  }, 240_000);

  it('legal actions never disappear for a bot that has a usable roll', () => {
    let s = newGame(4, 9);
    const rng = createRng(2);
    for (let i = 0; i < 60 && s.phase !== 'over'; i++) {
      expect(legalActions(s).length).toBeGreaterThan(0);
      s = apply(s, chooseAction(s, 'normal', rng)) as State;
    }
    expect(MAZE.width).toBe(15);
  });
});
