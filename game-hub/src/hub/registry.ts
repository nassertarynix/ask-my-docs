/**
 * Every game the hub knows about, in the order the cards appear.
 * Adding a game is one import and one entry here (see ARCHITECTURE.md).
 */
import { Goal, Layers } from 'lucide-react';
import type { GameEntry } from './types';
import { craterLab } from '../games/crater-lab';
import { retroDeck } from '../retro';

export const GAMES: readonly GameEntry[] = [
  craterLab,
  retroDeck,
  {
    id: 'orbit-golf',
    title: 'ORBIT // GOLF',
    tagline: 'Mini-golf, but every hole has its own gravity.',
    playerBadge: '1P',
    accentColor: '#7DD3A8',
    art: Goal,
    component: null,
  },
  {
    id: 'stack-quake',
    title: 'STACK // QUAKE',
    tagline: 'Build the tallest tower you can. Then the ground starts moving.',
    playerBadge: '1P / 2P',
    accentColor: '#B69CFF',
    art: Layers,
    component: null,
  },
];

export function findGame(id: string): GameEntry | undefined {
  return GAMES.find((game) => game.id === id);
}

/** Games that can be played now. */
export function liveGames(): GameEntry[] {
  return GAMES.filter((game) => game.component !== null);
}
