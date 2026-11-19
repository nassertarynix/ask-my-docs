import { Bot, Copy, Globe, Heart, LogOut, Shield, Hand } from 'lucide-react';
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
import { HEROES, MAX_HAND, MAX_SHIELD, defOf, heroById, needsTarget, summary } from './cards';
import { MAX_PLAYERS, aliveSeats, legalActions, type Action, type Player, type State } from './engine';
import { assignHeroes, brawlAdapter, type BrawlSetup } from './online';
import { BrawlCard } from './Visuals';

export const GAME_ID = 'pit-brawl';
type Session = OnlineSession<State, Action, BrawlSetup>;
type Snap = Snapshot<State, Action, BrawlSetup>;
type Mode = 'solo' | 'online';
const BOT_NAMES = ['Rook', 'Ember', 'Willow', 'Flint', 'Sable', 'Juniper', 'Cinder', 'Marrow', 'Pike'];
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
  const [saved] = useState(() => store.loadGameSettings(GAME_ID, { mode: 'solo', name: '', opponents: '3', level: 'normal', hero: 'random' }));
  const linkedRoom = (params.get('room') ?? '').toUpperCase();
  const [mode, setMode] = useState<Mode>(ROOM_CODE.test(linkedRoom) || saved.mode === 'online' ? 'online' : 'solo');
  const [name, setName] = useState(saved.name);
  const [opponents, setOpponents] = useState(Math.min(MAX_PLAYERS - 1, Math.max(1, Number(saved.opponents) || 3)));
  const [level, setLevel] = useState<BotLevel>(isLevel(saved.level) ? saved.level : 'normal');
  const [hero, setHero] = useState<number | null>(saved.hero === 'random' ? null : Math.min(HEROES.length - 1, Math.max(0, Number(saved.hero) || 0)));
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
  const myName = cleanName(name) || 'Brawler';
  const remember = () => store.saveGameSettings(GAME_ID, { mode, name: cleanName(name), opponents: String(opponents), level, hero: hero === null ? 'random' : String(hero) });

  const startSolo = () => {
    sfx.click();
    remember();
    const seed = gameSeed();
    const heroes = assignHeroes(opponents + 1, seed, hero);
    const setup: BrawlSetup = {
      players: [{ name: myName, kind: 'human', hero: heroes[0] as number }, ...BOT_NAMES.slice(0, opponents).map((n, i) => ({ name: n, kind: 'bot' as const, hero: heroes[i + 1] as number, level }))],
      seed,
    };
    const memory = new MemoryRelay();
    setLastSolo(true);
    attach(new OnlineSession({ adapter: brawlAdapter, connect: memory.connect('SOLO1'), code: 'SOLO1', name: myName, tokens: noTokens, autoStart: setup, maxSeats: MAX_PLAYERS, botDelayMs: fast ? 30 : 600 }));
  };

  const goOnline = (code: string) => {
    sfx.click();
    remember();
    setLastSolo(false);
    window.history.replaceState(null, '', roomHash(code)); // no navigation: it only lets a refresh find the room again
    attach(new OnlineSession({ adapter: brawlAdapter, connect: webSocketConnect(`${relay}/room/${code}`), code, name: myName, maxSeats: MAX_PLAYERS, botDelayMs: fast ? 30 : 600 }));
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
        A free-for-all brawl: each turn draw a card and play one. Hit, shield, heal, steal, sweep the whole table. Last hero standing wins. Up to ten players.
      </p>
      <RadioCards
        legend="How do you want to play?"
        name="pb-mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'solo', title: 'Against computers', hint: 'On your own, no connection needed', icon: <Bot size={22} aria-hidden="true" /> },
          { value: 'online', title: 'Online with friends', hint: 'Share a room code, up to ten players', icon: <Globe size={22} aria-hidden="true" /> },
        ]}
      />
      <label className="gm-field">
        <span>Your name</span>
        <input type="text" value={name} maxLength={20} placeholder="Brawler" onChange={(e) => setName(e.target.value)} data-field="name" autoComplete="nickname" />
      </label>
      {mode === 'solo' && (
        <>
          <fieldset className="choice-group">
            <legend>Your hero</legend>
            <div className="pb-heroes" role="radiogroup" aria-label="Your hero">
              <button type="button" role="radio" aria-checked={hero === null} className={`pb-hero-pick${hero === null ? ' pb-selected' : ''}`} onClick={() => setHero(null)} data-hero="random">
                <strong>Random</strong>
              </button>
              {HEROES.map((h) => (
                <button key={h.id} type="button" role="radio" aria-checked={hero === h.id} className={`pb-hero-pick${hero === h.id ? ' pb-selected' : ''}`} style={{ ['--hero' as string]: h.colour }} onClick={() => setHero(h.id)} data-hero={h.id}>
                  <strong>{h.name}</strong>
                  <small>{h.title}</small>
                </button>
              ))}
            </div>
          </fieldset>
          <label className="gm-field">
            <span>
              Computer opponents: <output data-output="opponents">{opponents}</output>
            </span>
            <input type="range" min={1} max={MAX_PLAYERS - 1} value={opponents} onChange={(e) => setOpponents(Number(e.target.value))} data-field="opponents" aria-label="Computer opponents" />
          </label>
          <RadioCards
            legend="How good are they?"
            name="pb-level"
            value={level}
            onChange={setLevel}
            options={[
              { value: 'easy', title: 'Easy', hint: 'Often plays at random' },
              { value: 'normal', title: 'Normal', hint: 'Hits what it can finish' },
              { value: 'hard', title: 'Hard', hint: 'Sharp and consistent' },
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
  const [wanted, setWanted] = useState(0);
  const [botLevel, setBotLevel] = useState<BotLevel>(level);
  const [copied, setCopied] = useState(false);
  const room = MAX_PLAYERS - humans;
  const bots = Math.min(room, Math.max(wanted, humans < 2 ? 2 - humans : 0));
  const total = humans + bots;
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
    const seed = gameSeed();
    const heroes = assignHeroes(total, seed);
    const players: BrawlSetup['players'] = [
      ...snap.players.map((p, i) => ({ name: p.name, kind: 'human' as const, hero: heroes[i] as number })),
      ...BOT_NAMES.slice(0, bots).map((n, i) => ({ name: n, kind: 'bot' as const, hero: heroes[humans + i] as number, level: botLevel })),
    ];
    session.start({ players, seed });
  };

  return (
    <div className="setup gm-lobby" data-screen="lobby">
      <p className="setup-lede">Share this code with your friends. Up to ten can play; computers fill empty seats. Heroes are dealt out at random.</p>
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
          <label className="gm-field">
            <span>
              Computer players: <output data-output="bots">{bots}</output> ({total} at the table)
            </span>
            <input type="range" min={Math.max(0, 2 - humans)} max={room} value={bots} onChange={(e) => setWanted(Number(e.target.value))} data-field="bots" aria-label="Computer players" disabled={room === 0} />
          </label>
          {bots > 0 && (
            <RadioCards
              legend="How good are the computers?"
              name="pb-lobby-level"
              value={botLevel}
              onChange={setBotLevel}
              options={[
                { value: 'easy', title: 'Easy' },
                { value: 'normal', title: 'Normal' },
                { value: 'hard', title: 'Hard' },
              ]}
            />
          )}
          <button type="button" className="btn btn-primary btn-big" onClick={begin} disabled={total < 2} data-action="begin">
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
function Table({ snap, session, onLeave, onAgain, solo }: { snap: Snap; session: Session; onLeave: () => void; onAgain: (() => void) | null; solo: boolean }) {
  const state = snap.state as State;
  const setup = snap.data as BrawlSetup;
  const you = snap.you ?? 0;
  const names = setup.players.map((p) => p.name);
  const over = state.phase === 'over';
  const myTurn = state.turn === you && !over;
  const me = state.players[you] as Player;

  // the card picked on screen is forgotten whenever the game moves on
  const stamp = `${state.turns}:${state.plays}`;
  const [ui, setUi] = useState<{ stamp: string; card: number | null }>({ stamp: '', card: null });
  const card = ui.stamp === stamp ? ui.card : null;
  const choose = (c: number | null) => setUi({ stamp, card: c });

  const legal = useMemo(() => legalActions(state), [state]);
  const def = card === null ? null : defOf(card);
  const wantsTarget = def !== null && needsTarget(def);
  const targets = new Set(card !== null && wantsTarget ? legal.filter((a) => a.card === card).map((a) => a.target) : []);

  const send = (a: Action) => {
    if (session.submit(a)) sfx.click();
  };
  const tapTile = (seat: number) => {
    if (card !== null && wantsTarget && targets.has(seat)) send({ type: 'play', card, target: seat });
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
    if (!me.alive) return `You are out. ${names[state.turn]} is playing…`;
    if (!myTurn) return `${names[state.turn]} is ${setup.players[state.turn]?.kind === 'bot' ? 'thinking' : 'playing'}…${snap.online ? '' : ' (reconnecting)'}`;
    if (card !== null && wantsTarget) return 'Choose who to play it on';
    return state.plays > 1 ? `Your turn: play a card (${state.plays} plays left)` : 'Your turn: play a card';
  })();

  const tile = (seat: number) => {
    const p = state.players[seat] as Player;
    const hero = heroById(p.hero);
    const isTarget = targets.has(seat);
    const classes = ['pb-tile'];
    if (state.turn === seat && !over) classes.push('pb-active');
    if (!p.alive) classes.push('pb-out');
    if (seat === you) classes.push('pb-me');
    if (isTarget) classes.push('pb-target');
    const inner = (
      <>
        <span className="pb-tile-name">
          <strong>{names[seat]}</strong>
          <small>
            {hero.name} {hero.title}
          </small>
        </span>
        <span className="pb-bar" aria-hidden="true">
          <span className="pb-bar-fill" style={{ width: `${(100 * p.hp) / state.maxHp}%` }} />
        </span>
        <span className="pb-stats">
          <span title="Health">
            <Heart size={13} aria-hidden="true" /> <b>{p.hp}</b>
          </span>
          <span title="Shield" className={p.shield > 0 ? 'pb-has-shield' : ''}>
            <Shield size={13} aria-hidden="true" /> <b>{p.shield}</b>
          </span>
          <span title="Cards in hand">
            <Hand size={13} aria-hidden="true" /> <b>{p.hand.length}</b>
          </span>
        </span>
        {!p.alive && <span className="pb-out-tag">out</span>}
      </>
    );
    const common = { key: seat, className: classes.join(' '), style: { ['--hero' as string]: hero.colour }, 'data-seat': seat, 'data-hp': p.hp, 'data-shield': p.shield, 'data-hand': p.hand.length, 'data-alive': p.alive ? 'yes' : 'no', 'data-target': isTarget ? 'yes' : undefined };
    return isTarget ? (
      <button type="button" {...common} onClick={() => tapTile(seat)} aria-label={`Play on ${names[seat]}`}>
        {inner}
      </button>
    ) : (
      <div {...common}>{inner}</div>
    );
  };

  return (
    <div className="gm-wrap pb-wrap" data-screen="play" data-turn={state.turn} data-my-seat={you} data-over={over ? 'yes' : 'no'} data-plays={state.plays} data-turns={state.turns} data-alive={aliveSeats(state).length} data-online={snap.online ? 'yes' : 'no'}>
      <p className="board-status" role="status">
        {prompt}
      </p>
      <div className="pb-tiles" role="group" aria-label="Players">
        {state.players.map((_, i) => tile(i))}
      </div>

      {me.alive && (
        <div className={`pb-hand-area${myTurn ? ' gm-active' : ''}`}>
          <div className="pb-hand" role="group" aria-label={`Your hand, ${me.hand.length} of ${MAX_HAND} cards`}>
            {me.hand.map((c, i) => (
              <BrawlCard key={`${c}-${i}`} id={c} selected={card === c} disabled={!myTurn} onClick={() => choose(card === c ? null : c)} />
            ))}
            {me.hand.length === 0 && <span className="gm-log-empty">No cards in hand.</span>}
          </div>
          <small className="pb-pile">
            Draw pile {me.drawPile.length} · discard {me.discard.length} · shield lasts until your next turn (max {MAX_SHIELD})
          </small>
        </div>
      )}

      {myTurn && card !== null && def && (
        <div className="gm-actionbar" data-bar="card">
          <strong>{def.name}</strong>
          <span>{summary(def)}</span>
          {wantsTarget ? (
            <small className="gm-hint">Tap one of the highlighted players.</small>
          ) : (
            <button type="button" className="btn btn-primary" onClick={() => send({ type: 'play', card })} data-action="play">
              Play it
            </button>
          )}
          <button type="button" className="btn" onClick={() => choose(null)} data-action="cancel">
            Cancel
          </button>
        </div>
      )}

      <ol className="gm-log" aria-label="Recent plays">
        {snap.lines.slice(-6).map((l, i) => (
          <li key={snap.lines.length - 6 + i}>{l}</li>
        ))}
        {snap.lines.length === 0 && <li className="gm-log-empty">No plays yet.</li>}
      </ol>

      {over && (
        <div className="end-card" role="status" data-result={state.winners.includes(you) ? 'win' : 'loss'}>
          <h2>{state.winners.includes(you) ? (state.winners.length > 1 ? 'A shared win!' : 'You win!') : `${state.winners.map((w) => names[w]).join(' and ')} win${state.winners.length === 1 ? 's' : ''}`}</h2>
          <p>
            {state.winners.map((w) => `${names[w]} (${heroById((state.players[w] as Player).hero).name})`).join(', ')} {state.winners.length === 1 ? 'is' : 'are'} the last standing after {state.turns} turns.
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
