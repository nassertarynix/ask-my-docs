import { describe, expect, it } from 'vitest';
import { createRng, nextRandom } from '../../crater-lab/engine/rng';
import { MAZE, ROWS, SEAT_CORNERS, cellX, cellY, parseMaze, type Maze } from '../maze';
import {
  FACES, MAX_SKIPS_IN_A_ROW, MAX_TURNS, apply, describe as describeAction, distancesToGoal, faceFor, heroDestinations, heroesHome, isLegal, keyOf, legalActions, minotaurDestinations,
  newGame, onGoal, replay, routesOpen, wallSquares, type Action, type Face, type State,
} from '../engine';

// ---- a small open board for checking one rule at a time ----
const W = 11;
const OPEN_ROWS = ['aa.......bb', 'a.........b', '...........', '...........', '...AA.BB...', '.....M.....', '...CC.DD...', '...........', '...........', 'c.........d', 'cc.......dd'];
const OPEN: Maze = parseMaze(OPEN_ROWS, 4, SEAT_CORNERS);
const at = (x: number, y: number) => y * W + x;
const rowsWith = (m: Maze, hedges: [number, number][]) => {
  const cells = [...m.cells];
  for (const [x, y] of hedges) cells[at(x, y)] = '#';
  return Array.from({ length: m.height }, (_, y) => cells.slice(y * W, y * W + W).join(''));
};

interface Options { seat0?: number[]; seat1?: number[]; minotaur?: number; walls?: number[]; supply?: number; players?: number; hedges?: [number, number][] }
/** A state on the open board with explicit heroes, Minotaur, walls and roll (seat 0 to move). Heroes not given stay on their start blocks. */
function board(face: Face, o: Options = {}): State {
  const maze = o.hedges ? parseMaze(rowsWith(OPEN, o.hedges), 4, SEAT_CORNERS) : OPEN;
  const base = newGame(o.players ?? 2, 1, maze);
  const heroes = base.heroes.map((h, i) => (i === 0 && o.seat0 ? o.seat0 : i === 1 && o.seat1 ? o.seat1 : [...h]));
  return { ...base, turn: 0, face, phase: 'play', heroes, minotaur: o.minotaur ?? maze.lair, walls: o.walls ?? [], wallSupply: o.supply ?? 4, turns: 0, skips: 0 };
}
const parked = [at(1, 8), at(2, 8), at(3, 8)]; // squares out of the way for heroes that are not the point of a test
const xy = (cells: number[]) => cells.map((c) => `${cellX(OPEN, c)},${cellY(OPEN, c)}`).sort();
const must = (s: State, a: Action): State => {
  const next = apply(s, a);
  if (!next) throw new Error(`illegal: ${keyOf(a)}`);
  return next;
};
const dist = (c: number, x: number, y: number) => Math.abs(cellX(OPEN, c) - x) + Math.abs(cellY(OPEN, c) - y);

describe('the maze data', () => {
  it('is a 15 x 15 rectangle with one lair, three start squares and at least two goal squares for each corner', () => {
    expect([MAZE.width, MAZE.height]).toEqual([15, 15]);
    expect(ROWS).toHaveLength(15);
    expect(MAZE.starts.map((s) => s.length)).toEqual([3, 3, 3, 3]);
    expect(MAZE.goals.every((g) => g.length >= 2)).toBe(true);
    expect(MAZE.lairExits.length).toBeGreaterThan(0);
  });
  it('is fair: turned a quarter turn it is the same maze, so every corner is as far from the temple as every other', () => {
    const cell = (x: number, y: number) => (ROWS[y] as string)[x] as string;
    const turn: Record<string, string> = { '#': '#', '.': '.', w: 'w', M: 'M', a: 'b', b: 'd', d: 'c', c: 'a', A: 'B', B: 'D', D: 'C', C: 'A' };
    for (let y = 0; y < 15; y++) for (let x = 0; x < 15; x++) expect(cell(14 - y, x), `square ${x},${y}`).toBe(turn[cell(x, y)]);
    const s = newGame(4, 1);
    const far = [0, 1, 2, 3].map((seat) => (distancesToGoal(s, seat)[(MAZE.starts[seat] as readonly number[])[0] as number]));
    expect(new Set(far).size).toBe(1);
    expect(far[0]).toBeGreaterThan(8);
  });
  it('has no sealed-off pockets: every open square can be walked to from every start block', () => {
    const s = newGame(4, 1);
    for (let seat = 0; seat < 4; seat++) {
      const d = distancesToGoal(s, seat);
      MAZE.cells.forEach((c, i) => {
        if ((c === '.' && !MAZE.walls.includes(i)) || 'ABCD'.includes(c)) expect(d[i], `square ${cellX(MAZE, i)},${cellY(MAZE, i)} for seat ${seat}`).toBeGreaterThanOrEqual(0);
      });
    }
  });
  it('refuses a malformed maze', () => {
    expect(() => parseMaze([...OPEN_ROWS.slice(0, 10), 'cc.......d'], 4, SEAT_CORNERS)).toThrow(); // ragged
    expect(() => parseMaze(OPEN_ROWS.map((r) => r.replace('M', '.')), 4, SEAT_CORNERS)).toThrow(); // no lair
    expect(() => parseMaze(OPEN_ROWS.map((r) => r.replace('CC', 'MC')), 4, SEAT_CORNERS)).toThrow(); // two lairs
    expect(() => parseMaze(OPEN_ROWS.map((r, i) => (i === 0 ? 'a........bb' : r)), 4, SEAT_CORNERS)).toThrow(); // two start squares for a corner
    expect(() => parseMaze(OPEN_ROWS.map((r) => r.replace('AA', 'A.')), 4, SEAT_CORNERS)).toThrow(); // one goal square for a corner
  });
});

