import { Bot, Footprints, Square, Users } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { GameProps } from '../../hub/types';
import { sfx } from '../../shared/audio';
import { RadioCards } from '../../shared/RadioCards';
import { store } from '../../shared/storage';
import { createRng } from '../crater-lab/engine/rng';
import { chooseMove, type Difficulty } from './ai';
import { SIZE, WALL_GRID, WALLS_EACH, apply, newGame, pawnMoves, wallProblem, wallsOnBoard, type Move, type Player, type State, type Wall, type WallProblem } from './engine';

export const GAME_ID = 'quoridor';
type Mode = 'ai' | 'pvp';
const COLORS = ['#FF5A4E', '#3B6CF6'] as const;
const HUMAN: Player = 0;
const CELL = 40;
const GAP = 10;
const STEP = CELL + GAP;
const PAD = 12;
const SPAN = SIZE * CELL + (SIZE - 1) * GAP + PAD * 2;
const isDifficulty = (v: string): v is Difficulty => v === 'easy' || v === 'normal' || v === 'hard';

const cellX = (c: number) => PAD + c * STEP;
const cellY = (r: number) => PAD + r * STEP;

/** The rectangle a wall covers, in board units. */
function wallRect(w: Wall) {
  return w.o === 'h'
    ? { x: cellX(w.c), y: cellY(w.r) + CELL, width: CELL * 2 + GAP, height: GAP }
    : { x: cellX(w.c) + CELL, y: cellY(w.r), width: GAP, height: CELL * 2 + GAP };
}

const WHY: Record<WallProblem, string> = {
  'none-left': 'No walls left.',
  outside: 'That is off the board.',
  overlap: 'A wall is already there.',
  cross: 'Walls cannot cross.',
  'blocks-path': 'That would trap a pawn: every pawn must keep a way to its goal.',
  'game-over': 'The game is over.',
};

/** The wall nearest to a point on the board: the nearest crossroads, lying along whichever direction the point is offset in. */
function wallAt(x: number, y: number): Wall | null {
  const c = Math.round((x - PAD - CELL - GAP / 2) / STEP);
  const r = Math.round((y - PAD - CELL - GAP / 2) / STEP);
  if (r < 0 || c < 0 || r >= WALL_GRID || c >= WALL_GRID) return null;
  const cx = cellX(c) + CELL + GAP / 2;
  const cy = cellY(r) + CELL + GAP / 2;
  return { o: Math.abs(x - cx) >= Math.abs(y - cy) ? 'h' : 'v', r, c };
}

