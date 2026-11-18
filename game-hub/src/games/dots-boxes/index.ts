import { lazy } from 'react';
import { Grid2x2 } from 'lucide-react';
import type { GameEntry } from '../../hub/types';

export const dotsBoxes: GameEntry = {
  id: 'dots-boxes',
  title: 'DOTS // BOXES',
  tagline: 'Join the dots. Close a box, keep the turn. Beware the long chain.',
  playerBadge: '1P / 2P',
  accentColor: '#FF8FB1',
  art: Grid2x2,
  component: lazy(() => import('./GameView')),
};
