import { ArrowUpDown, Bot, Undo2, Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameProps } from '../../hub/types';
import { sfx } from '../../shared/audio';
import { RadioCards } from '../../shared/RadioCards';
import { store } from '../../shared/storage';
import { createRng, nextRandom } from '../crater-lab/engine/rng';
import { chooseMove, type Difficulty } from './ai';
import { FILES, capturedBy, chessOf, historyOf, legalMoves, materialBalance, needsPromotion, resultOf, type Colour, type MoveInput, type PieceType, type Promotion } from './engine';
import { PIECE_NAMES, Piece } from './Pieces';

export const GAME_ID = 'chess';
type Mode = 'ai' | 'pvp';
type Side = Colour;
const isDifficulty = (v: string): v is Difficulty => v === 'easy' || v === 'normal' || v === 'hard';
const isSide = (v: string): v is Side => v === 'w' || v === 'b';
const COLOUR_NAME: Record<Colour, string> = { w: 'White', b: 'Black' };
const PROMOTIONS: { piece: Promotion; label: string }[] = [
  { piece: 'q', label: 'Queen' },
  { piece: 'r', label: 'Rook' },
  { piece: 'b', label: 'Bishop' },
  { piece: 'n', label: 'Knight' },
];
/** Pause before the computer moves, so its reply is not instant and the board can repaint first. */
const THINK_DELAY_MS = 350;

/** What a side has taken, as little pieces, and how far ahead it is in material. */
function Captures({ pieces, lead, colour }: { pieces: PieceType[]; lead: number; colour: Colour }) {
  return (
    <span className="ch-taken" aria-label={`captured ${pieces.length} piece${pieces.length === 1 ? '' : 's'}${lead > 0 ? `, ${lead} ahead` : ''}`}>
      {pieces.map((p, i) => (
        <Piece key={i} type={p} colour={colour} size={16} />
      ))}
      {lead > 0 && <b>+{lead}</b>}
    </span>
  );
}

