/**
 * Mastermind: against the computer (it makes the code), or two players on one device
 * (one makes a code behind the privacy curtain, the other guesses).
 */
import { Bot, Lightbulb, Users } from 'lucide-react';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import type { GameProps } from '../../hub/types';
import { sfx } from '../../shared/audio';
import { Curtain } from '../../shared/Curtain';
import { RadioCards } from '../../shared/RadioCards';
import { store } from '../../shared/storage';
import { createRng } from '../crater-lab/engine/rng';
import { MAX_TURNS, PEGS, guess as playGuess, hintPeg, isValidCode, newGame, randomSecret, type Game } from './engine';

export const GAME_ID = 'mastermind';
type Mode = 'ai' | 'pvp';

/** Colour, a letter-like symbol (so the pegs can be told apart without colour) and a name for screen readers. */
const PEG_STYLES = [
  { color: '#FF5A4E', symbol: '●', name: 'red' },
  { color: '#3B6CF6', symbol: '■', name: 'blue' },
  { color: '#16A34A', symbol: '▲', name: 'green' },
  { color: '#F5B700', symbol: '◆', name: 'yellow' },
  { color: '#7C3AED', symbol: '★', name: 'purple' },
  { color: '#14B8A6', symbol: '✚', name: 'teal' },
] as const;

function Peg({ color, selected, empty, onClick, label, size = 'm' }: { color: number | null; selected?: boolean; empty?: boolean; onClick?: () => void; label: string; size?: 's' | 'm' }) {
  const style = color === null ? undefined : ({ '--peg': PEG_STYLES[color]?.color } as CSSProperties);
  const className = `peg peg-${size}${color === null ? ' peg-empty' : ''}${selected ? ' peg-selected' : ''}${empty ? ' peg-hollow' : ''}`;
  const inner = color === null ? null : <span aria-hidden="true">{PEG_STYLES[color]?.symbol}</span>;
  return onClick ? (
    <button type="button" className={className} style={style} onClick={onClick} aria-label={label} aria-pressed={selected}>
      {inner}
    </button>
  ) : (
    <span className={className} style={style} role="img" aria-label={label}>
      {inner}
    </span>
  );
}

function FeedbackPegs({ exact, misplaced }: { exact: number; misplaced: number }) {
  const dots = [...Array(exact).fill('exact'), ...Array(misplaced).fill('misplaced'), ...Array(PEGS - exact - misplaced).fill('none')] as string[];
  return (
    <span className="fb" role="img" aria-label={`${exact} right colour and place, ${misplaced} right colour, wrong place`}>
      {dots.map((kind, i) => (
        <span key={i} className={`fb-dot fb-${kind}`} />
      ))}
    </span>
  );
}

/** Choose a code: a row of slots and the palette. Used for guessing and for the code-maker's secret. */
function CodeEntry({ value, onChange, onSubmit, submitLabel, disabled }: { value: (number | null)[]; onChange: (v: (number | null)[]) => void; onSubmit: () => void; submitLabel: string; disabled?: boolean }) {
  const [slot, setSlot] = useState(0);
  const filled = value.every((v) => v !== null);

  const put = useCallback(
    (color: number) => {
      const next = [...value];
      next[slot] = color;
      onChange(next);
      sfx.angleTick(30 + color * 25);
      const empty = next.findIndex((v) => v === null);
      setSlot(empty === -1 ? Math.min(PEGS - 1, slot + 1) : empty);
    },
    [value, slot, onChange],
  );

  const remove = useCallback(() => {
    const last = [...value].map((v, i) => (v !== null ? i : -1)).filter((i) => i >= 0).pop();
    const index = value[slot] !== null ? slot : (last ?? 0);
    const next = [...value];
    next[index] = null;
    onChange(next);
    setSlot(index);
  }, [value, slot, onChange]);

  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (/^[1-6]$/.test(e.key)) put(Number(e.key) - 1);
      else if (e.key === 'Backspace') remove();
      else if (e.key === 'Enter' && filled && (e.target as HTMLElement).tagName !== 'BUTTON') onSubmit();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [put, remove, filled, onSubmit, disabled]);

  return (
    <div className="entry" data-entry>
      <div className="entry-slots" role="group" aria-label="Your code">
        {value.map((v, i) => (
          <Peg key={i} color={v} selected={slot === i} empty label={`Place ${i + 1}: ${v === null ? 'empty' : PEG_STYLES[v]?.name}`} onClick={() => setSlot(i)} />
        ))}
      </div>
      <div className="palette" role="group" aria-label="Colours">
        {PEG_STYLES.map((style, c) => (
          <Peg key={c} color={c} label={`${style.name} (key ${c + 1})`} onClick={() => put(c)} />
        ))}
      </div>
      <div className="board-actions">
        <button type="button" className="btn" onClick={() => { onChange(Array(PEGS).fill(null)); setSlot(0); }} disabled={disabled || value.every((v) => v === null)}>
          Clear
        </button>
        <button type="button" className="btn btn-primary" onClick={onSubmit} disabled={disabled || !filled} data-action="submit">
          {submitLabel}
        </button>
      </div>
    </div>
  );
}

