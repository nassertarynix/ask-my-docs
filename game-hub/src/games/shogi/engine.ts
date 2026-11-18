/**
 * Shogi (Japanese chess) rules.
 *
 * The board is 9 x 9, `square = row * 9 + col`. Row 0 is the top (rank "a", gote's back rank) and column 0 is the left
 * (file 9), the way a diagram is drawn with sente (the side that moves first, "black") at the bottom. Squares are named
 * as in the USI protocol: file 9..1 then rank a..i, so sente's first rank is row 8 = "i" and "7g7f" is the usual first move.
 *
 * A position is mutable (`makeMove` / `unmakeMove`) because the computer's search must be fast; the game screen never
 * keeps one, it rebuilds a position from the list of moves with `replay`, as the chess game does.
 *
 * Rules covered: every piece and promotion (optional in the promotion zone, forced where a piece would have no move),
 * captured pieces going to the capturer's hand and being dropped back, the drop rules (no two unpromoted pawns of one side
 * on a file, nothing dropped where it could never move, no pawn drop that mates), check, checkmate, four-fold repetition
 * (a draw, unless one side gave check every move, which loses) and a move limit.
 */

export type Side = 0 | 1; // 0 = sente (first, bottom), 1 = gote
export type Kind = 'K' | 'R' | 'B' | 'G' | 'S' | 'N' | 'L' | 'P';
export const KINDS: readonly Kind[] = ['K', 'R', 'B', 'G', 'S', 'N', 'L', 'P'];
/** Piece codes: 1..8 in KINDS order, +8 when promoted. On the board a gote piece is stored negative. */
export const CODE: Record<Kind, number> = { K: 1, R: 2, B: 3, G: 4, S: 5, N: 6, L: 7, P: 8 };
const PROMOTABLE = new Set([2, 3, 5, 6, 7, 8]);
export const HAND_KINDS: readonly Kind[] = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];

export const START_SFEN = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';
export const MAX_PLIES = 512;

// ---- directions (sente's point of view: "forward" is up the screen, row - 1) ----
const DR = [-1, -1, 0, 1, 1, 1, 0, -1];
const DC = [0, 1, 1, 1, 0, -1, -1, -1];
const FLIP = [4, 3, 2, 1, 0, 7, 6, 5]; // the same direction seen from gote
const GOLD_STEPS = [0, 1, 2, 4, 6, 7];
const STEPS: number[][] = [];
const SLIDES: number[][] = [];
for (let c = 0; c <= 16; c++) {
  STEPS[c] = [];
  SLIDES[c] = [];
}
STEPS[1] = [0, 1, 2, 3, 4, 5, 6, 7];
for (const c of [4, 13, 14, 15, 16]) STEPS[c] = GOLD_STEPS;
STEPS[5] = [0, 1, 3, 5, 7];
STEPS[8] = [0];
SLIDES[7] = [0];
SLIDES[2] = [0, 2, 4, 6];
SLIDES[3] = [1, 3, 5, 7];
SLIDES[10] = [0, 2, 4, 6];
STEPS[10] = [1, 3, 5, 7];
SLIDES[11] = [1, 3, 5, 7];
STEPS[11] = [0, 2, 4, 6];
const KNIGHT = 6;

export const sqRow = (sq: number): number => (sq / 9) | 0;
export const sqCol = (sq: number): number => sq % 9;
export const sqName = (sq: number): string => `${9 - sqCol(sq)}${'abcdefghi'[sqRow(sq)]}`;
export function sqFromName(name: string): number {
  const file = Number(name[0]);
  const rank = 'abcdefghi'.indexOf(name[1] ?? '');
  if (!(file >= 1 && file <= 9) || rank < 0) throw new Error(`Bad square: ${name}`);
  return rank * 9 + (9 - file);
}

export const baseOf = (code: number): number => (code > 8 ? code - 8 : code);
export const isPromoted = (code: number): boolean => code > 8;
export const kindOf = (code: number): Kind => KINDS[baseOf(Math.abs(code)) - 1] as Kind;
export const ownerOf = (code: number): Side => (code > 0 ? 0 : 1);

/** Is this row inside the promotion zone (the far three ranks) for the side? */
const inZone = (row: number, side: Side): boolean => (side === 0 ? row <= 2 : row >= 6);

