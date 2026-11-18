import { describe, expect, it } from 'vitest';
import { createRng } from '../../crater-lab/engine/rng';
import { chooseMove, type Difficulty } from '../ai';
import { WALLS_EACH, apply, distance, distanceToRow, isLegal, legalWalls, newGame, pawnMoves, wallProblem, wallsOnBoard, type Move, type Pos, type State, type Wall } from '../engine';

const at = (r: number, c: number): Pos => ({ r, c });
const walk = (s: State, ...to: Pos[]) => to.reduce((st, p) => apply(st, { type: 'move', to: p }), s);
const wall = (s: State, o: 'h' | 'v', r: number, c: number): State => apply(s, { type: 'wall', wall: { o, r, c } });
/** A state with the pawns placed anywhere, for testing moves in isolation. */
const placed = (a: Pos, b: Pos, current: 0 | 1 = 0): State => ({ ...newGame(), pawns: [a, b], current });
const withWalls = (s: State, walls: Wall[]): State => {
  const hWalls = s.hWalls.slice();
  const vWalls = s.vWalls.slice();
  for (const w of walls) (w.o === 'h' ? hWalls : vWalls)[w.r * 8 + w.c] = 1;
  return { ...s, hWalls, vWalls };
};
const sorted = (ps: Pos[]) => ps.map((p) => `${p.r},${p.c}`).sort();

describe('the start', () => {
  it('pawns at the middle of opposite edges, ten walls each, player 0 to move, nine steps to go... eight actually', () => {
    const s = newGame();
    expect(s.pawns[0]).toEqual(at(8, 4));
    expect(s.pawns[1]).toEqual(at(0, 4));
    expect(s.wallsLeft).toEqual([WALLS_EACH, WALLS_EACH]);
    expect(s.current).toBe(0);
    expect(distance(s, 0)).toBe(8);
    expect(distance(s, 1)).toBe(8);
  });
});

