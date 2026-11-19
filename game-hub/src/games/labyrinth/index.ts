import { lazy } from 'react';
import { Castle } from 'lucide-react';
import type { GameEntry } from '../../hub/types';

export const labyrinth: GameEntry = {
  id: 'labyrinth',
  title: 'LABY // RINTH',
  tagline: 'Lead three heroes through the maze to the temple. Mind the Minotaur, and wall in your rivals. 2 to 4 players.',
  playerBadge: '1-4P',
  accentColor: '#4F9D69',
  art: Castle,
  component: lazy(() => import('./GameView')),
};
