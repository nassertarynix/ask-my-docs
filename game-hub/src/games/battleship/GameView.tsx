import { Bot, Dices, RotateCw, Trash2, Users } from 'lucide-react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GameProps } from '../../hub/types';
import { sfx } from '../../shared/audio';
import { Curtain } from '../../shared/Curtain';
import { RadioCards } from '../../shared/RadioCards';
import { store } from '../../shared/storage';
import { createRng } from '../crater-lab/engine/rng';
import { chooseShot, type Difficulty } from './ai';
import { CELLS, FLEET, SIZE, colOf, fits, isSunk, newBoard, randomFleet, rowOf, shipAt, shipCells, shoot, sunkShips, type Board, type Ship } from './engine';

export const GAME_ID = 'battleship';
type Mode = 'ai' | 'pvp';
const COLORS = ['#FF5A4E', '#3B6CF6'] as const;
const LETTERS = 'ABCDEFGHIJ';
const isDifficulty = (v: string): v is Difficulty => v === 'easy' || v === 'normal' || v === 'hard';
const squareName = (i: number): string => `${LETTERS[colOf(i)]}${rowOf(i) + 1}`;
const typeName = (id: string): string => FLEET.find((t) => t.id === id)?.name ?? id;

type CellState = 'water' | 'miss' | 'hit' | 'ship' | 'sunk';

