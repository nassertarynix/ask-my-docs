import { Lightbulb, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { GameProps } from '../../hub/types';
import { sfx } from '../../shared/audio';
import { RadioCards } from '../../shared/RadioCards';
import { store } from '../../shared/storage';
import { createRng } from '../crater-lab/engine/rng';
import { SIZES, colOf, generate, isSolved, lineMatches, rowOf, type Cell, type Puzzle, type Size } from './engine';

export const GAME_ID = 'picross';
type Tool = 'fill' | 'mark';

function seedFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('seed');
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
const formatTime = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function Play({ puzzle, onNew }: { puzzle: Puzzle; onNew: () => void }) {
  const { n, clues, solution } = puzzle;
  const [cells, setCells] = useState<Cell[]>(() => new Array<Cell>(n * n).fill(0));
  const [history, setHistory] = useState<Cell[][]>([]);
  const [tool, setTool] = useState<Tool>('fill');
  const [wrong, setWrong] = useState<Set<number>>(new Set());
  const [seconds, setSeconds] = useState(0);
  const [hints, setHints] = useState(0);
  const overlay = useRef<HTMLDivElement | null>(null);
  const stroke = useRef<{ value: Cell; tool: Tool; seen: Set<number>; before: Cell[] } | null>(null);
  const filled = useMemo(() => cells.map((c) => c === 1), [cells]);
  const solved = useMemo(() => isSolved(filled, clues, n), [filled, clues, n]);

  useEffect(() => {
    if (solved) return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [solved]);

  useEffect(() => {
    if (!solved) return;
    sfx.victory();
    store.recordResult(GAME_ID, 'win');
  }, [solved]);

  const rowDone = useMemo(() => clues.rows.map((clue, r) => lineMatches(clue, rowOf(filled, n, r))), [clues, filled, n]);
  const colDone = useMemo(() => clues.cols.map((clue, c) => lineMatches(clue, colOf(filled, n, c))), [clues, filled, n]);

  const paint = (index: number) => {
    const s = stroke.current;
    if (!s || s.seen.has(index)) return;
    s.seen.add(index);
    setCells((prev) => {
      if (prev[index] === s.value) return prev;
      const next = [...prev];
      next[index] = s.value;
      return next;
    });
    setWrong(new Set());
  };

  /** Which square is under the pointer: the overlay covers exactly the n x n squares, so it is plain arithmetic. */
  const cellAt = (e: ReactPointerEvent): number | null => {
    const rect = (overlay.current as HTMLElement).getBoundingClientRect();
    const c = Math.floor(((e.clientX - rect.left) / rect.width) * n);
    const r = Math.floor(((e.clientY - rect.top) / rect.height) * n);
    return r < 0 || c < 0 || r >= n || c >= n ? null : r * n + c;
  };

  const down = (e: ReactPointerEvent) => {
    if (solved) return;
    const index = cellAt(e);
    if (index === null) return;
    const chosen: Tool = e.button === 2 ? 'mark' : tool;
    const current = cells[index] as Cell;
    // the first square decides what the whole drag does: fill or clear, mark or unmark
    const value: Cell = chosen === 'fill' ? (current === 1 ? 0 : 1) : current === 2 ? 0 : 2;
    stroke.current = { value, tool: chosen, seen: new Set(), before: cells };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    sfx.angleTick(value === 1 ? 260 : value === 2 ? 160 : 200);
    paint(index);
    e.preventDefault();
  };
  const move = (e: ReactPointerEvent) => {
    if (!stroke.current) return;
    const index = cellAt(e);
    if (index !== null) paint(index);
  };
  const up = () => {
    const s = stroke.current;
    stroke.current = null;
    if (s && s.before !== cells) setHistory((h) => [...h.slice(-99), s.before]);
  };

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setCells(last);
    setHistory(history.slice(0, -1));
    setWrong(new Set());
  };

  const hint = () => {
    if (solved) return;
    const open = cells.map((c, i) => ((solution[i] ? c !== 1 : c === 1) ? i : -1)).filter((i) => i >= 0);
    const pick = open[0];
    if (pick === undefined) return;
    setHistory((h) => [...h.slice(-99), cells]);
    const next = [...cells];
    next[pick] = solution[pick] ? 1 : 2;
    setCells(next);
    setHints((x) => x + 1);
    sfx.mound();
  };

  const check = () => {
    const bad = new Set<number>();
    cells.forEach((c, i) => {
      if ((c === 1 && !solution[i]) || (c === 2 && solution[i])) bad.add(i);
    });
    setWrong(bad);
    if (bad.size === 0) sfx.turn();
    else sfx.hit();
  };

  const slots = Math.ceil(n / 2);
  const style = { '--n': n, '--slots': slots } as CSSProperties;

  return (
    <div className="board-wrap pc-wrap" data-screen="play" data-solved={solved ? 'yes' : 'no'} data-n={n} data-filled={filled.filter(Boolean).length}>
      <div className="sd-top">
        <span className="badge">
          {n} × {n}
        </span>
        <output aria-label="Time">{formatTime(seconds)}</output>
        {hints > 0 && <span className="sd-hints">{hints} hint{hints === 1 ? '' : 's'}</span>}
      </div>
      <div className="pc-box">
        <div className={`pc-board${solved ? ' pc-solved' : ''}`} style={style} onContextMenu={(e) => e.preventDefault()}>
          <span className="pc-corner" />
          {clues.cols.map((clue, c) => (
            <div key={`c${c}`} className={`pc-clue pc-clue-col${colDone[c] ? ' pc-done' : ''}${c % 5 === 4 && c < n - 1 ? ' pc-gap-r' : ''}`} data-clue={`c${c}`} aria-label={`Column ${c + 1}: ${clue.length ? clue.join(' ') : '0'}`}>
              {(clue.length ? clue : [0]).map((v, k) => (
                <span key={k}>{v}</span>
              ))}
            </div>
          ))}
          {clues.rows.map((clue, r) => (
            <div key={`r${r}`} style={{ display: 'contents' }}>
              <div className={`pc-clue pc-clue-row${rowDone[r] ? ' pc-done' : ''}${r % 5 === 4 && r < n - 1 ? ' pc-gap-b' : ''}`} data-clue={`r${r}`} aria-label={`Row ${r + 1}: ${clue.length ? clue.join(' ') : '0'}`}>
                {(clue.length ? clue : [0]).map((v, k) => (
                  <span key={k}>{v}</span>
                ))}
              </div>
              {Array.from({ length: n }, (_, c) => {
                const i = r * n + c;
                const v = cells[i] as Cell;
                const cls = ['pc-cell', v === 1 ? 'pc-on' : '', v === 2 ? 'pc-off' : '', wrong.has(i) ? 'pc-bad' : '', c % 5 === 4 && c < n - 1 ? 'pc-gap-r' : '', r % 5 === 4 && r < n - 1 ? 'pc-gap-b' : ''].filter(Boolean).join(' ');
                return (
                  <div key={c} className={cls} data-cell={i} data-state={v} role="button" aria-label={`Row ${r + 1}, column ${c + 1}: ${v === 1 ? 'filled' : v === 2 ? 'marked empty' : 'blank'}`} aria-pressed={v === 1}>
                    {v === 2 ? '×' : ''}
                  </div>
                );
              })}
            </div>
          ))}
          <div ref={overlay} className="pc-overlay" data-overlay onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
        </div>
      </div>
      <div className="board-actions">
        <button type="button" className={`btn${tool === 'fill' ? ' btn-primary' : ''}`} onClick={() => setTool('fill')} aria-pressed={tool === 'fill'} data-action="tool-fill">
          ■ Fill
        </button>
        <button type="button" className={`btn${tool === 'mark' ? ' btn-primary' : ''}`} onClick={() => setTool('mark')} aria-pressed={tool === 'mark'} data-action="tool-mark">
          <X size={16} aria-hidden="true" /> Mark empty
        </button>
        <button type="button" className="btn" onClick={undo} disabled={history.length === 0} data-action="undo">
          <Undo2 size={16} aria-hidden="true" /> Undo
        </button>
        <button type="button" className="btn" onClick={hint} disabled={solved} data-action="hint">
          <Lightbulb size={16} aria-hidden="true" /> Hint
        </button>
        <button type="button" className="btn" onClick={check} data-action="check">
          Check
        </button>
      </div>
      {solved && (
        <div className="end-card" role="status" data-result="solved">
          <h2>Picture complete in {formatTime(seconds)}!</h2>
          <p>{hints === 0 ? 'No hints used.' : `${hints} hint${hints === 1 ? '' : 's'} used.`}</p>
          <div className="board-actions">
            <button type="button" className="btn btn-primary" onClick={onNew} data-action="again" autoFocus>
              New puzzle
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function GameView(_props: GameProps) {
  const [saved] = useState(() => store.loadGameSettings(GAME_ID, { size: 10 }));
  const [size, setSize] = useState<string>(String(SIZES.includes(saved.size as Size) ? saved.size : 10));
  const [current, setCurrent] = useState<{ puzzle: Puzzle; round: number } | null>(null);
  const [round, setRound] = useState(0);
  const [base] = useState(() => (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0);

  const start = () => {
    sfx.click();
    const n = Number(size) as Size;
    store.saveGameSettings(GAME_ID, { size: n });
    const seed = seedFromUrl() ?? (base + round * 104729) >>> 0;
    setRound(round + 1);
    setCurrent({ puzzle: generate(createRng(seed), n), round });
  };

  if (!current) {
    const stats = store.loadStats(GAME_ID);
    return (
      <div className="setup" data-screen="setup">
        <p className="setup-lede">Numbers beside each row and column say how long the runs of filled squares are. Work out which squares to fill, and a picture appears.</p>
        <RadioCards
          legend="Size"
          name="pc-size"
          value={size}
          onChange={setSize}
          options={[
            { value: '5', title: '5 × 5', hint: 'A warm-up' },
            { value: '10', title: '10 × 10', hint: 'The classic' },
            { value: '15', title: '15 × 15', hint: 'Settle in' },
          ]}
        />
        <button type="button" className="btn btn-primary btn-big" onClick={start} data-action="start">
          New puzzle
        </button>
        {stats.wins > 0 && <p className="setup-stats">{stats.wins} picture{stats.wins === 1 ? '' : 's'} completed on this device.</p>}
        <p className="armory-keys">
          Drag across squares to fill several at once; the first square decides whether you fill or clear. Switch to <strong>Mark empty</strong> (or right-click) to cross out squares you know are blank. A clue turns grey once its line is right. Every puzzle can be solved by logic, with no guessing.
        </p>
      </div>
    );
  }
  return <Play key={current.round} puzzle={current.puzzle} onNew={start} />;
}