const blank = (): (number | null)[] => Array(PEGS).fill(null);

function Board({ game, mode, secretMaker, onAgain, onMenu }: { game: Game; mode: Mode; secretMaker: number; onAgain: () => void; onMenu: () => void }) {
  const over = game.status !== 'playing';
  return (
    <div className="mm-board" data-status={game.status} data-turns={game.turns.length}>
      <ol className="mm-rows" aria-label="Guesses so far">
        {Array.from({ length: MAX_TURNS }, (_, i) => {
          const turn = game.turns[i];
          return (
            <li key={i} className={`mm-row${turn ? '' : ' mm-row-empty'}`}>
              <span className="mm-n">{i + 1}</span>
              {Array.from({ length: PEGS }, (_, p) => (
                <Peg key={p} color={turn ? (turn.guess[p] as number) : null} size="s" empty label={turn ? PEG_STYLES[turn.guess[p] as number]?.name ?? '' : 'empty'} />
              ))}
              {turn ? <FeedbackPegs exact={turn.feedback.exact} misplaced={turn.feedback.misplaced} /> : <span className="fb" />}
            </li>
          );
        })}
      </ol>
      {over && (
        <div className="end-card" role="status" data-result={game.status}>
          <h2>{game.status === 'won' ? (mode === 'pvp' ? `Cracked in ${game.turns.length}!` : `You cracked it in ${game.turns.length}!`) : 'Out of guesses'}</h2>
          <div className="mm-secret">
            The code was{' '}
            {game.secret.map((c, i) => (
              <Peg key={i} color={c} size="s" label={PEG_STYLES[c]?.name ?? ''} />
            ))}
          </div>
          <div className="board-actions">
            <button type="button" className="btn btn-primary" onClick={onAgain} data-action="again">
              {mode === 'pvp' ? `Swap: Player ${secretMaker === 0 ? 2 : 1} makes the code` : 'Play again'}
            </button>
            <button type="button" className="btn" onClick={onMenu}>
              Change mode
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type Phase = 'menu' | 'maker-curtain' | 'setcode' | 'breaker-curtain' | 'play';

export default function GameView(_props: GameProps) {
  const [saved] = useState(() => store.loadGameSettings(GAME_ID, { mode: 'ai', repeats: true }));
  const [mode, setMode] = useState<Mode>(saved.mode === 'pvp' ? 'pvp' : 'ai');
  const [repeats, setRepeats] = useState<boolean>(saved.repeats);
  const [phase, setPhase] = useState<Phase>('menu');
  const [maker, setMaker] = useState(0); // in two-player games, who makes the code this round (0 or 1)
  const [draft, setDraft] = useState<(number | null)[]>(blank());
  const [game, setGame] = useState<Game | null>(null);
  const [entry, setEntry] = useState<(number | null)[]>(blank());
  const [hint, setHint] = useState<{ position: number; color: number } | null>(null);
  const [error, setError] = useState('');
  const [seedBase] = useState(() => (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0);
  const [rounds, setRounds] = useState(0);

  const start = (nextMaker: number) => {
    sfx.click();
    store.saveGameSettings(GAME_ID, { mode, repeats });
    setEntry(blank());
    setHint(null);
    setError('');
    if (mode === 'ai') {
      setGame(newGame(randomSecret(createRng((seedBase + rounds * 7919) >>> 0), repeats)));
      setRounds((n) => n + 1);
      setPhase('play');
    } else {
      setMaker(nextMaker);
      setDraft(blank());
      setGame(null);
      setPhase('maker-curtain');
    }
  };

  const lockCode = () => {
    const code = draft as number[];
    if (!isValidCode(code)) return;
    if (!repeats && new Set(code).size !== PEGS) {
      setError('This game is set to "no repeated colours": use four different ones.');
      return;
    }
    setError('');
    sfx.click();
    setGame(newGame(code));
    setDraft(blank()); // the draft is forgotten, so the code lives only in the game, which the board never shows until the end
    setPhase('breaker-curtain');
  };

  const submit = () => {
    if (!game || game.status !== 'playing' || !isValidCode(entry as number[])) return;
    const next = playGuess(game, entry as number[]);
    setGame(next);
    setEntry(blank());
    setHint(null);
    const last = next.turns[next.turns.length - 1]!;
    sfx.angleTick(60 + last.feedback.exact * 40);
    if (next.status !== 'playing') {
      if (next.status === 'won') sfx.victory();
      else sfx.defeat();
      store.recordResult(GAME_ID, mode === 'pvp' ? 'played' : next.status === 'won' ? 'win' : 'loss');
    }
  };

  if (phase === 'menu') {
    const stats = store.loadStats(GAME_ID);
    return (
      <div className="setup" data-screen="setup">
        <p className="setup-lede">Crack the hidden code of four colours in ten guesses. Each guess tells you how close you are.</p>
        <RadioCards
          legend="Who is playing?"
          name="mm-mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'ai', title: '1 player', hint: 'The computer makes the code', icon: <Bot size={22} aria-hidden="true" /> },
            { value: 'pvp', title: '2 players', hint: 'One makes a code, the other cracks it', icon: <Users size={22} aria-hidden="true" /> },
          ]}
        />
        <RadioCards
          legend="Repeated colours in the code?"
          name="mm-repeats"
          value={repeats ? 'yes' : 'no'}
          onChange={(v) => setRepeats(v === 'yes')}
          options={[
            { value: 'yes', title: 'Allowed', hint: 'The classic game' },
            { value: 'no', title: 'Never', hint: 'Easier: all four colours differ' },
          ]}
        />
        <button type="button" className="btn btn-primary btn-big" onClick={() => start(0)} data-action="start">
          Start
        </button>
        {stats.plays > 0 && (
          <p className="setup-stats">
            {stats.wins} cracked, {stats.losses} failed against the computer{stats.bestStreak > 1 ? `, best streak ${stats.bestStreak}` : ''}.
          </p>
        )}
        <p className="armory-keys">
          Keys: <kbd>1</kbd>–<kbd>6</kbd> place a colour, <kbd>Backspace</kbd> takes one back, <kbd>Enter</kbd> sends the guess. A solid dot means a right colour in the right place; a hollow dot means a right colour in the wrong place.
        </p>
      </div>
    );
  }

  if (phase === 'maker-curtain') {
    return <Curtain hidden player={`Player ${maker + 1}`} message="You make the secret code. The other player must not look." onReveal={() => setPhase('setcode')}>{null}</Curtain>;
  }

  if (phase === 'setcode') {
    return (
      <div className="mm-wrap" data-screen="setcode">
        <p className="board-status">Player {maker + 1}: choose the secret code</p>
        <CodeEntry value={draft} onChange={setDraft} onSubmit={lockCode} submitLabel="Lock in the code" />
        {error && <p className="mm-error" role="alert">{error}</p>}
      </div>
    );
  }

  if (phase === 'breaker-curtain') {
    const breaker = maker === 0 ? 2 : 1;
    return <Curtain hidden player={`Player ${breaker}`} message="The code is locked in. Your turn to crack it." onReveal={() => setPhase('play')}>{null}</Curtain>;
  }

  if (!game) return null;
  const over = game.status !== 'playing';
  const guesser = maker === 0 ? 2 : 1;
  return (
    <div className="mm-wrap" data-screen="play">
      <p className="board-status" role="status">
        {over ? 'Round over' : mode === 'pvp' ? `Player ${guesser}: guess ${game.turns.length + 1} of ${MAX_TURNS}` : `Guess ${game.turns.length + 1} of ${MAX_TURNS}`}
      </p>
      <Board game={game} mode={mode} secretMaker={maker} onAgain={() => start(maker === 0 ? 1 : 0)} onMenu={() => setPhase('menu')} />
      {!over && (
        <>
          <CodeEntry value={entry} onChange={setEntry} onSubmit={submit} submitLabel="Guess" />
          <div className="board-actions">
            <button
              type="button"
              className="btn"
              onClick={() => setHint(hintPeg(game))}
              disabled={hint !== null}
              title="Shows one peg of the code"
              data-action="hint"
            >
              <Lightbulb size={16} aria-hidden="true" /> Hint
            </button>
            {hint && (
              <span className="mm-hint" role="status">
                Place {hint.position + 1} is <Peg color={hint.color} size="s" label={PEG_STYLES[hint.color]?.name ?? ''} />
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