// ---- moves, packed into one integer: from (0..80, or 127 for a drop) | to << 7 | promote << 14 | dropped code << 15 ----
export type Move = number;
export const DROP = 127;
export const moveFrom = (m: Move): number => m & 127;
export const moveTo = (m: Move): number => (m >> 7) & 127;
export const movePromotes = (m: Move): boolean => ((m >> 14) & 1) === 1;
export const moveDropCode = (m: Move): number => (m >> 15) & 15;
export const isDrop = (m: Move): boolean => moveFrom(m) === DROP;
export const stepMove = (from: number, to: number, promote = false): Move => from | (to << 7) | ((promote ? 1 : 0) << 14);
export const dropMove = (kind: Kind, to: number): Move => DROP | (to << 7) | (CODE[kind] << 15);

interface Undo {
  move: Move;
  captured: number;
  piece: number;
}

export interface GenerateOptions {
  /** Only consider drops next to a piece (the computer's search uses this; the rules never do). */
  nearDrops?: boolean;
  /** Only moves that capture (no drops): for the capture search at the end of a line. */
  capturesOnly?: boolean;
}

export class Position {
  readonly board = new Int8Array(81);
  /** hands[side * 9 + code], codes 2..8 */
  readonly hands = new Int8Array(18);
  turn: Side = 0;
  readonly kings: [number, number] = [-1, -1];
  private readonly stack: Undo[] = [];

  /** How many moves have been made on this position (for unwinding after an interrupted search). */
  get plyCount(): number {
    return this.stack.length;
  }

  clone(): Position {
    const p = new Position();
    p.board.set(this.board);
    p.hands.set(this.hands);
    p.turn = this.turn;
    p.kings[0] = this.kings[0];
    p.kings[1] = this.kings[1];
    return p;
  }

  handCount(side: Side, kind: Kind): number {
    return this.hands[side * 9 + CODE[kind]] as number;
  }

  makeMove(m: Move): void {
    const side = this.turn;
    const sign = side === 0 ? 1 : -1;
    const to = moveTo(m);
    if (isDrop(m)) {
      const code = moveDropCode(m);
      this.board[to] = sign * code;
      this.hands[side * 9 + code] = (this.hands[side * 9 + code] as number) - 1;
      this.stack.push({ move: m, captured: 0, piece: code * sign });
    } else {
      const from = moveFrom(m);
      const piece = this.board[from] as number;
      const captured = this.board[to] as number;
      if (captured !== 0) this.hands[side * 9 + baseOf(Math.abs(captured))] = (this.hands[side * 9 + baseOf(Math.abs(captured))] as number) + 1;
      this.board[to] = movePromotes(m) ? piece + sign * 8 : piece;
      this.board[from] = 0;
      if (Math.abs(piece) === 1) this.kings[side] = to;
      this.stack.push({ move: m, captured, piece });
    }
    this.turn = (1 - side) as Side;
  }

  unmakeMove(): void {
    const u = this.stack.pop();
    if (!u) return;
    const side = (1 - this.turn) as Side;
    const to = moveTo(u.move);
    if (isDrop(u.move)) {
      this.board[to] = 0;
      this.hands[side * 9 + moveDropCode(u.move)] = (this.hands[side * 9 + moveDropCode(u.move)] as number) + 1;
    } else {
      const from = moveFrom(u.move);
      this.board[from] = u.piece;
      this.board[to] = u.captured;
      if (u.captured !== 0) this.hands[side * 9 + baseOf(Math.abs(u.captured))] = (this.hands[side * 9 + baseOf(Math.abs(u.captured))] as number) - 1;
      if (Math.abs(u.piece) === 1) this.kings[side] = from;
    }
    this.turn = side;
  }