export default function GameView(_props: GameProps) {
  const [saved] = useState(() => store.loadGameSettings(GAME_ID, { mode: 'ai', difficulty: 'normal', side: 'w' }));
  const [mode, setMode] = useState<Mode>(saved.mode === 'pvp' ? 'pvp' : 'ai');
  const [difficulty, setDifficulty] = useState<Difficulty>(isDifficulty(saved.difficulty) ? saved.difficulty : 'normal');
  const [side, setSide] = useState<Side>(isSide(saved.side) ? saved.side : 'w');
  const [moves, setMoves] = useState<MoveInput[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [promotion, setPromotion] = useState<{ from: string; to: string } | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [seed] = useState(() => (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0);
  const rng = useRef(createRng(seed));
  const recorded = useRef(false);

  const game = useMemo(() => (moves ? chessOf(moves) : null), [moves]);
  const result = useMemo(() => (game ? resultOf(game) : null), [game]);
  const over = result !== null && result.kind !== 'ongoing';
  const turn: Colour = game ? game.turn() : 'w';
  const aiTurn = game !== null && mode === 'ai' && !over && turn !== side;

  // the computer's move: computed after a short pause, so "thinking" shows first (the search itself blocks the page for up to ~2 s on hard)
  useEffect(() => {
    if (!moves || !aiTurn) return;
    const id = window.setTimeout(() => {
      const choice = chooseMove(moves, difficulty, rng.current);
      const before = chessOf(moves);
      const captured = legalMoves(before, choice.from).some((m) => m.to === choice.to && m.captured);
      if (captured) sfx.explosion(8);
      else sfx.angleTick(300 + Math.floor(nextRandom(rng.current) * 200));
      setMoves([...moves, { from: choice.from, to: choice.to, promotion: choice.promotion }]);
    }, THINK_DELAY_MS);
    return () => window.clearTimeout(id);
  }, [moves, aiTurn, difficulty]);

  // record the result once per game
  useEffect(() => {
    if (!result || result.kind === 'ongoing' || recorded.current) return;
    recorded.current = true;
    if (mode === 'pvp') {
      store.recordResult(GAME_ID, 'played');
      sfx.victory();
    } else if (result.kind === 'draw') {
      store.recordResult(GAME_ID, 'draw');
    } else if (result.winner === side) {
      store.recordResult(GAME_ID, 'win');
      sfx.victory();
    } else {
      store.recordResult(GAME_ID, 'loss');
      sfx.defeat();
    }
  }, [result, mode, side]);

  const start = () => {
    sfx.click();
    store.saveGameSettings(GAME_ID, { mode, difficulty, side });
    recorded.current = false;
    setSelected(null);
    setPromotion(null);
    setFlipped(false);
    setMoves([]);
  };

  if (!moves || !game || !result) {
    const stats = store.loadStats(GAME_ID);
    return (
      <div className="setup" data-screen="setup">
        <p className="setup-lede">Checkmate the other king. Tap a piece to see where it can go, then tap the square. All the rules are in: castling, en passant, promotion and the draws.</p>
        <RadioCards
          legend="Who is playing?"
          name="ch-mode"
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
              name="ch-side"
              value={side}
              onChange={setSide}
              options={[
                { value: 'w', title: 'White', hint: 'You move first' },
                { value: 'b', title: 'Black', hint: 'The computer moves first' },
              ]}
            />
            <RadioCards
              legend="How good is the computer?"
              name="ch-level"
              value={difficulty}
              onChange={setDifficulty}
              options={[
                { value: 'easy', title: 'Easy', hint: 'Looks one move ahead and makes slips' },
                { value: 'normal', title: 'Normal', hint: 'Looks about three moves ahead' },
                { value: 'hard', title: 'Hard', hint: 'Thinks for up to two seconds a move' },
              ]}
            />
          </>
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

  const home: Colour = mode === 'ai' ? side : 'w'; // whose pieces start at the bottom
  const bottom: Colour = flipped ? (home === 'w' ? 'b' : 'w') : home;
  const ranks = bottom === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = bottom === 'w' ? [...FILES] : [...FILES].reverse();
  const targets = selected ? legalMoves(game, selected) : [];
  const targetSquares = new Set(targets.map((m) => m.to));
  const last = moves[moves.length - 1];
  const checkedKing = result.kind === 'ongoing' && result.check ? game.board().flat().find((sq) => sq && sq.type === 'k' && sq.color === turn)?.square : undefined;
  const canPlay = !over && !aiTurn && promotion === null;
  const taken = capturedBy(game);
  const balance = materialBalance(game);
  const name = (c: Colour) => (mode === 'pvp' ? COLOUR_NAME[c] : c === side ? 'You' : 'Computer');
  const history = historyOf(moves);
  const pairs: { n: number; white?: string; black?: string }[] = [];
  history.forEach((h, i) => {
    if (i % 2 === 0) pairs.push({ n: i / 2 + 1, white: h.san });
    else pairs[pairs.length - 1]!.black = h.san;
  });
  const undoFloor = mode === 'ai' && side === 'b' ? 1 : 0; // the computer's opening move cannot be taken back
  const canUndo = !aiTurn && !over && moves.length > undoFloor;

  const status = over
    ? 'Game over'
    : aiTurn
      ? 'Computer is thinking…'
      : `${name(turn)}${mode === 'pvp' ? ' to move' : ': your move'}${result.kind === 'ongoing' && result.check ? ' · Check!' : ''}`;

  const commit = (from: string, to: string, promote?: Promotion) => {
    const move = legalMoves(game, from).find((m) => m.to === to && (m.promotion ?? undefined) === promote);
    if (!move) return;
    if (move.captured) sfx.explosion(8);
    else sfx.angleTick(300 + (to.charCodeAt(0) - 97) * 40);
    setMoves([...moves, { from, to, promotion: promote }]);
    setSelected(null);
    setPromotion(null);
  };

  const press = (square: string) => {
    if (!canPlay) return;
    if (selected && targetSquares.has(square)) {
      if (needsPromotion(game, selected, square)) setPromotion({ from: selected, to: square });
      else commit(selected, square);
      return;
    }
    const piece = game.get(square as never);
    if (piece && piece.color === turn) setSelected(square === selected ? null : square);
    else setSelected(null);
  };

  const undo = () => {
    const cut = mode === 'ai' && turn === side ? 2 : 1;
    sfx.click();
    setSelected(null);
    setPromotion(null);
    setMoves(moves.slice(0, Math.max(undoFloor, moves.length - cut)));
  };

  const top: Colour = bottom === 'w' ? 'b' : 'w';
  const lead = (c: Colour) => (c === 'w' ? Math.max(0, balance) : Math.max(0, -balance));
  const endTitle =
    result.kind === 'checkmate'
      ? mode === 'pvp'
        ? `Checkmate · ${COLOUR_NAME[result.winner]} wins`
        : result.winner === side
          ? 'Checkmate · you win!'
          : 'Checkmate · the computer wins'
      : `A draw by ${result.kind === 'draw' ? result.reason : ''}`;

  return (
    <div className="board-wrap ch-wrap" data-screen="play" data-over={over ? 'yes' : 'no'} data-turn={turn} data-result={result.kind} data-moves={moves.length} data-thinking={aiTurn ? 'yes' : 'no'} data-bottom={bottom}>
      <div className="scorebar">
        {[top, bottom].map((c) => (
          <div key={c} className={`score ch-side ch-side-${c}${turn === c && !over ? ' score-active' : ''}`}>
            <span>
              <span className={`ch-chip ch-chip-${c}`} />
              {name(c)}
            </span>
            <Captures pieces={taken[c]} lead={lead(c)} colour={c === 'w' ? 'b' : 'w'} />
          </div>
        ))}
      </div>
      <p className="board-status" role="status">
        {status}
      </p>

      <div className="ch-board" role="group" aria-label="Chess board">
        {ranks.flatMap((rank) =>
          files.map((file) => {
            const square = `${file}${rank}`;
            const piece = game.get(square as never);
            const dark = (FILES.indexOf(file) + rank) % 2 === 1;
            const isTarget = targetSquares.has(square);
            const classes = ['ch-sq', dark ? 'ch-dark' : 'ch-light'];
            if (square === selected) classes.push('ch-selected');
            if (last && (square === last.from || square === last.to)) classes.push('ch-last');
            if (square === checkedKing) classes.push('ch-check');
            if (isTarget) classes.push(piece ? 'ch-capture' : 'ch-move');
            const showRank = file === files[0];
            const showFile = rank === ranks[ranks.length - 1];
            return (
              <button
                key={square}
                type="button"
                className={classes.join(' ')}
                data-square={square}
                data-piece={piece ? `${piece.color}${piece.type}` : ''}
                data-target={isTarget ? 'yes' : undefined}
                aria-label={`${square}${piece ? `, ${COLOUR_NAME[piece.color as Colour].toLowerCase()} ${PIECE_NAMES[piece.type as PieceType]}` : ''}${isTarget ? ', can move here' : ''}`}
                aria-pressed={square === selected}
                disabled={!canPlay}
                onClick={() => press(square)}
              >
                {piece && <Piece type={piece.type as PieceType} colour={piece.color as Colour} />}
                {showRank && (
                  <span className="ch-rank" aria-hidden="true">
                    {rank}
                  </span>
                )}
                {showFile && (
                  <span className="ch-file" aria-hidden="true">
                    {file}
                  </span>
                )}
              </button>
            );
          }),
        )}
        {promotion && (
          <div className="ch-promo" role="dialog" aria-label="Promote the pawn" data-promotion="yes">
            <p>Promote to</p>
            <div>
              {PROMOTIONS.map((p) => (
                <button key={p.piece} type="button" className="ch-promo-pick" data-promote={p.piece} aria-label={p.label} onClick={() => commit(promotion.from, promotion.to, p.piece)}>
                  <Piece type={p.piece} colour={turn} size={44} />
                  <small>{p.label}</small>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="board-actions">
        <button type="button" className="btn" onClick={undo} disabled={!canUndo} data-action="undo">
          <Undo2 size={16} aria-hidden="true" /> Undo
        </button>
        <button type="button" className="btn" onClick={() => setFlipped(!flipped)} data-action="flip">
          <ArrowUpDown size={16} aria-hidden="true" /> Flip board
        </button>
        <button type="button" className="btn" onClick={() => setMoves(null)} data-action="settings">
          New game
        </button>
      </div>

      <ol className="ch-moves" aria-label="Moves so far" data-count={history.length}>
        {pairs.length === 0 && <li className="ch-moves-empty">No moves yet.</li>}
        {pairs.map((p) => (
          <li key={p.n}>
            <span className="ch-move-no">{p.n}.</span> <span data-san="w">{p.white}</span> <span data-san="b">{p.black ?? ''}</span>
          </li>
        ))}
      </ol>

      {over && (
        <div className="end-card" role="status" data-result={result.kind === 'checkmate' ? result.winner : 'draw'}>
          <h2>{endTitle}</h2>
          <p>
            {history.length} move{history.length === 1 ? '' : 's'} played.
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
