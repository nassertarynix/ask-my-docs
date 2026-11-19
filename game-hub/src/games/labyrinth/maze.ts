/**
 * The maze of LABY // RINTH, as plain data. The whole game (rules, computer players, screen) reads the board from here, so a
 * different maze is a change to this one file.
 *
 * !! PLACEHOLDER !! This layout is hand-drawn, four-way symmetric (so every corner is exactly as far from the temple as every
 * other) and is NOT the maze of the board game it is inspired by. It exists so the rules could be built and tested; replace
 * `ROWS` with the real layout when it is available (the tests will say if the new one is malformed or unfair).
 *
 * Legend:  # hedge (a fixed wall)   . open space   M the Minotaur's lair (the temple's heart)
 *          a b c d  start-block squares of the corners top-left, top-right, bottom-left, bottom-right (three per corner)
 *          A B C D  the coloured goal squares of those corners at the temple (at least two each)
 *          w  a movable wall already on the board at the start
 */
export const ROWS: readonly string[] = [
  'aa.........w.bb',
  'a.##.##..###..b',
  '...#.....#...#.',
  'w#.#.###.#.###.',
  '.#...#...#.....',
  '.####.#.B.##.#.',
  '.....AA.B#.#.#.',
  '...#...M...#...',
  '.#.#.#C.DD.....',
  '.#.##.C.#.####.',
  '.....#...#...#.',
  '.###.#.###.#.#w',
  '.#...#.....#...',
  'c..###..##.##.d',
  'cc.w.........dd',
];

/** Corners are numbered 0 top-left, 1 top-right, 2 bottom-left, 3 bottom-right. */
export const CORNER_NAMES = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
const START_CHARS = 'abcd';
const GOAL_CHARS = 'ABCD';

export interface Maze {
  readonly width: number;
  readonly height: number;
  /** One character per square, row by row. */
  readonly cells: readonly string[];
  readonly lair: number;
  /** Each corner's three start squares. */
  readonly starts: readonly (readonly number[])[];
  /** Each corner's goal squares. */
  readonly goals: readonly (readonly number[])[];
  /** Open squares next to each corner's start block: where a hero's first step goes. */
  readonly exits: readonly (readonly number[])[];
  /** Open squares next to the lair: where the Minotaur's first step goes. */
  readonly lairExits: readonly number[];
  /** Movable walls on the board at the start. */
  readonly walls: readonly number[];
  /** Movable walls waiting at the edge of the board at the start. */
  readonly wallSupply: number;
  /** Which corners the players sit in, by number of players. */
  readonly seatCorners: Readonly<Record<number, readonly number[]>>;
}

export function parseMaze(rows: readonly string[], wallSupply: number, seatCorners: Maze['seatCorners']): Maze {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  if (height < 5 || width < 5 || rows.some((r) => r.length !== width)) throw new Error('The maze must be a rectangle.');
  const raw = rows.join('').split('');
  const cells = raw.map((c) => (c === 'w' ? '.' : c)); // a movable wall stands on open ground
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? undefined : cells[y * width + x]);
  const find = (ch: string) => cells.flatMap((c, i) => (c === ch ? [i] : []));
  const lairs = find('M');
  if (lairs.length !== 1) throw new Error('The maze needs exactly one lair.');
  const lair = lairs[0] as number;
  const starts = [...START_CHARS].map(find);
  const goals = [...GOAL_CHARS].map(find);
  if (starts.some((s) => s.length !== 3)) throw new Error('Every corner needs three start squares.');
  if (goals.some((g) => g.length < 2)) throw new Error('Every corner needs at least two goal squares (two heroes must be home to win a two-player game).');
  const neighbours = (i: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].flatMap(([dx, dy]) => {
    const x = (i % width) + (dx as number);
    const y = Math.floor(i / width) + (dy as number);
    return at(x, y) === undefined ? [] : [y * width + x];
  });
  const exits = starts.map((block) => [...new Set(block.flatMap((c) => neighbours(c)).filter((n) => cells[n] === '.'))].sort((a, b) => a - b));
  if (exits.some((e) => e.length === 0)) throw new Error('Every start block needs a way out.');
  const lairExits = neighbours(lair).filter((n) => cells[n] === '.').sort((a, b) => a - b);
  if (lairExits.length === 0) throw new Error('The lair needs a way out.');
  const walls = raw.flatMap((c, i) => (c === 'w' ? [i] : []));
  return { width, height, cells, lair, starts, goals, exits, lairExits, walls, wallSupply, seatCorners };
}

/** Two players sit in opposite corners; three and four fill the corners in order. */
export const SEAT_CORNERS = { 2: [0, 3], 3: [0, 1, 2], 4: [0, 1, 2, 3] } as const;
export const MAZE: Maze = parseMaze(ROWS, 10, SEAT_CORNERS);

export const cellX = (m: Maze, i: number): number => i % m.width;
export const cellY = (m: Maze, i: number): number => Math.floor(i / m.width);
