import { Flag, Pickaxe, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { GameProps } from '../../hub/types';
import { sfx } from '../../shared/audio';
import { RadioCards } from '../../shared/RadioCards';
import { store } from '../../shared/storage';
import { createRng, type Rng } from '../crater-lab/engine/rng';
import { PRESETS, adjacent, chord, minesLeft, newGame, reveal, toggleFlag, type Preset, type State } from './engine';

export const GAME_ID = 'minesweeper';
/** Number colours, as in the classic game, darkened a little so they read on paper. */
const NUMBER_COLORS = ['', '#2b4bd1', '#15803d', '#b42318', '#1e1b6e', '#7a1f1f', '#0e7490', '#18181b', '#6b6b73'];
const LONG_PRESS_MS = 420;

function seedFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('seed');
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

const pad3 = (n: number): string => (n < 0 ? '-' : '') + String(Math.min(999, Math.abs(n))).padStart(n < 0 ? 2 : 3, '0');

function Play({ preset, onMenu }: { preset: Preset; onMenu: () => void }) {
  const [state, setState] = useState<State>(() => newGame(preset.w, preset.h, preset.mines));
  const [flagMode, setFlagMode] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [seed] = useState(() => seedFromUrl() ?? ((Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0));
  const rng = useRef<Rng>(createRng(seed));
  const press = useRef<{ timer: number; fired: boolean } | null>(null);

  useEffect(() => {
    if (state.status !== 'playing') return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [state.status]);

  useEffect(() => {
    if (state.status === 'won') {
      sfx.victory();
      store.recordResult(GAME_ID, 'win');
    } else if (state.status === 'lost') {
      sfx.explosion(60);
      store.recordResult(GAME_ID, 'loss');
    }
  }, [state.status]);

  const restart = () => {
    sfx.click();
    rng.current = createRng(seedFromUrl() ?? ((Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0));
    setState(newGame(preset.w, preset.h, preset.mines));
    setSeconds(0);
  };

  const open = (i: number) => {
    if (state.revealed[i]) {
      setState(chord(state, i, rng.current)); // clicking an opened number opens its neighbours when the flags match
      return;
    }
    if (state.flags[i]) return;
    sfx.angleTick(300 + (i % 9) * 30);
    setState(reveal(state, i, rng.current));
  };
  const flag = (i: number) => {
    if (state.revealed[i]) return;
    sfx.angleTick(120);
    setState(toggleFlag(state, i));
  };

  const down = (e: ReactPointerEvent, i: number) => {
    if (e.pointerType === 'mouse') return;
    press.current = {
      fired: false,
      timer: window.setTimeout(() => {
        if (press.current) press.current.fired = true;
        flag(i);
        navigator.vibrate?.(20);
      }, LONG_PRESS_MS),
    };
  };
  const up = () => {
    if (press.current) window.clearTimeout(press.current.timer);
  };

  const face = state.status === 'won' ? '😎' : state.status === 'lost' ? '😵' : '🙂';

  return (
    <div className="board-wrap ms-wrap" data-screen="play" data-status={state.status} data-left={minesLeft(state)}>
      <div className="ms-bar">
        <output className="ms-led" aria-label="Mines left">{pad3(minesLeft(state))}</output>
        <button type="button" className="btn ms-face" onClick={restart} aria-label="Start a new game" data-action="restart">
          <span aria-hidden="true">{face}</span>
        </button>
        <output className="ms-led" aria-label="Seconds">{pad3(seconds)}</output>
      </div>
      <div className="ms-scroll">
        <div className="ms-grid" style={{ '--cols': preset.w } as CSSProperties} role="grid" aria-label="Minesweeper board" data-cols={preset.w}>
          {Array.from({ length: preset.w * preset.h }, (_, i) => {
            const isOpen = state.revealed[i] === 1;
            const isMine = state.mines[i] === 1;
            const isFlag = state.flags[i] === 1;
            const n = isOpen && !isMine ? adjacent(state, i) : 0;
            const cellState = isOpen ? (isMine ? (state.exploded === i ? 'boom' : 'mine') : 'open') : isFlag ? (state.status === 'lost' && !isMine ? 'wrongflag' : 'flag') : 'hidden';
            return (
              <button
                key={i}
                type="button"
                role="gridcell"
                className={`ms-cell ms-${cellState}`}
                data-cell={i}
                data-state={cellState}
                data-n={n}
                style={n ? ({ color: NUMBER_COLORS[n] } as CSSProperties) : undefined}
                aria-label={`Row ${Math.floor(i / preset.w) + 1}, column ${(i % preset.w) + 1}: ${cellState === 'open' ? (n ? `${n}` : 'empty') : cellState}`}
                disabled={state.status === 'won' || state.status === 'lost'}
                onPointerDown={(e) => down(e, i)}
                onPointerUp={up}
                onPointerLeave={up}
                onPointerCancel={up}
                onClick={() => {
                  if (press.current?.fired) {
                    press.current = null;
                    return; // that press was a long press: it already placed a flag
                  }
                  if (flagMode && !state.revealed[i]) flag(i);
                  else open(i);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  flag(i);
                }}
                onKeyDown={(e) => {
                  if (e.key.toLowerCase() === 'f') {
                    e.preventDefault();
                    flag(i);
                  }
                }}
              >
                {cellState === 'open' ? (n || '') : cellState === 'flag' ? '⚑' : cellState === 'wrongflag' ? '✕' : cellState === 'mine' || cellState === 'boom' ? '✹' : ''}
              </button>
            );
          })}
        </div>
      </div>
      <div className="board-actions">
        <button type="button" className={`btn${flagMode ? ' btn-primary' : ''}`} onClick={() => setFlagMode(!flagMode)} aria-pressed={flagMode} data-action="flag-mode">
          {flagMode ? <Flag size={16} aria-hidden="true" /> : <Pickaxe size={16} aria-hidden="true" />} {flagMode ? 'Flagging' : 'Digging'}
        </button>
        <button type="button" className="btn" onClick={onMenu}>
          <RotateCcw size={16} aria-hidden="true" /> Change size
        </button>
      </div>
      {(state.status === 'won' || state.status === 'lost') && (
        <div className="end-card" role="status" data-result={state.status}>
          <h2>{state.status === 'won' ? `Cleared in ${seconds} s!` : 'Boom.'}</h2>
          <div className="board-actions">
            <button type="button" className="btn btn-primary" onClick={restart} data-action="again" autoFocus>
              Try again
            </button>
          </div>
        </div>
      )}
      <p className="armory-keys">Click to dig, right-click or long-press to flag, click an opened number to open its neighbours once its flags match. The first click is always safe.</p>
    </div>
  );
}

export default function GameView(_props: GameProps) {
  const [saved] = useState(() => store.loadGameSettings(GAME_ID, { size: 'beginner' }));
  const [size, setSize] = useState<Preset['id']>(PRESETS.some((p) => p.id === saved.size) ? (saved.size as Preset['id']) : 'beginner');
  const [preset, setPreset] = useState<Preset | null>(null);

  if (!preset) {
    const stats = store.loadStats(GAME_ID);
    return (
      <div className="setup" data-screen="setup">
        <p className="setup-lede">Clear the board without touching a mine. Numbers tell you how many mines are next to a square.</p>
        <RadioCards
          legend="Board size"
          name="ms-size"
          value={size}
          onChange={setSize}
          options={PRESETS.map((p) => ({ value: p.id, title: p.name, hint: `${p.w} × ${p.h}, ${p.mines} mines` }))}
        />
        <button
          type="button"
          className="btn btn-primary btn-big"
          onClick={() => {
            sfx.click();
            store.saveGameSettings(GAME_ID, { size });
            setPreset(PRESETS.find((p) => p.id === size) ?? (PRESETS[0] as Preset));
          }}
          data-action="start"
        >
          Start
        </button>
        {stats.plays > 0 && (
          <p className="setup-stats">
            {stats.wins} cleared, {stats.losses} blown up{stats.bestStreak > 1 ? `, best streak ${stats.bestStreak}` : ''}.
          </p>
        )}
      </div>
    );
  }
  return <Play key={preset.id} preset={preset} onMenu={() => setPreset(null)} />;
}
