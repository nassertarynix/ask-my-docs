import { lazy } from 'react';
import { Bomb } from 'lucide-react';
import type { GameEntry } from '../../hub/types';

export const minesweeper: GameEntry = {
  id: 'minesweeper',
  title: 'MINE // SWEEP',
  tagline: 'Numbers, flags and a bit of nerve. The first click is always safe.',
  playerBadge: '1P',
  accentColor: '#FF7A45',
  art: Bomb,
  component: lazy(() => import('./GameView')),
};