  /** Does `by` attack the square? (Looks outwards from the square, so it is cheap.) */
  isAttacked(sq: number, by: Side): boolean {
    const row = sqRow(sq);
    const col = sqCol(sq);
    for (let d = 0; d < 8; d++) {
      const dr = DR[d] as number;
      const dc = DC[d] as number;
      let r = row + dr;
      let c = col + dc;
      let k = 1;
      while (r >= 0 && r < 9 && c >= 0 && c < 9) {
        const p = this.board[r * 9 + c] as number;
        if (p !== 0) {
          if (ownerOf(p) === by) {
            const code = Math.abs(p);
            // the piece looks back at `sq` along the opposite direction, in its own frame
            const back = (d + 4) % 8;
            const own = by === 0 ? back : (FLIP[back] as number);
            if ((SLIDES[code] as number[]).includes(own) || (k === 1 && (STEPS[code] as number[]).includes(own))) return true;
          }
          break;
        }
        r += dr;
        c += dc;
        k++;
      }
    }
    // knights: a sente knight stands two rows below the square it attacks, a gote knight two rows above
    const kr = row + (by === 0 ? 2 : -2);
    if (kr >= 0 && kr < 9) {
      for (const dc of [-1, 1]) {
        const kc = col + dc;
        if (kc >= 0 && kc < 9 && this.board[kr * 9 + kc] === (by === 0 ? KNIGHT : -KNIGHT)) return true;
      }
    }
    return false;
  }

  inCheck(side: Side = this.turn): boolean {
    const k = this.kings[side];
    return k >= 0 && this.isAttacked(k, (1 - side) as Side);
  }

  /** Moves that obey how pieces move and drop, but may leave the mover's king in check. */
  pseudoMoves(options: GenerateOptions = {}): Move[] {
    const out: Move[] = [];
    const side = this.turn;
    const sign = side === 0 ? 1 : -1;
    for (let from = 0; from < 81; from++) {
      const p = this.board[from] as number;
      if (p === 0 || ownerOf(p) !== side) continue;
      const code = Math.abs(p);
      const row = sqRow(from);
      const col = sqCol(from);
      const add = (to: number) => {
        const target = this.board[to] as number;
        if (target !== 0 && ownerOf(target) === side) return false;
        if (target === 0 && options.capturesOnly) return true; // nothing to add, but a slider carries on
        const base = baseOf(code);
        const toRow = sqRow(to);
        const canPromote = !isPromoted(code) && PROMOTABLE.has(base) && (inZone(row, side) || inZone(toRow, side));
        const last = side === 0 ? toRow : 8 - toRow; // 0 = the far rank
        const forced = (base === 8 || base === 7) && last === 0 ? true : base === 6 && last <= 1;
        if (canPromote) out.push(stepMove(from, to, true));
        if (!(canPromote && forced)) out.push(stepMove(from, to));
        return target === 0; // a slider may go on only through empty squares
      };
      for (const d of STEPS[code] as number[]) {
        const dd = side === 0 ? d : (FLIP[d] as number);
        const r = row + (DR[dd] as number);
        const c = col + (DC[dd] as number);
        if (r >= 0 && r < 9 && c >= 0 && c < 9) add(r * 9 + c);
      }
      for (const d of SLIDES[code] as number[]) {
        const dd = side === 0 ? d : (FLIP[d] as number);
        let r = row + (DR[dd] as number);
        let c = col + (DC[dd] as number);
        while (r >= 0 && r < 9 && c >= 0 && c < 9) {
          if (!add(r * 9 + c)) break;
          r += DR[dd] as number;
          c += DC[dd] as number;
        }
      }
      if (code === KNIGHT) {
        const r = row + (side === 0 ? -2 : 2);
        if (r >= 0 && r < 9) for (const dc of [-1, 1]) if (col + dc >= 0 && col + dc < 9) add(r * 9 + col + dc);
      }
    }
    for (let code = 2; code <= 8 && !options.capturesOnly; code++) {
      if ((this.hands[side * 9 + code] as number) === 0) continue;
      let pawnFiles = 0;
      if (code === 8) for (let sq = 0; sq < 81; sq++) if (this.board[sq] === sign * 8) pawnFiles |= 1 << sqCol(sq);
      for (let to = 0; to < 81; to++) {
        if (this.board[to] !== 0) continue;
        const row = sqRow(to);
        const last = side === 0 ? row : 8 - row;
        if ((code === 8 || code === 7) && last === 0) continue;
        if (code === 6 && last <= 1) continue;
        if (code === 8 && (pawnFiles & (1 << sqCol(to))) !== 0) continue; // two pawns on a file
        if (options.nearDrops && !this.hasNeighbour(to)) continue;
        out.push(DROP | (to << 7) | (code << 15));
      }
    }
    return out;
  }

