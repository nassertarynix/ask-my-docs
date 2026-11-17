import { Flame, Trophy } from 'lucide-react';
import type { CSSProperties } from 'react';
import { GAMES } from './registry';
import { gameHref } from './route';
import type { GameEntry } from './types';
import { store } from '../shared/storage';
import { sfx } from '../shared/audio';

function Card({ game }: { game: GameEntry }) {
  const live = game.component !== null;
  const stats = live ? store.loadStats(game.id) : null;
  const Art = game.art;
  const style = { '--accent': game.accentColor } as CSSProperties;

  const inside = (
    <>
      <div className="card-art">
        <Art className="card-art-image" />
        {!live && <span className="card-soon">Coming soon</span>}
      </div>
      <div className="card-body">
        <h2 className="card-title">{game.title}</h2>
        <p className="card-tagline">{game.tagline}</p>
        <div className="card-meta">
          <span className="badge">{game.playerBadge}</span>
          {stats && stats.plays > 0 && (
            <>
              <span className="stat" title="Wins against the computer">
                <Trophy size={14} aria-hidden="true" /> {stats.wins} {stats.wins === 1 ? 'win' : 'wins'}
              </span>
              {stats.streak > 1 && (
                <span className="stat" title={`Best streak: ${stats.bestStreak}`}>
                  <Flame size={14} aria-hidden="true" /> {stats.streak} in a row
                </span>
              )}
            </>
          )}
          {live && <span className="card-play">Play →</span>}
        </div>
      </div>
    </>
  );

  return live ? (
    <a className="card card-live" style={style} href={gameHref(game.id)} onClick={() => sfx.click()} data-game={game.id}>
      {inside}
    </a>
  ) : (
    <div className="card card-placeholder" style={style} aria-disabled="true" data-game={game.id}>
      {inside}
    </div>
  );
}

export function HubHome() {
  return (
    <div className="hub">
      <header className="hub-header">
        <p className="hub-kicker">Small games. No logins. No loading bars.</p>
        <h1 className="hub-title">
          PAPER <span className="hub-title-box">ARCADE</span>
        </h1>
      </header>
      <main>
        <ul className="card-grid">
          {GAMES.map((game) => (
            <li key={game.id}>
              <Card game={game} />
            </li>
          ))}
        </ul>
      </main>
      <footer className="hub-footer">
        <p>Everything runs in your browser. Nothing is uploaded; your stats stay on this device.</p>
      </footer>
    </div>
  );
}
