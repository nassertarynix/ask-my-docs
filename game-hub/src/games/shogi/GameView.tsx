import { ArrowUpDown, Bot, Flag, Undo2, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameProps } from '../../hub/types';
import { sfx } from '../../shared/audio';
import { RadioCards } from '../../shared/RadioCards';
import { store } from '../../shared/storage';
import { createRng, nextRandom } from '../crater-lab/engine/rng';
import { chooseMove, type Difficulty } from './ai';
import { CODE, HAND_KINDS, START_SFEN, isDrop, kindOf, moveFrom, moveTo, movePromotes, ownerOf, parseSfen, replay, sqName, type Kind, type Move, type Side } from './engine';
import { Tile, nameOfCode, NAMES, type Labels } from './Pieces';

export const GAME_ID = 'shogi';
type Mode = 'ai' | 'pvp';
const isDifficulty = (v: string): v is Difficulty => v === 'easy' || v === 'normal' || v === 'hard';
const isLabels = (v: string): v is Labels => v === 'kanji' || v === 'letters';
const SIDE_NAME = ['Sente', 'Gote'] as const;
/** Pause before the computer moves, so its reply is not instant and the board can repaint first. */
const THINK_DELAY_MS = 350;

type Selection = { kind: 'square'; sq: number } | { kind: 'hand'; piece: Kind } | null;

/** `?sfen=` starts from a given position (for tests and puzzles); anything unreadable falls back to the usual start. */
function startFromUrl(): string {
  const raw = new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('sfen');
  if (!raw) return START_SFEN;
  try {
    parseSfen(raw);
    return raw;
  } catch {
    return START_SFEN;
  }
}

