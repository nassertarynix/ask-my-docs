import { describe, expect, it } from 'vitest';
import { gemAdapter, type GemSetup } from '../../games/gem-merchants/online';
import { OnlineSession, type TokenStore } from '../session';
import { MemoryRelay, webSocketConnect, type TransportHandlers } from '../transport';
import type { ServerMsg } from '../protocol';

const until = async (cond: () => boolean, ms = 3000) => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 1));
  }
};
const memTokens = (): TokenStore => {
  const m = new Map<string, string>();
  return { get: (c) => m.get(c) ?? null, set: (c, t) => void m.set(c, t) };
};
const make = (relay: MemoryRelay, code: string, name: string, extra: { botDelayMs?: number; autoStart?: GemSetup } = {}) =>
  new OnlineSession({ adapter: gemAdapter, connect: relay.connect(code), code, name, tokens: memTokens(), botDelayMs: 0, ...extra });
const setup = (kinds: ('human' | 'bot')[], seed = 3): GemSetup => ({ players: kinds.map((kind, i) => ({ name: kind === 'bot' ? `Bot ${i}` : `P${i}`, kind, ...(kind === 'bot' ? { level: 'normal' as const } : {}) })), seed });

type Session = ReturnType<typeof make>;
const snap = (s: Session) => s.getSnapshot();
const turnOf = (s: Session) => snap(s).state?.turn;
const take = { type: 'take3' as const, gems: ['amber', 'azure', 'jade'] as ('amber' | 'azure' | 'jade')[] };

async function lobby(kinds: ('human' | 'bot')[], hostDelay = 0) {
  const relay = new MemoryRelay();
  const humans = kinds.filter((k) => k === 'human').length;
  const sessions: Session[] = [make(relay, 'ROOM2', 'Ada', { botDelayMs: hostDelay })];
  await until(() => snap(sessions[0] as Session).status === 'lobby');
  for (let i = 1; i < humans; i++) sessions.push(make(relay, 'ROOM2', `Guest${i}`));
  await until(() => sessions.every((s) => snap(s).players.length === humans));
  return { relay, sessions };
}

