/**
 * Every game the hub knows about, in the order the cards appear.
 * Adding a game is one import and one entry here (see ARCHITECTURE.md).
 */
import { Crown } from 'lucide-react';
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

export const GAMES: readonly GameEntry[] = [
  craterLab,
  retroDeck,
  mastermind,
  dotsBoxes,
  mancala,
  quoridor,
  sudoku,
  minesweeper,
  waterSort,
  picross,
  {
    id: 'chess',
    title: 'CHESS',
    tagline: 'The classic, with a computer opponent and a friend on the same screen.',
    playerBadge: '1P / 2P',
    accentColor: '#F5B700',
    art: Crown,
    component: null,
  },
];

export function findGame(id: string): GameEntry | undefined {
  return GAMES.find((game) => game.id === id);
}

/** Games that can be played now. */
export function liveGames(): GameEntry[] {
  return GAMES.filter((game) => game.component !== null);
}
