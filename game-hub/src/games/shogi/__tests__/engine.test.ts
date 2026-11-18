import { describe, expect, it } from 'vitest';
import {
  CODE, START_SFEN, dropMove, dropsOf, keyOf, moveFromUsi, movesFrom, parseSfen, perft, replay, sqFromName, sqName, stepMove, toSfen, usiOf, movePromotes, isDrop, type Move,
} from '../engine';

const legal = (sfen: string) => parseSfen(sfen).legalMoves().map(usiOf);
const play = (sfen: string, usis: string[]): Move[] => {
  const p = parseSfen(sfen);
  return usis.map((u) => {
    const m = moveFromUsi(p, u);
    p.makeMove(m);
    return m;
  });
};

describe('squares and SFEN', () => {
  it('names squares the way USI does', () => {
    expect(sqName(0)).toBe('9a');
    expect(sqName(80)).toBe('1i');
    expect(sqFromName('7g')).toBe(6 * 9 + 2);
    for (let sq = 0; sq < 81; sq++) expect(sqFromName(sqName(sq))).toBe(sq);
  });

  it('reads and writes the start position unchanged, with hands and promotions', () => {
    expect(toSfen(parseSfen(START_SFEN))).toBe(START_SFEN);
    const odd = '4k4/9/4+L4/9/9/9/9/9/4K4 w 2Pr3p 7';
    expect(toSfen(parseSfen(odd), 7)).toBe(odd);
  });

  it('refuses nonsense', () => {
    expect(() => parseSfen('9/9/9 b - 1')).toThrow();
    expect(() => parseSfen('4k4/9/9/9/9/9/9/9/4X4 b - 1')).toThrow();
    expect(() => parseSfen('4k4/9/9/9/9/9/9/9/4+G4 b - 1')).toThrow();
  });
});

describe('move generation (perft: positions reached after n plies from the start)', () => {
  it('has 30 first moves, 900 after two plies and 25470 after three', () => {
    const p = parseSfen(START_SFEN);
    expect(perft(p, 1)).toBe(30);
    expect(perft(p, 2)).toBe(900);
    expect(perft(p, 3)).toBe(25470);
    expect(toSfen(p)).toBe(START_SFEN); // the search leaves the position as it found it
  });

  it('matches the published count of 719731 after four plies', () => {
    expect(perft(parseSfen(START_SFEN), 4)).toBe(719731);
  }, 60_000);
});

describe('how pieces move', () => {
  const targets = (sfen: string, from: string) => [...new Set(movesFrom(parseSfen(sfen), sqFromName(from)).map((m) => sqName((m >> 7) & 127)))].sort();
  const empty = (piece: string, extra = '') => `4k4/9/9/9/4${piece}4/9/9/9/4K4 b ${extra || '-'} 1`;

  it('gold steps forward, sideways and straight back, not diagonally back', () => {
    expect(targets(empty('G'), '5e')).toEqual(['4d', '4e', '5d', '5f', '6d', '6e']);
  });
  it('silver steps forward and the four diagonals', () => {
    expect(targets(empty('S'), '5e')).toEqual(expect.arrayContaining(['5d', '4d', '6d', '4f', '6f']));
    expect(targets(empty('S'), '5e')).not.toContain('5f');
  });
  it('a knight jumps two forward and one aside, over pieces', () => {
    expect(targets('4k4/9/9/9/4N4/4P4/9/9/4K4 b - 1', '5e')).toEqual(['4c', '6c']);
  });
  it('a lance runs straight ahead until blocked and can take the blocker', () => {
    expect(targets('4k4/9/9/4p4/9/9/9/4L4/4K4 b - 1', '5h')).toEqual(['5d', '5e', '5f', '5g']);
  });
  it('a pawn takes one step forward only', () => {
    expect(targets(empty('P'), '5e')).toEqual(['5d']);
  });
  it('a bishop slides diagonally; a promoted bishop (horse) also steps one square straight', () => {
    expect(targets(empty('B'), '5e')).toContain('1a');
    expect(targets(empty('B'), '5e')).not.toContain('5d');
    const horse = targets(empty('+B'), '5e');
    expect(horse).toEqual(expect.arrayContaining(['5d', '5f', '4e', '6e', '1a']));
    expect(horse).not.toContain('5c');
  });
  it('a rook slides straight; a promoted rook (dragon) also steps diagonally one square', () => {
    expect(targets(empty('R'), '5e')).toContain('5b');
    const dragon = targets(empty('+R'), '5e');
    expect(dragon).toEqual(expect.arrayContaining(['5b', '4d', '6f']));
    expect(dragon).not.toContain('3c');
  });
  it('gote moves the other way up the board', () => {
    const p = parseSfen('4k4/9/9/9/4p4/9/9/9/4K4 w - 1');
    expect(movesFrom(p, sqFromName('5e')).map((m) => sqName((m >> 7) & 127))).toEqual(['5f']);
  });
});