/** A 10 x 10 grid. `showShips` draws ships that are not yet hit (your own fleet, or everything when the game is over). */
function Grid({ board, showShips, onCell, size, label, ghost, ghostBad }: { board: Board | null; showShips: boolean; onCell?: (i: number) => void; size: 'big' | 'small'; label: string; ghost?: number[]; ghostBad?: boolean }) {
  const state = (i: number): CellState => {
    if (!board) return 'water';
    const shot = board.shots[i];
    const ship = shipAt(board, i);
    if (shot === 2) return ship && isSunk(board, ship) ? 'sunk' : 'hit';
    if (shot === 1) return 'miss';
    return ship && showShips ? 'ship' : 'water';
  };
  return (
    <div className={`bs-grid bs-${size}`} role="group" aria-label={label}>
      <span className="bs-corner" />
      {Array.from({ length: SIZE }, (_, c) => (
        <span key={`h${c}`} className="bs-label">
          {LETTERS[c]}
        </span>
      ))}
      {Array.from({ length: SIZE }, (_, r) => (
        <div key={r} style={{ display: 'contents' }}>
          <span className="bs-label">{r + 1}</span>
          {Array.from({ length: SIZE }, (_, c) => {
            const i = r * SIZE + c;
            const s = state(i);
            const inGhost = ghost?.includes(i);
            const cls = `bs-cell bs-${s}${inGhost ? (ghostBad ? ' bs-ghost-bad' : ' bs-ghost') : ''}`;
            const mark = s === 'hit' || s === 'sunk' ? '✕' : s === 'miss' ? '•' : '';
            return onCell ? (
              <button key={c} type="button" className={cls} data-cell={i} data-state={s} aria-label={`${squareName(i)}: ${s === 'water' ? 'unknown' : s}`} onClick={() => onCell(i)}>
                {mark}
              </button>
            ) : (
              <span key={c} className={cls} data-cell={i} data-state={s} role="img" aria-label={`${squareName(i)}: ${s}`}>
                {mark}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** Placing a fleet: pick a spot for each ship in turn, rotate, shuffle, or pick a ship up to move it. */
function Placement({ player, title, onReady }: { player: number; title: string; onReady: (ships: Ship[]) => void }) {
  const [ships, setShips] = useState<Ship[]>([]);
  const [horizontal, setHorizontal] = useState(true);
  const [hover, setHover] = useState<number | null>(null);
  const [seed] = useState(() => (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0);
  const rng = useRef(createRng(seed));
  const next = FLEET.find((t) => !ships.some((s) => s.id === t.id));

  const preview = next && hover !== null ? shipCells(next.size, rowOf(hover), colOf(hover), horizontal) : null;
  // a ship that does not fit is shown running off the edge in red, clipped to the grid
  const ghostCells = next && hover !== null ? Array.from({ length: next.size }, (_, k) => (horizontal ? rowOf(hover) * SIZE + colOf(hover) + k : hover + k * SIZE)).filter((i) => i < CELLS && (!horizontal || rowOf(i) === rowOf(hover))) : [];
  const ghostBad = !preview || !fits(ships, preview);

  const click = (i: number) => {
    const existing = ships.find((s) => s.cells.includes(i));
    if (existing) {
      setShips(ships.filter((s) => s !== existing)); // pick it up again
      sfx.angleTick(160);
      return;
    }
    // work from the square that was tapped, not from the hover preview: a finger leaves no hover behind
    const cells = next ? shipCells(next.size, rowOf(i), colOf(i), horizontal) : null;
    if (!next || !cells || !fits(ships, cells)) {
      sfx.hit();
      return;
    }
    setShips([...ships, { id: next.id, size: next.size, cells }]);
    sfx.mound();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'r') {
        setHorizontal((h) => !h);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // show placed ships using a board with no shots
  const board: Board = { ships, shots: new Uint8Array(CELLS) };

  return (
    <div className="bs-place" data-screen="place" data-player={player} data-placed={ships.length} onPointerLeave={() => setHover(null)}>
      <p className="board-status">{title}</p>
      <div onPointerMove={(e) => {
        const el = (e.target as HTMLElement).closest('[data-cell]');
        setHover(el ? Number(el.getAttribute('data-cell')) : null);
      }}>
        <Grid board={board} showShips size="big" label="Your fleet" onCell={click} ghost={ghostCells} ghostBad={ghostBad} />
      </div>
      <ul className="bs-fleet" aria-label="Ships to place">
        {FLEET.map((t) => {
          const placed = ships.some((s) => s.id === t.id);
          return (
            <li key={t.id} className={`${placed ? 'bs-placed' : ''}${next?.id === t.id ? ' bs-next' : ''}`}>
              {t.name} <small>{t.size}</small>
              <span className="bs-pips" aria-hidden="true">
                {Array.from({ length: t.size }, (_, k) => (
                  <i key={k} />
                ))}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="board-actions">
        <button type="button" className="btn" onClick={() => setHorizontal(!horizontal)} data-action="rotate">
          <RotateCw size={16} aria-hidden="true" /> {horizontal ? 'Across' : 'Down'} (R)
        </button>
        <button type="button" className="btn" onClick={() => setShips(randomFleet(rng.current))} data-action="random">
          <Dices size={16} aria-hidden="true" /> Shuffle
        </button>
        <button type="button" className="btn" onClick={() => setShips([])} disabled={ships.length === 0} data-action="clear">
          <Trash2 size={16} aria-hidden="true" /> Clear
        </button>
        <button type="button" className="btn btn-primary" onClick={() => onReady(ships)} disabled={ships.length !== FLEET.length} data-action="ready">
          Ready
        </button>
      </div>
      <p className="armory-keys">Tap a square to place the next ship there. Tap a placed ship to pick it up. Ships may touch but not overlap.</p>
    </div>
  );
}

export default function GameView(_props: GameProps) {
  const [saved] = useState(() => store.loadGameSettings(GAME_ID, { mode: 'ai', difficulty: 'normal' }));
  const [mode, setMode] = useState<Mode>(saved.mode === 'pvp' ? 'pvp' : 'ai');
  const [difficulty, setDifficulty] = useState<Difficulty>(isDifficulty(saved.difficulty) ? saved.difficulty : 'normal');
  const [screen, setScreen] = useState<'menu' | 'place' | 'turn' | 'over'>('menu');
  const [placing, setPlacing] = useState(0); // who is placing a fleet
  const [curtain, setCurtain] = useState(false);
  const [fleets, setFleets] = useState<[Ship[] | null, Ship[] | null]>([null, null]);
  const [boards, setBoards] = useState<[Board, Board] | null>(null); // boards[p] is player p's own fleet, with the shots it has received
  const [current, setCurrent] = useState(0);
  const [fired, setFired] = useState(false);
  const [message, setMessage] = useState('');
  const [winner, setWinner] = useState<number | null>(null);
  const [seed] = useState(() => (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0);
  const rng = useRef(createRng(seed ^ 0x51ed));
  const recorded = useRef(false);

  const name = (p: number) => (mode === 'pvp' ? `Player ${p + 1}` : p === 0 ? 'You' : 'The computer');

  const begin = () => {
    sfx.click();
    store.saveGameSettings(GAME_ID, { mode, difficulty });
    recorded.current = false;
    setFleets([null, null]);
    setBoards(null);
    setCurrent(0);
    setFired(false);
    setMessage('');
    setWinner(null);
    setPlacing(0);
    setCurtain(mode === 'pvp');
    setScreen('place');
  };

  const fleetReady = (ships: Ship[]) => {
    sfx.click();
    if (mode === 'ai') {
      setBoards([newBoard(ships), newBoard(randomFleet(createRng(seed ^ 0xbeef)))]);
      setScreen('turn');
      setMessage('Your turn: fire at the enemy grid.');
      return;
    }
    if (placing === 0) {
      setFleets([ships, null]);
      setPlacing(1);
      setCurtain(true);
    } else {
      setBoards([newBoard(fleets[0] as Ship[]), newBoard(ships)]);
      setCurrent(0);
      setCurtain(true);
      setScreen('turn');
      setMessage('Fire at the enemy grid.');
    }
  };

  const finish = (w: number) => {
    setWinner(w);
    setScreen('over');
    if (!recorded.current) {
      recorded.current = true;
      if (mode === 'pvp') store.recordResult(GAME_ID, 'played');
      else store.recordResult(GAME_ID, w === 0 ? 'win' : 'loss');
    }
    if (mode === 'pvp' || w === 0) sfx.victory();
    else sfx.defeat();
  };

  const fire = (i: number) => {
    if (!boards || fired || screen !== 'turn') return;
    if (mode === 'ai' && current !== 0) return;
    const target = current === 0 ? 1 : 0;
    const tb = boards[target];
    if (tb.shots[i]) return;
    const result = shoot(tb, i);
    const next: [Board, Board] = [boards[0], boards[1]];
    next[target] = result.board;
    setBoards(next);
    setFired(true);
    if (result.sunk) {
      sfx.explosion(60);
      setMessage(`${squareName(i)}: hit! You sank their ${typeName(result.sunk.id)}.`);
    } else if (result.hit) {
      sfx.explosion(25);
      setMessage(`${squareName(i)}: hit!`);
    } else {
      sfx.angleTick(140);
      setMessage(`${squareName(i)}: miss.`);
    }
    if (result.won) {
      finish(current);
      return;
    }
    if (mode === 'ai') window.setTimeout(() => setFired(false), 0); // the computer answers in the effect below
  };

  // the computer's shot
  const aiBoards = boards;
  useEffect(() => {
    if (mode !== 'ai' || screen !== 'turn' || !aiBoards || !fired) return;
    const id = window.setTimeout(() => {
      const mine = aiBoards[0];
      const shot = chooseShot({ shots: mine.shots, sunk: sunkShips(mine) }, difficulty, rng.current);
      const result = shoot(mine, shot);
      setBoards([result.board, aiBoards[1]]);
      setFired(false);
      if (result.won) {
        finish(1);
        return;
      }
      sfx.hit();
      setMessage(`The computer fired at ${squareName(shot)}: ${result.sunk ? `it sank your ${typeName(result.sunk.id)}!` : result.hit ? 'a hit!' : 'a miss.'} Your turn.`);
    }, 800);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fired, screen, mode]);

  const endTurn = () => {
    sfx.click();
    setCurrent(current === 0 ? 1 : 0);
    setFired(false);
    setCurtain(true);
    setMessage('Fire at the enemy grid.');
  };

  const stats = store.loadStats(GAME_ID);

  if (screen === 'menu') {
    return (
      <div className="setup" data-screen="setup">
        <p className="setup-lede">Hide your fleet, then hunt theirs. Sink all five ships first.</p>
        <RadioCards
          legend="Who is playing?"
          name="bs-mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'ai', title: '1 player', hint: 'You against the computer', icon: <Bot size={22} aria-hidden="true" /> },
            { value: 'pvp', title: '2 players', hint: 'Pass the device; a curtain hides each fleet', icon: <Users size={22} aria-hidden="true" /> },
          ]}
        />
        {mode === 'ai' && (
          <RadioCards
            legend="How good is the computer?"
            name="bs-level"
            value={difficulty}
            onChange={setDifficulty}
            options={[
              { value: 'easy', title: 'Easy', hint: 'Fires at random' },
              { value: 'normal', title: 'Normal', hint: 'Hunts, then follows up hits' },
              { value: 'hard', title: 'Hard', hint: 'Works out the likeliest square' },
            ]}
          />
        )}
        <button type="button" className="btn btn-primary btn-big" onClick={begin} data-action="start">
          Start
        </button>
        {stats.plays > 0 && (
          <p className="setup-stats">
            Against the computer: {stats.wins} won, {stats.losses} lost.
          </p>
        )}
      </div>
    );
  }

  if (screen === 'place') {
    return (
      <Curtain hidden={curtain} player={`Player ${placing + 1}`} message="Place your fleet. The other player must not look." onReveal={() => setCurtain(false)}>
        <Placement key={placing} player={placing} title={mode === 'pvp' ? `Player ${placing + 1}: place your fleet` : 'Place your fleet'} onReady={fleetReady} />
      </Curtain>
    );
  }

  if (!boards) return null;
  const me = current;
  const over = screen === 'over';
  const shownMe: 0 | 1 = mode === 'ai' ? 0 : me === 0 ? 0 : 1;
  const shownEnemy: 0 | 1 = shownMe === 0 ? 1 : 0;

  return (
    <Curtain hidden={curtain && mode === 'pvp' && !over} player={`Player ${me + 1}`} message="Your turn to fire. Make sure only you are looking." onReveal={() => setCurtain(false)}>
      <div className="board-wrap bs-wrap" data-screen="play" data-over={over ? 'yes' : 'no'} data-current={me} data-fired={fired ? 'yes' : 'no'} data-winner={winner ?? ''} data-enemy-sunk={sunkShips(boards[shownEnemy]).length} data-my-sunk={sunkShips(boards[shownMe]).length}>
        <div className="scorebar">
          {([0, 1] as const).map((p) => (
            <div key={p} className={`score${me === p && !over ? ' score-active' : ''}`} style={{ '--player': COLORS[p] } as CSSProperties}>
              <span>
                <span className="score-dot" />
                {name(p)}
              </span>
              <output aria-label={`${name(p)} ships afloat`}>{FLEET.length - sunkShips(boards[p]).length} afloat</output>
            </div>
          ))}
        </div>
        <p className="board-status" role="status">
          {over ? (winner === 0 && mode === 'ai' ? 'You win!' : mode === 'ai' ? 'The computer wins.' : `Player ${(winner ?? 0) + 1} wins!`) : message}
        </p>
        <div className="bs-boards">
          <div>
            <h2 className="bs-title">{over || mode === 'pvp' ? `${name(shownEnemy)}'s waters` : 'Enemy waters'}</h2>
            <Grid board={boards[shownEnemy]} showShips={over} size="big" label="Enemy waters" onCell={!over && !fired && !(mode === 'ai' && current !== 0) ? fire : undefined} />
          </div>
          <div>
            <h2 className="bs-title">Your fleet</h2>
            <Grid board={boards[shownMe]} showShips size="small" label="Your fleet" />
          </div>
        </div>
        {!over && mode === 'pvp' && fired && (
          <div className="board-actions">
            <button type="button" className="btn btn-primary" onClick={endTurn} data-action="end-turn" autoFocus>
              End turn: pass the device
            </button>
          </div>
        )}
        {over && (
          <div className="end-card" role="status" data-result={winner}>
            <h2>{mode === 'ai' ? (winner === 0 ? 'Victory!' : 'Defeat') : `Player ${(winner ?? 0) + 1} wins`}</h2>
            <p>Both fleets are shown above.</p>
            <div className="board-actions">
              <button type="button" className="btn btn-primary" onClick={begin} data-action="again" autoFocus>
                Play again
              </button>
              <button type="button" className="btn" onClick={() => setScreen('menu')}>
                Change settings
              </button>
            </div>
          </div>
        )}
      </div>
    </Curtain>
  );
}