export default function GameView(_props: GameProps) {
  const [saved] = useState(() => store.loadGameSettings(GAME_ID, { mode: 'ai', difficulty: 'normal', side: '0', labels: 'kanji' }));
  const [mode, setMode] = useState<Mode>(saved.mode === 'pvp' ? 'pvp' : 'ai');
  const [difficulty, setDifficulty] = useState<Difficulty>(isDifficulty(saved.difficulty) ? saved.difficulty : 'normal');
  const [human, setHuman] = useState<'0' | '1'>(saved.side === '1' ? '1' : '0');
  const [labels, setLabels] = useState<Labels>(isLabels(saved.labels) ? saved.labels : 'kanji');
  const [moves, setMoves] = useState<Move[] | null>(null);
  const [selected, setSelected] = useState<Selection>(null);
  const [choosing, setChoosing] = useState<{ promote: Move; plain: Move } | null>(null);
  const [resigned, setResigned] = useState<Side | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [seed] = useState(() => (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0);
  const rng = useRef(createRng(seed));
  const recorded = useRef(false);
  const [sfen] = useState(startFromUrl);

  const side: Side = human === '1' ? 1 : 0; // the human's side against the computer
  const rp = useMemo(() => (moves ? replay(moves, sfen) : null), [moves, sfen]);
  const legal = useMemo(() => (rp ? rp.pos.legalMoves() : []), [rp]);
  const result = rp?.result ?? null;
  const over = resigned !== null || (result !== null && result.kind !== 'ongoing');
  const turn: Side = rp ? rp.pos.turn : 0;
  const aiTurn = rp !== null && mode === 'ai' && !over && turn !== side;

  // the computer's move: computed after a short pause, so "thinking" shows first (the search blocks the page for up to ~2.5 s on hard)
  useEffect(() => {
    if (!moves || !aiTurn) return;
    const id = window.setTimeout(() => {
      const choice = chooseMove(moves, difficulty, rng.current, {}, sfen);
      const before = replay(moves, sfen).pos;
      if (!isDrop(choice.move) && before.board[moveTo(choice.move)] !== 0) sfx.explosion(8);
      else sfx.angleTick(300 + Math.floor(nextRandom(rng.current) * 200));
      setMoves([...moves, choice.move]);
    }, THINK_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [moves, aiTurn, difficulty, sfen]);

  // record the result once per game
  useEffect(() => {
    if (!over || recorded.current) return;
    recorded.current = true;
    if (mode === 'pvp') {
      store.recordResult(GAME_ID, 'played');
      sfx.victory();
      return;
    }
    const winner: Side | null = resigned !== null ? ((1 - resigned) as Side) : result && (result.kind === 'mate' || result.kind === 'perpetual') ? result.winner : null;
    if (winner === null) store.recordResult(GAME_ID, 'draw');
    else if (winner === side) {
      store.recordResult(GAME_ID, 'win');
      sfx.victory();
    } else {
      store.recordResult(GAME_ID, 'loss');
      sfx.defeat();
    }
  }, [over, mode, side, resigned, result]);

  const start = () => {
    sfx.click();
    store.saveGameSettings(GAME_ID, { mode, difficulty, side: human, labels });
    recorded.current = false;
    setSelected(null);
    setChoosing(null);
    setResigned(null);
    setFlipped(false);
    setMoves([]);
  };

  if (!moves || !rp || !result) {
    const stats = store.loadStats(GAME_ID);
    return (
      <div className="setup" data-screen="setup">
        <p className="setup-lede">
          Japanese chess. Checkmate the other king. Pieces you capture join your hand, and on your turn you may drop one on any empty square instead of
          moving. In the far three ranks, pieces may promote.
        </p>
        <RadioCards
          legend="Who is playing?"
          name="sg-mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'ai', title: '1 player', hint: 'You against the computer', icon: <Bot size={22} aria-hidden="true" /> },
            { value: 'pvp', title: '2 players', hint: 'Take turns on one device', icon: <Users size={22} aria-hidden="true" /> },
          ]}
        />
        {mode === 'ai' && (
          <>
            <RadioCards
              legend="Which side do you play?"
              name="sg-side"
              value={human}
              onChange={setHuman}
              options={[
                { value: '0', title: 'Sente', hint: 'You move first' },
                { value: '1', title: 'Gote', hint: 'The computer moves first' },
              ]}
            />
            <RadioCards
              legend="How good is the computer?"
              name="sg-level"
              value={difficulty}
              onChange={setDifficulty}
              options={[
                { value: 'easy', title: 'Easy', hint: 'Looks one move ahead and makes slips' },
                { value: 'normal', title: 'Normal', hint: 'Looks about three moves ahead' },
                { value: 'hard', title: 'Hard', hint: 'Thinks for up to two and a half seconds a move' },
              ]}
            />
          </>
        )}
        <RadioCards
          legend="Piece labels"
          name="sg-labels"
          value={labels}
          onChange={setLabels}
          options={[
            { value: 'kanji', title: 'Kanji', hint: '王 飛 角 金 銀 桂 香 歩' },
            { value: 'letters', title: 'Letters', hint: 'K R B G S N L P' },
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

  const pos = rp.pos;
  const home: Side = mode === 'ai' ? side : 0; // whose pieces start at the bottom
  const bottom: Side = flipped ? ((1 - home) as Side) : home;
  const order = Array.from({ length: 81 }, (_, i) => i);
  if (bottom === 1) order.reverse(); // seen from gote the board is turned half round
  const last = rp.plies[rp.plies.length - 1];
  const canPlay = !over && !aiTurn && choosing === null;
  const name = (s: Side) => (mode === 'pvp' ? SIDE_NAME[s] : s === side ? 'You' : 'Computer');

  const targetMoves = (() => {
    if (!selected) return [] as Move[];
    if (selected.kind === 'hand') return legal.filter((m) => isDrop(m) && m >> 15 === CODE[selected.piece]);
    return legal.filter((m) => !isDrop(m) && moveFrom(m) === selected.sq);
  })();
  const targetSquares = new Set(targetMoves.map(moveTo));
  const checkedKing = result.kind === 'ongoing' && result.check ? pos.kings[turn] : -1;

  const commit = (m: Move) => {
    if (!isDrop(m) && pos.board[moveTo(m)] !== 0) sfx.explosion(8);
    else sfx.angleTick(300 + (moveTo(m) % 9) * 40);
    setMoves([...moves, m]);
    setSelected(null);
    setChoosing(null);
  };

  const press = (sq: number) => {
    if (!canPlay) return;
    if (selected && targetSquares.has(sq)) {
      const here = targetMoves.filter((m) => moveTo(m) === sq);
      const promote = here.find((m) => movePromotes(m));
      const plain = here.find((m) => !movePromotes(m));
      if (promote !== undefined && plain !== undefined) setChoosing({ promote, plain }); // promotion is optional here: ask
      else commit(here[0] as Move);
      return;
    }
    const p = pos.board[sq] as number;
    if (p !== 0 && ownerOf(p) === turn) setSelected(selected?.kind === 'square' && selected.sq === sq ? null : { kind: 'square', sq });
    else setSelected(null);
  };

  const pickHand = (piece: Kind) => {
    if (!canPlay) return;
    setSelected(selected?.kind === 'hand' && selected.piece === piece ? null : { kind: 'hand', piece });
  };

  const undoFloor = mode === 'ai' && side === 1 ? 1 : 0; // the computer's opening move cannot be taken back
  const canUndo = !aiTurn && !over && moves.length > undoFloor;
  const undo = () => {
    const cut = mode === 'ai' && turn === side ? 2 : 1;
    sfx.click();
    setSelected(null);
    setChoosing(null);
    setMoves(moves.slice(0, Math.max(undoFloor, moves.length - cut)));
  };

  const status = over
    ? 'Game over'
    : aiTurn
      ? 'Computer is thinking…'
      : `${name(turn)}${mode === 'pvp' ? ' to move' : ': your move'}${result.kind === 'ongoing' && result.check ? ' · Check!' : ''}`;

  const winnerOf: Side | null = resigned !== null ? ((1 - resigned) as Side) : result.kind === 'mate' || result.kind === 'perpetual' ? result.winner : null;
  const endTitle = (() => {
    if (resigned !== null) return `${name(resigned)} resigned`;
    if (result.kind === 'mate') return mode === 'pvp' ? `Checkmate · ${SIDE_NAME[result.winner]} wins` : result.winner === side ? 'Checkmate · you win!' : 'Checkmate · the computer wins';
    if (result.kind === 'perpetual') return `${name((1 - result.winner) as Side)} gave perpetual check and loses`;
    if (result.kind === 'draw') return result.reason === 'repetition' ? 'A draw by repetition' : 'A draw: the move limit was reached';
    return '';
  })();

  const pairs: { n: number; first?: string; second?: string }[] = [];
  rp.plies.forEach((p, i) => {
    if (i % 2 === 0) pairs.push({ n: i / 2 + 1, first: p.label });
    else (pairs[pairs.length - 1] as { second?: string }).second = p.label;
  });

  const hand = (s: Side) => (
    <div className="sg-hand" data-hand-of={s} aria-label={`${SIDE_NAME[s]} hand`}>
      {HAND_KINDS.map((k) => {
        const n = pos.handCount(s, k);
        if (n === 0) return null;
        const mine = canPlay && turn === s;
        const on = selected?.kind === 'hand' && selected.piece === k && turn === s;
        return (
          <button key={k} type="button" className={`sg-hand-pick${on ? ' sg-selected' : ''}`} data-hand={k} data-owner={s} data-count={n} disabled={!mine} aria-pressed={on} aria-label={`${SIDE_NAME[s]} hand: ${n} ${NAMES[k]}${n === 1 ? '' : 's'}`} onClick={() => pickHand(k)}>
            <Tile code={s === 0 ? CODE[k] : -CODE[k]} labels={labels} upright={s === bottom} />
            {n > 1 && <span className="sg-count">{n}</span>}
          </button>
        );
      })}
      {HAND_KINDS.every((k) => pos.handCount(s, k) === 0) && <span className="sg-hand-empty">no pieces in hand</span>}
    </div>
  );

  const top: Side = (1 - bottom) as Side;
  return (
    <div className="board-wrap sg-wrap" data-screen="play" data-over={over ? 'yes' : 'no'} data-turn={turn} data-result={resigned !== null ? 'resigned' : result.kind} data-moves={moves.length} data-thinking={aiTurn ? 'yes' : 'no'} data-bottom={bottom}>
      <div className="scorebar">
        {[top, bottom].map((s) => (
          <div key={s} className={`score${turn === s && !over ? ' score-active' : ''}`}>
            <span>
              <span className={`ch-chip ch-chip-${s === 0 ? 'b' : 'w'}`} />
              {name(s)}
            </span>
            <small>{mode === 'ai' ? SIDE_NAME[s] : s === 0 ? 'moves first' : 'moves second'}</small>
          </div>
        ))}
      </div>
      <p className="board-status" role="status">
        {status}
      </p>
      {hand(top)}
      <div className="sg-board" role="group" aria-label="Shogi board">
        {order.map((sq) => {
          const p = pos.board[sq] as number;
          const isTarget = targetSquares.has(sq);
          const classes = ['sg-sq'];
          if (selected?.kind === 'square' && selected.sq === sq) classes.push('sg-selected');
          if (last && (moveTo(last.move) === sq || (!isDrop(last.move) && moveFrom(last.move) === sq))) classes.push('sg-last');
          if (sq === checkedKing) classes.push('sg-check');
          if (isTarget) classes.push(p !== 0 ? 'sg-capture' : 'sg-move');
          const col = sq % 9;
          const row = Math.floor(sq / 9);
          const edgeTop = row === (bottom === 0 ? 0 : 8);
          const edgeRight = col === (bottom === 0 ? 8 : 0);
          return (
            <button
              key={sq}
              type="button"
              className={classes.join(' ')}
              data-square={sqName(sq)}
              data-piece={p === 0 ? '' : `${p > 0 ? 'b' : 'w'}:${p === 0 ? '' : (Math.abs(p) > 8 ? '+' : '') + kindOf(p)}`}
              data-target={isTarget ? 'yes' : undefined}
              aria-label={`${sqName(sq)}${p !== 0 ? `, ${SIDE_NAME[ownerOf(p)].toLowerCase()} ${nameOfCode(p)}` : ''}${isTarget ? ', can move here' : ''}`}
              aria-pressed={selected?.kind === 'square' && selected.sq === sq}
              disabled={!canPlay}
              onClick={() => press(sq)}
            >
              {p !== 0 && <Tile code={p} labels={labels} upright={ownerOf(p) === bottom} />}
              {edgeTop && (
                <span className="sg-file" aria-hidden="true">
                  {9 - col}
                </span>
              )}
              {edgeRight && (
                <span className="sg-rank" aria-hidden="true">
                  {'abcdefghi'[row]}
                </span>
              )}
            </button>
          );
        })}
        {choosing && (
          <div className="ch-promo sg-promo" role="dialog" aria-label="Promote the piece?" data-promotion="yes">
            <p>Promote this piece?</p>
            <div>
              <button type="button" className="btn btn-primary" data-promote="yes" onClick={() => commit(choosing.promote)} autoFocus>
                Promote
              </button>
              <button type="button" className="btn" data-promote="no" onClick={() => commit(choosing.plain)}>
                Don't promote
              </button>
            </div>
          </div>
        )}
      </div>
      {hand(bottom)}

      <div className="board-actions">
        <button type="button" className="btn" onClick={undo} disabled={!canUndo} data-action="undo">
          <Undo2 size={16} aria-hidden="true" /> Undo
        </button>
        <button type="button" className="btn" onClick={() => setFlipped(!flipped)} data-action="flip">
          <ArrowUpDown size={16} aria-hidden="true" /> Flip board
        </button>
        <button type="button" className="btn" onClick={() => setResigned(turn === side || mode === 'pvp' ? turn : side)} disabled={over || aiTurn} data-action="resign">
          <Flag size={16} aria-hidden="true" /> Resign
        </button>
        <button type="button" className="btn" onClick={() => setMoves(null)} data-action="settings">
          New game
        </button>
      </div>

      <ol className="ch-moves" aria-label="Moves so far" data-count={rp.plies.length}>
        {pairs.length === 0 && <li className="ch-moves-empty">No moves yet.</li>}
        {pairs.map((p) => (
          <li key={p.n}>
            <span className="ch-move-no">{p.n}.</span> <span data-san="1">{p.first}</span> <span data-san="2">{p.second ?? ''}</span>
          </li>
        ))}
      </ol>

      {over && (
        <div className="end-card" role="status" data-result={winnerOf === null ? 'draw' : winnerOf}>
          <h2>{endTitle}</h2>
          <p>
            {rp.plies.length} move{rp.plies.length === 1 ? '' : 's'} played.
          </p>
          <div className="board-actions">
            <button type="button" className="btn btn-primary" onClick={start} data-action="again" autoFocus>
              Play again
            </button>
            <button type="button" className="btn" onClick={() => setMoves(null)}>
              Change settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