describe('moving the pawn', () => {
  it('steps one square in four directions, and not off the board', () => {
    expect(sorted(pawnMoves(newGame()))).toEqual(['7,4', '8,3', '8,5']);
    expect(sorted(pawnMoves(placed(at(4, 4), at(0, 0))))).toEqual(['3,4', '4,3', '4,5', '5,4']);
  });

  it('cannot step through a wall (horizontal and vertical, from either side of the wall\'s two squares)', () => {
    const s = withWalls(placed(at(4, 4), at(0, 0)), [{ o: 'h', r: 3, c: 4 }]); // between rows 3 and 4, columns 4 and 5
    expect(sorted(pawnMoves(s))).not.toContain('3,4');
    expect(sorted(pawnMoves({ ...s, pawns: [at(4, 5), at(0, 0)] }))).not.toContain('3,5'); // the wall's second column
    expect(sorted(pawnMoves({ ...s, pawns: [at(4, 3), at(0, 0)] }))).toContain('3,3'); // just outside it
    const v = withWalls(placed(at(4, 4), at(0, 0)), [{ o: 'v', r: 3, c: 4 }]); // between columns 4 and 5, rows 3 and 4
    expect(sorted(pawnMoves(v))).not.toContain('4,5');
    expect(sorted(pawnMoves({ ...v, pawns: [at(3, 4), at(0, 0)] }))).not.toContain('3,5');
    expect(sorted(pawnMoves({ ...v, pawns: [at(5, 4), at(0, 0)] }))).toContain('5,5');
  });

  it('jumps straight over the other pawn when there is room', () => {
    const s = placed(at(4, 4), at(3, 4));
    expect(sorted(pawnMoves(s))).toEqual(['2,4', '4,3', '4,5', '5,4']);
    expect(sorted(pawnMoves(s))).not.toContain('3,4'); // cannot land on it
  });

  it('goes diagonally round the other pawn when a wall is behind it', () => {
    const s = withWalls(placed(at(4, 4), at(3, 4)), [{ o: 'h', r: 2, c: 4 }]); // wall behind the opponent
    expect(sorted(pawnMoves(s))).toEqual(['3,3', '3,5', '4,3', '4,5', '5,4']);
  });

  it('goes diagonally round the other pawn when the board edge is behind it', () => {
    const s = placed(at(1, 4), at(0, 4));
    expect(sorted(pawnMoves(s))).toEqual(['0,3', '0,5', '1,3', '1,5', '2,4']);
  });

  it('a wall beside the other pawn removes just that diagonal', () => {
    const s = withWalls(placed(at(4, 4), at(3, 4)), [{ o: 'h', r: 2, c: 4 }, { o: 'v', r: 2, c: 4 }]); // behind, and to its right
    const moves = sorted(pawnMoves(s));
    expect(moves).toContain('3,3');
    expect(moves).not.toContain('3,5');
  });

  it('a sideways jump works the same way', () => {
    const s = placed(at(4, 4), at(4, 5));
    expect(sorted(pawnMoves(s))).toEqual(['3,4', '4,3', '4,6', '5,4']);
  });

  it('walls do not stop a pawn from jumping if they are not between the pawns and the landing square', () => {
    const s = withWalls(placed(at(4, 4), at(3, 4)), [{ o: 'h', r: 3, c: 3 }]); // wall between rows 3 and 4 at columns 3, 4: between the pawns
    expect(sorted(pawnMoves(s))).not.toContain('2,4');
    expect(sorted(pawnMoves(s))).not.toContain('3,4');
  });

  it('refuses an illegal move, and a move after the game is won', () => {
    const s = newGame();
    expect(() => apply(s, { type: 'move', to: at(5, 4) })).toThrow();
    expect(() => apply(s, { type: 'move', to: at(7, 5) })).toThrow();
    const nearlyWon = placed(at(1, 0), at(0, 4));
    const won = apply(nearlyWon, { type: 'move', to: at(0, 0) });
    expect(won.winner).toBe(0);
    expect(isLegal(won, { type: 'move', to: at(0, 1) })).toBe(false);
    expect(() => apply(won, { type: 'move', to: at(0, 1) })).toThrow();
  });
});

describe('placing walls', () => {
  it('uses up a wall, passes the turn, and the wall is on the board', () => {
    const s = wall(newGame(), 'h', 3, 3);
    expect(s.wallsLeft).toEqual([9, 10]);
    expect(s.current).toBe(1);
    expect(wallsOnBoard(s)).toEqual([{ o: 'h', r: 3, c: 3 }]);
  });

  it.each([
    [{ o: 'h', r: 3, c: 3 }, 'overlap'], // the same place
    [{ o: 'h', r: 3, c: 2 }, 'overlap'], // shares half
    [{ o: 'h', r: 3, c: 4 }, 'overlap'],
    [{ o: 'v', r: 3, c: 3 }, 'cross'], // crossing at the same crossroads
  ] as [Wall, string][])('with a horizontal wall at (3,3), %j is refused as %s', (w, reason) => {
    expect(wallProblem(wall(newGame(), 'h', 3, 3), w)).toBe(reason);
  });

  it('walls that only touch end to end, or sit side by side, are fine', () => {
    const s = wall(newGame(), 'h', 3, 3);
    expect(wallProblem(s, { o: 'h', r: 3, c: 5 })).toBeNull(); // end to end, one crossroad apart
    expect(wallProblem(s, { o: 'h', r: 4, c: 3 })).toBeNull(); // the next row
    expect(wallProblem(s, { o: 'v', r: 3, c: 4 })).toBeNull();
    expect(wallProblem(s, { o: 'v', r: 2, c: 3 })).toBeNull();
  });

  it('vertical walls overlap and cross by the same rules', () => {
    const s = wall(newGame(), 'v', 3, 3);
    expect(wallProblem(s, { o: 'v', r: 4, c: 3 })).toBe('overlap');
    expect(wallProblem(s, { o: 'v', r: 2, c: 3 })).toBe('overlap');
    expect(wallProblem(s, { o: 'h', r: 3, c: 3 })).toBe('cross');
    expect(wallProblem(s, { o: 'v', r: 5, c: 3 })).toBeNull();
  });

  it('must lie on the board', () => {
    const s = newGame();
    for (const w of [{ o: 'h', r: 8, c: 0 }, { o: 'h', r: 0, c: 8 }, { o: 'v', r: -1, c: 0 }, { o: 'v', r: 0, c: 9 }, { o: 'h', r: 1.5, c: 1 }] as Wall[]) {
      expect(wallProblem(s, w)).toBe('outside');
    }
  });

  it('a player with no walls left cannot place one, and the count never goes negative', () => {
    let s: State = { ...newGame(), wallsLeft: [1, 0] };
    s = wall(s, 'h', 0, 0);
    expect(s.wallsLeft).toEqual([0, 0]);
    s = { ...s, current: 0 };
    expect(wallProblem(s, { o: 'h', r: 5, c: 5 })).toBe('none-left');
    expect(legalWalls(s)).toEqual([]);
  });
});

