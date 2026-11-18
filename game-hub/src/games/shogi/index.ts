import { lazy } from 'react';
import { Pentagon } from 'lucide-react';
import type { GameEntry } from '../../hub/types';

export const shogi: GameEntry = {
  id: 'shogi',
  title: 'SHOGI',
  tagline: 'Japanese chess: captured pieces change sides and drop back onto the board.',
  playerBadge: '1P / 2P',
  accentColor: '#E86A5E',
  art: Pentagon,
  component: lazy(() => import('./GameView')),
};
