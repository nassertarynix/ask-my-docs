import { Eraser, Lightbulb, Pencil, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { GameProps } from '../../hub/types';
import { sfx } from '../../shared/audio';
import { RadioCards } from '../../shared/RadioCards';
import { store } from '../../shared/storage';
import { createRng } from '../crater-lab/engine/rng';
import { PEERS, box, col, conflicts, digitCounts, generate, isSolved, row, type Difficulty, type Puzzle } from './engine';

export const GAME_ID = 'sudoku';
const isDifficulty = (v: string): v is Difficulty => v === 'easy' || v === 'medium' || v === 'hard';

interface Snapshot {
  values: number[];
  notes: number[];
}

function seedFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('seed');
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

const formatTime = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function Play({ puzzle, difficulty, onNew }: { puzzle: Puzzle; difficulty: Difficulty; onNew: () => void }) {
  const [values, setValues] = useState<number[]>(puzzle.puzzle);
  const [notes, setNotes] = useState<number[]>(() => new Array(81).fill(0));
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [pencil, setPencil] = useState(false);
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const [seconds, setSeconds] = useState(0);
  const [hints, setHints] = useState(0);
  const solved = useMemo(() => isSolved(values), [values]);
  const clashes = useMemo(() => conflicts(values), [values]);
  const counts = useMemo(() => digitCounts(values), [values]);
  const given = (i: number) => puzzle.puzzle[i] !== 0;

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

  const remember = () => setHistory((h) => [...h.slice(-99), { values, notes }]);

  const enter = useCallback(
    (d: number) => {
      if (selected === null || given(selected) || solved) return;
      if (pencil && values[selected] === 0) {
        setHistory((h) => [...h.slice(-99), { values, notes }]);
        const next = [...notes];
        next[selected] = (next[selected] as number) ^ (1 << d);
        setNotes(next);
        sfx.angleTick(100 + d * 40);
        return;
      }
      setHistory((h) => [...h.slice(-99), { values, notes }]);
      const nextValues = [...values];
      const same = nextValues[selected] === d;
      nextValues[selected] = same ? 0 : d;
      const nextNotes = [...notes];
      nextNotes[selected] = 0;
      if (!same) for (const p of PEERS[selected] as readonly number[]) nextNotes[p] = (nextNotes[p] as number) & ~(1 << d); // a placed digit rules itself out of its neighbours' notes
      setValues(nextValues);
      setNotes(nextNotes);
      setMarked(new Set());
      sfx.angleTick(200 + d * 50);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, pencil, values, notes, solved],
  );

  const erase = useCallback(() => {
    if (selected === null || given(selected) || solved) return;
    if (values[selected] === 0 && notes[selected] === 0) return;
    remember();
    const nextValues = [...values];
    nextValues[selected] = 0;
    const nextNotes = [...notes];
    nextNotes[selected] = 0;
    setValues(nextValues);
    setNotes(nextNotes);
    setMarked(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, values, notes, solved]);

  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setValues(last.values);
    setNotes(last.notes);
    setHistory(history.slice(0, -1));
    setMarked(new Set());
  };

  const hint = () => {
    if (solved) return;
    // the selected cell if it is empty or wrong, otherwise the first one that is
    const wrong = (i: number) => !given(i) && values[i] !== puzzle.solution[i];
    const target = selected !== null && wrong(selected) ? selected : values.findIndex((_, i) => wrong(i));
    if (target < 0) return;
    remember();
    const nextValues = [...values];
    nextValues[target] = puzzle.solution[target] as number;
    const nextNotes = [...notes];
    nextNotes[target] = 0;
    setValues(nextValues);
    setNotes(nextNotes);
    setSelected(target);
    setHints((h) => h + 1);
    setMarked(new Set());
    sfx.mound();
  };

  const check = () => {
    const wrong = new Set<number>();
    values.forEach((v, i) => v !== 0 && v !== puzzle.solution[i] && wrong.add(i));
    setMarked(wrong);
    if (wrong.size === 0) sfx.turn();
    else sfx.hit();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (/^[1-9]$/.test(e.key)) enter(Number(e.key));
      else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') erase();
      else if (e.key.toLowerCase() === 'n') setPencil((p) => !p);
      else if (e.key.startsWith('Arrow')) {
        const at = selected ?? 40;
        const r = row(at) + (e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0);
        const c = col(at) + (e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0);
        if (r >= 0 && r < 9 && c >= 0 && c < 9) setSelected(r * 9 + c);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enter, erase, selected]);

  const sel = selected;
  const selValue = sel === null ? 0 : (values[sel] as number);

  return (
    <div className="board-wrap sd-wrap" data-screen="play" data-solved={solved ? 'yes' : 'no'} data-filled={values.filter(Boolean).length}>
      <div className="sd-top">
        <span className="badge">{difficulty}</span>
        <output aria-label="Time">{formatTime(seconds)}</output>
        {hints > 0 && <span className="sd-hints">{hints} hint{hints === 1 ? '' : 's'}</span>}
      </div>
      <div className="sd-grid" role="grid" aria-label="Sudoku grid">
        {values.map((v, i) => {
          const isSel = sel === i;
          const related = sel !== null && !isSel && (row(i) === row(sel) || col(i) === col(sel) || box(i) === box(sel));
          const sameDigit = selValue !== 0 && v === selValue && !isSel;
          const cls = ['sd-cell', given(i) ? 'sd-given' : '', isSel ? 'sd-sel' : '', related ? 'sd-related' : '', sameDigit ? 'sd-same' : '', clashes.has(i) ? 'sd-clash' : '', marked.has(i) ? 'sd-wrong' : '', col(i) % 3 === 2 && col(i) < 8 ? 'sd-rb' : '', row(i) % 3 === 2 && row(i) < 8 ? 'sd-bb' : ''].filter(Boolean).join(' ');
          return (
            <button key={i} type="button" role="gridcell" className={cls} data-cell={i} data-value={v} aria-label={`Row ${row(i) + 1}, column ${col(i) + 1}, ${v ? v : 'empty'}${given(i) ? ', given' : ''}`} aria-selected={isSel} onClick={() => setSelected(i)}>
              {v ? (
                v
              ) : notes[i] ? (
                <span className="sd-notes" aria-hidden="true">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                    <span key={d}>{(notes[i] as number) & (1 << d) ? d : ''}</span>
                  ))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="sd-pad" role="group" aria-label="Digits">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button key={d} type="button" className="btn sd-digit" disabled={(counts[d] as number) >= 9 && !pencil} onClick={() => enter(d)} data-digit={d} aria-label={`Digit ${d}, ${9 - (counts[d] as number)} left`}>
            {d}
            <small>{Math.max(0, 9 - (counts[d] as number))}</small>
          </button>
        ))}
      </div>
      <div className="board-actions">
        <button type="button" className={`btn${pencil ? ' btn-primary' : ''}`} onClick={() => setPencil(!pencil)} aria-pressed={pencil} data-action="notes">
          <Pencil size={16} aria-hidden="true" /> Notes {pencil ? 'on' : 'off'}
        </button>
        <button type="button" className="btn" onClick={erase} data-action="erase">
          <Eraser size={16} aria-hidden="true" /> Erase
        </button>
        <button type="button" className="btn" onClick={undo} disabled={history.length === 0} data-action="undo">
          <Undo2 size={16} aria-hidden="true" /> Undo
        </button>
        <button type="button" className="btn" onClick={hint} data-action="hint">
          <Lightbulb size={16} aria-hidden="true" /> Hint
        </button>
        <button type="button" className="btn" onClick={check} data-action="check">
          Check
        </button>
      </div>
      {solved && (
        <div className="end-card" role="status" data-result="solved">
          <h2>Solved in {formatTime(seconds)}!</h2>
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
  const [saved] = useState(() => store.loadGameSettings(GAME_ID, { difficulty: 'easy' }));
  const [difficulty, setDifficulty] = useState<Difficulty>(isDifficulty(saved.difficulty) ? saved.difficulty : 'easy');
  const [current, setCurrent] = useState<{ puzzle: Puzzle; difficulty: Difficulty; round: number } | null>(null);
  const [round, setRound] = useState(0);
  const [base] = useState(() => (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0);

  const start = () => {
    sfx.click();
    store.saveGameSettings(GAME_ID, { difficulty });
    const seed = seedFromUrl() ?? (base + round * 104729) >>> 0;
    setRound(round + 1);
    setCurrent({ puzzle: generate(createRng(seed), difficulty), difficulty, round });
  };

  if (!current) {
    const stats = store.loadStats(GAME_ID);
    return (
      <div className="setup" data-screen="setup">
        <p className="setup-lede">Fill the grid so every row, column and 3×3 box holds 1 to 9 exactly once. Every puzzle has one solution.</p>
        <RadioCards
          legend="Difficulty"
          name="sd-level"
          value={difficulty}
          onChange={setDifficulty}
          options={[
            { value: 'easy', title: 'Easy', hint: '40 clues' },
            { value: 'medium', title: 'Medium', hint: '32 clues' },
            { value: 'hard', title: 'Hard', hint: '26 clues' },
          ]}
        />
        <button type="button" className="btn btn-primary btn-big" onClick={start} data-action="start">
          New puzzle
        </button>
        {stats.wins > 0 && <p className="setup-stats">{stats.wins} puzzle{stats.wins === 1 ? '' : 's'} solved on this device.</p>}
        <p className="armory-keys">
          Keys: <kbd>1</kbd>–<kbd>9</kbd> fill the selected cell, <kbd>N</kbd> toggles pencil notes, <kbd>Backspace</kbd> erases, arrows move. Clashes show in red.
        </p>
      </div>
    );
  }

  return <Play key={current.round} puzzle={current.puzzle} difficulty={current.difficulty} onNew={start} />;
}
