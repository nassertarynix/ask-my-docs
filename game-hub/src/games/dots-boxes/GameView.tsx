import { Bot, Users } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GameProps } from '../../hub/types';
import { sfx } from '../../shared/audio';
import { RadioCards } from '../../shared/RadioCards';
import { store } from '../../shared/storage';
import { createRng } from '../crater-lab/engine/rng';
import { chooseMove, type Difficulty } from './ai';
import { edgeCount, edgeDots, isOver, newGame, play, winner, type Player, type State } from './engine';

export const GAME_ID = 'dots-boxes';
type Mode = 'ai' | 'pvp';
const COLORS = ['#FF5A4E', '#3B6CF6'] as const;
const CELL = 64;
const PAD = 26;
/** In a game against the computer, the person is always Player 1 (red). */
const HUMAN: Player = 0;

const isDifficulty = (v: string): v is Difficulty => v === 'easy' || v === 'normal' || v === 'hard';
const sizeOf = (v: string): number => (v === '3' ? 3 : v === '5' ? 5 : 4);

function Board({ state, canPlay, onEdge, hover, setHover }: { state: State; canPlay: boolean; onEdge: (edge: number) => void; hover: number | null; setHover: (e: number | null) => void }) {
  const { w, h } = state.board;
  const width = w * CELL + PAD * 2;
  const height = h * CELL + PAD * 2;
  const pos = ([r, c]: [number, number]) => ({ x: PAD + c * CELL, y: PAD + r * CELL });
  const edges = Array.from({ length: edgeCount(state.board) }, (_, e) => e);
  return (
    <svg className="db-board" viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Dots and Boxes board" data-drawn={state.drawn}>
      {Array.from(state.owners).map((owner, box) => {
        if (owner < 0) return null;
        const r = Math.floor(box / w);
        const c = box % w;
        return (
          <g key={box} data-box-owner={owner}>
            <rect x={PAD + c * CELL + 5} y={PAD + r * CELL + 5} width={CELL - 10} height={CELL - 10} rx={8} fill={COLORS[owner]} opacity={0.35} />
            <text x={PAD + c * CELL + CELL / 2} y={PAD + r * CELL + CELL / 2 + 8} textAnchor="middle" fontSize={22} fontWeight={700} fill="#18181B">
              {owner + 1}
            </text>
          </g>
        );
      })}
      {edges.map((e) => {
        const dots = edgeDots(state.board, e);
        const a = pos(dots.from);
        const b = pos(dots.to);
        const drawn = state.edges[e] === 1;
        const free = !drawn;
        return (
          <g key={e}>
            {drawn ? (
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={state.lastMove === e ? COLORS[state.lastMover ?? 0] : '#18181B'} strokeWidth={state.lastMove === e ? 8 : 6} strokeLinecap="round" data-edge-drawn={e} />
            ) : (
              <>
                {hover === e && canPlay && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={COLORS[state.current]} strokeWidth={6} strokeLinecap="round" opacity={0.55} />}
                <line
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="transparent"
                  strokeWidth={30}
                  strokeLinecap="round"
                  className={canPlay && free ? 'db-hit' : undefined}
                  data-edge={e}
                  role="button"
                  aria-label={`Draw the edge from dot ${dots.from[0]},${dots.from[1]} to dot ${dots.to[0]},${dots.to[1]}`}
                  tabIndex={canPlay ? 0 : -1}
                  onPointerEnter={() => setHover(e)}
                  onPointerLeave={() => setHover(null)}
                  onClick={() => canPlay && onEdge(e)}
                  onKeyDown={(ev) => {
                    if (canPlay && (ev.key === 'Enter' || ev.key === ' ')) {
                      ev.preventDefault();
                      onEdge(e);
                    }
                  }}
                />
              </>
            )}
          </g>
        );
      })}
      {Array.from({ length: (h + 1) * (w + 1) }, (_, i) => (
        <circle key={i} cx={PAD + (i % (w + 1)) * CELL} cy={PAD + Math.floor(i / (w + 1)) * CELL} r={6} fill="#18181B" pointerEvents="none" />
      ))}
    </svg>
  );
}

