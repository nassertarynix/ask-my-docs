import { lazy } from 'react';
import { FlaskConical } from 'lucide-react';
import type { GameEntry } from '../../hub/types';

export const waterSort: GameEntry = {
  id: 'water-sort',
  title: 'WATER // SORT',
  tagline: 'Pour the colours until every tube is a single shade.',
  playerBadge: '1P',
  accentColor: '#0EA5E9',
  art: FlaskConical,
  component: lazy(() => import('./GameView')),
};
