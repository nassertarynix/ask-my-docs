import { lazy } from 'react';
import { Swords } from 'lucide-react';
import type { GameEntry } from '../../hub/types';

export const pitBrawl: GameEntry = {
  id: 'pit-brawl',
  title: 'PIT // BRAWL',
  tagline: 'A fast free-for-all card brawl: ten heroes, up to ten players. Against computers, or online.',
  playerBadge: '1-10P',
  accentColor: '#E5484D',
  art: Swords,
  component: lazy(() => import('./GameView')),
};