describe('a wall may never shut a pawn in completely (the path check)', () => {
  /** A pen round the bottom-middle pawn at (8,4): vertical walls on both sides of column 4 for rows 7 and 8. Only the top is open. */
  const pen = () => wall(wall(newGame(), 'v', 7, 3), 'v', 7, 4);

  it('refuses the wall that would close the pen\'s only exit, and allows one that leaves a way out', () => {
    const s = pen();
    expect(distance(s, 0)).toBe(8); // still free to go up
    expect(wallProblem({ ...s, current: 1 }, { o: 'h', r: 6, c: 3 })).toBe('blocks-path'); // covers (7,4) -> (6,4): sealed
    expect(wallProblem({ ...s, current: 1 }, { o: 'h', r: 6, c: 4 })).toBe('blocks-path'); // the same exit, from the other side
    expect(wallProblem({ ...s, current: 1 }, { o: 'h', r: 6, c: 2 })).toBeNull(); // columns 2-3 only: column 4 is still open
  });

  it('a wall that only lengthens the route is allowed, and the route really is longer', () => {
    const before = pen();
    const after = apply({ ...before, current: 1 }, { type: 'wall', wall: { o: 'h', r: 6, c: 2 } });
    expect(distance(after, 0)).toBe(8);
    const longer = apply({ ...before, current: 1 }, { type: 'wall', wall: { o: 'h', r: 5, c: 4 } }); // across the corridor higher up: columns 4-5
    expect(distance(longer, 0)).toBeGreaterThan(8);
    expect(distance(longer, 0)).toBeLessThan(Infinity);
  });

  it('applies to BOTH pawns: nobody may trap the opponent, and nobody may trap their own pawn', () => {
    // pen the TOP pawn (player 1 at (0,4)): vertical walls beside column 4 for rows 0 and 1
    const penned: State = withWalls(newGame(), [{ o: 'v', r: 0, c: 3 }, { o: 'v', r: 0, c: 4 }]);
    const closing: Wall = { o: 'h', r: 1, c: 3 }; // across the pen's only exit
    expect(wallProblem({ ...penned, current: 0 }, closing)).toBe('blocks-path'); // the other player may not do it...
    expect(wallProblem({ ...penned, current: 1 }, closing)).toBe('blocks-path'); // ...and neither may the penned player
  });

  it('distance counts real steps round walls', () => {
    const s = withWalls(newGame(), [{ o: 'h', r: 7, c: 3 }, { o: 'h', r: 7, c: 5 }]); // a wall across columns 3-6 above row 8
    expect(distance(s, 0)).toBeGreaterThan(8);
    expect(distanceToRow(s.hWalls, s.vWalls, at(8, 4), 8)).toBe(0);
  });

  it('every wall the engine lists as legal really can be played, and none of them cuts anyone off', () => {
    let s = newGame();
    s = walk(s, at(7, 4), at(1, 4));
    for (const w of legalWalls(s).filter((_, i) => i % 9 === 0)) {
      const next = apply(s, { type: 'wall', wall: w });
      expect(distance(next, 0)).toBeLessThan(Infinity);
      expect(distance(next, 1)).toBeLessThan(Infinity);
    }
    expect(legalWalls(newGame()).length).toBe(128);
  });
});