describe('the die and setting up', () => {
  it('has six equally likely faces, repeatable from the seed', () => {
    const counts = new Map<Face, number>();
    for (let i = 0; i < 6000; i++) counts.set(faceFor(7, i), (counts.get(faceFor(7, i)) ?? 0) + 1);
    for (const f of FACES) {
      expect(counts.get(f) ?? 0).toBeGreaterThan(850);
      expect(counts.get(f) ?? 0).toBeLessThan(1150);
    }
  });
  it('puts three heroes on each start block, the Minotaur in its lair, two players in opposite corners', () => {
    const s = newGame(2, 3);
    expect(s.corners).toEqual([0, 3]);
    expect(s.heroes.map((h) => h.length)).toEqual([3, 3]);
    expect(s.heroes[0]).toEqual([...(MAZE.starts[0] as readonly number[])]);
    expect(s.minotaur).toBe(MAZE.lair);
    expect(s.wallSupply).toBe(10);
    expect(newGame(4, 3).corners).toEqual([0, 1, 2, 3]);
  });
  it('is for two to four players, and varies who starts', () => {
    expect(() => newGame(1, 1)).toThrow();
    expect(() => newGame(5, 1)).toThrow();
    expect(new Set(Array.from({ length: 40 }, (_, k) => newGame(3, k).turn)).size).toBe(3);
    expect(newGame(3, 9)).toEqual(newGame(3, 9));
  });
  it('always starts with a roll that can be used', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = newGame(3, seed);
      expect(s.phase === 'over' || legalActions(s).length > 0).toBe(true);
    }
  });
});

