/**
 * Mancala, in its common Kalah form: two rows of six pits, a store on each side, four stones in every pit.
 *
 * Pits are numbered round the board in the direction stones are sown (counter-clockwise):
 *   0..5   player 0's pits, left to right along the bottom row
 *   6      player 0's store, on the right
 *   7..12  player 1's pits, right to left along the top row
 *   13     player 1's store, on the left
 *
 * Sowing: pick up every stone in one of your pits and drop one in each following pit, skipping the opponent's store.
 *  - last stone in your own store: you move again
 *  - last stone in an empty pit on your side, with stones in the pit opposite: you capture them and that stone
 *  - when one side has no stones left, the other player keeps what is left on their side, and the game ends
 */
export type Player = 0 | 1;

export const PITS_PER_SIDE = 6;
export const STONES_AT_START = 4;
export const STORE: readonly [number, number] = [6, 13];
export const TOTAL_STONES = PITS_PER_SIDE * 2 * STONES_AT_START;

export interface State {
  pits: readonly number[];
  current: Player;
  over: boolean;
}

export function newGame(stones = STONES_AT_START): State {
  const pits = new Array<number>(14).fill(stones);
  pits[6] = 0;
  pits[13] = 0;
  return { pits, current: 0, over: false };
}

/** Pit index of player p's n-th pit (n from 0 to 5, in the order they sit on the board). */
export const pitOf = (p: Player, n: number): number => p * 7 + n;

/** The pit across the board from a pit. */
export const opposite = (pit: number): number => 12 - pit;

export const ownsPit = (p: Player, pit: number): boolean => pit >= p * 7 && pit < p * 7 + PITS_PER_SIDE;

/** Which of this player's pits (0 to 5) can be played: the non-empty ones. */
export function legalMoves(s: State): number[] {
  if (s.over) return [];
  const out: number[] = [];
  for (let n = 0; n < PITS_PER_SIDE; n++) if ((s.pits[pitOf(s.current, n)] ?? 0) > 0) out.push(n);
  return out;
}

export interface MoveResult {
  state: State;
  /** The pits that got a stone, in order (the animation plays this). */
  path: number[];
  /** The mover gets another turn. */
  extraTurn: boolean;
  /** Stones captured (including the capturing stone), or 0. */
  captured: number;
  /** Stones swept into a store at the end of the game. */
  swept: number;
}

export function sidesEmpty(pits: readonly number[]): boolean {
  const empty = (p: Player) => Array.from({ length: PITS_PER_SIDE }, (_, n) => pits[pitOf(p, n)] ?? 0).every((v) => v === 0);
  return empty(0) || empty(1);
}

/** Play pit n (0 to 5) of the current player. Returns the new state; the old one is untouched. */
export function move(s: State, n: number): MoveResult {
  if (s.over) throw new Error('The game is over.');
  if (!Number.isInteger(n) || n < 0 || n >= PITS_PER_SIDE) throw new Error('A pit is 0 to 5.');
  const me = s.current;
  const from = pitOf(me, n);
  const pits = s.pits.slice();
  let hand = pits[from] ?? 0;
  if (hand === 0) throw new Error('That pit is empty.');
  pits[from] = 0;
  const skip = STORE[me === 0 ? 1 : 0];
  const path: number[] = [];
  let at = from;
  while (hand > 0) {
    at = (at + 1) % 14;
    if (at === skip) continue;
    pits[at] = (pits[at] ?? 0) + 1;
    path.push(at);
    hand--;
  }

  let captured = 0;
  let extraTurn = at === STORE[me];
  if (!extraTurn && ownsPit(me, at) && pits[at] === 1 && (pits[opposite(at)] ?? 0) > 0) {
    captured = (pits[opposite(at)] ?? 0) + 1;
    pits[STORE[me]] = (pits[STORE[me]] ?? 0) + captured;
    pits[opposite(at)] = 0;
    pits[at] = 0;
  }

  let swept = 0;
  let over = false;
  if (sidesEmpty(pits)) {
    over = true;
    extraTurn = false;
    for (const p of [0, 1] as Player[]) {
      for (let k = 0; k < PITS_PER_SIDE; k++) {
        const pit = pitOf(p, k);
        swept += pits[pit] ?? 0;
        pits[STORE[p]] = (pits[STORE[p]] ?? 0) + (pits[pit] ?? 0);
        pits[pit] = 0;
      }
    }
  }
  const current: Player = over || extraTurn ? me : me === 0 ? 1 : 0;
  return { state: { pits, current, over }, path, extraTurn, captured, swept };
}

export type Winner = Player | 'draw';
export function winner(s: State): Winner | null {
  if (!s.over) return null;
  const a = s.pits[STORE[0]] ?? 0;
  const b = s.pits[STORE[1]] ?? 0;
  return a === b ? 'draw' : a > b ? 0 : 1;
}

export const score = (s: State, p: Player): number => s.pits[STORE[p]] ?? 0;
