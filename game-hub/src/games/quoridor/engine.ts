/**
 * Quoridor. Two pawns on a 9 x 9 board race to the opposite edge. On your turn you either move your pawn one
 * step, or place one of your ten walls (each covers two squares' width) to slow the other player down. A wall may
 * never completely cut a pawn off from its goal: some path must always remain.
 *
 * Squares are (row, col) with row 0 at the top. Player 0 starts at the bottom middle and heads for row 0;
 * player 1 starts at the top middle and heads for row 8.
 *
 * Walls sit between squares, on an 8 x 8 grid of "crossroads":
 *   horizontal wall (r, c): lies between rows r and r+1, covering columns c and c+1
 *   vertical wall   (r, c): lies between columns c and c+1, covering rows r and r+1
 */
export const SIZE = 9;
export const WALL_GRID = SIZE - 1;
export const WALLS_EACH = 10;

export type Player = 0 | 1;
export interface Pos {
  r: number;
  c: number;
}
export type Orientation = 'h' | 'v';
export interface Wall {
  o: Orientation;
  r: number;
  c: number;
}
export type Move = { type: 'move'; to: Pos } | { type: 'wall'; wall: Wall };

export interface State {
  pawns: readonly [Pos, Pos];
  /** 1 where a wall of that orientation sits at (r, c), indexed r * 8 + c. */
  hWalls: Uint8Array;
  vWalls: Uint8Array;
  wallsLeft: readonly [number, number];
  current: Player;
  winner: Player | null;
}

export const START: readonly [Pos, Pos] = [
  { r: 8, c: 4 },
  { r: 0, c: 4 },
];
export const goalRow = (p: Player): number => (p === 0 ? 0 : SIZE - 1);

export function newGame(): State {
  return {
    pawns: [{ ...START[0] }, { ...START[1] }],
    hWalls: new Uint8Array(WALL_GRID * WALL_GRID),
    vWalls: new Uint8Array(WALL_GRID * WALL_GRID),
    wallsLeft: [WALLS_EACH, WALLS_EACH],
    current: 0,
    winner: null,
  };
}

const inBoard = (p: Pos): boolean => p.r >= 0 && p.r < SIZE && p.c >= 0 && p.c < SIZE;
const inGrid = (r: number, c: number): boolean => r >= 0 && r < WALL_GRID && c >= 0 && c < WALL_GRID;
const hAt = (hw: Uint8Array, r: number, c: number): boolean => inGrid(r, c) && hw[r * WALL_GRID + c] === 1;
const vAt = (vw: Uint8Array, r: number, c: number): boolean => inGrid(r, c) && vw[r * WALL_GRID + c] === 1;
const same = (a: Pos, b: Pos): boolean => a.r === b.r && a.c === b.c;

/** Is the step between two neighbouring squares blocked by a wall? */
function blockedBetween(hw: Uint8Array, vw: Uint8Array, a: Pos, b: Pos): boolean {
  if (a.r === b.r) {
    const c = Math.min(a.c, b.c);
    return vAt(vw, a.r, c) || vAt(vw, a.r - 1, c);
  }
  const r = Math.min(a.r, b.r);
  return hAt(hw, r, a.c) || hAt(hw, r, a.c - 1);
}

const DIRS: readonly Pos[] = [
  { r: -1, c: 0 },
  { r: 1, c: 0 },
  { r: 0, c: -1 },
  { r: 0, c: 1 },
];
const add = (p: Pos, d: Pos): Pos => ({ r: p.r + d.r, c: p.c + d.c });

/** Fewest steps from `from` to any square of `row`, ignoring pawns (the rule for deciding whether a wall is allowed). Infinity if cut off. */
export function distanceToRow(hw: Uint8Array, vw: Uint8Array, from: Pos, row: number): number {
  const seen = new Uint8Array(SIZE * SIZE);
  let frontier: Pos[] = [from];
  seen[from.r * SIZE + from.c] = 1;
  for (let steps = 0; frontier.length > 0; steps++) {
    const next: Pos[] = [];
    for (const p of frontier) {
      if (p.r === row) return steps;
      for (const d of DIRS) {
        const q = add(p, d);
        if (!inBoard(q) || seen[q.r * SIZE + q.c] || blockedBetween(hw, vw, p, q)) continue;
        seen[q.r * SIZE + q.c] = 1;
        next.push(q);
      }
    }
    frontier = next;
  }
  return Infinity;
}

export const distance = (s: State, p: Player): number => distanceToRow(s.hWalls, s.vWalls, s.pawns[p], goalRow(p));