  private hasNeighbour(sq: number): boolean {
    const row = sqRow(sq);
    const col = sqCol(sq);
    for (let d = 0; d < 8; d++) {
      const r = row + (DR[d] as number);
      const c = col + (DC[d] as number);
      if (r >= 0 && r < 9 && c >= 0 && c < 9 && this.board[r * 9 + c] !== 0) return true;
    }
    return false;
  }

  /** Does the side to move have at least one legal move (ignoring the pawn-drop-mate rule, which only ever forbids drops)? */
  hasLegalMove(): boolean {
    const side = this.turn;
    for (const m of this.pseudoMoves()) {
      this.makeMove(m);
      const ok = !this.inCheck(side);
      this.unmakeMove();
      if (ok) return true;
    }
    return false;
  }

  /** Every legal move for the side to move. */
  legalMoves(options: GenerateOptions = {}): Move[] {
    const side = this.turn;
    const out: Move[] = [];
    for (const m of this.pseudoMoves(options)) {
      this.makeMove(m);
      let ok = !this.inCheck(side);
      // dropping a pawn to give checkmate is not allowed
      if (ok && isDrop(m) && moveDropCode(m) === 8 && this.inCheck(this.turn) && !this.hasLegalMove()) ok = false;
      this.unmakeMove();
      if (ok) out.push(m);
    }
    return out;
  }
}

/** Count the positions `depth` moves ahead (used to prove the move generator). */
export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  let n = 0;
  for (const m of pos.legalMoves()) {
    if (depth === 1) {
      n++;
      continue;
    }
    pos.makeMove(m);
    n += perft(pos, depth - 1);
    pos.unmakeMove();
  }
  return n;
}

// ---- SFEN: the standard text form of a position ----
export function parseSfen(sfen: string): Position {
  const [boardPart, turnPart, handPart] = sfen.trim().split(/\s+/);
  const pos = new Position();
  const rows = (boardPart ?? '').split('/');
  if (rows.length !== 9) throw new Error('SFEN needs nine ranks.');
  rows.forEach((text, row) => {
    let col = 0;
    let promoted = false;
    for (const ch of text) {
      if (ch === '+') {
        promoted = true;
        continue;
      }
      if (ch >= '1' && ch <= '9') {
        col += Number(ch);
        continue;
      }
      const kind = ch.toUpperCase() as Kind;
      if (!(kind in CODE) || col > 8) throw new Error(`Bad SFEN piece: ${ch}`);
      const side: Side = ch === kind ? 0 : 1;
      const code = CODE[kind] + (promoted ? 8 : 0);
      if (promoted && !PROMOTABLE.has(CODE[kind])) throw new Error(`${ch} cannot be promoted.`);
      pos.board[row * 9 + col] = side === 0 ? code : -code;
      if (kind === 'K') pos.kings[side] = row * 9 + col;
      col++;
      promoted = false;
    }
    if (col !== 9) throw new Error('Every SFEN rank needs nine squares.');
  });
  pos.turn = turnPart === 'w' ? 1 : 0;
  if (handPart && handPart !== '-') {
    for (const [, n, ch] of handPart.matchAll(/(\d*)([A-Za-z])/g)) {
      const kind = (ch as string).toUpperCase() as Kind;
      if (!HAND_KINDS.includes(kind)) throw new Error(`Bad SFEN hand piece: ${ch}`);
      const side: Side = ch === kind ? 0 : 1;
      pos.hands[side * 9 + CODE[kind]] = Number(n || 1);
    }
  }
  return pos;
}

export function toSfen(pos: Position, moveNumber = 1): string {
  const rows: string[] = [];
  for (let row = 0; row < 9; row++) {
    let text = '';
    let empty = 0;
    for (let col = 0; col < 9; col++) {
      const p = pos.board[row * 9 + col] as number;
      if (p === 0) {
        empty++;
        continue;
      }
      if (empty) text += empty;
      empty = 0;
      const letter = kindOf(p);
      text += (isPromoted(Math.abs(p)) ? '+' : '') + (p > 0 ? letter : letter.toLowerCase());
    }
    rows.push(text + (empty || ''));
  }
  let hand = '';
  for (const side of [0, 1] as Side[]) {
    for (const kind of HAND_KINDS) {
      const n = pos.handCount(side, kind);
      if (n > 0) hand += (n > 1 ? n : '') + (side === 0 ? kind : kind.toLowerCase());
    }
  }
  return `${rows.join('/')} ${pos.turn === 0 ? 'b' : 'w'} ${hand || '-'} ${moveNumber}`;
}

