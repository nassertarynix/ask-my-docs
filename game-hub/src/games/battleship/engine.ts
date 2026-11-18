/**
 * Battleship. Each player secretly places a fleet on a 10 x 10 grid, then they take turns firing at squares of the
 * other player's grid. A shot says "hit" or "miss"; when every square of a ship has been hit it is sunk, and the
 * first player to sink the whole fleet wins. Ships may touch but not overlap.
 *
 * Squares are numbered 0 to 99, row by row. Pure functions: a shot returns a new board.
 */
import { nextRandom, type Rng } from '../crater-lab/engine/rng';

export const SIZE = 10;
export const CELLS = SIZE * SIZE;

export interface ShipType {
  id: 'carrier' | 'battleship' | 'cruiser' | 'submarine' | 'destroyer';
  name: string;
  size: number;
}
export const FLEET: readonly ShipType[] = [
  { id: 'carrier', name: 'Carrier', size: 5 },
  { id: 'battleship', name: 'Battleship', size: 4 },
  { id: 'cruiser', name: 'Cruiser', size: 3 },
  { id: 'submarine', name: 'Submarine', size: 3 },
  { id: 'destroyer', name: 'Destroyer', size: 2 },
];
export const FLEET_SQUARES = FLEET.reduce((n, s) => n + s.size, 0); // 17

export interface Ship {
  id: ShipType['id'];
  size: number;
  /** The squares it covers, in order. */
  cells: number[];
}

/** 0 = not shot at, 1 = miss, 2 = hit. */
export type Shot = 0 | 1 | 2;

export interface Board {
  ships: readonly Ship[];
  shots: Uint8Array;
}

export const rowOf = (i: number): number => Math.floor(i / SIZE);
export const colOf = (i: number): number => i % SIZE;

/** The squares a ship of `size` covers starting at (r, c) and running right (horizontal) or down; null if it leaves the grid. */
export function shipCells(size: number, r: number, c: number, horizontal: boolean): number[] | null {
  if (r < 0 || c < 0 || r >= SIZE || c >= SIZE) return null;
  const cells: number[] = [];
  for (let k = 0; k < size; k++) {
    const rr = horizontal ? r : r + k;
    const cc = horizontal ? c + k : c;
    if (rr >= SIZE || cc >= SIZE) return null;
    cells.push(rr * SIZE + cc);
  }
  return cells;
}

/** Can these squares be added to the fleet without overlapping a ship already there? */
export function fits(fleet: readonly Ship[], cells: readonly number[]): boolean {
  const used = new Set(fleet.flatMap((s) => s.cells));
  return cells.every((c) => !used.has(c));
}

/** A complete fleet placed at random. */
export function randomFleet(rng: Rng): Ship[] {
  for (let attempt = 0; attempt < 100; attempt++) {
    const ships: Ship[] = [];
    let ok = true;
    for (const type of FLEET) {
      let placed = false;
      for (let tries = 0; tries < 200 && !placed; tries++) {
        const horizontal = nextRandom(rng) < 0.5;
        const cells = shipCells(type.size, Math.floor(nextRandom(rng) * SIZE), Math.floor(nextRandom(rng) * SIZE), horizontal);
        if (cells && fits(ships, cells)) {
          ships.push({ id: type.id, size: type.size, cells });
          placed = true;
        }
      }
      if (!placed) {
        ok = false;
        break;
      }
    }
    if (ok) return ships;
  }
  throw new Error('Could not place a fleet.');
}

/** A fleet is valid if it has one of each ship, all inside the grid, none overlapping. */
export function isValidFleet(ships: readonly Ship[]): boolean {
  if (ships.length !== FLEET.length) return false;
  const seen = new Set<number>();
  for (const type of FLEET) {
    const ship = ships.find((s) => s.id === type.id);
    if (!ship || ship.size !== type.size || ship.cells.length !== type.size) return false;
    if (!ship.cells.every((c) => Number.isInteger(c) && c >= 0 && c < CELLS)) return false;
    // a straight line: all in one row, or all in one column, consecutive
    const horizontal = ship.cells.every((c, k) => rowOf(c) === rowOf(ship.cells[0] as number) && c === (ship.cells[0] as number) + k);
    const vertical = ship.cells.every((c, k) => colOf(c) === colOf(ship.cells[0] as number) && c === (ship.cells[0] as number) + k * SIZE);
    if (!horizontal && !vertical) return false;
    for (const c of ship.cells) {
      if (seen.has(c)) return false;
      seen.add(c);
    }
  }
  return true;
}

export function newBoard(ships: readonly Ship[]): Board {
  if (!isValidFleet(ships)) throw new Error('That is not a valid fleet.');
  return { ships, shots: new Uint8Array(CELLS) };
}

export const shipAt = (b: Board, i: number): Ship | undefined => b.ships.find((s) => s.cells.includes(i));
export const isSunk = (b: Board, ship: Ship): boolean => ship.cells.every((c) => b.shots[c] === 2);
export const sunkShips = (b: Board): Ship[] => b.ships.filter((s) => isSunk(b, s));
export const allSunk = (b: Board): boolean => b.ships.every((s) => isSunk(b, s));

export interface ShotResult {
  board: Board;
  hit: boolean;
  /** The ship this shot finished off, if any. */
  sunk: Ship | null;
  /** That was the last ship. */
  won: boolean;
}

/** Fire at square i. Throws if the square was already shot at. */
export function shoot(b: Board, i: number): ShotResult {
  if (!Number.isInteger(i) || i < 0 || i >= CELLS) throw new Error('That square is not on the grid.');
  if (b.shots[i]) throw new Error('You already fired there.');
  const ship = shipAt(b, i);
  const shots = b.shots.slice();
  shots[i] = ship ? 2 : 1;
  const board: Board = { ships: b.ships, shots };
  const sunk = ship && isSunk(board, ship) ? ship : null;
  return { board, hit: !!ship, sunk, won: allSunk(board) };
}

export const shotsFired = (b: Board): number => b.shots.reduce((n, s) => n + (s ? 1 : 0), 0);
