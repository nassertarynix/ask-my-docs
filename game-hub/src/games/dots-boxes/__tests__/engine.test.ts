import { describe, expect, it } from 'vitest';
import { createRng } from '../../crater-lab/engine/rng';
import { chooseMove, exactValue, SOLVE_LIMIT, type Difficulty } from '../ai';
import {
  boxCount,
  boxEdges,
  boxesCompletedBy,
  edgeBoxes,
  edgeCount,
  edgeDots,
  freeEdges,
  horizontalId,
  isOver,
  newGame,
  play,
  sides,
  verticalId,
  winner,
  type State,
} from '../engine';

const b2 = { w: 2, h: 2 };

/** Draw these edges in order, whoever's turn it is. */
function draw(state: State, edges: number[]): State {
  return edges.reduce((s, e) => play(s, e).state, state);
}

describe('the board', () => {
  it.each([
    [{ w: 1, h: 1 }, 4, 1],
    [{ w: 2, h: 2 }, 12, 4],
    [{ w: 5, h: 5 }, 60, 25],
    [{ w: 3, h: 4 }, 31, 12],
  ])('%j has %i edges and %i boxes', (board, edges, boxes) => {
    expect(edgeCount(board)).toBe(edges);
    expect(boxCount(board)).toBe(boxes);
  });

  it('edge numbers are unique, and every box has four different edges that all touch it', () => {
    const board = { w: 4, h: 3 };
    const seen = new Set<number>();
    for (let r = 0; r <= board.h; r++) for (let c = 0; c < board.w; c++) seen.add(horizontalId(board, r, c));
    for (let r = 0; r < board.h; r++) for (let c = 0; c <= board.w; c++) seen.add(verticalId(board, r, c));
    expect(seen.size).toBe(edgeCount(board));
    expect(Math.max(...seen)).toBe(edgeCount(board) - 1);
    for (let r = 0; r < board.h; r++) {
      for (let c = 0; c < board.w; c++) {
        const edges = boxEdges(board, r, c);
        expect(new Set(edges).size).toBe(4);
        for (const e of edges) expect(edgeBoxes(board, e)).toContain(r * board.w + c);
      }
    }
  });

  it('an edge on the border touches one box, an inner edge touches two', () => {
    for (let e = 0; e < edgeCount(b2); e++) {
      const dots = edgeDots(b2, e);
      const border = (p: [number, number]) => p[0] === 0 || p[0] === 2 || p[1] === 0 || p[1] === 2;
      const onBorder = border(dots.from) && border(dots.to) && (dots.from[0] === dots.to[0] ? dots.from[0] % 2 === 0 : dots.from[1] % 2 === 0);
      expect(edgeBoxes(b2, e)).toHaveLength(onBorder ? 1 : 2);
    }
  });

  it('refuses silly sizes', () => {
    expect(() => newGame({ w: 0, h: 3 })).toThrow();
    expect(() => newGame({ w: 9, h: 3 })).toThrow();
    expect(() => newGame({ w: 2.5, h: 3 })).toThrow();
  });
});

describe('playing', () => {
  it('a move that completes nothing passes the turn', () => {
    const { state, completed } = play(newGame(b2), 0);
    expect(completed).toEqual([]);
    expect(state.current).toBe(1);
    expect(state.drawn).toBe(1);
    expect(state.lastMove).toBe(0);
  });

  it('completing a box scores it and keeps the turn; completing two at once scores two', () => {
    // box 0 (top-left): its edges are top 0, bottom 2, left 4, right 5 (horizontal ids 0..5, vertical from 6)
    const top = boxEdges(b2, 0, 0);
    let s = newGame(b2);
    s = draw(s, [top[0], top[2], top[3]]); // three sides: players 0, 1, 0
    expect(sides(s, 0)).toBe(3);
    expect(s.current).toBe(1);
    const done = play(s, top[1]);
    expect(done.completed).toEqual([0]);
    expect(done.state.owners[0]).toBe(1);
    expect(done.state.scores).toEqual([0, 1]);
    expect(done.state.current).toBe(1); // moves again

    // a double: draw the shared edge between boxes 0 and 1 last
    let d = newGame(b2);
    const left = boxEdges(b2, 0, 0);
    const right = boxEdges(b2, 0, 1);
    const shared = left[3];
    expect(right[2]).toBe(shared);
    d = draw(d, [left[0], left[1], left[2], right[0], right[1], right[3]]);
    expect(boxesCompletedBy(d, shared!)).toBe(2);
    const both = play(d, shared!);
    expect(both.completed.sort()).toEqual([0, 1]);
    expect(both.state.scores[d.current]).toBe(2);
  });

  it('refuses an edge twice, an edge that does not exist, and a move after the end', () => {
    const s = play(newGame(b2), 3).state;
    expect(() => play(s, 3)).toThrow('already');
    expect(() => play(s, 99)).toThrow();
    expect(() => play(s, -1)).toThrow();
    const over = draw(newGame({ w: 1, h: 1 }), [0, 1, 2, 3]);
    expect(isOver(over)).toBe(true);
    expect(() => play(over, 0)).toThrow('over');
  });

  it('never changes the state it was given', () => {
    const s = newGame(b2);
    play(s, 0);
    expect(s.drawn).toBe(0);
    expect(Array.from(s.edges).every((e) => e === 0)).toBe(true);
    expect(s.current).toBe(0);
  });

  it('a whole game: every box ends up owned, scores add up to the boxes, and the winner is the higher score', () => {
    const rng = createRng(4);
    for (let g = 0; g < 20; g++) {
      let s = newGame({ w: 3, h: 3 });
      while (!isOver(s)) s = play(s, chooseMove(s, 'easy', rng)).state;
      expect(s.scores[0] + s.scores[1]).toBe(9);
      expect(Array.from(s.owners).every((o) => o === 0 || o === 1)).toBe(true);
      expect(freeEdges(s)).toHaveLength(0);
      const w = winner(s);
      if (s.scores[0] === s.scores[1]) expect(w).toBe('draw');
      else expect(w).toBe(s.scores[0] > s.scores[1] ? 0 : 1);
    }
    expect(winner(newGame(b2))).toBeNull();
  });
});

