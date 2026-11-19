import { lazy } from 'react';
import { Coins } from 'lucide-react';
import type { GameEntry } from '../../hub/types';

export const gemMerchants: GameEntry = {
  id: 'gem-merchants',
  title: 'GEM // MERCHANTS',
  tagline: 'Collect gems, buy stalls, win patrons. Against computers, or online with up to three friends.',
  playerBadge: '1-4P',
  accentColor: '#7C5CFF',
  art: Coins,
  component: lazy(() => import('./GameView')),
};
