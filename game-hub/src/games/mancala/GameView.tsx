import { Bot, Users } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GameProps } from '../../hub/types';
import { sfx } from '../../shared/audio';
import { RadioCards } from '../../shared/RadioCards';
import { store } from '../../shared/storage';
import { createRng } from '../crater-lab/engine/rng';
import { chooseMove, type Difficulty } from './ai';
import { PITS_PER_SIDE, STORE, legalMoves, move, newGame, pitOf, score, winner, type MoveResult, type Player, type State } from './engine';

export const GAME_ID = 'mancala';
type Mode = 'ai' | 'pvp';
const COLORS = ['#FF5A4E', '#3B6CF6'] as const;
const HUMAN: Player = 0;
const STEP_MS = 140;
const isDifficulty = (v: string): v is Difficulty => v === 'easy' || v === 'normal' || v === 'hard';

interface Animation {
  result: MoveResult;
  mover: Player;
  step: number;
  pits: number[];
}

function Stones({ count }: { count: number }) {
  return (
    <span className="mc-stones" aria-hidden="true">
      {Array.from({ length: Math.min(count, 18) }, (_, i) => (
        <span key={i} className="mc-stone" style={{ '--i': i } as CSSProperties} />
      ))}
    </span>
  );
}

export default function GameView(_props: GameProps) {
  const [saved] = useState(() => store.loadGameSettings(GAME_ID, { mode: 'ai', difficulty: 'normal' }));
  const [mode, setMode] = useState<Mode>(saved.mode === 'pvp' ? 'pvp' : 'ai');
  const [difficulty, setDifficulty] = useState<Difficulty>(isDifficulty(saved.difficulty) ? saved.difficulty : 'normal');
  const [game, setGame] = useState<State | null>(null);
  const [anim, setAnim] = useState<Animation | null>(null);
  const [note, setNote] = useState('');
  const [seed] = useState(() => (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0);
  const rng = useRef(createRng(seed));
  const recorded = useRef(false);

  const aiTurn = game !== null && mode === 'ai' && game.current !== HUMAN && !game.over;
  const busy = anim !== null;

  const play = (state: State, n: number) => {
    const result = move(state, n);
    const pits = state.pits.slice();
    pits[pitOf(state.current, n)] = 0;
    setNote('');
    setAnim({ result, mover: state.current, step: 0, pits });
  };

  // play out the sowing one stone at a time, then settle on the real result
  useEffect(() => {
    if (!anim) return;
    const { result, step } = anim;
    if (step < result.path.length) {
      const id = window.setTimeout(() => {
        const pit = result.path[step] as number;
        const pits = anim.pits.slice();
        pits[pit] = (pits[pit] ?? 0) + 1;
        sfx.angleTick(60 + (pit % 7) * 70);
        setAnim({ ...anim, step: step + 1, pits });
      }, STEP_MS);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => {
      const next = result.state;
      setGame(next);
      setAnim(null);
      if (result.captured > 0) {
        sfx.explosion(20);
        setNote(`Captured ${result.captured}!`);
      } else if (result.extraTurn) {
        sfx.turn();
        setNote('Another turn!');
      }
      if (next.over && !recorded.current) {
        recorded.current = true;
        const w = winner(next);
        if (mode === 'pvp') store.recordResult(GAME_ID, 'played');
        else store.recordResult(GAME_ID, w === 'draw' ? 'draw' : w === HUMAN ? 'win' : 'loss');
        if (mode === 'pvp' || w === HUMAN) sfx.victory();
        else if (w !== 'draw') sfx.defeat();
      }
    }, 320);
    return () => window.clearTimeout(id);
  }, [anim, mode]);

  // the computer's turn
  useEffect(() => {
    if (!game || !aiTurn || busy) return;
    const id = window.setTimeout(() => play(game, chooseMove(game, difficulty, rng.current)), 650);
    return () => window.clearTimeout(id);
  }, [game, aiTurn, busy, difficulty]);

  const start = () => {
    sfx.click();
    store.saveGameSettings(GAME_ID, { mode, difficulty });
    recorded.current = false;
    setNote('');
    setAnim(null);
    setGame(newGame());
  };

  if (!game) {
    const stats = store.loadStats(GAME_ID);
    return (
      <div className="setup" data-screen="setup">
        <p className="setup-lede">Sow stones round the board. Land in your store for another turn, or in an empty pit to capture what is opposite.</p>
        <RadioCards
          legend="Who is playing?"
          name="mc-mode"
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
            name="mc-level"
            value={difficulty}
            onChange={setDifficulty}
            options={[
              { value: 'easy', title: 'Easy', hint: 'Looks one move ahead' },
              { value: 'normal', title: 'Normal', hint: 'Looks four moves ahead' },
              { value: 'hard', title: 'Hard', hint: 'Looks ten moves ahead' },
            ]}
          />
        )}
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

  const pits = anim ? anim.pits : game.pits;
  const moves = legalMoves(game);
  const name = (p: Player) => (mode === 'pvp' ? `Player ${p + 1}` : p === HUMAN ? 'You' : 'Computer');
  const w = winner(game);
  const status = game.over ? 'Game over' : busy ? 'Sowing…' : aiTurn ? 'Computer is thinking…' : `${name(game.current)}: pick a pit`;
  const canPlay = !game.over && !busy && !aiTurn;

  const pit = (index: number, owner: Player, n: number) => {
    const count = pits[index] ?? 0;
    const playable = canPlay && game.current === owner && moves.includes(n);
    return (
      <button
        key={index}
        type="button"
        className={`mc-pit${playable ? ' mc-pit-playable' : ''}${anim && anim.result.path[anim.step - 1] === index ? ' mc-pit-hit' : ''}`}
        style={{ '--player': COLORS[owner] } as CSSProperties}
        disabled={!playable}
        data-pit={index}
        data-count={count}
        aria-label={`${name(owner)}, pit ${n + 1}: ${count} stone${count === 1 ? '' : 's'}`}
        onClick={() => play(game, n)}
      >
        <Stones count={count} />
        <span className="mc-count">{count}</span>
      </button>
    );
  };

  return (
    <div className="board-wrap" data-screen="play" data-over={game.over ? 'yes' : 'no'} data-current={game.current} data-score0={score(game, 0)} data-score1={score(game, 1)} data-busy={busy ? 'yes' : 'no'}>
      <div className="scorebar">
        {([0, 1] as Player[]).map((p) => (
          <div key={p} className={`score${game.current === p && !game.over ? ' score-active' : ''}`} style={{ '--player': COLORS[p] } as CSSProperties}>
            <span>
              <span className="score-dot" />
              {name(p)}
            </span>
            <output aria-label={`${name(p)} store`}>{pits[STORE[p]] ?? 0}</output>
          </div>
        ))}
      </div>
      <p className="board-status" role="status">
        {status}
        {note && <span className="mc-note"> · {note}</span>}
      </p>
      <div className="mc-board" role="group" aria-label="Mancala board">
        <div className="mc-store mc-store-1" style={{ '--player': COLORS[1] } as CSSProperties} data-store="1">
          <Stones count={pits[STORE[1]] ?? 0} />
          <span className="mc-count">{pits[STORE[1]] ?? 0}</span>
        </div>
        <div className="mc-row mc-row-top">{Array.from({ length: PITS_PER_SIDE }, (_, k) => pit(pitOf(1, PITS_PER_SIDE - 1 - k), 1, PITS_PER_SIDE - 1 - k))}</div>
        <div className="mc-row mc-row-bottom">{Array.from({ length: PITS_PER_SIDE }, (_, k) => pit(pitOf(0, k), 0, k))}</div>
        <div className="mc-store mc-store-0" style={{ '--player': COLORS[0] } as CSSProperties} data-store="0">
          <Stones count={pits[STORE[0]] ?? 0} />
          <span className="mc-count">{pits[STORE[0]] ?? 0}</span>
        </div>
      </div>
      {game.over && (
        <div className="end-card" role="status" data-result={w}>
          <h2>{w === 'draw' ? 'A draw' : mode === 'pvp' ? `Player ${(w as number) + 1} wins` : w === HUMAN ? 'You win!' : 'The computer wins'}</h2>
          <p>
            {score(game, 0)} : {score(game, 1)}
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