describe('moving a hero exactly as many squares as were rolled', () => {
  const start = at(5, 2);
  const open = (face: Face) => board(face, { seat0: [start, parked[1] as number, parked[2] as number] });
  it('even rolls end an even distance away and odd rolls an odd one, and never back where the hero started', () => {
    const notGoal = (c: number) => !'ABCD'.includes(OPEN.cells[c] as string); // stepping onto your own goal ends a move early: the one exception
    const four = heroDestinations(open(4), 0, 0, 4);
    expect(four.length).toBeGreaterThan(10);
    for (const d of four.filter(notGoal)) {
      expect(dist(d, 5, 2) % 2).toBe(0);
      expect(dist(d, 5, 2)).toBeGreaterThan(0);
    }
    expect(four).toContain(at(9, 2));
    expect(four).not.toContain(at(8, 2)); // three squares is not four
    const three = heroDestinations(open(3), 0, 0, 3);
    for (const d of three.filter(notGoal)) expect(dist(d, 5, 2) % 2).toBe(1);
    expect(three).toContain(at(8, 2));
    expect(three).toContain(at(6, 2)); // round three sides of a small block: allowed, no square is visited twice
  });
  it('never crosses a hedge, a wall, another hero or the Minotaur, and cannot stand on them', () => {
    const hedges: [number, number][] = [];
    for (let x = 4; x <= 9; x++) hedges.push([x, 1], [x, 3]);
    hedges.push([4, 2]); // a corridor along row 2, closed at its west end
    const corridor = (extra: Partial<Options> = {}) => board(3, { seat0: [start, parked[1] as number, parked[2] as number], hedges, ...extra });
    expect(xy(heroDestinations(corridor(), 0, 0, 3))).toEqual(['8,2']);
    expect(heroDestinations(corridor({ walls: [at(7, 2)] }), 0, 0, 3)).toEqual([]);
    expect(heroDestinations(corridor({ seat1: [at(8, 2), at(9, 9), at(8, 9)] }), 0, 0, 3)).toEqual([]);
    expect(heroDestinations(corridor({ minotaur: at(8, 2) }), 0, 0, 3)).toEqual([]);
  });
  it('cannot go into the lair or another player\'s start block, but may pass over another player\'s goal squares', () => {
    const nearLair = board(3, { seat0: [at(5, 4), parked[1] as number, parked[2] as number] });
    expect(heroDestinations(nearLair, 0, 0, 3)).not.toContain(at(5, 5));
    const nearStart = board(3, { seat0: [at(9, 3), parked[1] as number, parked[2] as number] });
    for (const d of heroDestinations(nearStart, 0, 0, 3)) expect(OPEN.cells[d]).not.toBe('b');
    const crossing = board(3, { seat0: [at(6, 3), parked[1] as number, parked[2] as number] });
    expect(heroDestinations(crossing, 0, 0, 3)).toContain(at(6, 6)); // over the other corners' goal squares at 6,4 and down to 6,6
  });
  it('a hero in the start block steps first onto any open square beside the block, and all three heroes have the same ways out', () => {
    const s = board(3);
    const ways = heroDestinations(s, 0, 0, 3);
    expect(ways.length).toBeGreaterThan(3);
    for (const hero of [1, 2]) expect(heroDestinations(s, 0, hero, 3)).toEqual(ways);
  });
  it('landing on its own goal ends a move with squares left over, and a hero that is home stays there', () => {
    const s = board(6, { seat0: [at(4, 1), parked[1] as number, parked[2] as number] });
    expect(heroDestinations(s, 0, 0, 6)).toContain(at(4, 4)); // three squares away: a goal square, so the move ends there
    const after = must(s, { type: 'move', hero: 0, to: at(4, 4) });
    expect(onGoal(after, 0, 0)).toBe(true);
    expect(heroesHome(after, 0)).toBe(1);
    expect(after.phase).toBe('play'); // two players need two heroes home
    expect(heroDestinations({ ...after, turn: 0, face: 4 }, 0, 0, 4)).toEqual([]);
  });
});

describe('the Minotaur', () => {
  it('leaves the lair by a square beside the temple and ends exactly eight steps along', () => {
    const { ends, hits } = minotaurDestinations(board('minotaur'));
    expect(hits).toEqual([]);
    expect(ends.length).toBeGreaterThan(20);
    for (const e of ends) {
      expect(dist(e, 5, 5) % 2).toBe(0);
      expect(OPEN.cells[e]).toBe('.');
    }
  });
  it('runs into a hero on the way: the hero goes back to its own start square and the Minotaur goes home to the lair', () => {
    const victim = at(5, 2);
    const s = board('minotaur', { seat1: [victim, at(9, 10), at(10, 10)] });
    expect(minotaurDestinations(s).hits).toContain(victim);
    const after = must(s, { type: 'minotaur', to: victim });
    expect(after.heroes[1]?.[0]).toBe((OPEN.starts[3] as readonly number[])[0]);
    expect(after.minotaur).toBe(OPEN.lair);
    expect(after.heroes[1]?.slice(1)).toEqual(s.heroes[1]?.slice(1));
  });
  it('cannot reach a hero it is walled off from, and with nothing to hit it simply moves', () => {
    const victim = at(5, 2);
    const walled = board('minotaur', { seat1: [victim, at(9, 10), at(10, 10)], walls: [at(4, 2), at(6, 2), at(5, 1), at(5, 3)] });
    expect(minotaurDestinations(walled).hits).toEqual([]);
    const s = board('minotaur');
    const e = minotaurDestinations(s).ends[0] as number;
    expect(must(s, { type: 'minotaur', to: e }).minotaur).toBe(e);
  });
  it('cannot enter a safe square, so a hero on a goal square cannot be hit and is not passed through', () => {
    const s = board('minotaur', { seat0: [at(4, 4), parked[1] as number, parked[2] as number] });
    const { ends, hits } = minotaurDestinations(s);
    expect(hits).not.toContain(at(4, 4));
    expect(ends).not.toContain(at(4, 4));
    expect(minotaurDestinations(board('minotaur')).hits).toEqual([]); // heroes on their start blocks are safe too
  });
  it('is stuck in its lair when walled in, so the roll is lost', () => {
    const s = board('minotaur', { walls: [at(5, 4), at(4, 5), at(6, 5), at(5, 6)] });
    expect(minotaurDestinations(s)).toEqual({ ends: [], hits: [] });
    expect(legalActions(s)).toEqual([]);
  });
  it('would hit its owner\'s own hero if that is what you choose', () => {
    const own = at(5, 2);
    const s = board('minotaur', { seat0: [own, parked[1] as number, parked[2] as number] });
    expect(minotaurDestinations(s).hits).toContain(own);
  });
});