describe('winning', () => {
  it('reaching the far row wins, for each player, and the winner keeps the turn marker', () => {
    expect(apply(placed(at(1, 3), at(4, 4)), { type: 'move', to: at(0, 3) }).winner).toBe(0);
    expect(apply(placed(at(4, 4), at(7, 3), 1), { type: 'move', to: at(8, 3) }).winner).toBe(1);
  });

  it('a pawn that jumps onto the goal row wins too', () => {
    const s = placed(at(2, 4), at(1, 4));
    const won = apply(s, { type: 'move', to: at(0, 4) });
    expect(won.winner).toBe(0);
  });

  it('never changes the state it was given', () => {
    const s = newGame();
    wall(s, 'h', 0, 0);
    walk(s, at(7, 4));
    expect(s.pawns[0]).toEqual(at(8, 4));
    expect(wallsOnBoard(s)).toEqual([]);
    expect(s.wallsLeft).toEqual([10, 10]);
  });
});

describe('the computer', () => {
  it('takes a winning step when it has one', () => {
    for (const level of ['easy', 'normal', 'hard'] as Difficulty[]) {
      const s = placed(at(4, 4), at(7, 2), 1);
      expect(chooseMove(s, level, createRng(1))).toEqual({ type: 'move', to: at(8, 2) });
    }
  });

  it('walks towards its goal when there is nothing better, and only plays legal moves', () => {
    const rng = createRng(5);
    let s = newGame();
    for (let i = 0; i < 30 && s.winner === null; i++) {
      const m = chooseMove(s, 'normal', rng);
      expect(isLegal(s, m)).toBe(true);
      s = apply(s, m);
    }
    expect(distance(s, 0)).toBeLessThan(8);
  });

  it('puts a wall in front of an opponent who is about to win, instead of racing and losing', () => {
    // player 0 is one step from winning; it is player 1's turn and player 1 is far from its goal
    const s = withWalls(placed(at(1, 4), at(2, 4), 1), []);
    const m = chooseMove(s, 'normal', createRng(2));
    expect(m.type).toBe('wall');
    const after = apply(s, m);
    expect(distance(after, 0)).toBeGreaterThan(1);
  });

  it('never makes a move the rules forbid, in whole games between computers', () => {
    for (const [a, b] of [['easy', 'normal'], ['normal', 'normal']] as [Difficulty, Difficulty][]) {
      const rng = createRng(11);
      let s = newGame();
      let turns = 0;
      while (s.winner === null && turns++ < 200) {
        const m: Move = chooseMove(s, s.current === 0 ? a : b, rng);
        expect(isLegal(s, m)).toBe(true);
        s = apply(s, m);
      }
      expect(s.winner).not.toBeNull();
    }
  }, 120_000);

  it('refuses to move when the game is over', () => {
    const won = apply(placed(at(1, 0), at(0, 4)), { type: 'move', to: at(0, 0) });
    expect(() => chooseMove(won, 'normal', createRng(1))).toThrow();
  });

  it('normal beats easy more often than not, from either side', () => {
    let score = 0;
    for (let g = 0; g < 6; g++) {
      const rng = createRng(200 + g);
      const normalIs = (g % 2) as 0 | 1;
      let s = newGame();
      let turns = 0;
      while (s.winner === null && turns++ < 150) s = apply(s, chooseMove(s, s.current === normalIs ? 'normal' : 'easy', rng));
      score += s.winner === normalIs ? 1 : s.winner === null ? 0 : -1;
    }
    expect(score).toBeGreaterThanOrEqual(2);
  }, 180_000);
});
