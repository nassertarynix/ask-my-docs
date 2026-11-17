import { lazy } from 'react';
import type { GameEntry } from '../../hub/types';
import { CardArt } from './ui/CardArt';

/** CRATER // LAB's card on the hub. The game's code is loaded only when someone opens it. */
export const craterLab: GameEntry = {
  id: 'crater-lab',
  title: 'CRATER // LAB',
  tagline: 'Lob weird ammo across a landscape you are busy destroying.',
  playerBadge: '1P / 2P',
  accentColor: '#FF7A45',
  art: CardArt,
  component: lazy(() => import('./ui/GameView')),
};
