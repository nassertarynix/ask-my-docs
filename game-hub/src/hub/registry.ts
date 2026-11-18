/**
 * Every game the hub knows about, in the order the cards appear.
 * Adding a game is one import and one entry here (see ARCHITECTURE.md).
 */
import type { GameEntry } from './types';
import { craterLab } from '../games/crater-lab';
import { retroDeck } from '../retro';
import { mastermind } from '../games/mastermind';
import { dotsBoxes } from '../games/dots-boxes';
import { mancala } from '../games/mancala';
import { quoridor } from '../games/quoridor';
import { sudoku } from '../games/sudoku';
import { minesweeper } from '../games/minesweeper';
import { waterSort } from '../games/water-sort';
import { picross } from '../games/picross';
import { battleship } from '../games/battleship';
import { airHockey } from '../games/air-hockey';
import { chess } from '../games/chess';

export const GAMES: readonly GameEntry[] = [
  craterLab,
  retroDeck,
  mastermind,
  dotsBoxes,
  mancala,
  battleship,
  airHockey,
  quoridor,
  sudoku,
  minesweeper,
  waterSort,
  picross,
  chess,
];

export function findGame(id: string): GameEntry | undefined {
  return GAMES.find((game) => game.id === id);
}

/** Games that can be played now. */
export function liveGames(): GameEntry[] {
  return GAMES.filter((game) => game.component !== null);
}
