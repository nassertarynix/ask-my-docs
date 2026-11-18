/**
 * Water Sort. Tubes hold up to four layers of coloured liquid. Pour the top layer(s) of one tube into another that is
 * empty or has the same colour on top (and room). Sort the colours until every tube is empty or holds a single colour.
 *
 * Levels are made from a seed and checked with a solver, so every level can be won, and the solver gives hints.
 */
import { nextRandom, type Rng } from '../crater-lab/engine/rng';

export const CAPACITY = 4;
/** A tube is a list of colour numbers, bottom first. */
export type Tube = readonly number[];
export type Tubes = readonly Tube[];
export interface Move {
  from: number;
  to: number;
}

/** Colours used in a level: 3 at level 1, one more every two levels, at most 12. */
export const colorsForLevel = (level: number): number => Math.min(12, 3 + Math.floor((Math.max(1, level) - 1) / 2));

export const top = (t: Tube): number | undefined => t[t.length - 1];

/** How many layers of the top colour sit together at the top of a tube. */
export function topRun(t: Tube): number {
  const c = top(t);
  if (c === undefined) return 0;
  let n = 0;
  for (let i = t.length - 1; i >= 0 && t[i] === c; i--) n++;
  return n;
}

export function canPour(tubes: Tubes, from: number, to: number): boolean {
  if (from === to) return false;
  const a = tubes[from];
  const b = tubes[to];
  if (!a || !b || a.length === 0 || b.length >= CAPACITY) return false;
  // pouring a tube that is all one colour into an empty tube only moves it, which gains nothing, so it is not offered
  if (b.length === 0) return a.length !== topRun(a);
  return top(a) === top(b);
}

/** Pour as much of the top colour as fits. Returns the new tubes and how many layers moved. Throws if the pour is not allowed. */
export function pour(tubes: Tubes, from: number, to: number): { tubes: Tube[]; moved: number } {
  if (!canPour(tubes, from, to)) throw new Error('That pour is not allowed.');
  const a = [...(tubes[from] as Tube)];
  const b = [...(tubes[to] as Tube)];
  const moved = Math.min(topRun(a), CAPACITY - b.length);
  const colour = top(a) as number;
  for (let i = 0; i < moved; i++) {
    a.pop();
    b.push(colour);
  }
  return { tubes: tubes.map((t, i) => (i === from ? a : i === to ? b : [...t])), moved };
}

/** A tube that is finished: empty, or full of one colour. */
export const isDone = (t: Tube): boolean => t.length === 0 || (t.length === CAPACITY && t.every((c) => c === t[0]));

/** Won: every tube is empty or a full tube of one colour. */
export const isWon = (tubes: Tubes): boolean => tubes.every(isDone);

export function legalMoves(tubes: Tubes): Move[] {
  const out: Move[] = [];
  for (let from = 0; from < tubes.length; from++) for (let to = 0; to < tubes.length; to++) if (canPour(tubes, from, to)) out.push({ from, to });
  return out;
}

/** Not won, and nothing can be poured. */
export const isStuck = (tubes: Tubes): boolean => !isWon(tubes) && legalMoves(tubes).length === 0;

/** A canonical key for a position: the order of tubes does not matter. */
const keyOf = (tubes: Tubes): string => tubes.map((t) => t.join(',')).sort().join('|');

/**
 * Find a sequence of pours that wins, by depth-first search over positions not seen before.
 * Gives up (null) after `maxNodes` positions, so a very hard or unsolvable position cannot hang the page.
 */
export function solve(tubes: Tubes, maxNodes = 60_000): Move[] | null {
  const seen = new Set<string>();
  let nodes = 0;
  const path: Move[] = [];
  const go = (state: Tubes): boolean => {
    if (isWon(state)) return true;
    if (nodes++ > maxNodes) return false;
    const key = keyOf(state);
    if (seen.has(key)) return false;
    seen.add(key);
    // prefer pours that finish or extend a run: they rarely need undoing
    const moves = legalMoves(state)
      .map((m) => {
        const next = pour(state, m.from, m.to);
        const intoSame = (state[m.to] as Tube).length > 0;
        const finishes = isDone(next.tubes[m.to] as Tube) && intoSame;
        return { m, next: next.tubes, score: (finishes ? 100 : 0) + (intoSame ? 10 : 0) + next.moved };
      })
      .sort((x, y) => y.score - x.score);
    for (const { m, next } of moves) {
      path.push(m);
      if (go(next)) return true;
      path.pop();
    }
    return false;
  };
  return go(tubes) ? [...path] : null;
}

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(rng) * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/**
 * A level: `colors` colours with four layers each, mixed at random into `colors` tubes, plus two empty tubes.
 * Levels that are already solved, or that the solver cannot win, are thrown away and made again.
 */
export function generateLevel(rng: Rng, colors: number, emptyTubes = 2): { tubes: Tube[]; solution: Move[] } {
  for (let attempt = 0; attempt < 200; attempt++) {
    const layers = shuffled(
      Array.from({ length: colors * CAPACITY }, (_, i) => Math.floor(i / CAPACITY)),
      rng,
    );
    const tubes: Tube[] = Array.from({ length: colors }, (_, k) => layers.slice(k * CAPACITY, (k + 1) * CAPACITY));
    for (let e = 0; e < emptyTubes; e++) tubes.push([]);
    if (isWon(tubes)) continue;
    const solution = solve(tubes);
    if (solution) return { tubes, solution };
  }
  throw new Error('Could not make a level.');
}

/** One more empty tube (the "add a tube" help). */
export const withExtraTube = (tubes: Tubes): Tube[] => [...tubes.map((t) => [...t]), []];