describe('walls', () => {
  it('puts a wall from the edge on any empty open square, using one from the supply', () => {
    const s = board('wall', { supply: 2 });
    const targets = wallSquares(s);
    for (const c of [at(5, 5), at(4, 4), at(0, 0)]) expect(targets).not.toContain(c); // the lair, a goal square, a start square
    const after = must(s, { type: 'wall', from: 'supply', to: at(5, 3) });
    expect(after.walls).toEqual([at(5, 3)]);
    expect(after.wallSupply).toBe(1);
  });
  it('can move a wall that is already on the board, which does not use up the supply', () => {
    const s = board('wall', { walls: [at(5, 3)], supply: 0 });
    expect(legalActions(s).every((a) => a.type === 'wall' && a.from === at(5, 3))).toBe(true);
    const after = must(s, { type: 'wall', from: at(5, 3), to: at(8, 8) });
    expect(after.walls).toEqual([at(8, 8)]);
    expect(after.wallSupply).toBe(0);
  });
  it('cannot go on a hero, the Minotaur, another wall, a hedge or a safe square', () => {
    const s = board('wall', { seat0: [at(5, 3), parked[1] as number, parked[2] as number], walls: [at(7, 3)], minotaur: at(2, 5), hedges: [[8, 3]] });
    const targets = new Set(wallSquares(s));
    for (const c of [at(5, 3), at(7, 3), at(2, 5), at(8, 3), at(5, 5), at(4, 4), at(0, 0)]) expect(targets.has(c)).toBe(false);
    expect(targets.has(at(6, 3))).toBe(true);
  });
  it('may never shut every route from a start block to its owner\'s goal', () => {
    const exits = OPEN.exits[0] as readonly number[];
    expect(routesOpen(OPEN, [0, 3], [...exits])).toBe(false);
    const last = at(1, 1);
    const almost = exits.filter((e) => e !== last);
    expect(exits).toContain(last);
    expect(routesOpen(OPEN, [0, 3], almost)).toBe(true);
    const s = board('wall', { walls: [...almost], supply: 3 });
    expect(isLegal(s, { type: 'wall', from: 'supply', to: last })).toBe(false);
    expect(isLegal(s, { type: 'wall', from: 'supply', to: at(8, 8) })).toBe(true);
    const moving = board('wall', { walls: [...almost, at(8, 8)], supply: 0 });
    expect(isLegal(moving, { type: 'wall', from: at(8, 8), to: last })).toBe(false);
  });
  it('counts every seated player\'s route, not just the one rolling', () => {
    const exits3 = OPEN.exits[3] as readonly number[];
    const s = board('wall', { walls: exits3.slice(1), supply: 3 });
    expect(isLegal(s, { type: 'wall', from: 'supply', to: exits3[0] as number })).toBe(false);
  });
});

