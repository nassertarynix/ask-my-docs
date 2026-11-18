import { lazy } from 'react';
import { Grid3x3 } from 'lucide-react';
import type { GameEntry } from '../../hub/types';

export const sudoku: GameEntry = {
  id: 'sudoku',
  title: 'SU // DOKU',
  tagline: 'Nine rows, nine columns, nine boxes, one solution.',
  playerBadge: '1P',
  accentColor: '#7DD3A8',
  art: Grid3x3,
  component: lazy(() => import('./GameView')),
};