export default function GameView(_props: GameProps) {
  const [saved] = useState(() => store.loadGameSettings(GAME_ID, { mode: 'ai', difficulty: 'normal', size: '4' }));
  const [mode, setMode] = useState<Mode>(saved.mode === 'pvp' ? 'pvp' : 'ai');
  const [difficulty, setDifficulty] = useState<Difficulty>(isDifficulty(saved.difficulty) ? saved.difficulty : 'normal');
  const [size, setSize] = useState<string>(String(sizeOf(saved.size)));
  const [game, setGame] = useState<State | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [seed] = useState(() => (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0);
  const rng = useRef(createRng(seed));
  const recorded = useRef(false);

  const aiTurn = game !== null && mode === 'ai' && game.current !== HUMAN && !isOver(game);

  const move = (state: State, edge: number) => {
    const { state: next, completed } = play(state, edge);
    if (completed.length > 0) sfx.mound();
    else sfx.angleTick(80 + (next.drawn % 12) * 25);
    setGame(next);
    if (isOver(next) && !recorded.current) {
      recorded.current = true;
      const w = winner(next);
      if (mode === 'pvp') store.recordResult(GAME_ID, 'played');
      else store.recordResult(GAME_ID, w === 'draw' ? 'draw' : w === HUMAN ? 'win' : 'loss');
      if (w === HUMAN || mode === 'pvp') sfx.victory();
      else if (w !== 'draw') sfx.defeat();
    }
  };

  useEffect(() => {
    if (!game || !aiTurn) return;
    const id = window.setTimeout(() => move(game, chooseMove(game, difficulty, rng.current)), 520);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, aiTurn, difficulty]);

  const start = () => {
    sfx.click();
    store.saveGameSettings(GAME_ID, { mode, difficulty, size });
    const n = sizeOf(size);
    recorded.current = false;
    setHover(null);
    setGame(newGame({ w: n, h: n }));
  };

  if (!game) {
    const stats = store.loadStats(GAME_ID);
    return (
      <div className="setup" data-screen="setup">
        <p className="setup-lede">Draw lines between dots. Close the fourth side of a box and it is yours, and you go again.</p>
        <RadioCards
          legend="Who is playing?"
          name="db-mode"
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
            name="db-level"
            value={difficulty}
            onChange={setDifficulty}
            options={[
              { value: 'easy', title: 'Easy', hint: 'Plays mostly at random' },
              { value: 'normal', title: 'Normal', hint: 'Takes boxes, avoids gifts' },
              { value: 'hard', title: 'Hard', hint: 'Solves the end of the game exactly' },
            ]}
          />
        )}
        <RadioCards
          legend="Board size"
          name="db-size"
          value={size}
          onChange={setSize}
          options={[
            { value: '3', title: '3 × 3', hint: 'Quick' },
            { value: '4', title: '4 × 4', hint: 'Medium' },
            { value: '5', title: '5 × 5', hint: 'The long one' },
          ]}
        />
        <button type="button" className="btn btn-primary btn-big" onClick={start} data-action="start">
          Start
        </button>
        {stats.plays > 0 && (
          <p className="setup-stats">
            Against the computer: {stats.wins} won, {stats.losses} lost{stats.draws ? `, ${stats.draws} drawn` : ''}.
          </p>
        )}
      </div>
    );
  }

  const over = isOver(game);
  const w = winner(game);
  const name = (p: Player) => (mode === 'pvp' ? `Player ${p + 1}` : p === HUMAN ? 'You' : 'Computer');
  const status = over ? 'Game over' : aiTurn ? 'Computer is thinking…' : `${name(game.current)}${mode === 'pvp' ? ': your move' : ': your move'}`;

  return (
    <div className="board-wrap" data-screen="play" data-over={over ? 'yes' : 'no'} data-current={game.current} data-score0={game.scores[0]} data-score1={game.scores[1]} data-drawn={game.drawn}>
      <div className="scorebar">
        {([0, 1] as Player[]).map((p) => (
          <div key={p} className={`score${game.current === p && !over ? ' score-active' : ''}`} style={{ '--player': COLORS[p] } as CSSProperties}>
            <span>
              <span className="score-dot" />
              {name(p)}
            </span>
            <output aria-label={`${name(p)} boxes`}>{game.scores[p]}</output>
          </div>
        ))}
      </div>
      <p className="board-status" role="status">
        {status}
      </p>
      <Board state={game} canPlay={!over && !aiTurn} onEdge={(e) => move(game, e)} hover={hover} setHover={setHover} />
      {over && (
        <div className="end-card" role="status" data-result={w}>
          <h2>{w === 'draw' ? 'A draw' : mode === 'pvp' ? `Player ${(w as number) + 1} wins` : w === HUMAN ? 'You win!' : 'The computer wins'}</h2>
          <p>
            {game.scores[0]} : {game.scores[1]}
          </p>
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
