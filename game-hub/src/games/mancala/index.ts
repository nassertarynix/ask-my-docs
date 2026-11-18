import { lazy } from 'react';
import { Gem } from 'lucide-react';
import type { GameEntry } from '../../hub/types';

export const mancala: GameEntry = {
  id: 'mancala',
  title: 'MAN // CALA',
  tagline: 'Sow stones round the board. Land in your store, steal from your rival.',
  playerBadge: '1P / 2P',
  accentColor: '#7DD3A8',
  art: Gem,
  component: lazy(() => import('./GameView')),
};
