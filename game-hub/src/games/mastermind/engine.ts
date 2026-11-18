/**
 * Mastermind rules: a hidden code of PEGS colours, MAX_TURNS guesses, and after each guess two numbers:
 * how many pegs are the right colour in the right place (exact) and how many are a right colour in the
 * wrong place (misplaced). Pure functions, no randomness of their own: the secret is made from an Rng.
 */
import { nextRandom, type Rng } from '../crater-lab/engine/rng';

export const PEGS = 4;
export const COLORS = 6;
export const MAX_TURNS = 10;

/** A code: PEGS numbers, each 0 to COLORS - 1. */
export type Code = readonly number[];

export interface Feedback {
  exact: number;
  misplaced: number;
}

export interface Turn {
  guess: Code;
  feedback: Feedback;
}

export type Status = 'playing' | 'won' | 'lost';

export interface Game {
  secret: Code;
  turns: readonly Turn[];
  status: Status;
}

export function isValidCode(code: Code): boolean {
  return code.length === PEGS && code.every((c) => Number.isInteger(c) && c >= 0 && c < COLORS);
}

/**
 * Score a guess against the secret. Colours can repeat, so each secret peg may only be matched once:
 * first count the exact matches, then match the leftovers by colour.
 */
export function score(secret: Code, guess: Code): Feedback {
  let exact = 0;
  const secretLeft = new Array<number>(COLORS).fill(0);
  const guessLeft = new Array<number>(COLORS).fill(0);
  for (let i = 0; i < PEGS; i++) {
    const s = secret[i] as number;
    const g = guess[i] as number;
    if (s === g) exact++;
    else {
      secretLeft[s] = (secretLeft[s] ?? 0) + 1;
      guessLeft[g] = (guessLeft[g] ?? 0) + 1;
    }
  }
  let misplaced = 0;
  for (let c = 0; c < COLORS; c++) misplaced += Math.min(secretLeft[c] ?? 0, guessLeft[c] ?? 0);
  return { exact, misplaced };
}

/** A random secret. With `repeats` false every colour is different. */
export function randomSecret(rng: Rng, repeats = true): Code {
  const code: number[] = [];
  const pool = Array.from({ length: COLORS }, (_, i) => i);
  while (code.length < PEGS) {
    const pick = Math.floor(nextRandom(rng) * (repeats ? COLORS : pool.length));
    if (repeats) code.push(pick);
    else code.push(pool.splice(pick, 1)[0] as number);
  }
  return code;
}

export function newGame(secret: Code): Game {
  if (!isValidCode(secret)) throw new Error('A code is four colours, each one of six.');
  return { secret, turns: [], status: 'playing' };
}

/** Play a guess. Returns the new game; the old one is not changed. Guesses after the end are refused. */
export function guess(game: Game, code: Code): Game {
  if (game.status !== 'playing') throw new Error('The game is over.');
  if (!isValidCode(code)) throw new Error('A guess is four colours, each one of six.');
  const feedback = score(game.secret, code);
  const turns = [...game.turns, { guess: [...code], feedback }];
  const status: Status = feedback.exact === PEGS ? 'won' : turns.length >= MAX_TURNS ? 'lost' : 'playing';
  return { secret: game.secret, turns, status };
}

/** Would `candidate` have produced exactly this feedback for every guess so far? (Used by hints.) */
export function isConsistent(candidate: Code, turns: readonly Turn[]): boolean {
  return turns.every((t) => {
    const f = score(candidate, t.guess);
    return f.exact === t.feedback.exact && f.misplaced === t.feedback.misplaced;
  });
}

/** Every possible code, in order. */
export function allCodes(): Code[] {
  const out: Code[] = [];
  const total = COLORS ** PEGS;
  for (let n = 0; n < total; n++) {
    const code: number[] = [];
    let rest = n;
    for (let i = 0; i < PEGS; i++) {
      code.unshift(rest % COLORS);
      rest = Math.floor(rest / COLORS);
    }
    out.push(code);
  }
  return out;
}

/** How many codes are still possible after these turns. */
export function remainingCodes(turns: readonly Turn[]): number {
  return allCodes().filter((c) => isConsistent(c, turns)).length;
}

/** A hint: one peg of the secret, at a position the player has not got right yet. Returns null if there is none. */
export function hintPeg(game: Game): { position: number; color: number } | null {
  const last = game.turns[game.turns.length - 1];
  const wrong = Array.from({ length: PEGS }, (_, i) => i).filter((i) => !last || last.guess[i] !== game.secret[i]);
  const position = wrong[0];
  return position === undefined ? null : { position, color: game.secret[position] as number };
}
