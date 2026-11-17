import { HubHome } from './hub/HubHome';
import { GameFrame } from './hub/GameFrame';
import { findGame } from './hub/registry';
import { useRoute } from './hub/route';

export function App() {
  const route = useRoute();
  if (route.screen === 'play') {
    const game = findGame(route.gameId);
    // an unknown or not-yet-built game falls back to the home screen rather than a blank page
    if (game && game.component) return <GameFrame key={game.id} game={game} />;
  }
  return <HubHome />;
}
