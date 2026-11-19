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
import { GEMS, GEM_NAMES, cardById, patronById, type Gem, type Level } from './cards';
import { bonusesOf, eligiblePatrons, keyOf, legalActions, scoreOf, tokensOf, MAX_TOKENS, TARGET_POINTS, type Action, type PlayerState, type State } from './engine';
import { gemAdapter, type GemSetup } from './online';
import { CardBack, CardView, GemIcon, PatronView } from './Visuals';

export const GAME_ID = 'gem-merchants';
type Session = OnlineSession<State, Action, GemSetup>;
type Snap = Snapshot<State, Action, GemSetup>;
type Mode = 'solo' | 'online';
const BOT_NAMES = ['Marlowe', 'Quill', 'Tamsin'];
const isLevel = (v: string): v is BotLevel => v === 'easy' || v === 'normal' || v === 'hard';
const noTokens: TokenStore = { get: () => null, set: () => undefined };
const noSubscribe = () => () => undefined;
const noSnapshot = () => null;
const randomSeed = () => (Date.now() ^ Math.floor(Math.random() * 0xffffff)) >>> 0;

/** The page address for this game, with the room code in it (so a refresh can rejoin) and any development relay override kept. */
function roomHash(code: string | null): string {
  const query = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const next = new URLSearchParams();
  if (code) next.set('room', code);
  for (const key of ['relay', 'fast']) {
    const v = query.get(key);
    if (v) next.set(key, v);
  }
  const text = next.toString();
  return `#/play/${GAME_ID}${text ? `?${text}` : ''}`;
}

type CardSel = { kind: 'board'; level: Level; slot: number } | { kind: 'reserved'; index: number } | { kind: 'deck'; level: Level } | null;

export default function GameView(_props: GameProps) {
  const params = useMemo(() => new URLSearchParams(window.location.hash.split('?')[1] ?? ''), []);
  const relay = relayUrl(params);
  const [saved] = useState(() => store.loadGameSettings(GAME_ID, { mode: 'solo', name: '', bots: '2', level: 'normal' }));
  const linkedRoom = (params.get('room') ?? '').toUpperCase();
  const fast = params.get('fast') === '1'; // for tests: computers play at once
  const [mode, setMode] = useState<Mode>(ROOM_CODE.test(linkedRoom) || saved.mode === 'online' ? 'online' : 'solo');
  const [name, setName] = useState(saved.name);
  const [bots, setBots] = useState(['1', '2', '3'].includes(saved.bots) ? saved.bots : '2');
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
  const myName = cleanName(name) || 'Merchant';
  const remember = () => store.saveGameSettings(GAME_ID, { mode, name: cleanName(name), bots, level });

  const startSolo = () => {
    sfx.click();
    remember();
    const setup: GemSetup = {
      players: [{ name: myName, kind: 'human' }, ...BOT_NAMES.slice(0, Number(bots)).map((n) => ({ name: n, kind: 'bot' as const, level }))],
      seed: randomSeed(),
    };
    const memory = new MemoryRelay();
    setLastSolo(true);
    attach(new OnlineSession({ adapter: gemAdapter, connect: memory.connect('SOLO1'), code: 'SOLO1', name: myName, tokens: noTokens, autoStart: setup, botDelayMs: fast ? 40 : undefined }));
  };

  const goOnline = (code: string) => {
    sfx.click();
    remember();
    setLastSolo(false);
    window.history.replaceState(null, '', roomHash(code)); // no navigation: it only lets a refresh find the room again
    attach(new OnlineSession({ adapter: gemAdapter, connect: webSocketConnect(`${relay}/room/${code}`), code, name: myName, botDelayMs: fast ? 60 : undefined }));
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
        Collect gems, buy stalls that make later buys cheaper, and attract patrons. First to {TARGET_POINTS} points ends the round. 2 to 4 merchants.
      </p>
      <RadioCards
        legend="How do you want to play?"
        name="gm-mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'solo', title: 'Against computers', hint: 'On your own, no connection needed', icon: <Bot size={22} aria-hidden="true" /> },
          { value: 'online', title: 'Online with friends', hint: 'Share a room code', icon: <Globe size={22} aria-hidden="true" /> },
        ]}
      />
      <label className="gm-field">
        <span>Your name</span>
        <input type="text" value={name} maxLength={20} placeholder="Merchant" onChange={(e) => setName(e.target.value)} data-field="name" autoComplete="nickname" />
      </label>
      {mode === 'solo' && (
        <>
          <RadioCards
            legend="Computer merchants"
            name="gm-bots"
            value={bots}
            onChange={setBots}
            options={[
              { value: '1', title: '1', hint: 'Two at the table' },
              { value: '2', title: '2', hint: 'Three at the table' },
              { value: '3', title: '3', hint: 'Four at the table' },
            ]}
          />
          <RadioCards
            legend="How good are they?"
            name="gm-level"
            value={level}
            onChange={setLevel}
            options={[
              { value: 'easy', title: 'Easy', hint: 'Often plays at random' },
              { value: 'normal', title: 'Normal', hint: 'Sensible, a little unpredictable' },
              { value: 'hard', title: 'Hard', hint: 'Steady, and blocks your best buys' },
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
          Against computers: {stats.wins} won, {stats.losses} lost{stats.draws ? `, ${stats.draws} drawn` : ''}.
        </p>
      )}
    </div>
  );
}