function Board({
  state,
  destinations,
  onStep,
  wallMode,
  preview,
  setPreview,
  onWallPointer,
}: {
  state: State;
  destinations: { r: number; c: number }[];
  onStep: (r: number, c: number) => void;
  wallMode: boolean;
  preview: Wall | null;
  setPreview: (w: Wall | null) => void;
  onWallPointer: (w: Wall, pointerType: string) => void;
}) {
  const svg = useRef<SVGSVGElement | null>(null);
  const toBoard = (e: ReactPointerEvent) => {
    const rect = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * SPAN, y: ((e.clientY - rect.top) / rect.height) * SPAN };
  };
  const problem = preview ? wallProblem(state, preview) : null;
  return (
    <svg
      ref={svg}
      className="qd-board"
      viewBox={`0 0 ${SPAN} ${SPAN}`}
      role="group"
      aria-label="Quoridor board"
      data-wall-mode={wallMode ? 'yes' : 'no'}
      onPointerMove={(e) => wallMode && setPreview(wallAt(toBoard(e).x, toBoard(e).y))}
      onPointerLeave={() => setPreview(null)}
      onPointerDown={(e) => {
        if (!wallMode) return;
        const w = wallAt(toBoard(e).x, toBoard(e).y);
        if (w) onWallPointer(w, e.pointerType);
      }}
    >
      {Array.from({ length: SIZE * SIZE }, (_, i) => {
        const r = Math.floor(i / SIZE);
        const c = i % SIZE;
        const goal0 = r === 0;
        const goal1 = r === SIZE - 1;
        return <rect key={i} x={cellX(c)} y={cellY(r)} width={CELL} height={CELL} rx={6} fill={goal0 ? '#FFD9D4' : goal1 ? '#D6E0FF' : '#F1D9A7'} stroke="#18181B" strokeWidth={1.5} />;
      })}
      {wallsOnBoard(state).map((w) => {
        const rect = wallRect(w);
        return <rect key={`${w.o}${w.r}${w.c}`} {...rect} rx={3} fill="#18181B" data-wall={`${w.o}${w.r},${w.c}`} />;
      })}
      {preview && wallMode && (
        <rect {...wallRect(preview)} rx={3} fill={problem ? '#B42318' : COLORS[state.current]} opacity={problem ? 0.45 : 0.8} data-preview={problem ?? 'ok'} />
      )}
      {!wallMode &&
        destinations.map((d) => (
          <g key={`${d.r},${d.c}`}>
            <circle
              cx={cellX(d.c) + CELL / 2}
              cy={cellY(d.r) + CELL / 2}
              r={CELL / 2 - 4}
              fill={COLORS[state.current]}
              opacity={0.3}
              className="qd-dest"
              data-dest={`${d.r},${d.c}`}
              role="button"
              tabIndex={0}
              aria-label={`Move to row ${d.r + 1}, column ${d.c + 1}`}
              onClick={() => onStep(d.r, d.c)}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onStep(d.r, d.c))}
            />
          </g>
        ))}
      {state.pawns.map((p, i) => (
        <g key={i} data-pawn={i} data-at={`${p.r},${p.c}`}>
          <circle cx={cellX(p.c) + CELL / 2} cy={cellY(p.r) + CELL / 2} r={CELL / 2 - 5} fill={COLORS[i]} stroke="#18181B" strokeWidth={3} />
          <text x={cellX(p.c) + CELL / 2} y={cellY(p.r) + CELL / 2 + 6} textAnchor="middle" fontSize={18} fontWeight={700} fill="#fff" pointerEvents="none">
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function GameView(_props: GameProps) {
  const [saved] = useState(() => store.loadGameSettings(GAME_ID, { mode: 'ai', difficulty: 'normal' }));
  const [mode, setMode] = useState<Mode>(saved.mode === 'pvp' ? 'pvp' : 'ai');
  const [difficulty, setDifficulty] = useState<Difficulty>(isDifficulty(saved.difficulty) ? saved.difficulty : 'normal');
  const [game, setGame] = useState<State | null>(null);
  const [wallMode, setWallMode] = useState(false);
  const [preview, setPreview] = useState<Wall | null>(null);
  const [picked, setPicked] = useState<Wall | null>(null); // a wall chosen with a finger, waiting for "Place wall"
  const [message, setMessage] = useState('');
  const [seed] = useState(() => (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0);
  const rng = useRef(createRng(seed));
  const recorded = useRef(false);

  const aiTurn = game !== null && mode === 'ai' && game.current !== HUMAN && game.winner === null;

  const commit = (state: State, m: Move) => {
    const next = apply(state, m);
    if (m.type === 'wall') sfx.mound();
    else sfx.angleTick(120 + next.pawns[state.current].r * 60);
    setGame(next);
    setPicked(null);
    setPreview(null);
    setMessage('');
    setWallMode(false);
    if (next.winner !== null && !recorded.current) {
      recorded.current = true;
      if (mode === 'pvp') store.recordResult(GAME_ID, 'played');
      else store.recordResult(GAME_ID, next.winner === HUMAN ? 'win' : 'loss');
      if (mode === 'pvp' || next.winner === HUMAN) sfx.victory();
      else sfx.defeat();
    }
  };

  useEffect(() => {
    if (!game || !aiTurn) return;
    const id = window.setTimeout(() => commit(game, chooseMove(game, difficulty, rng.current)), 550);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, aiTurn, difficulty]);

  const start = () => {
    sfx.click();
    store.saveGameSettings(GAME_ID, { mode, difficulty });
    recorded.current = false;
    setWallMode(false);
    setPreview(null);
    setPicked(null);
    setMessage('');
    setGame(newGame());
  };

  if (!game) {
    const stats = store.loadStats(GAME_ID);
    return (
      <div className="setup" data-screen="setup">
        <p className="setup-lede">Race your pawn to the far side. Or slow your rival down with walls: just never wall them in completely.</p>
        <RadioCards
          legend="Who is playing?"
          name="qd-mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'ai', title: '1 player', hint: 'You against the computer', icon: <Bot size={22} aria-hidden="true" /> },
            { value: 'pvp', title: '2 players', hint: 'Take turns on one device', icon: <Users size={22} aria-hidden="true" /> },
          ]}
        />
        {mode === 'ai' && (
          <RadioCards
            legend="How good is the computer?"
            name="qd-level"
            value={difficulty}
            onChange={setDifficulty}
            options={[
              { value: 'easy', title: 'Easy', hint: 'Looks one move ahead' },
              { value: 'normal', title: 'Normal', hint: 'Looks two moves ahead' },
              { value: 'hard', title: 'Hard', hint: 'Looks three moves ahead' },
            ]}
          />
        )}
        <button type="button" className="btn btn-primary btn-big" onClick={start} data-action="start">
          Start
        </button>
        {stats.plays > 0 && (
          <p className="setup-stats">
            Against the computer: {stats.wins} won, {stats.losses} lost.
          </p>
        )}
        <p className="armory-keys">
          On your turn, tap a highlighted square to move, or switch to <strong>Place a wall</strong> and point at the gap between squares. Walls can be placed along or across; the board decides from where you point. Pawns jump each other.
        </p>
      </div>
    );
  }

  const over = game.winner !== null;
  const canPlay = !over && !aiTurn;
  const name = (p: Player) => (mode === 'pvp' ? `Player ${p + 1}` : p === HUMAN ? 'You' : 'Computer');
  const destinations = canPlay ? pawnMoves(game) : [];
  const wallsLeft = game.wallsLeft[game.current];
  const status = over ? 'Game over' : aiTurn ? 'Computer is thinking…' : `${name(game.current)}: ${wallMode ? 'point at a gap' : 'move your pawn'}`;

  const onWallPointer = (w: Wall, pointerType: string) => {
    if (!canPlay) return;
    const problem = wallProblem(game, w);
    if (problem) {
      setMessage(WHY[problem]);
      setPicked(null);
      return;
    }
    setMessage('');
    if (pointerType === 'touch' || pointerType === 'pen') setPicked(w); // a finger covers the spot: confirm with the button
    else commit(game, { type: 'wall', wall: w });
  };

  return (
    <div className="board-wrap" data-screen="play" data-over={over ? 'yes' : 'no'} data-current={game.current} data-walls0={game.wallsLeft[0]} data-walls1={game.wallsLeft[1]} data-winner={game.winner ?? ''}>
      <div className="scorebar">
        {([0, 1] as Player[]).map((p) => (
          <div key={p} className={`score${game.current === p && !over ? ' score-active' : ''}`} style={{ '--player': COLORS[p] } as CSSProperties}>
            <span>
              <span className="score-dot" />
              {name(p)}
            </span>
            <output aria-label={`${name(p)} walls left`}>{game.wallsLeft[p]} / {WALLS_EACH} walls</output>
          </div>
        ))}
      </div>
      <p className="board-status" role="status">
        {status}
      </p>
      <Board
        state={game}
        destinations={destinations}
        onStep={(r, c) => canPlay && commit(game, { type: 'move', to: { r, c } })}
        wallMode={wallMode && canPlay}
        preview={picked ?? preview}
        setPreview={(w) => !picked && setPreview(w)}
        onWallPointer={onWallPointer}
      />
      {message && (
        <p className="mm-error" role="alert" data-error>
          {message}
        </p>
      )}
      {!over && (
        <div className="board-actions">
          <button type="button" className={`btn${!wallMode ? ' btn-primary' : ''}`} disabled={!canPlay} onClick={() => { setWallMode(false); setPicked(null); setMessage(''); }} data-action="mode-move" aria-pressed={!wallMode}>
            <Footprints size={16} aria-hidden="true" /> Move pawn
          </button>
          <button type="button" className={`btn${wallMode ? ' btn-primary' : ''}`} disabled={!canPlay || wallsLeft === 0} onClick={() => setWallMode(true)} data-action="mode-wall" aria-pressed={wallMode}>
            <Square size={16} aria-hidden="true" /> Place a wall ({wallsLeft})
          </button>
          {picked && (
            <button type="button" className="btn btn-primary" onClick={() => commit(game, { type: 'wall', wall: picked })} data-action="confirm-wall">
              Place this wall
            </button>
          )}
        </div>
      )}
      {over && (
        <div className="end-card" role="status" data-result={game.winner}>
          <h2>{mode === 'pvp' ? `Player ${(game.winner as number) + 1} wins` : game.winner === HUMAN ? 'You win!' : 'The computer wins'}</h2>
          <div className="board-actions">
            <button type="button" className="btn btn-primary" onClick={start} data-action="again" autoFocus>
              Play again
            </button>
            <button type="button" className="btn" onClick={() => setGame(null)}>
              Change settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
