import type { ComponentType, LazyExoticComponent } from 'react';

/** What the hub gives every game. */
export interface GameProps {
  /** Go back to the hub's home screen. */
  onExit: () => void;
}

/** One card on the hub. Adding a game to the hub means adding one of these to the registry. */
export interface GameEntry {
  /** Used in the URL (#/play/<id>) and as the key for saved stats. Lowercase, no spaces. */
  id: string;
  title: string;
  /** One sentence under the title. */
  tagline: string;
  /** Who can play, e.g. "1P / 2P". */
  playerBadge: string;
  /** The card's colour, any CSS colour. */
  accentColor: string;
  /** A small picture for the card: any component that draws itself to fill its box. */
  art: ComponentType<{ className?: string }>;
  /** The game itself, or null for a "coming soon" card. Usually `lazy(() => import(...))` so it loads on demand. */
  component: LazyExoticComponent<ComponentType<GameProps>> | ComponentType<GameProps> | null;
}