/** The squares the player's pawn can move to this turn: steps, straight jumps and diagonal jumps. */
export function pawnMoves(s: State, p: Player = s.current): Pos[] {
  const me = s.pawns[p];
  const other = s.pawns[p === 0 ? 1 : 0];
  const out: Pos[] = [];
  for (const d of DIRS) {
    const step = add(me, d);
    if (!inBoard(step) || blockedBetween(s.hWalls, s.vWalls, me, step)) continue;
    if (!same(step, other)) {
      out.push(step);
      continue;
    }
    // the other pawn is in the way: jump over it if there is room, otherwise go round it diagonally
    const beyond = add(step, d);
    if (inBoard(beyond) && !blockedBetween(s.hWalls, s.vWalls, step, beyond)) {
      out.push(beyond);
      continue;
    }
    const sideways = d.r === 0 ? [DIRS[0] as Pos, DIRS[1] as Pos] : [DIRS[2] as Pos, DIRS[3] as Pos];
    for (const side of sideways) {
      const diagonal = add(step, side);
      if (inBoard(diagonal) && !blockedBetween(s.hWalls, s.vWalls, step, diagonal)) out.push(diagonal);
    }
  }
  return out;
}

export type WallProblem = 'none-left' | 'outside' | 'overlap' | 'cross' | 'blocks-path' | 'game-over';

/** Why a wall cannot be placed now, or null if it can. */
export function wallProblem(s: State, w: Wall): WallProblem | null {
  if (s.winner !== null) return 'game-over';
  if (s.wallsLeft[s.current] <= 0) return 'none-left';
  if (!Number.isInteger(w.r) || !Number.isInteger(w.c) || !inGrid(w.r, w.c)) return 'outside';
  const { hWalls: hw, vWalls: vw } = s;
  if (w.o === 'h') {
    if (hAt(hw, w.r, w.c) || hAt(hw, w.r, w.c - 1) || hAt(hw, w.r, w.c + 1)) return 'overlap';
    if (vAt(vw, w.r, w.c)) return 'cross';
  } else {
    if (vAt(vw, w.r, w.c) || vAt(vw, w.r - 1, w.c) || vAt(vw, w.r + 1, w.c)) return 'overlap';
    if (hAt(hw, w.r, w.c)) return 'cross';
  }
  const nh = w.o === 'h' ? withWall(hw, w) : hw;
  const nv = w.o === 'v' ? withWall(vw, w) : vw;
  for (const p of [0, 1] as Player[]) {
    if (distanceToRow(nh, nv, s.pawns[p], goalRow(p)) === Infinity) return 'blocks-path';
  }
  return null;
}

function withWall(grid: Uint8Array, w: Wall): Uint8Array {
  const copy = grid.slice();
  copy[w.r * WALL_GRID + w.c] = 1;
  return copy;
}

/** Every wall the current player may place right now. */
export function legalWalls(s: State): Wall[] {
  if (s.winner !== null || s.wallsLeft[s.current] <= 0) return [];
  const out: Wall[] = [];
  for (const o of ['h', 'v'] as Orientation[]) {
    for (let r = 0; r < WALL_GRID; r++) {
      for (let c = 0; c < WALL_GRID; c++) {
        const w: Wall = { o, r, c };
        if (wallProblem(s, w) === null) out.push(w);
      }
    }
  }
  return out;
}

export function isLegal(s: State, m: Move): boolean {
  if (s.winner !== null) return false;
  if (m.type === 'move') return pawnMoves(s).some((p) => same(p, m.to));
  return wallProblem(s, m.wall) === null;
}

/** Make a move. Returns the new state; the old one is untouched. Throws on an illegal move. */
export function apply(s: State, m: Move): State {
  if (!isLegal(s, m)) throw new Error('That move is not allowed.');
  const me = s.current;
  const next: Player = me === 0 ? 1 : 0;
  if (m.type === 'move') {
    const pawns: [Pos, Pos] = [s.pawns[0], s.pawns[1]];
    pawns[me] = { ...m.to };
    const won = m.to.r === goalRow(me);
    return { ...s, pawns, current: won ? me : next, winner: won ? me : null };
  }
  const wallsLeft: [number, number] = [s.wallsLeft[0], s.wallsLeft[1]];
  wallsLeft[me] -= 1;
  return {
    ...s,
    hWalls: m.wall.o === 'h' ? withWall(s.hWalls, m.wall) : s.hWalls,
    vWalls: m.wall.o === 'v' ? withWall(s.vWalls, m.wall) : s.vWalls,
    wallsLeft,
    current: next,
  };
}

/** The walls that are on the board. */
export function wallsOnBoard(s: State): Wall[] {
  const out: Wall[] = [];
  for (let r = 0; r < WALL_GRID; r++) {
    for (let c = 0; c < WALL_GRID; c++) {
      if (s.hWalls[r * WALL_GRID + c]) out.push({ o: 'h', r, c });
      if (s.vWalls[r * WALL_GRID + c]) out.push({ o: 'v', r, c });
    }
  }
  return out;
}
