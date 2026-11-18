import { lazy } from 'react';
import { Binary } from 'lucide-react';
import type { GameEntry } from '../../hub/types';

export const picross: GameEntry = {
  id: 'picross',
  title: 'PIC // ROSS',
  tagline: 'Follow the number clues to uncover a hidden pixel picture.',
  playerBadge: '1P',
  accentColor: '#FF8FB1',
  art: Binary,
  component: lazy(() => import('./GameView')),
};