describe('a room over the in-memory relay', () => {
  it('shows everyone the lobby, with the first player as host, and only the host can start', async () => {
    const { sessions } = await lobby(['human', 'human']);
    const [host, guest] = sessions as [Session, Session];
    expect(snap(host)).toMatchObject({ you: 0, hostSeat: 0, status: 'lobby' });
    expect(snap(guest)).toMatchObject({ you: 1, hostSeat: 0, status: 'lobby' });
    expect(snap(guest).players.map((p) => p.name)).toEqual(['Ada', 'Guest1']);
    guest.start(setup(['human', 'human']));
    await new Promise((r) => setTimeout(r, 20));
    expect(snap(host).status).toBe('lobby');
  });

  it('starts for everyone with the same game, and keeps every device in step through the host\'s computer player', async () => {
    const { sessions } = await lobby(['human', 'human', 'bot']);
    const [host, guest] = sessions as [Session, Session];
    host.start(setup(['human', 'human', 'bot']));
    await until(() => sessions.every((s) => snap(s).status === 'playing'));
    expect(snap(host).state).toEqual(snap(guest).state);
    expect(host.submit(take)).toBe(true);
    await until(() => turnOf(guest) === 1);
    expect(guest.submit({ type: 'take2', gem: 'pearl' })).toBe(true);
    await until(() => snap(guest).log.length >= 3 && turnOf(guest) === 0); // the bot played in between
    expect(snap(guest).log.map((e) => e.seat)).toEqual([0, 1, 2]);
    expect(snap(host).state).toEqual(snap(guest).state);
    expect(snap(host).lines[0]).toBe('P0 took Amber, Azure, Jade');
    expect(snap(guest).lines).toHaveLength(3);
  });

  it('does not send an action that is out of turn or illegal', async () => {
    const { sessions } = await lobby(['human', 'human']);
    const [host, guest] = sessions as [Session, Session];
    host.start(setup(['human', 'human']));
    await until(() => sessions.every((s) => snap(s).status === 'playing'));
    expect(guest.submit(take)).toBe(false); // not your turn
    expect(host.submit({ type: 'take3', gems: ['amber', 'amber', 'jade'] })).toBe(false); // not a legal take
    expect(host.submit({ type: 'buy', from: { level: 3, slot: 0 } })).toBe(false); // cannot afford
    await new Promise((r) => setTimeout(r, 20));
    expect(snap(host).log).toHaveLength(0);
  });

  it('ignores, on every device alike, an action a cheating or broken client sends', async () => {
    const { relay, sessions } = await lobby(['human', 'human']);
    const [host, guest] = sessions as [Session, Session];
    host.start(setup(['human', 'human']));
    await until(() => sessions.every((s) => snap(s).status === 'playing'));
    const rogue = relay.transports[1];
    rogue?.send({ t: 'act', action: { type: 'take2', gem: 'jade' } }); // guest's seat, but it is the host's turn
    rogue?.send({ t: 'act', action: { type: 'take3', gems: 5 } }); // not even an action
    rogue?.send({ t: 'act', action: 'drop table' });
    rogue?.send({ t: 'act', action: { type: 'buy', from: { level: 9, slot: 0 } } });
    await new Promise((r) => setTimeout(r, 30));
    expect(snap(host).log).toHaveLength(0);
    expect(snap(guest).log).toHaveLength(0);
    expect(snap(host).state).toEqual(snap(guest).state);
    expect(host.submit(take)).toBe(true); // and the game carries on normally
    await until(() => turnOf(guest) === 1);
  });

  it('lets a device that dropped out come back, replay the log and carry on', async () => {
    const { relay, sessions } = await lobby(['human', 'human']);
    const [host, guest] = sessions as [Session, Session];
    host.start(setup(['human', 'human']));
    await until(() => sessions.every((s) => snap(s).status === 'playing'));
    relay.transports[1]?.drop();
    await until(() => !snap(guest).online);
    host.submit(take);
    await until(() => turnOf(host) === 1);
    expect(snap(guest).log).toHaveLength(0); // it missed that move
    relay.transports[1]?.restore();
    await until(() => snap(guest).log.length === 1);
    expect(snap(guest).you).toBe(1); // the same seat, thanks to its token
    expect(snap(guest).state).toEqual(snap(host).state);
    expect(guest.submit({ type: 'take2', gem: 'pearl' })).toBe(true);
    await until(() => turnOf(host) === 0);
  });

  it('hands the computer seats to the next player when the host leaves', async () => {
    const { sessions } = await lobby(['human', 'human', 'bot'], 60_000); // the host\'s bot would think for a minute
    const [host, guest] = sessions as [Session, Session];
    host.start(setup(['human', 'human', 'bot']));
    await until(() => sessions.every((s) => snap(s).status === 'playing'));
    host.submit(take);
    await until(() => turnOf(guest) === 1);
    guest.submit({ type: 'take2', gem: 'pearl' });
    await until(() => turnOf(guest) === 2); // the bot's turn
    host.leave();
    await until(() => snap(guest).hostSeat === 1);
    await until(() => turnOf(guest) === 0); // the guest's device played the bot
    expect(snap(guest).log.map((e) => e.seat)).toEqual([0, 1, 2]);
  });

  it('refuses a latecomer to a started game and a fifth player to a full room', async () => {
    const { relay, sessions } = await lobby(['human', 'human']);
    (sessions[0] as Session).start(setup(['human', 'human']));
    await until(() => sessions.every((s) => snap(s).status === 'playing'));
    const late = make(relay, 'ROOM2', 'Late');
    await until(() => snap(late).status === 'failed');
    expect(snap(late).error).toMatch(/started/);

    const relay2 = new MemoryRelay();
    const four = ['A', 'B', 'C', 'D'].map((n) => make(relay2, 'FULL5', n));
    await until(() => four.every((s) => snap(s).players.length === 4));
    const fifth = make(relay2, 'FULL5', 'E');
    await until(() => snap(fifth).status === 'failed');
    expect(snap(fifth).error).toMatch(/full/);
  });

  it('plays a solo game against computers when started automatically', async () => {
    const relay = new MemoryRelay();
    const me = make(relay, 'SOLO2', 'Ada', { autoStart: setup(['human', 'bot', 'bot']) });
    await until(() => snap(me).status === 'playing');
    expect(snap(me).seats).toEqual(['human', 'bot', 'bot']);
    expect(me.submit(take)).toBe(true);
    await until(() => snap(me).log.length === 3 && turnOf(me) === 0);
    expect(snap(me).log.map((e) => e.seat)).toEqual([0, 1, 2]);
  });

  it('stops everything when you leave', async () => {
    const relay = new MemoryRelay();
    const me = make(relay, 'SOLO3', 'Ada', { autoStart: setup(['human', 'bot']) });
    await until(() => snap(me).status === 'playing');
    me.leave();
    expect(snap(me).status).toBe('closed');
    expect(me.submit(take)).toBe(false);
  });

  it('reports a failed connection', async () => {
    const s = new OnlineSession({ adapter: gemAdapter, connect: (h: TransportHandlers) => (queueMicrotask(() => h.close(false)), { send() {}, close() {} }), code: 'XXXXX', name: 'Ada', tokens: memTokens() });
    await until(() => snap(s).status === 'failed');
    expect(snap(s).error).toMatch(/reach/);
  });

  it('refuses a game setup it does not understand', async () => {
    const relay = new MemoryRelay();
    const s = make(relay, 'BADSU', 'Ada');
    await until(() => snap(s).status === 'lobby');
    relay.transports[0]?.send({ t: 'start', seats: ['human', 'bot'], data: { players: 'nope' } });
    await until(() => snap(s).status === 'failed');
    expect(snap(s).error).toMatch(/not understood/);
  });
});

