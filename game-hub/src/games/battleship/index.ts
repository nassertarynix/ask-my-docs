import { lazy } from 'react';
import { Ship } from 'lucide-react';
import type { GameEntry } from '../../hub/types';

export const battleship: GameEntry = {
  id: 'battleship',
  title: 'BATTLE // SHIP',
  tagline: 'Hide your fleet, hunt theirs. A privacy curtain keeps two-player games honest.',
  playerBadge: '1P / 2P',
  accentColor: '#3B6CF6',
  art: Ship,
  component: lazy(() => import('./GameView')),
};