describe('promotion', () => {
  it('is optional for a pawn entering the zone and offers both moves', () => {
    const ms = legal('4k4/9/9/4P4/9/9/9/9/4K4 b - 1');
    expect(ms).toContain('5d5c');
    expect(ms).toContain('5d5c+');
  });
  it('applies when a piece leaves the zone too', () => {
    const ms = legal('4k4/9/4S4/9/9/9/9/9/4K4 b - 1');
    expect(ms).toContain('5c4d+');
    expect(ms).toContain('5c4d');
  });
  it('is forced for a pawn or lance on the last rank, and a knight on the last two', () => {
    expect(legal('9/4P4/9/9/9/9/9/9/K7k b - 1')).toEqual(expect.arrayContaining(['5b5a+']));
    expect(legal('9/4P4/9/9/9/9/9/9/K7k b - 1')).not.toContain('5b5a');
    expect(legal('9/9/4L4/9/9/9/9/9/K7k b - 1')).not.toContain('5c5a');
    const knight = legal('9/9/9/4N4/9/9/9/9/K7k b - 1');
    expect(knight).toContain('5d4b+');
    expect(knight).not.toContain('5d4b'); // a knight on rank b could never move again
    const knight2 = legal('9/9/4N4/9/9/9/9/9/K7k b - 1');
    expect(knight2).toContain('5c4a+');
    expect(knight2).not.toContain('5c4a');
  });
  it('is not offered to a gold or king, or to a piece already promoted', () => {
    expect(legal('4k4/9/4G4/9/9/9/9/9/4K4 b - 1').some((u) => u.endsWith('+'))).toBe(false);
    expect(legal('4k4/9/4+S4/9/9/9/9/9/4K4 b - 1').some((u) => u.endsWith('+'))).toBe(false);
  });
  it('turns the piece over when played', () => {
    const p = parseSfen('4k4/9/9/4P4/9/9/9/9/4K4 b - 1');
    p.makeMove(moveFromUsi(p, '5d5c+'));
    expect(toSfen(p).startsWith('4k4/9/4+P4')).toBe(true);
  });
});

describe('captures and drops', () => {
  it('a captured piece goes to the capturer\'s hand, and a promoted one comes back unpromoted', () => {
    const p = parseSfen('4k4/9/4+p4/9/9/9/9/4R4/4K4 b - 1');
    p.makeMove(moveFromUsi(p, '5h5c'));
    expect(p.handCount(0, 'P')).toBe(1);
    p.unmakeMove();
    expect(p.handCount(0, 'P')).toBe(0);
    expect(toSfen(p)).toBe('4k4/9/4+p4/9/9/9/9/4R4/4K4 b - 1');
  });

  it('a piece in hand can be dropped on any empty square (not occupied ones)', () => {
    const p = parseSfen('4k4/9/9/9/9/9/9/9/4K4 b G 1');
    const drops = dropsOf(p, 'G');
    expect(drops).toHaveLength(79);
    p.makeMove(dropMove('G', sqFromName('5e')));
    expect(p.handCount(0, 'G')).toBe(0);
    expect(p.board[sqFromName('5e')]).toBe(CODE.G);
  });

  it('forbids two unpromoted pawns on a file (nifu), but allows it for a promoted pawn or another side\'s pawn', () => {
    const p = parseSfen('4k4/9/9/9/9/9/4P4/9/4K4 b P 1');
    const files = new Set(dropsOf(p, 'P').map((m) => sqName((m >> 7) & 127)[0]));
    expect(files.has('5')).toBe(false);
    expect(files.has('4')).toBe(true);
    const promoted = parseSfen('4k4/9/9/9/9/9/4+P4/9/4K4 b P 1');
    expect(dropsOf(promoted, 'P').some((m) => sqName((m >> 7) & 127).startsWith('5'))).toBe(true);
    const theirs = parseSfen('4k4/9/9/9/9/9/4p4/9/4K4 b P 1');
    expect(dropsOf(theirs, 'P').some((m) => sqName((m >> 7) & 127).startsWith('5'))).toBe(true);
  });

  it('never drops a piece where it could not move', () => {
    const p = parseSfen('4k4/9/9/9/9/9/9/9/4K4 b PLN 1');
    const rank = (kind: 'P' | 'L' | 'N') => new Set(dropsOf(p, kind).map((m) => sqName((m >> 7) & 127)[1]));
    expect(rank('P').has('a')).toBe(false);
    expect(rank('L').has('a')).toBe(false);
    expect(rank('N').has('a')).toBe(false);
    expect(rank('N').has('b')).toBe(false);
    expect(rank('N').has('c')).toBe(true);
    expect(rank('P').has('b')).toBe(true);
    // gote's far end is rank i
    const g = parseSfen('4k4/9/9/9/9/9/9/9/4K4 w pn 1');
    expect(new Set(dropsOf(g, 'P').map((m) => sqName((m >> 7) & 127)[1])).has('i')).toBe(false);
    expect(new Set(dropsOf(g, 'N').map((m) => sqName((m >> 7) & 127)[1])).has('h')).toBe(false);
  });

  it('forbids a pawn drop that gives checkmate, but allows any other pawn drop, and a mating drop of another piece', () => {
    const sfen = '8k/9/7G1/4B4/9/9/9/9/4K4 b P 1';
    const p = parseSfen(sfen);
    expect(legal(sfen)).not.toContain('P*1b');
    expect(legal(sfen)).toContain('P*5e');
    expect(isDrop(dropMove('P', sqFromName('1b')))).toBe(true);
    // the same drop is fine if the king has somewhere to run (take the bishop away)
    expect(legal('8k/9/7G1/9/9/9/9/9/4K4 b P 1')).toContain('P*1b');
    p.makeMove(dropMove('P', sqFromName('5e')));
    expect(p.turn).toBe(1);
  });
});

