import { lazy } from 'react';
import { BrickWall } from 'lucide-react';
import type { GameEntry } from '../../hub/types';

export const quoridor: GameEntry = {
  id: 'quoridor',
  title: 'QUOR // IDOR',
  tagline: 'Race to the far edge, and wall your rival in. Almost.',
  playerBadge: '1P / 2P',
  accentColor: '#B69CFF',
  art: BrickWall,
  component: lazy(() => import('./GameView')),
};
