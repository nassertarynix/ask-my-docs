import { Lightbulb, Plus, RotateCcw, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { GameProps } from '../../hub/types';
import { sfx } from '../../shared/audio';
import { store } from '../../shared/storage';
import { createRng } from '../crater-lab/engine/rng';
import { CAPACITY, canPour, colorsForLevel, generateLevel, isStuck, isWon, pour, solve, withExtraTube, type Move, type Tube } from './engine';

export const GAME_ID = 'water-sort';
/** Twelve colours that stay apart, each with a symbol so they can also be told apart without colour. */
const LIQUIDS = [
  { color: '#FF5A4E', symbol: '●' },
  { color: '#3B6CF6', symbol: '■' },
  { color: '#16A34A', symbol: '▲' },
  { color: '#F5B700', symbol: '◆' },
  { color: '#7C3AED', symbol: '★' },
  { color: '#14B8A6', symbol: '✚' },
  { color: '#FF8FB1', symbol: '♥' },
  { color: '#8B5A2B', symbol: '♣' },
  { color: '#9CA3AF', symbol: '▼' },
  { color: '#84CC16', symbol: '✿' },
  { color: '#0EA5E9', symbol: '☾' },
  { color: '#18181B', symbol: '✖' },
] as const;

/** Level n is always the same puzzle, so "level 12" means something. */
const seedFor = (level: number): number => Math.imul(level, 2654435761) >>> 0;

function Level({ level, onNext }: { level: number; onNext: () => void }) {
  const initial = useMemo(() => generateLevel(createRng(seedFor(level)), colorsForLevel(level)).tubes, [level]);
  const [tubes, setTubes] = useState<readonly Tube[]>(initial);
  const [history, setHistory] = useState<(readonly Tube[])[]>([]);
  const [picked, setPicked] = useState<number | null>(null);
  const [shake, setShake] = useState<number | null>(null);
  const [hinted, setHinted] = useState<Move | null>(null);
  const [extraUsed, setExtraUsed] = useState(false);
  const [moves, setMoves] = useState(0);
  const recorded = useRef(false);
  const won = isWon(tubes);
  const stuck = isStuck(tubes);

  useEffect(() => {
    if (!won || recorded.current) return;
    recorded.current = true;
    sfx.victory();
    store.recordResult(GAME_ID, 'win');
    const saved = store.loadGameSettings(GAME_ID, { level: 1 });
    store.saveGameSettings(GAME_ID, { level: Math.max(saved.level, level + 1) });
  }, [won, level]);

  useEffect(() => {
    if (!hinted) return;
    const id = window.setTimeout(() => setHinted(null), 1800);
    return () => window.clearTimeout(id);
  }, [hinted]);

  const click = (i: number) => {
    if (won) return;
    setHinted(null);
    if (picked === null) {
      if ((tubes[i] as Tube).length === 0) return;
      setPicked(i);
      sfx.angleTick(200 + i * 20);
      return;
    }
    if (picked === i) {
      setPicked(null);
      return;
    }
    if (canPour(tubes, picked, i)) {
      const result = pour(tubes, picked, i);
      setHistory((h) => [...h, tubes]);
      setTubes(result.tubes);
      setMoves((m) => m + 1);
      setPicked(null);
      sfx.angleTick(300 + result.moved * 90);
      return;
    }
    // not allowed: wobble the target, and switch the selection to it if it has liquid
    setShake(i);
    window.setTimeout(() => setShake((s) => (s === i ? null : s)), 350);
    sfx.hit();
    setPicked((tubes[i] as Tube).length > 0 ? i : null);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setTubes(last);
    setHistory(history.slice(0, -1));
    setPicked(null);
    setMoves((m) => Math.max(0, m - 1));
  };
  const restart = () => {
    setTubes(initial);
    setHistory([]);
    setPicked(null);
    setExtraUsed(false);
    setMoves(0);
  };
  const hint = () => {
    const plan = solve(tubes);
    const next = plan?.[0];
    if (next) {
      setHinted(next);
      setPicked(null);
    }
  };

  return (
    <div className="board-wrap ws-wrap" data-screen="play" data-level={level} data-won={won ? 'yes' : 'no'} data-moves={moves} data-stuck={stuck ? 'yes' : 'no'}>
      <div className="sd-top">
        <span className="badge">Level {level}</span>
        <output aria-label="Moves" className="ws-moves">{moves} move{moves === 1 ? '' : 's'}</output>
      </div>
      <div className="ws-tubes" role="group" aria-label="Tubes">
        {tubes.map((t, i) => {
          const classes = ['ws-tube', picked === i ? 'ws-picked' : '', shake === i ? 'ws-shake' : '', hinted?.from === i ? 'ws-hint-from' : '', hinted?.to === i ? 'ws-hint-to' : '', t.length === CAPACITY && t.every((c) => c === t[0]) ? 'ws-done' : ''].filter(Boolean).join(' ');
          return (
            <button key={i} type="button" className={classes} data-tube={i} data-fill={t.length} aria-label={`Tube ${i + 1}: ${t.length === 0 ? 'empty' : t.map((c) => LIQUIDS[c]?.symbol).join(' ')}`} aria-pressed={picked === i} onClick={() => click(i)}>
              {t.map((c, k) => (
                <span key={k} className="ws-layer" data-color={c} style={{ '--liquid': LIQUIDS[c]?.color } as CSSProperties}>
                  <span aria-hidden="true">{LIQUIDS[c]?.symbol}</span>
                </span>
              ))}
            </button>
          );
        })}
      </div>
      {stuck && !won && (
        <p className="mm-error" role="alert" data-stuck-note>
          No pours left. Undo a move, or add a tube.
        </p>
      )}
      <div className="board-actions">
        <button type="button" className="btn" onClick={undo} disabled={history.length === 0 || won} data-action="undo">
          <Undo2 size={16} aria-hidden="true" /> Undo
        </button>
        <button type="button" className="btn" onClick={restart} data-action="restart">
          <RotateCcw size={16} aria-hidden="true" /> Restart
        </button>
        <button type="button" className="btn" onClick={hint} disabled={won} data-action="hint">
          <Lightbulb size={16} aria-hidden="true" /> Hint
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setTubes(withExtraTube(tubes));
            setExtraUsed(true);
            sfx.mound();
          }}
          disabled={extraUsed || won}
          data-action="add-tube"
          title="One extra empty tube per level"
        >
          <Plus size={16} aria-hidden="true" /> Tube
        </button>
      </div>
      {won && (
        <div className="end-card" role="status" data-result="won">
          <h2>Level {level} complete!</h2>
          <p>{moves} moves.</p>
          <div className="board-actions">
            <button type="button" className="btn btn-primary" onClick={onNext} data-action="next" autoFocus>
              Next level
            </button>
            <button type="button" className="btn" onClick={restart}>
              Replay
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GameView(_props: GameProps) {
  const [saved] = useState(() => store.loadGameSettings(GAME_ID, { level: 1 }));
  const startLevel = Math.max(1, Math.min(999, Math.floor(saved.level)));
  const [level, setLevel] = useState<number | null>(null);
  const [chosen, setChosen] = useState(startLevel);

  if (level === null) {
    return (
      <div className="setup" data-screen="setup">
        <p className="setup-lede">Pour the liquids until every tube holds one colour. You can only pour onto the same colour, or into an empty tube.</p>
        <label className="slider ws-picker">
          <span>
            Level <output>{chosen}</output>
          </span>
          <input type="range" min={1} max={Math.max(startLevel, 1)} value={chosen} onChange={(e) => setChosen(Number(e.target.value))} disabled={startLevel === 1} aria-label="Level" />
        </label>
        <button
          type="button"
          className="btn btn-primary btn-big"
          onClick={() => {
            sfx.click();
            setLevel(chosen);
          }}
          data-action="start"
        >
          {startLevel > 1 ? `Play level ${chosen}` : 'Start'}
        </button>
        <p className="armory-keys">Tap a tube to pick it up, then tap where to pour. Later levels add colours. Your furthest level is remembered on this device.</p>
      </div>
    );
  }
  return <Level key={level} level={level} onNext={() => setLevel(level + 1)} />;
}
