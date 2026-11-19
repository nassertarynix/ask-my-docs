import { Bot, Copy, Globe, LogOut } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { GameProps } from '../../hub/types';
import { relayUrl } from '../../hub/config';
import { cleanName, randomRoomCode, ROOM_CODE } from '../../net/protocol';
import { OnlineSession, sessionTokens, type Snapshot, type TokenStore } from '../../net/session';
import { MemoryRelay, webSocketConnect } from '../../net/transport';
import { sfx } from '../../shared/audio';
import { RadioCards } from '../../shared/RadioCards';
import { store } from '../../shared/storage';
import type { BotLevel } from './ai';
import { HEROES_PER_PLAYER, heroAt, heroesHome, heroesNeeded, legalActions, type Action, type State } from './engine';
import { labyAdapter, type LabySetup } from './online';

export const GAME_ID = 'labyrinth';
type Session = OnlineSession<State, Action, LabySetup>;
type Snap = Snapshot<State, Action, LabySetup>;
type Mode = 'solo' | 'online';
const MAX_PLAYERS = 4;
/** The four teams, by corner of the board. */
const TEAMS = [
  { name: 'Athens', colour: '#F5B700', ink: '#18181b' },
  { name: 'Sparta', colour: '#E5484D', ink: '#ffffff' },
  { name: 'Corinth', colour: '#3B82F6', ink: '#ffffff' },
  { name: 'Thebes', colour: '#EDE7D6', ink: '#18181b' },
] as const;
const BOT_NAMES = ['Ariadne', 'Daedalus', 'Icarus'];
const isLevel = (v: string): v is BotLevel => v === 'easy' || v === 'normal' || v === 'hard';
const noTokens: TokenStore = { get: () => null, set: () => undefined };
const noSubscribe = () => () => undefined;
const noSnapshot = () => null;
const randomSeed = () => (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0;
/** `?seed=N` in the address makes the game the same every time (for tests). */
const gameSeed = (): number => {
  const raw = Number(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('seed'));
  return Number.isInteger(raw) && raw > 0 ? raw : randomSeed();
};

function roomHash(code: string | null): string {
  const query = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const next = new URLSearchParams();
  if (code) next.set('room', code);
  for (const key of ['relay', 'fast', 'seed']) {
    const v = query.get(key);
    if (v) next.set(key, v);
  }
  const text = next.toString();
  return `#/play/${GAME_ID}${text ? `?${text}` : ''}`;
}

export default function GameView(_props: GameProps) {
  const params = useMemo(() => new URLSearchParams(window.location.hash.split('?')[1] ?? ''), []);
  const relay = relayUrl(params);
  const fast = params.get('fast') === '1'; // for tests: computers play at once
  const [saved] = useState(() => store.loadGameSettings(GAME_ID, { mode: 'solo', name: '', opponents: '1', level: 'normal' }));
  const linkedRoom = (params.get('room') ?? '').toUpperCase();
  const [mode, setMode] = useState<Mode>(ROOM_CODE.test(linkedRoom) || saved.mode === 'online' ? 'online' : 'solo');
  const [name, setName] = useState(saved.name);
  const [opponents, setOpponents] = useState(['1', '2', '3'].includes(saved.opponents) ? saved.opponents : '1');
  const [level, setLevel] = useState<BotLevel>(isLevel(saved.level) ? saved.level : 'normal');
  const [joinCode, setJoinCode] = useState(ROOM_CODE.test(linkedRoom) ? linkedRoom : '');
  const [session, setSession] = useState<Session | null>(null);
  const [lastSolo, setLastSolo] = useState(false);
  const sessionRef = useRef<Session | null>(null);
  useEffect(() => () => sessionRef.current?.leave(), []);

  const snap = useSyncExternalStore(session?.subscribe ?? noSubscribe, (session?.getSnapshot ?? noSnapshot) as () => Snap | null);
  const attach = (s: Session | null) => {
    sessionRef.current?.leave();
    sessionRef.current = s;
    setSession(s);
  };
  const myName = cleanName(name) || 'Hero';
  const remember = () => store.saveGameSettings(GAME_ID, { mode, name: cleanName(name), opponents, level });

  const startSolo = () => {
    sfx.click();
    remember();
    const setup: LabySetup = {
      players: [{ name: myName, kind: 'human' }, ...BOT_NAMES.slice(0, Number(opponents)).map((n) => ({ name: n, kind: 'bot' as const, level }))],
      seed: gameSeed(),
    };
    const memory = new MemoryRelay();
    setLastSolo(true);
    attach(new OnlineSession({ adapter: labyAdapter, connect: memory.connect('SOLO1'), code: 'SOLO1', name: myName, tokens: noTokens, autoStart: setup, maxSeats: MAX_PLAYERS, botDelayMs: fast ? 30 : 700 }));
  };

  const goOnline = (code: string) => {
    sfx.click();
    remember();
    setLastSolo(false);
    window.history.replaceState(null, '', roomHash(code)); // no navigation: it only lets a refresh find the room again
    attach(new OnlineSession({ adapter: labyAdapter, connect: webSocketConnect(`${relay}/room/${code}`), code, name: myName, maxSeats: MAX_PLAYERS, botDelayMs: fast ? 30 : 700 }));
  };
  const leave = () => {
    window.history.replaceState(null, '', roomHash(null));
    attach(null);
  };

  // a refreshed tab (or one the phone put to sleep) that was in a room goes straight back to its seat
  const rejoined = useRef(false);
  useEffect(() => {
    if (rejoined.current) return;
    rejoined.current = true;
    // this one-off effect starts the connection on mount, which is exactly what the rule below warns against doing in general
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (relay !== '' && ROOM_CODE.test(linkedRoom) && sessionTokens.get(linkedRoom)) goOnline(linkedRoom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (session && snap) {
    if (snap.status === 'playing' && snap.state && snap.data) return <Table snap={snap} session={session} onLeave={leave} onAgain={lastSolo ? startSolo : null} solo={lastSolo} />;
    if (snap.status === 'lobby') return <Lobby snap={snap} session={session} onLeave={leave} level={level} />;
    if (snap.status === 'failed' || snap.status === 'closed') {
      return (
        <div className="setup" data-screen="failed">
          <p className="setup-lede" role="alert">
            {snap.error ?? 'The connection closed.'}
          </p>
          <button type="button" className="btn btn-primary" onClick={leave}>
            Back
          </button>
        </div>
      );
    }
    return (
      <div className="setup" data-screen="connecting">
        <p className="setup-lede" role="status">
          Connecting…
        </p>
        <button type="button" className="btn" onClick={leave}>
          Cancel
        </button>
      </div>
    );
  }

  const stats = store.loadStats(GAME_ID);
  return (
    <div className="setup" data-screen="setup">
      <p className="setup-lede">
        Lead your three heroes through the labyrinth to the temple at its heart. Roll the die: move a hero exactly that many squares, build a wall to hold your rivals back, or send the Minotaur charging. 2 to 4 players.
      </p>
      <RadioCards
        legend="How do you want to play?"
        name="lb-mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'solo', title: 'Against computers', hint: 'On your own, no connection needed', icon: <Bot size={22} aria-hidden="true" /> },
          { value: 'online', title: 'Online with friends', hint: 'Share a room code', icon: <Globe size={22} aria-hidden="true" /> },
        ]}
      />
      <label className="gm-field">
        <span>Your name</span>
        <input type="text" value={name} maxLength={20} placeholder="Hero" onChange={(e) => setName(e.target.value)} data-field="name" autoComplete="nickname" />
      </label>
      {mode === 'solo' && (
        <>
          <RadioCards
            legend="Computer rivals"
            name="lb-opponents"
            value={opponents}
            onChange={setOpponents}
            options={[
              { value: '1', title: '1', hint: 'Two players: get two heroes home' },
              { value: '2', title: '2', hint: 'Three players: one hero is enough' },
              { value: '3', title: '3', hint: 'Four players: one hero is enough' },
            ]}
          />
          <RadioCards
            legend="How good are they?"
            name="lb-level"
            value={level}
            onChange={setLevel}
            options={[
              { value: 'easy', title: 'Easy', hint: 'Often plays at random' },
              { value: 'normal', title: 'Normal', hint: 'Sensible, a little unpredictable' },
              { value: 'hard', title: 'Hard', hint: 'Steady, and aims the Minotaur well' },
            ]}
          />
          <button type="button" className="btn btn-primary btn-big" onClick={startSolo} data-action="start">
            Start
          </button>
        </>
      )}
      {mode === 'online' &&
        (relay === '' ? (
          <p className="gm-note" role="status" data-online="off">
            Online play is not switched on yet: the room server has not been connected. You can still play against computers.
          </p>
        ) : (
          <div className="gm-online" data-online="on">
            <button type="button" className="btn btn-primary btn-big" onClick={() => goOnline(randomRoomCode())} data-action="create">
              Create a room
            </button>
            <form
              className="gm-join"
              onSubmit={(e) => {
                e.preventDefault();
                if (ROOM_CODE.test(joinCode)) goOnline(joinCode);
              }}
            >
              <label className="gm-field">
                <span>Or join a room</span>
                <input type="text" value={joinCode} maxLength={5} placeholder="ROOM CODE" onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} data-field="code" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
              </label>
              <button type="submit" className="btn" disabled={!ROOM_CODE.test(joinCode)} data-action="join">
                Join
              </button>
            </form>
          </div>
        ))}
      {stats.plays > 0 && (
        <p className="setup-stats">
          Against computers: {stats.wins} won, {stats.losses} lost.
        </p>
      )}
    </div>
  );
}

// ---------- the lobby ----------
function Lobby({ snap, session, onLeave, level }: { snap: Snap; session: Session; onLeave: () => void; level: BotLevel }) {
  const humans = snap.players.length;
  const isHost = snap.you !== null && snap.you === snap.hostSeat;
  const [seatsChoice, setSeatsChoice] = useState('2');
  const [botLevel, setBotLevel] = useState<BotLevel>(level);
  const [copied, setCopied] = useState(false);
  const seats = Math.max(2, humans, Math.min(MAX_PLAYERS, Number(seatsChoice)));
  const link = `${window.location.origin}${window.location.pathname}${roomHash(snap.code)}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const begin = () => {
    sfx.click();
    const players: LabySetup['players'] = [
      ...snap.players.map((p) => ({ name: p.name, kind: 'human' as const })),
      ...BOT_NAMES.slice(0, seats - humans).map((n) => ({ name: n, kind: 'bot' as const, level: botLevel })),
    ];
    session.start({ players, seed: gameSeed() });
  };

  return (
    <div className="setup gm-lobby" data-screen="lobby">
      <p className="setup-lede">Share this code with your friends. Two to four can play; computers fill empty seats.</p>
      <div className="gm-code" data-room-code={snap.code} aria-label={`Room code ${snap.code.split('').join(' ')}`}>
        {snap.code}
      </div>
      <button type="button" className="btn" onClick={copy}>
        <Copy size={16} aria-hidden="true" /> {copied ? 'Link copied' : 'Copy invite link'}
      </button>
      {!snap.online && (
        <p className="gm-note" role="status">
          Reconnecting…
        </p>
      )}
      {snap.error && (
        <p className="gm-note" role="alert">
          {snap.error}
        </p>
      )}
      <ul className="gm-roster" aria-label="Players in the room">
        {snap.players.map((p) => (
          <li key={p.seat} data-seat={p.seat} className={p.connected ? '' : 'gm-away'}>
            {p.name}
            {p.seat === snap.you ? ' (you)' : ''}
            {p.seat === snap.hostSeat ? ' · host' : ''}
            {p.connected ? '' : ' · away'}
          </li>
        ))}
      </ul>
      {isHost ? (
        <>
          <RadioCards
            legend="Players at the table"
            name="lb-seats"
            value={String(seats)}
            onChange={setSeatsChoice}
            options={(['2', '3', '4'] as const).map((n) => ({ value: n, title: n, hint: Number(n) < humans ? 'Too few for everyone here' : `${Math.max(0, Number(n) - humans)} computer${Number(n) - humans === 1 ? '' : 's'}` }))}
          />
          {seats > humans && (
            <RadioCards
              legend="How good are the computers?"
              name="lb-lobby-level"
              value={botLevel}
              onChange={setBotLevel}
              options={[
                { value: 'easy', title: 'Easy' },
                { value: 'normal', title: 'Normal' },
                { value: 'hard', title: 'Hard' },
              ]}
            />
          )}
          <button type="button" className="btn btn-primary btn-big" onClick={begin} disabled={seats < humans} data-action="begin">
            Start the game
          </button>
        </>
      ) : (
        <p className="gm-note" role="status">
          Waiting for {snap.players.find((p) => p.seat === snap.hostSeat)?.name ?? 'the host'} to start…
        </p>
      )}
      <button type="button" className="btn" onClick={onLeave}>
        <LogOut size={16} aria-hidden="true" /> Leave
      </button>
    </div>
  );
}

// ---------- the table ----------
type Pick = { kind: 'hero'; hero: number } | { kind: 'wall'; from: number | 'supply' } | null;

const FACE_TEXT = (f: State['face']) => (typeof f === 'number' ? String(f) : f === 'wall' ? 'Wall' : 'Minotaur');

function Table({ snap, session, onLeave, onAgain, solo }: { snap: Snap; session: Session; onLeave: () => void; onAgain: (() => void) | null; solo: boolean }) {
  const state = snap.state as State;
  const setup = snap.data as LabySetup;
  const you = snap.you ?? 0;
  const names = setup.players.map((p) => p.name);
  const m = state.maze;
  const over = state.phase === 'over';
  const myTurn = state.turn === you && !over;
  const team = (seat: number) => TEAMS[state.corners[seat] as number] as (typeof TEAMS)[number];

  // what is picked on screen is forgotten whenever the game moves on
  const stamp = `${state.turns}`;
  const [ui, setUi] = useState<{ stamp: string; pick: Pick }>({ stamp: '', pick: null });
  const pick = ui.stamp === stamp ? ui.pick : null;
  const choose = (p: Pick) => setUi({ stamp, pick: p });

  const legal = useMemo(() => (myTurn ? legalActions(state) : []), [state, myTurn]);

  // which squares can be tapped now, and what tapping each does
  const targets = new Map<number, Action>();
  const movable = new Set<number>(); // my heroes that can move with this roll
  const movableWalls = new Set<number>();
  let canTakeNew = false;
  if (myTurn) {
    for (const a of legal) {
      if (a.type === 'minotaur') {
        targets.set(a.to, a);
      } else if (a.type === 'move') {
        movable.add(a.hero);
        if (pick?.kind === 'hero' && pick.hero === a.hero) targets.set(a.to, a);
      } else {
        if (a.from === 'supply') canTakeNew = true;
        else movableWalls.add(a.from);
        if (pick?.kind === 'wall' && pick.from === a.from) targets.set(a.to, a);
      }
    }
  }

  const send = (a: Action) => {
    if (session.submit(a)) {
      if (a.type === 'minotaur' && heroAt(state, a.to)) sfx.explosion(10);
      else sfx.angleTick(300 + (a.to % 7) * 40);
    }
  };

  const tap = (cell: number) => {
    if (!myTurn) return;
    const hit = targets.get(cell);
    if (hit) return send(hit);
    const occ = heroAt(state, cell);
    if (typeof state.face === 'number' && occ && occ[0] === you && movable.has(occ[1])) return choose(pick?.kind === 'hero' && pick.hero === occ[1] ? null : { kind: 'hero', hero: occ[1] });
    if (state.face === 'wall' && state.walls.includes(cell) && movableWalls.has(cell)) return choose(pick?.kind === 'wall' && pick.from === cell ? null : { kind: 'wall', from: cell });
    choose(null);
  };

  const seen = useRef(snap.lines.length);
  const wasMine = useRef(myTurn);
  useEffect(() => {
    if (snap.lines.length > seen.current && snap.log[snap.log.length - 1]?.seat !== you) sfx.angleTick(340);
    seen.current = snap.lines.length;
    if (myTurn && !wasMine.current) sfx.turn();
    wasMine.current = myTurn;
  }, [snap.lines.length, snap.log, you, myTurn]);

  const recorded = useRef(false);
  useEffect(() => {
    if (!over || recorded.current) return;
    recorded.current = true;
    if (!solo) return void store.recordResult(GAME_ID, 'played');
    const won = state.winners.includes(you);
    store.recordResult(GAME_ID, won ? 'win' : 'loss');
    if (won) sfx.victory();
    else sfx.defeat();
  }, [over, solo, state.winners, you]);

  const prompt = (() => {
    if (over) return 'Game over';
    if (!myTurn) return `${names[state.turn]} is ${setup.players[state.turn]?.kind === 'bot' ? 'thinking' : 'playing'}…${snap.online ? '' : ' (reconnecting)'}`;
    if (typeof state.face === 'number') return pick?.kind === 'hero' ? `Where should it go? Exactly ${state.face} squares (tap a lit square)` : `You rolled ${state.face}: tap a hero to move it ${state.face} squares`;
    if (state.face === 'wall') return pick?.kind === 'wall' ? 'Tap a lit square to put the wall there' : 'You rolled a wall: take a new one, or tap a wall in the maze to move it';
    return 'You rolled the Minotaur: tap where it charges (a red ring means it hits a hero)';
  })();

  const need = heroesNeeded(state.players);
  const cells = m.cells.map((c, i) => {
    const occ = heroAt(state, i);
    const target = targets.get(i);
    const isWall = state.walls.includes(i);
    const classes = ['lb-cell'];
    if (c === '#') classes.push('lb-hedge');
    else if (c === 'M') classes.push('lb-lair');
    else if ('abcd'.includes(c)) classes.push('lb-start');
    else if ('ABCD'.includes(c)) classes.push('lb-goal');
    if (isWall) classes.push('lb-wall');
    if (target) classes.push(target.type === 'minotaur' && occ ? 'lb-hit' : 'lb-target');
    if (pick?.kind === 'hero' && occ && occ[0] === you && occ[1] === pick.hero) classes.push('lb-picked');
    if (pick?.kind === 'wall' && pick.from === i) classes.push('lb-picked');
    if (myTurn && !target && ((occ && occ[0] === you && movable.has(occ[1]) && !pick) || (isWall && movableWalls.has(i) && !pick))) classes.push('lb-ready');
    const cornerOfCell = 'abcdABCD'.includes(c) ? 'abcdABCD'.indexOf(c) % 4 : -1;
    const style = cornerOfCell >= 0 ? { ['--team' as string]: TEAMS[cornerOfCell]?.colour } : undefined;
    const interactive = !!target || (myTurn && ((occ && occ[0] === you && movable.has(occ[1])) || (isWall && movableWalls.has(i))));
    const content = (
      <>
        {occ && (
          <span className="lb-hero" style={{ ['--team' as string]: team(occ[0]).colour, ['--ink' as string]: team(occ[0]).ink }} data-hero={`${occ[0]}:${occ[1]}`} aria-hidden="true">
            {occ[1] + 1}
          </span>
        )}
        {i === state.minotaur && (
          <svg className="lb-minotaur" viewBox="0 0 24 24" aria-hidden="true" data-minotaur="yes">
            <path d="M3 4c1 5 3 6 5 7M21 4c-1 5-3 6-5 7" fill="none" stroke="#18181b" strokeWidth="2.4" strokeLinecap="round" />
            <circle cx="12" cy="13" r="6.5" fill="#8B4A2B" stroke="#18181b" strokeWidth="1.6" />
            <circle cx="9.7" cy="12" r="1" fill="#fff" />
            <circle cx="14.3" cy="12" r="1" fill="#fff" />
            <ellipse cx="12" cy="16" rx="2.6" ry="1.8" fill="#E8B796" stroke="#18181b" strokeWidth="1" />
          </svg>
        )}
      </>
    );
    const common = { key: i, className: classes.join(' '), style, 'data-cell': i, 'data-kind': isWall ? 'wall' : c === '#' ? 'hedge' : c === 'M' ? 'lair' : 'abcd'.includes(c) ? 'start' : 'ABCD'.includes(c) ? 'goal' : 'open', 'data-target': target ? 'yes' : undefined };
    return interactive ? (
      <button type="button" {...common} onClick={() => tap(i)} aria-label={`Square ${(i % m.width) + 1}, ${Math.floor(i / m.width) + 1}${target ? ', can go here' : ''}`}>
        {content}
      </button>
    ) : (
      <div {...common}>{content}</div>
    );
  });

  return (
    <div className="gm-wrap lb-wrap" data-screen="play" data-turn={state.turn} data-my-seat={you} data-face={String(state.face)} data-over={over ? 'yes' : 'no'} data-turns={state.turns} data-online={snap.online ? 'yes' : 'no'}>
      <div className="lb-players">
        {state.heroes.map((_, seat) => (
          <div key={seat} className={`score${state.turn === seat && !over ? ' score-active' : ''}`} data-seat={seat} data-home={heroesHome(state, seat)} style={{ ['--player' as string]: team(seat).colour }}>
            <span>
              <span className="score-dot" />
              {names[seat]}
              {seat === you ? ' (you)' : ''}
            </span>
            <output aria-label={`${heroesHome(state, seat)} of ${need} heroes home`}>
              {heroesHome(state, seat)}/{need}
            </output>
          </div>
        ))}
      </div>

      <div className="lb-roll">
        <span className={`lb-die lb-die-${typeof state.face === 'number' ? 'n' : state.face}`} aria-label={`${names[state.turn]} rolled ${FACE_TEXT(state.face)}`} data-die={String(state.face)}>
          {FACE_TEXT(state.face)}
        </span>
        <p className="board-status" role="status">
          {prompt}
        </p>
      </div>

      <div className="lb-board" role="group" aria-label="The labyrinth" style={{ gridTemplateColumns: `repeat(${m.width}, minmax(0, 1fr))` }}>
        {cells}
      </div>

      {myTurn && state.face === 'wall' && (
        <div className="board-actions">
          <button type="button" className="btn btn-primary" disabled={!canTakeNew} onClick={() => choose({ kind: 'wall', from: 'supply' })} data-action="new-wall" aria-pressed={pick?.kind === 'wall' && pick.from === 'supply'}>
            Take a new wall ({state.wallSupply} left)
          </button>
        </div>
      )}
      {myTurn && legal.length === 0 && <p className="gm-note">Nothing can be done with that roll.</p>}
      <p className="lb-legend">
        {state.walls.length} wall{state.walls.length === 1 ? '' : 's'} in the maze, {state.wallSupply} at the edge. Squares in your colour are safe from the Minotaur. {HEROES_PER_PLAYER} heroes each; {need} must get home.
      </p>

      <ol className="gm-log" aria-label="Recent moves">
        {snap.lines.slice(-5).map((l, i) => (
          <li key={snap.lines.length - 5 + i}>{l}</li>
        ))}
        {snap.lines.length === 0 && <li className="gm-log-empty">No moves yet.</li>}
      </ol>

      {over && (
        <div className="end-card" role="status" data-result={state.winners.includes(you) ? 'win' : 'loss'}>
          <h2>{state.winners.includes(you) ? (state.winners.length > 1 ? 'A shared victory!' : 'You win!') : `${state.winners.map((w) => names[w]).join(' and ')} win${state.winners.length === 1 ? 's' : ''}`}</h2>
          <p>
            {state.winners.map((w) => `${names[w]} (${team(w).name})`).join(', ')} reached the temple after {state.turns} turns.
          </p>
          <div className="board-actions">
            {onAgain && (
              <button type="button" className="btn btn-primary" onClick={onAgain} data-action="again" autoFocus>
                Play again
              </button>
            )}
            <button type="button" className="btn" onClick={onLeave} data-action="menu">
              {solo ? 'Change settings' : 'Leave the room'}
            </button>
          </div>
        </div>
      )}
      {!over && (
        <div className="board-actions">
          <button type="button" className="btn" onClick={onLeave} data-action="leave">
            <LogOut size={16} aria-hidden="true" /> Leave game
          </button>
        </div>
      )}
    </div>
  );
}

