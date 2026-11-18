import { lazy } from 'react';
import { CircleDot } from 'lucide-react';
import type { GameEntry } from '../../hub/types';

export const mastermind: GameEntry = {
  id: 'mastermind',
  title: 'MASTER // MIND',
  tagline: 'Crack a four-colour code in ten guesses. Or set one for a friend.',
  playerBadge: '1P / 2P',
  accentColor: '#F5B700',
  art: CircleDot,
  component: lazy(() => import('./GameView')),
};
