import { lazy } from 'react';
import { Disc3 } from 'lucide-react';
import type { GameEntry } from '../../hub/types';

export const airHockey: GameEntry = {
  id: 'air-hockey',
  title: 'AIR // HOCKEY',
  tagline: 'A fast puck, a low-friction table. Split screen for two, or take on the computer.',
  playerBadge: '1P / 2P',
  accentColor: '#14B8A6',
  art: Disc3,
  component: lazy(() => import('./GameView')),
};
