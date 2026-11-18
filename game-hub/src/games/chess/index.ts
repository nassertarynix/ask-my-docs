import { lazy } from 'react';
import { Crown } from 'lucide-react';
import type { GameEntry } from '../../hub/types';

export const chess: GameEntry = {
  id: 'chess',
  title: 'CHESS',
  tagline: 'The classic, with a computer opponent and a friend on the same screen.',
  playerBadge: '1P / 2P',
  accentColor: '#F5B700',
  art: Crown,
  component: lazy(() => import('./GameView')),
};