describe('check and checkmate', () => {
  it('a king may not step into check, but may take an undefended piece', () => {
    const k = legal('4k4/9/9/9/9/9/9/3r5/4K4 b - 1'); // the gote rook on 6h covers rank h and file 6
    expect(k.sort()).toEqual(['5i4i', '5i6h']);
  });

  it('answers a check only by capturing, blocking (by a move or a drop) or running', () => {
    // sente's king on 5i is checked by the gote rook on 5a; the gold in hand can interpose on 5b..5h
    const p = parseSfen('4r3k/9/9/9/9/9/9/9/4K4 b G 1');
    expect(p.inCheck(0)).toBe(true);
    const moves = p.legalMoves().map(usiOf);
    expect(moves).toContain('G*5e');
    expect(moves).toContain('5i4i');
    expect(moves).not.toContain('G*4e');
    expect(moves).not.toContain('5i5h'); // still on the rook's file
  });

  it('a pinned piece may only move along the pin', () => {
    // the gote rook on 5a, sente's silver on 5g and king on 5i: the silver is pinned to the file
    const p = parseSfen('4r3k/9/9/9/9/9/4S4/9/4K4 b - 1');
    expect(movesFrom(p, sqFromName('5g')).map(usiOf)).toEqual(['5g5f']);
  });

  it('finds the mate: a gold dropped in front of the king, supported by a lance', () => {
    const sfen = '4k4/9/4L4/9/9/9/9/9/4K4 b G 1';
    const moves = play(sfen, ['G*5b']);
    const r = replay(moves, sfen);
    expect(r.result).toEqual({ kind: 'mate', winner: 0 });
    expect(r.plies[0]?.check).toBe(true);
  });

  it('is not mate if the checking piece can be taken', () => {
    const r = replay(play('4k4/9/9/9/9/9/9/9/4K4 b G 1'.replace('4k4', '3gk4'), ['G*5b']), '3gk4/9/9/9/9/9/9/9/4K4 b G 1');
    expect(r.result.kind).toBe('ongoing');
  });
});

describe('repetition and the move limit', () => {
  it('a position that comes round four times is a draw', () => {
    const sfen = '4k4/9/9/9/9/9/9/9/4K4 b - 1';
    const cycle = ['5i5h', '5a5b', '5h5i', '5b5a'];
    const usis = [...cycle, ...cycle, ...cycle];
    const r3 = replay(play(sfen, usis.slice(0, 8)), sfen);
    expect(r3.result.kind).toBe('ongoing'); // third time round only
    const r4 = replay(play(sfen, usis), sfen);
    expect(r4.result).toEqual({ kind: 'draw', reason: 'repetition' });
  });

  it('a side that gives check on every move of the cycle loses instead (perpetual check)', () => {
    const sfen = '8k/R8/9/9/9/9/9/9/4K4 b - 1';
    const cycle = ['9b9a', '1a1b', '9a9b', '1b1a'];
    const r = replay(play(sfen, [...cycle, ...cycle, ...cycle]), sfen);
    expect(r.result).toEqual({ kind: 'perpetual', winner: 1 });
  });

  it('position keys tell hands apart', () => {
    expect(keyOf(parseSfen('4k4/9/9/9/9/9/9/9/4K4 b P 1'))).not.toBe(keyOf(parseSfen('4k4/9/9/9/9/9/9/9/4K4 b - 1')));
  });
});

describe('notation', () => {
  it('writes moves readably and replays them', () => {
    const sfen = START_SFEN;
    const moves = play(sfen, ['7g7f', '3c3d', '8h2b+']);
    const r = replay(moves, sfen);
    expect(r.plies.map((p) => p.label)).toEqual(['P7g-7f', 'P3c-3d', 'B8hx2b+']);
    expect(r.pos.handCount(0, 'B')).toBe(1);
    expect(movePromotes(moves[2] as Move)).toBe(true);
    expect(stepMove(sqFromName('7g'), sqFromName('7f'))).toBe(moves[0]);
  });
});