// ---------- the lobby ----------
function Lobby({ snap, session, onLeave, level }: { snap: Snap; session: Session; onLeave: () => void; level: BotLevel }) {
  const humans = snap.players.length;
  const isHost = snap.you !== null && snap.you === snap.hostSeat;
  const [seatsChoice, setSeatsChoice] = useState('3');
  const [botLevel, setBotLevel] = useState<BotLevel>(level);
  const [copied, setCopied] = useState(false);
  const seats = Math.max(2, humans, Math.min(4, Number(seatsChoice)));
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
    const players: GemSetup['players'] = [
      ...snap.players.map((p) => ({ name: p.name, kind: 'human' as const })),
      ...BOT_NAMES.slice(0, seats - humans).map((n) => ({ name: n, kind: 'bot' as const, level: botLevel })),
    ];
    session.start({ players, seed: randomSeed() });
  };

  return (
    <div className="setup gm-lobby" data-screen="lobby">
      <p className="setup-lede">Share this code with your friends. Up to four can sit at the table; computers fill empty seats.</p>
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
            legend="Seats at the table"
            name="gm-seats"
            value={String(seats)}
            onChange={setSeatsChoice}
            options={(['2', '3', '4'] as const).map((n) => ({ value: n, title: n, hint: Number(n) < humans ? 'Too few for everyone here' : `${Math.max(0, Number(n) - humans)} computer${Number(n) - humans === 1 ? '' : 's'}` }))}
          />
          {seats > humans && (
            <RadioCards
              legend="How good are the computers?"
              name="gm-lobby-level"
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
function Table({ snap, session, onLeave, onAgain, solo }: { snap: Snap; session: Session; onLeave: () => void; onAgain: (() => void) | null; solo: boolean }) {
  const state = snap.state as State;
  const setup = snap.data as GemSetup;
  const you = snap.you ?? 0;
  const names = setup.players.map((p) => p.name);
  const over = state.phase === 'over';
  const myTurn = state.turn === you && !over;
  const me = state.players[you] as PlayerState;

  // what is picked on screen is forgotten whenever the game moves on
  const stamp = `${state.turns}:${state.phase}`;
  const [ui, setUi] = useState<{ stamp: string; pick: Gem[]; sel: CardSel }>({ stamp: '', pick: [], sel: null });
  const cur = ui.stamp === stamp ? ui : { stamp, pick: [] as Gem[], sel: null as CardSel };
  const setPick = (pick: Gem[]) => setUi({ stamp, pick, sel: null });
  const setSel = (sel: CardSel) => setUi({ stamp, pick: [], sel });

  const legalKeys = useMemo(() => new Set(legalActions(state).map(keyOf)), [state]);
  const can = (a: Action) => myTurn && legalKeys.has(keyOf(a));

  const pickAction: Action | null = cur.pick.length === 0 ? null : cur.pick.length === 2 && cur.pick[0] === cur.pick[1] ? { type: 'take2', gem: cur.pick[0] as Gem } : { type: 'take3', gems: cur.pick };
  const sel = cur.sel;
  const buyAction: Action | null = !sel || sel.kind === 'deck' ? null : { type: 'buy', from: sel.kind === 'board' ? { level: sel.level, slot: sel.slot } : { reserved: sel.index } };
  const reserveAction: Action | null = !sel || sel.kind === 'reserved' ? null : { type: 'reserve', level: sel.level, slot: sel.kind === 'deck' ? 'deck' : sel.slot };

  const send = (a: Action | null) => {
    if (a && session.submit(a)) {
      if (a.type === 'buy') sfx.explosion(6);
      else sfx.click();
    }
  };

  const tapGem = (g: Gem) => {
    if (!myTurn || state.phase !== 'action') return;
    sfx.click();
    const p = cur.pick;
    if (p.length === 2 && p[0] === p[1]) return setPick(p[0] === g ? [] : [g]);
    if (p.includes(g)) {
      if (p.length === 1 && state.supply[g] >= 4) return setPick([g, g]); // a second tap on the same colour means "two of these"
      return setPick(p.filter((x) => x !== g));
    }
    if (p.length < 3) setPick([...p, g]);
  };

  // sounds for other people's moves, and a nudge when it becomes your turn
  const seen = useRef(snap.lines.length);
  const wasMine = useRef(myTurn);
  useEffect(() => {
    if (snap.lines.length > seen.current && snap.log[snap.log.length - 1]?.seat !== you) sfx.angleTick(360);
    seen.current = snap.lines.length;
    if (myTurn && !wasMine.current) sfx.turn();
    wasMine.current = myTurn;
  }, [snap.lines.length, snap.log, you, myTurn]);

  // record the result once
  const recorded = useRef(false);
  useEffect(() => {
    if (!over || recorded.current) return;
    recorded.current = true;
    if (!solo) return void store.recordResult(GAME_ID, 'played');
    const won = state.winners.includes(you);
    store.recordResult(GAME_ID, won ? (state.winners.length === 1 ? 'win' : 'draw') : 'loss');
    if (won) sfx.victory();
    else sfx.defeat();
  }, [over, solo, state.winners, you]);

  const prompt = (() => {
    if (over) return 'Game over';
    if (!myTurn) return `${names[state.turn]} is ${setup.players[state.turn]?.kind === 'bot' ? 'thinking' : 'playing'}…${snap.online ? '' : ' (reconnecting)'}`;
    if (state.phase === 'discard') return `Too many tokens: hand back ${tokensOf(me) - MAX_TOKENS} (tap your tokens)`;
    if (state.phase === 'patron') return 'A patron is visiting: choose one';
    return 'Your turn: take gems, reserve a stall or buy one';
  })();

  const selectedCardId = !sel ? null : sel.kind === 'board' ? (state.board[sel.level - 1]?.[sel.slot] ?? null) : sel.kind === 'reserved' ? (me.reserved[sel.index]?.id ?? null) : null;
  const patronChoices = myTurn && state.phase === 'patron' ? eligiblePatrons(state, you) : [];
  const bonus = bonusesOf(me);

  return (
    <div
      className="gm-wrap"
      data-screen="play"
      data-turn={state.turn}
      data-phase={state.phase}
      data-my-seat={you}
      data-over={over ? 'yes' : 'no'}
      data-turns={state.turns}
      data-scores={state.players.map((_, i) => scoreOf(state, i)).join(',')}
      data-online={snap.online ? 'yes' : 'no'}
    >
      <div className="gm-others">
        {state.players.map((p, i) =>
          i === you ? null : (
            <div key={i} className={`gm-other${state.turn === i && !over ? ' gm-active' : ''}`} data-seat={i} data-score={scoreOf(state, i)} data-tokens={tokensOf(p)}>
              <span className="gm-other-head">
                <strong>{names[i]}</strong>
                <span className="gm-other-score" aria-label={`${scoreOf(state, i)} points`}>
                  {scoreOf(state, i)} pts
                </span>
              </span>
              <span className="gm-mini" aria-label="Tokens held, and the discount their stalls give">
                {GEMS.map((g) => {
                  const off = bonusesOf(p)[g] as number;
                  return (
                    <span key={g} className={`gm-mini-gem${p.gems[g] === 0 && off === 0 ? ' gm-zero' : ''}`} title={GEM_NAMES[g]}>
                      <GemIcon gem={g} size={18} />
                      <b>{p.gems[g]}</b>
                      {off > 0 && <i>+{off}</i>}
                    </span>
                  );
                })}
                <span className={`gm-mini-gem${p.gems.gold === 0 ? ' gm-zero' : ''}`} title="Gold">
                  <GemIcon gem="gold" size={18} />
                  <b>{p.gems.gold}</b>
                </span>
              </span>
              <span className="gm-other-extra">
                {tokensOf(p)} tokens · {p.cards.length} stalls{p.patrons.length ? ` · ${p.patrons.length} patron${p.patrons.length === 1 ? '' : 's'}` : ''}
                {p.reserved.length > 0 && (
                  <span className="gm-reserved-row" aria-label={`${p.reserved.length} reserved`}>
                    {p.reserved.map((r, k) => (r.open ? <CardView key={k} id={r.id} /> : <CardBack key={k} level={cardById(r.id).level} />))}
                  </span>
                )}
              </span>
            </div>
          ),
        )}
      </div>

      <p className="board-status" role="status">
        {prompt}
      </p>

      <div className="gm-patrons" aria-label="Patrons">
        {state.patrons.map((id) => (
          <PatronView key={id} id={id} eligible={patronChoices.includes(id)} onClick={patronChoices.includes(id) ? () => send({ type: 'patron', id }) : undefined} />
        ))}
      </div>

      <div className="gm-board" role="group" aria-label="Stalls for sale">
        {([3, 2, 1] as Level[]).map((level) => (
          <div className="gm-row" key={level} data-level={level}>
            <CardBack
              level={level}
              count={(state.decks[level - 1] as readonly number[]).length}
              selected={sel?.kind === 'deck' && sel.level === level}
              onClick={(state.decks[level - 1] as readonly number[]).length > 0 ? () => setSel({ kind: 'deck', level }) : undefined}
              data={{ deck: level }}
            />
            {(state.board[level - 1] as readonly (number | null)[]).map((id, slot) =>
              id === null ? (
                <span key={slot} className="gm-empty" />
              ) : (
                <CardView
                  key={slot}
                  id={id}
                  data={{ slot }}
                  selected={sel?.kind === 'board' && sel.level === level && sel.slot === slot}
                  affordable={can({ type: 'buy', from: { level, slot } })}
                  onClick={() => setSel({ kind: 'board', level, slot })}
                />
              ),
            )}
          </div>
        ))}
      </div>

      <div className="gm-supply" role="group" aria-label="Gem supply">
        {GEMS.map((g) => {
          const n = cur.pick.filter((x) => x === g).length;
          return (
            <button key={g} type="button" className={`gm-token${n ? ' gm-selected' : ''}`} data-supply={g} data-count={state.supply[g]} disabled={!myTurn || state.phase !== 'action' || state.supply[g] === 0} onClick={() => tapGem(g)} aria-label={`${GEM_NAMES[g]}: ${state.supply[g]} in the supply${n ? `, ${n} picked` : ''}`}>
              <GemIcon gem={g} size={34} />
              <span className="gm-count">{state.supply[g]}</span>
              {n > 0 && <span className="gm-picked">{n}</span>}
            </button>
          );
        })}
        <span className="gm-token gm-gold" data-supply="gold" data-count={state.supply.gold} aria-label={`Gold: ${state.supply.gold} in the supply`}>
          <GemIcon gem="gold" size={34} />
          <span className="gm-count">{state.supply.gold}</span>
        </span>
      </div>

      {myTurn && state.phase === 'action' && (cur.pick.length > 0 || sel) && (
        <div className="gm-actionbar" data-bar={sel ? 'card' : 'gems'}>
          {cur.pick.length > 0 && (
            <>
              <span className="gm-picks" aria-label="Gems picked">
                {cur.pick.map((g, i) => (
                  <GemIcon key={i} gem={g} size={28} />
                ))}
              </span>
              <button type="button" className="btn btn-primary" disabled={!pickAction || !can(pickAction)} onClick={() => send(pickAction)} data-action="take">
                {cur.pick.length === 2 && cur.pick[0] === cur.pick[1] ? `Take two ${GEM_NAMES[cur.pick[0] as Gem]}` : `Take ${cur.pick.length} gem${cur.pick.length === 1 ? '' : 's'}`}
              </button>
              <button type="button" className="btn" onClick={() => setPick([])} data-action="clear">
                Clear
              </button>
              {!(pickAction && can(pickAction)) && <small className="gm-hint">Pick three different gems, or tap one colour twice for a pair.</small>}
            </>
          )}
          {sel && (
            <>
              {selectedCardId !== null ? <CardView id={selectedCardId} large /> : <CardBack level={(sel as { level: Level }).level} />}
              <span className="gm-buttons">
                {buyAction && (
                  <button type="button" className="btn btn-primary" disabled={!can(buyAction)} onClick={() => send(buyAction)} data-action="buy">
                    Buy
                  </button>
                )}
                {reserveAction && (
                  <button type="button" className="btn" disabled={!can(reserveAction)} onClick={() => send(reserveAction)} data-action="reserve">
                    Reserve
                  </button>
                )}
                <button type="button" className="btn" onClick={() => setSel(null)} data-action="cancel">
                  Cancel
                </button>
              </span>
              {buyAction && !can(buyAction) && <small className="gm-hint">You cannot afford this one yet.</small>}
            </>
          )}
        </div>
      )}

      <div className={`gm-mine${myTurn ? ' gm-active' : ''}`} data-seat={you} data-score={scoreOf(state, you)} data-tokens={tokensOf(me)}>
        <div className="gm-mine-head">
          <strong>{names[you]} (you)</strong>
          <span className="gm-other-score">{scoreOf(state, you)} pts</span>
        </div>
        <div className="gm-mine-tokens">
          {[...GEMS, 'gold' as const].map((t) => {
            const n = me.gems[t];
            const giveBack = myTurn && state.phase === 'discard' && n > 0;
            return (
              <button key={t} type="button" className={`gm-token gm-mine-token${giveBack ? ' gm-giveback' : ''}`} data-mine={t} data-count={n} disabled={!giveBack} onClick={() => send({ type: 'return', token: t })} aria-label={`${GEM_NAMES[t]}: you hold ${n}${t !== 'gold' ? `, and your stalls give ${bonus[t]} off` : ''}`}>
                <GemIcon gem={t} size={30} />
                <span className="gm-count">{n}</span>
                {t !== 'gold' && bonus[t] > 0 && <span className="gm-bonus">+{bonus[t]}</span>}
              </button>
            );
          })}
        </div>
        {me.reserved.length > 0 && (
          <div className="gm-reserved" aria-label="Your reserved stalls">
            {me.reserved.map((r, index) => (
              <CardView key={r.id} id={r.id} data={{ reserved: index }} selected={sel?.kind === 'reserved' && sel.index === index} affordable={can({ type: 'buy', from: { reserved: index } })} onClick={() => setSel({ kind: 'reserved', index })} />
            ))}
          </div>
        )}
        {me.patrons.length > 0 && <p className="gm-patron-line">Patrons: {me.patrons.map((id) => patronById(id).name).join(', ')}</p>}
      </div>

      <ol className="gm-log" aria-label="Recent moves">
        {snap.lines.slice(-4).map((l, i) => (
          <li key={snap.lines.length - 4 + i}>{l}</li>
        ))}
        {snap.lines.length === 0 && <li className="gm-log-empty">No moves yet.</li>}
      </ol>

      {over && (
        <div className="end-card" role="status" data-result={state.winners.includes(you) ? 'win' : 'loss'}>
          <h2>{state.winners.includes(you) ? (state.winners.length > 1 ? 'A shared win!' : 'You win!') : `${state.winners.map((w) => names[w]).join(' and ')} win${state.winners.length === 1 ? 's' : ''}`}</h2>
          <table className="gm-final">
            <tbody>
              {state.players.map((p, i) => (
                <tr key={i} className={state.winners.includes(i) ? 'gm-winner' : ''}>
                  <th scope="row">{names[i]}</th>
                  <td>{scoreOf(state, i)} pts</td>
                  <td>{p.cards.length} stalls</td>
                </tr>
              ))}
            </tbody>
          </table>
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
