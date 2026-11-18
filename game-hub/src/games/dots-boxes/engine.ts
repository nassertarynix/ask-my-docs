/**
 * Dots and Boxes. A grid of W x H boxes is drawn with (W+1) x (H+1) dots. Players take turns drawing one
 * edge between two neighbouring dots. Whoever draws the fourth side of a box owns it and moves again.
 * The player with more boxes wins.
 *
 * Edges are numbered: all the horizontal ones first (row by row), then all the vertical ones.
 *   horizontal (r, c): between dot (r, c) and dot (r, c+1)   r in 0..H, c in 0..W-1   id = r * W + c
 *   vertical   (r, c): between dot (r, c) and dot (r+1, c)   r in 0..H-1, c in 0..W   id = (H+1) * W + r * (W+1) + c
 */
export type Player = 0 | 1;

export interface Board {
  w: number;
  h: number;
}

export interface State {
  board: Board;
  /** 1 where the edge has been drawn. */
  edges: Uint8Array;
  /** Who owns each box (row-major), or -1. */
  owners: Int8Array;
  current: Player;
  scores: [number, number];
  /** Edges drawn so far (the last one is `lastMove`). */
  drawn: number;
  lastMove: number | null;
  /** Who drew `lastMove`. */
  lastMover: Player | null;
}

export const edgeCount = ({ w, h }: Board): number => (h + 1) * w + h * (w + 1);
export const boxCount = ({ w, h }: Board): number => w * h;

export function newGame(board: Board): State {
  if (!Number.isInteger(board.w) || !Number.isInteger(board.h) || board.w < 1 || board.h < 1 || board.w > 8 || board.h > 8) throw new Error('A board is 1 to 8 boxes each way.');
  return { board, edges: new Uint8Array(edgeCount(board)), owners: new Int8Array(boxCount(board)).fill(-1), current: 0, scores: [0, 0], drawn: 0, lastMove: null, lastMover: null };
}

export const horizontalId = (b: Board, r: number, c: number): number => r * b.w + c;
export const verticalId = (b: Board, r: number, c: number): number => (b.h + 1) * b.w + r * (b.w + 1) + c;

/** The four edges around box (r, c): top, bottom, left, right. */
export function boxEdges(b: Board, r: number, c: number): [number, number, number, number] {
  return [horizontalId(b, r, c), horizontalId(b, r + 1, c), verticalId(b, r, c), verticalId(b, r, c + 1)];
}

/** The boxes an edge touches (one on the border, two inside), as row-major box numbers. */
export function edgeBoxes(b: Board, edge: number): number[] {
  const horizontalCount = (b.h + 1) * b.w;
  const out: number[] = [];
  if (edge < horizontalCount) {
    const r = Math.floor(edge / b.w);
    const c = edge % b.w;
    if (r > 0) out.push((r - 1) * b.w + c);
    if (r < b.h) out.push(r * b.w + c);
  } else {
    const k = edge - horizontalCount;
    const r = Math.floor(k / (b.w + 1));
    const c = k % (b.w + 1);
    if (c > 0) out.push(r * b.w + (c - 1));
    if (c < b.w) out.push(r * b.w + c);
  }
  return out;
}

/** Where an edge is, for drawing: its two dots as (row, column) pairs. */
export function edgeDots(b: Board, edge: number): { from: [number, number]; to: [number, number] } {
  const horizontalCount = (b.h + 1) * b.w;
  if (edge < horizontalCount) {
    const r = Math.floor(edge / b.w);
    const c = edge % b.w;
    return { from: [r, c], to: [r, c + 1] };
  }
  const k = edge - horizontalCount;
  const r = Math.floor(k / (b.w + 1));
  const c = k % (b.w + 1);
  return { from: [r, c], to: [r + 1, c] };
}

function sidesOf(b: Board, edges: Uint8Array, box: number): number {
  const r = Math.floor(box / b.w);
  const c = box % b.w;
  return boxEdges(b, r, c).reduce((n, e) => n + (edges[e] ?? 0), 0);
}

export const sides = (s: State, box: number): number => sidesOf(s.board, s.edges, box);
export const isOver = (s: State): boolean => s.drawn === edgeCount(s.board);
export const isFree = (s: State, edge: number): boolean => edge >= 0 && edge < s.edges.length && s.edges[edge] === 0;

export function freeEdges(s: State): number[] {
  const out: number[] = [];
  for (let e = 0; e < s.edges.length; e++) if (s.edges[e] === 0) out.push(e);
  return out;
}

/** How many boxes drawing this edge would complete right now. */
export function boxesCompletedBy(s: State, edge: number): number {
  return edgeBoxes(s.board, edge).filter((box) => sides(s, box) === 3).length;
}

/**
 * Draw an edge. Returns the new state (the old one is untouched) and the boxes it completed.
 * Completing a box keeps the turn; otherwise the turn passes.
 */
export function play(s: State, edge: number): { state: State; completed: number[] } {
  if (isOver(s)) throw new Error('The game is over.');
  if (!isFree(s, edge)) throw new Error('That edge is already drawn.');
  const edges = s.edges.slice();
  edges[edge] = 1;
  const owners = s.owners.slice();
  const completed: number[] = [];
  for (const box of edgeBoxes(s.board, edge)) {
    if (sidesOf(s.board, edges, box) === 4) {
      owners[box] = s.current;
      completed.push(box);
    }
  }
  const scores: [number, number] = [s.scores[0], s.scores[1]];
  scores[s.current] += completed.length;
  const current: Player = completed.length > 0 ? s.current : s.current === 0 ? 1 : 0;
  return { state: { board: s.board, edges, owners, current, scores, drawn: s.drawn + 1, lastMove: edge, lastMover: s.current }, completed };
}

export type Winner = Player | 'draw';
export function winner(s: State): Winner | null {
  if (!isOver(s)) return null;
  return s.scores[0] === s.scores[1] ? 'draw' : s.scores[0] > s.scores[1] ? 0 : 1;
}