/** A position's identity for repetition: the board, both hands and whose turn it is. */
export const keyOf = (pos: Position): string => toSfen(pos).split(' ').slice(0, 3).join(' ');

// ---- notation ----
export const usiOf = (m: Move): string => (isDrop(m) ? `${KINDS[moveDropCode(m) - 1]}*${sqName(moveTo(m))}` : `${sqName(moveFrom(m))}${sqName(moveTo(m))}${movePromotes(m) ? '+' : ''}`);

export function moveFromUsi(pos: Position, usi: string): Move {
  const found = pos.legalMoves().find((m) => usiOf(m) === usi);
  if (found === undefined) throw new Error(`${usi} is not legal here.`);
  return found;
}

/** A readable name for a move in this position, e.g. "P7g-7f", "Bx2b+" is written "B8hx2b+", a drop "P*5e". */
export function labelOf(pos: Position, m: Move): string {
  if (isDrop(m)) return usiOf(m);
  const piece = pos.board[moveFrom(m)] as number;
  const letter = (isPromoted(Math.abs(piece)) ? '+' : '') + kindOf(piece);
  const capture = (pos.board[moveTo(m)] as number) !== 0;
  return `${letter}${sqName(moveFrom(m))}${capture ? 'x' : '-'}${sqName(moveTo(m))}${movePromotes(m) ? '+' : ''}`;
}

// ---- a whole game ----
export type Result =
  | { kind: 'ongoing'; check: boolean }
  | { kind: 'mate'; winner: Side }
  | { kind: 'perpetual'; winner: Side }
  | { kind: 'draw'; reason: 'repetition' | 'move limit' };

export interface Ply {
  move: Move;
  usi: string;
  label: string;
  /** Did this move give check? */
  check: boolean;
  /** The side that moved. */
  side: Side;
}

export interface Replay {
  pos: Position;
  plies: Ply[];
  result: Result;
}

/** Play the moves out from `sfen` (they must be legal) and judge the position reached. */
export function replay(moves: readonly Move[], sfen: string = START_SFEN): Replay {
  const pos = parseSfen(sfen);
  const keys = [keyOf(pos)];
  const plies: Ply[] = [];
  for (const m of moves) {
    const side = pos.turn;
    const label = labelOf(pos, m);
    pos.makeMove(m);
    keys.push(keyOf(pos));
    plies.push({ move: m, usi: usiOf(m), label, check: pos.inCheck(pos.turn), side });
  }
  return { pos, plies, result: judge(pos, keys, plies) };
}

function judge(pos: Position, keys: string[], plies: Ply[]): Result {
  if (!pos.hasLegalMove()) return { kind: 'mate', winner: (1 - pos.turn) as Side };
  const last = keys[keys.length - 1] as string;
  const seen: number[] = [];
  keys.forEach((k, i) => k === last && seen.push(i));
  if (seen.length >= 4) {
    // four times the same position: a draw, unless one side checked on every one of its moves in the cycle (that side loses)
    const from = seen[0] as number;
    const cycle = plies.slice(from);
    for (const side of [0, 1] as Side[]) {
      const mine = cycle.filter((p) => p.side === side);
      if (mine.length > 0 && mine.every((p) => p.check)) return { kind: 'perpetual', winner: (1 - side) as Side };
    }
    return { kind: 'draw', reason: 'repetition' };
  }
  if (plies.length >= MAX_PLIES) return { kind: 'draw', reason: 'move limit' };
  return { kind: 'ongoing', check: pos.inCheck(pos.turn) };
}

/** Legal moves that start on a square. */
export const movesFrom = (pos: Position, from: number): Move[] => pos.legalMoves().filter((m) => !isDrop(m) && moveFrom(m) === from);
/** Legal drops of one kind. */
export const dropsOf = (pos: Position, kind: Kind): Move[] => pos.legalMoves().filter((m) => isDrop(m) && moveDropCode(m) === CODE[kind]);
