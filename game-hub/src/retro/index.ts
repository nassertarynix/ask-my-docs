import { lazy } from 'react';
import { Gamepad2 } from 'lucide-react';
import type { GameEntry } from '../hub/types';

/** The Retro Deck's card on the hub. The emulator and its cores are only downloaded when a game is started. */
export const retroDeck: GameEntry = {
  id: 'retro',
  title: 'RETRO // DECK',
  tagline: 'NES, Super NES, Mega Drive and Game Boy games, emulated in the browser.',
  playerBadge: '1P / 2P',
  accentColor: '#8A6FDF',
  art: Gamepad2,
  component: lazy(() => import('./RetroView')),
};