// ---------- the WebSocket transport, against a fake socket ----------
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    FakeSocket.all.push(this);
  }
  send(text: string) {
    this.sent.push(text);
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  drop() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe('the WebSocket transport', () => {
  const connect = (extra = {}) => {
    FakeSocket.all = [];
    const events: string[] = [];
    const msgs: ServerMsg[] = [];
    const t = webSocketConnect('ws://relay.test/room/ABCDE', { WebSocketImpl: FakeSocket as unknown as typeof WebSocket, baseDelayMs: 1, pingMs: 5, retries: 2, ...extra })({
      open: () => events.push('open'),
      message: (m) => msgs.push(m),
      close: (retry) => events.push(retry ? 'close-retry' : 'close-final'),
    });
    return { t, events, msgs };
  };

  it('opens, sends JSON, reads only well-formed messages, and pings to stay alive', async () => {
    const { t, events, msgs } = connect();
    const ws = FakeSocket.all[0] as FakeSocket;
    expect(ws.url).toBe('ws://relay.test/room/ABCDE');
    t.send({ t: 'ping' }); // not open yet: dropped
    expect(ws.sent).toEqual([]);
    ws.open();
    expect(events).toEqual(['open']);
    t.send({ t: 'join', name: 'Ada' });
    expect(ws.sent[0]).toBe('{"t":"join","name":"Ada"}');
    ws.onmessage?.({ data: '{"t":"pong"}' });
    ws.onmessage?.({ data: 'junk' });
    ws.onmessage?.({ data: '{"t":"bogus"}' });
    expect(msgs).toEqual([{ t: 'pong' }]);
    await new Promise((r) => setTimeout(r, 25));
    expect(ws.sent.filter((s) => s === '{"t":"ping"}').length).toBeGreaterThan(1);
    t.close();
  });

  it('reconnects after a drop, and tells the session each time the link opens', async () => {
    const { t, events } = connect();
    (FakeSocket.all[0] as FakeSocket).open();
    (FakeSocket.all[0] as FakeSocket).drop();
    expect(events).toEqual(['open', 'close-retry']);
    await until(() => FakeSocket.all.length === 2);
    (FakeSocket.all[1] as FakeSocket).open();
    expect(events).toEqual(['open', 'close-retry', 'open']);
    t.close();
  });

  it('gives up after its retries and says so', async () => {
    const { events } = connect();
    for (let i = 0; i < 3; i++) {
      await until(() => FakeSocket.all.length === i + 1);
      (FakeSocket.all[i] as FakeSocket).drop();
    }
    expect(events).toEqual(['close-retry', 'close-retry', 'close-final']);
    await new Promise((r) => setTimeout(r, 15));
    expect(FakeSocket.all).toHaveLength(3);
  });

  it('does not reconnect when closed on purpose', async () => {
    const { t, events } = connect();
    (FakeSocket.all[0] as FakeSocket).open();
    t.close();
    await new Promise((r) => setTimeout(r, 15));
    expect(FakeSocket.all).toHaveLength(1);
    expect(events).toEqual(['open', 'close-final']);
  });
});
