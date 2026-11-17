import { ArrowLeft, RotateCcw, Volume2, VolumeX } from 'lucide-react';
import { Suspense, useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { GameEntry } from './types';
import { goHome } from './route';
import { isMuted, setMuted, sfx, subscribeMuted, unlockAudio } from '../shared/audio';

/**
 * The frame every game is shown in: one top bar with Back, the title, a sound toggle and Reset.
 * Reset remounts the game component (a new React key), so a game gets a clean start for free and
 * does not have to implement resetting itself.
 */
export function GameFrame({ game }: { game: GameEntry }) {
  const [run, setRun] = useState(0);
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  const Game = game.component;
  const style = { '--accent': game.accentColor } as CSSProperties;

  return (
    <div className="frame" style={style} onPointerDown={unlockAudio} onKeyDown={unlockAudio}>
      <header className="frame-bar">
        <button type="button" className="btn" onClick={goHome} aria-label="Back to the hub">
          <ArrowLeft size={18} aria-hidden="true" />
          <span className="btn-label">Hub</span>
        </button>
        <h1 className="frame-title">{game.title}</h1>
        <div className="frame-actions">
          <button
            type="button"
            className="btn btn-icon"
            aria-pressed={muted}
            aria-label={muted ? 'Turn sound on' : 'Turn sound off'}
            title={muted ? 'Sound is off' : 'Sound is on'}
            onClick={() => {
              setMuted(!muted);
              if (muted) sfx.click();
            }}
          >
            {muted ? <VolumeX size={18} aria-hidden="true" /> : <Volume2 size={18} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="btn"
            aria-label="Reset the game"
            onClick={() => {
              sfx.click();
              setRun((n) => n + 1);
            }}
          >
            <RotateCcw size={18} aria-hidden="true" />
            <span className="btn-label">Reset</span>
          </button>
        </div>
      </header>
      <main className="frame-main">
        {Game ? (
          <Suspense fallback={<p className="frame-loading">Loading…</p>}>
            <Game key={run} onExit={goHome} />
          </Suspense>
        ) : (
          <p className="frame-loading">This one is not built yet.</p>
        )}
      </main>
    </div>
  );
}