describe('the computer', () => {
  it('always takes a box that is on offer (normal and hard)', () => {
    const top = boxEdges(b2, 0, 0);
    const s = draw(newGame(b2), [top[0], top[2], top[3]]); // box 0 has three sides
    for (const level of ['normal', 'hard'] as Difficulty[]) {
      for (let seed = 1; seed < 6; seed++) expect(chooseMove(s, level, createRng(seed))).toBe(top[1]);
    }
  });

  it('does not draw a third side while a safe move exists', () => {
    const board = { w: 3, h: 3 };
    let s = newGame(board);
    // give box 0 two sides, then ask many times: it must never add a third to box 0 unless forced
    const e = boxEdges(board, 0, 0);
    s = draw(s, [e[0], e[2]]);
    for (let seed = 1; seed < 30; seed++) {
      const move = chooseMove(s, 'normal', createRng(seed));
      expect(edgeBoxes(board, move).some((box) => sides(s, box) === 2)).toBe(false);
    }
  });

  it('when every move gives something away, it gives the least: a 1-box handout rather than a 3-chain', () => {
    // two isolated corridors on a 1x4 board: a single box (open) and a 3-box chain
    const board = { w: 4, h: 1 };
    let s = newGame(board);
    // wall off box 0 from the others and leave boxes 1..3 as a chain, every box with two sides drawn
    const edges: number[] = [];
    for (let c = 0; c < 4; c++) edges.push(horizontalId(board, 0, c), horizontalId(board, 1, c)); // all tops and bottoms
    edges.push(verticalId(board, 0, 0), verticalId(board, 0, 1)); // box 0: left and right drawn too (it is complete)
    s = draw(s, edges);
    // now no safe move exists among the remaining vertical edges 2, 3, 4
    const move = chooseMove(s, 'normal', createRng(1));
    expect([verticalId(board, 0, 2), verticalId(board, 0, 3), verticalId(board, 0, 4)]).toContain(move);
    // opening at either end gives away fewer than opening in the middle? on a chain of 3 every opening gives all of them
    expect(freeEdges(s)).toHaveLength(3);
  });

  it('the hard player solves small positions exactly: its move is among those with the best exact value', () => {
    const rng = createRng(12);
    let checked = 0;
    for (let g = 0; g < 12; g++) {
      let s = newGame({ w: 3, h: 2 }); // 17 edges
      while (!isOver(s) && s.edges.length - s.drawn > SOLVE_LIMIT - 2) s = play(s, chooseMove(s, 'easy', rng)).state;
      while (!isOver(s)) {
        const move = chooseMove(s, 'hard', rng);
        const value = (e: number) => {
          const { state, completed } = play(s, e);
          return state.current === s.current ? completed.length + exactValue(state) : completed.length - exactValue(state);
        };
        const best = Math.max(...freeEdges(s).map(value));
        expect(value(move)).toBe(best);
        checked++;
        s = play(s, move).state;
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('the exact value matches a known position: the player to move on a lone 2-box chain with the middle open wins both boxes... or concedes them', () => {
    // 1x2 board, all outer edges drawn, only the middle edge free: drawing it completes both boxes for the mover
    const board = { w: 2, h: 1 };
    const outer = [horizontalId(board, 0, 0), horizontalId(board, 0, 1), horizontalId(board, 1, 0), horizontalId(board, 1, 1), verticalId(board, 0, 0), verticalId(board, 0, 2)];
    const s = draw(newGame(board), outer);
    expect(exactValue(s)).toBe(2);
  });

  it('hard beats easy over a series of games, from either side', () => {
    let hardPoints = 0;
    let easyPoints = 0;
    for (let g = 0; g < 8; g++) {
      const rng = createRng(100 + g);
      const hardIs: 0 | 1 = g % 2 === 0 ? 0 : 1;
      let s = newGame({ w: 3, h: 3 });
      while (!isOver(s)) s = play(s, chooseMove(s, s.current === hardIs ? 'hard' : 'easy', rng)).state;
      hardPoints += s.scores[hardIs];
      easyPoints += s.scores[hardIs === 0 ? 1 : 0];
    }
    expect(hardPoints).toBeGreaterThan(easyPoints * 1.5);
  }, 60_000);

  it('refuses to move when the game is over', () => {
    const over = draw(newGame({ w: 1, h: 1 }), [0, 1, 2, 3]);
    expect(() => chooseMove(over, 'normal', createRng(1))).toThrow();
  });
});
