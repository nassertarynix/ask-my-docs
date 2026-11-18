/**
 * The computer's firing. It only uses what a player at the table would know: which squares it has fired at, what
 * happened, and which ships it has sunk (and so their sizes and squares). It never looks at the other fleet.
 *
 *   easy    fires at random squares
 *   normal  hunts on a checkerboard (every ship is at least two squares long, so half the squares are enough to find
 *           one), and after a hit works outwards along the line until the ship sinks
 *   hard    works out, for every square, how many ways the ships still afloat could be placed through it, and fires at
 *           the likeliest; squares next to unresolved hits count for much more
 */
import { nextRandom, type Rng } from '../crater-lab/engine/rng';
import { CELLS, FLEET, SIZE, colOf, rowOf, shipCells, type Ship } from './engine';

export type Difficulty = 'easy' | 'normal' | 'hard';

/** What the firing side knows: its shots (0 none, 1 miss, 2 hit) and the ships it has sunk. */
export interface Knowledge {
  shots: Uint8Array;
  sunk: readonly Ship[];
}

const unshot = (k: Knowledge): number[] => Array.from({ length: CELLS }, (_, i) => i).filter((i) => !k.shots[i]);

/** Hit squares that do not belong to a sunk ship: a ship is still out there under each. */
function openHits(k: Knowledge): number[] {
  const sunkCells = new Set(k.sunk.flatMap((s) => s.cells));
  const out: number[] = [];
  for (let i = 0; i < CELLS; i++) if (k.shots[i] === 2 && !sunkCells.has(i)) out.push(i);
  return out;
}

const neighbours = (i: number): number[] => {
  const r = rowOf(i);
  const c = colOf(i);
  const out: number[] = [];
  if (r > 0) out.push(i - SIZE);
  if (r < SIZE - 1) out.push(i + SIZE);
  if (c > 0) out.push(i - 1);
  if (c < SIZE - 1) out.push(i + 1);
  return out;
};

function pick<T>(items: readonly T[], rng: Rng): T {
  return items[Math.floor(nextRandom(rng) * items.length)] as T;
}

function normalShot(k: Knowledge, rng: Rng): number {
  const free = unshot(k);
  const hits = openHits(k);
  if (hits.length > 0) {
    // two or more hits in a line: carry on along it; otherwise try the squares around a hit
    const inLine: number[] = [];
    for (const h of hits) {
      for (const step of [1, SIZE]) {
        if (hits.includes(h + step) && (step === 1 ? colOf(h) < SIZE - 1 : true)) {
          for (const end of [h - step, h + step * 2]) {
            const wraps = step === 1 && rowOf(end) !== rowOf(h);
            if (end >= 0 && end < CELLS && !wraps && !k.shots[end]) inLine.push(end);
          }
        }
      }
    }
    if (inLine.length > 0) return pick(inLine, rng);
    const around = hits.flatMap(neighbours).filter((n) => !k.shots[n]);
    if (around.length > 0) return pick(around, rng);
  }
  const parity = free.filter((i) => (rowOf(i) + colOf(i)) % 2 === 0);
  return pick(parity.length > 0 ? parity : free, rng);
}

/** How many ways the ships still afloat could lie through each square, given what has been learned. */
export function density(k: Knowledge): number[] {
  const afloat = [...FLEET.map((s) => s.size)];
  for (const s of k.sunk) {
    const at = afloat.indexOf(s.size);
    if (at >= 0) afloat.splice(at, 1);
  }
  const sunkCells = new Set(k.sunk.flatMap((s) => s.cells));
  const hits = new Set(openHits(k));
  const score = new Array<number>(CELLS).fill(0);
  for (const size of afloat) {
    for (const horizontal of [true, false]) {
      for (let r = 0; r < SIZE; r++) {
        for (let c = 0; c < SIZE; c++) {
          const cells = shipCells(size, r, c, horizontal);
          if (!cells) continue;
          // a ship cannot lie over a miss or over a ship already sunk
          if (cells.some((i) => k.shots[i] === 1 || sunkCells.has(i))) continue;
          const covered = cells.filter((i) => hits.has(i)).length;
          const weight = 1 + covered * 30; // a placement that explains the hits already seen is far more likely
          for (const i of cells) if (!k.shots[i]) score[i] = (score[i] ?? 0) + weight;
        }
      }
    }
  }
  return score;
}

function hardShot(k: Knowledge, rng: Rng): number {
  const score = density(k);
  let best = -1;
  let ties: number[] = [];
  for (let i = 0; i < CELLS; i++) {
    if (k.shots[i]) continue;
    const s = score[i] as number;
    if (s > best) {
      best = s;
      ties = [i];
    } else if (s === best) ties.push(i);
  }
  return pick(ties, rng);
}

/** The square the computer fires at next. */
export function chooseShot(k: Knowledge, difficulty: Difficulty, rng: Rng): number {
  const free = unshot(k);
  if (free.length === 0) throw new Error('Every square has been fired at.');
  if (difficulty === 'easy') return pick(free, rng);
  return difficulty === 'normal' ? normalShot(k, rng) : hardShot(k, rng);
}
