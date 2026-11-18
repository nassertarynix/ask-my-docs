/**
 * Every game the hub knows about, in the order the cards appear.
 * Adding a game is one import and one entry here (see ARCHITECTURE.md).
 */
import { Crown, Grid3x3 } from 'lucide-react';
import type { GameEntry } from './types';
import { craterLab } from '../games/crater-lab';
import { retroDeck } from '../retro';
import { mastermind } from '../games/mastermind';
import { dotsBoxes } from '../games/dots-boxes';
import { mancala } from '../games/mancala';
import { quoridor } from '../games/quoridor';

export const GAMES: readonly GameEntry[] = [
  craterLab,
  retroDeck,
  mastermind,
  dotsBoxes,
  mancala,
  quoridor,
  {
    id: 'chess',
    title: 'CHESS',
    tagline: 'The classic, with a computer opponent and a friend on the same screen.',
    playerBadge: '1P / 2P',
    accentColor: '#F5B700',
    art: Crown,
    component: null,
  },
  {
    id: 'sudoku',
    title: 'SUDOKU',
    tagline: 'Fill the grid so every row, column and box holds 1 to 9 once.',
    playerBadge: '1P',
    accentColor: '#7DD3A8',
    art: Grid3x3,
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