describe('winning and getting stuck', () => {
  it('needs two heroes home with two players, and the game ends at once', () => {
    const s = board(6, { seat0: [at(3, 4), at(4, 1), parked[2] as number] });
    const win = must(s, { type: 'move', hero: 1, to: at(4, 4) });
    expect(heroesHome(win, 0)).toBe(2);
    expect(win.phase).toBe('over');
    expect(win.winners).toEqual([0]);
    expect(legalActions(win)).toEqual([]);
    expect(apply(win, { type: 'move', hero: 2, to: 0 })).toBeNull();
  });
  it('needs one hero home with three or four players', () => {
    for (const players of [3, 4]) {
      const base = board(6, { players });
      const s = { ...base, heroes: base.heroes.map((h, i) => (i === 0 ? [at(4, 1), parked[1] as number, parked[2] as number] : h)) };
      const win = must(s, { type: 'move', hero: 0, to: at(4, 4) });
      expect(win.phase).toBe('over');
      expect(win.winners).toEqual([0]);
    }
  });
  it('loses the turn when the roll cannot be used, and passes on to the next player with a new roll', () => {
    const s = board('minotaur', { walls: [at(5, 4), at(4, 5), at(6, 5), at(5, 6)] });
    expect(legalActions(s)).toEqual([]);
    // a legal move by seat 0 hands over to seat 1, whose roll is whatever the seed gives; the game only ever stops on a usable roll
    const open = board(3);
    const after = must(open, legalActions(open)[0] as Action);
    expect(after.turn).toBe(1);
    expect(after.phase === 'over' || legalActions(after).length > 0).toBe(true);
  });
  it('ends a game in which nothing can ever be done, giving it to whoever is furthest on', () => {
    // movable walls standing on every way out of every start block and on every way out of the lair
    const walled = [[2, 0], [1, 1], [0, 2], [8, 0], [9, 1], [10, 2], [0, 8], [1, 9], [2, 10], [8, 10], [9, 9], [10, 8], [5, 4], [4, 5], [6, 5], [5, 6]];
    const rows = OPEN_ROWS.map((r, y) => r.split('').map((ch, x) => (walled.some(([wx, wy]) => wx === x && wy === y) ? 'w' : ch)).join(''));
    const sealed = parseMaze(rows, 0, SEAT_CORNERS);
    const s = newGame(2, 1, sealed);
    expect(s.phase).toBe('over');
    expect(s.skips).toBe(MAX_SKIPS_IN_A_ROW);
    expect(s.winners).toEqual([0, 1]);
  });
  it('ends a game that has gone on far too long', () => {
    const s = board(3);
    const almost = { ...s, turns: MAX_TURNS - 1 };
    expect(must(almost, legalActions(almost)[0] as Action).phase).toBe('over');
  });
});

describe('replaying and describing', () => {
  const setup = { players: [{ name: 'Ada', kind: 'human' as const }, { name: 'Bo', kind: 'human' as const }], seed: 5 };
  it('rebuilds a game from its actions, ignoring actions out of turn or illegal ones', () => {
    const start = newGame(2, 5);
    const first = legalActions(start)[0] as Action;
    const direct = must(start, first);
    expect(replay(setup, [{ seat: start.turn, action: first }])).toEqual(direct);
    const noisy = replay(setup, [
      { seat: (start.turn + 1) % 2, action: first },
      { seat: start.turn, action: { type: 'minotaur', to: 0 } },
      { seat: start.turn, action: first },
    ]);
    expect(noisy).toEqual(direct);
  });
  it('does not change the state it is given', () => {
    const s = newGame(2, 3);
    const before = JSON.stringify(s);
    apply(s, legalActions(s)[0] as Action);
    expect(JSON.stringify(s)).toBe(before);
  });
  it('describes each kind of action', () => {
    const names = ['Ada', 'Bo'];
    const m = board(3);
    expect(describeAction(m, legalActions(m)[0] as Action, names)).toBe('Ada rolled 3 and moved a hero');
    const w = board('wall');
    expect(describeAction(w, { type: 'wall', from: 'supply', to: at(5, 3) }, names)).toBe('Ada rolled a wall and placed one');
    const hitTarget = at(5, 2);
    const hit = board('minotaur', { seat1: [hitTarget, at(9, 10), at(10, 10)] });
    expect(describeAction(hit, { type: 'minotaur', to: hitTarget }, names)).toContain("hit Bo's hero");
  });
});

describe('whole games', () => {
  it.each([2, 3, 4])('a %i-player game of random legal actions finishes', (n) => {
    for (const seed of [1, 2]) {
      let s = newGame(n, seed);
      const rng = createRng(seed * 17);
      let steps = 0;
      while (s.phase !== 'over' && steps++ < 5000) {
        const acts = legalActions(s);
        s = must(s, acts[Math.floor(nextRandom(rng) * acts.length)] as Action);
      }
      expect(s.phase).toBe('over');
      expect(s.winners.length).toBeGreaterThan(0);
    }
  }, 120_000);
});
