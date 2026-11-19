import { describe, expect, it } from 'vitest';
import { ROOM_CODE, cleanName, parseClientMsg, parseServerMsg, randomRoomCode, type ClientMsg, type ServerMsg } from '../protocol';
import { RoomCore, type Out } from '../roomCore';

let n = 0;
const room = () => new RoomCore(() => `tok${++n}`);
const msgsFor = (outs: Out[], conn: string): ServerMsg[] => outs.filter((o) => o.to === conn || o.to === '*').map((o) => o.msg);
const joined = (core: RoomCore, conn: string, name: string, token?: string) => core.handle(conn, token ? { t: 'join', name, token } : { t: 'join', name });
const errorOf = (outs: Out[]) => outs.map((o) => o.msg).find((m): m is Extract<ServerMsg, { t: 'error' }> => m.t === 'error');

describe('joining a room', () => {
  it('seats players in order, the first being the host, and tells everyone who is there', () => {
    const core = room();
    const a = joined(core, 'a', 'Ada');
    expect(msgsFor(a, 'a')[0]).toMatchObject({ t: 'joined', you: 0, hostSeat: 0, started: false });
    const b = joined(core, 'b', 'Bo');
    const toB = msgsFor(b, 'b')[0] as Extract<ServerMsg, { t: 'joined' }>;
    expect(toB.you).toBe(1);
    expect(toB.players.map((p) => p.name)).toEqual(['Ada', 'Bo']);
    const toA = b.find((o) => o.to === 'a')?.msg;
    expect(toA).toMatchObject({ t: 'players', you: 0, hostSeat: 0 });
  });

  it('gives each player a token of their own', () => {
    const core = room();
    const t1 = (msgsFor(joined(core, 'a', 'Ada'), 'a')[0] as Extract<ServerMsg, { t: 'joined' }>).token;
    const t2 = (msgsFor(joined(core, 'b', 'Bo'), 'b')[0] as Extract<ServerMsg, { t: 'joined' }>).token;
    expect(t1).not.toBe(t2);
  });

  it('holds four players and turns a fifth away', () => {
    const core = room();
    for (const c of ['a', 'b', 'c', 'd']) joined(core, c, c.toUpperCase());
    expect(errorOf(joined(core, 'e', 'Eve'))?.code).toBe('full');
  });

  it('lets a player who leaves the lobby go, and closes the gap in the seats', () => {
    const core = room();
    joined(core, 'a', 'Ada');
    joined(core, 'b', 'Bo');
    joined(core, 'c', 'Cy');
    const outs = core.disconnect('b');
    const toC = outs.find((o) => o.to === 'c')?.msg as Extract<ServerMsg, { t: 'players' }>;
    expect(toC.you).toBe(1);
    expect(toC.players.map((p) => p.name)).toEqual(['Ada', 'Cy']);
  });

  it('passes hosting to the next player when the host leaves the lobby', () => {
    const core = room();
    joined(core, 'a', 'Ada');
    joined(core, 'b', 'Bo');
    const outs = core.disconnect('a');
    expect(outs.find((o) => o.to === 'b')?.msg).toMatchObject({ t: 'players', you: 0, hostSeat: 0 });
    expect(errorOf(core.handle('b', { t: 'start', seats: ['human', 'bot'], data: null }))).toBeUndefined();
  });
});

describe('starting', () => {
  const lobby = () => {
    const core = room();
    joined(core, 'a', 'Ada');
    joined(core, 'b', 'Bo');
    return core;
  };
  it('lets only the host start, with seats that match the players present', () => {
    const core = lobby();
    expect(errorOf(core.handle('b', { t: 'start', seats: ['human', 'human'], data: null }))?.code).toBe('forbidden');
    expect(errorOf(core.handle('a', { t: 'start', seats: ['human', 'bot'], data: null }))?.code).toBe('bad'); // two people are here
    expect(errorOf(core.handle('a', { t: 'start', seats: ['human', 'human', 'human'], data: null }))?.code).toBe('bad');
    expect(errorOf(core.handle('a', { t: 'start', seats: ['bot', 'human', 'human'], data: null }))?.code).toBe('bad'); // people sit first
  });
  it('starts for everyone, with bots in the seats after the people, and then refuses newcomers', () => {
    const core = lobby();
    const outs = core.handle('a', { t: 'start', seats: ['human', 'human', 'bot'], data: { seed: 5 } });
    expect(outs).toEqual([{ to: '*', msg: { t: 'started', seats: ['human', 'human', 'bot'], data: { seed: 5 } } }]);
    expect(errorOf(joined(core, 'c', 'Cy'))?.code).toBe('started');
    expect(errorOf(core.handle('a', { t: 'start', seats: ['human', 'human'], data: null }))?.code).toBe('started');
  });
});

describe('playing', () => {
  const started = () => {
    const core = room();
    const ta = (msgsFor(joined(core, 'a', 'Ada'), 'a')[0] as Extract<ServerMsg, { t: 'joined' }>).token;
    const tb = (msgsFor(joined(core, 'b', 'Bo'), 'b')[0] as Extract<ServerMsg, { t: 'joined' }>).token;
    core.handle('a', { t: 'start', seats: ['human', 'human', 'bot'], data: 'setup' });
    return { core, ta, tb };
  };
  const act = (core: RoomCore, conn: string, action: number, seat?: number) => core.handle(conn, seat === undefined ? { t: 'act', action } : { t: 'act', action, seat });

  it('numbers actions, stamps them with the sender\'s seat and sends them to everybody', () => {
    const { core } = started();
    expect(act(core, 'a', 10)).toEqual([{ to: '*', msg: { t: 'act', seq: 0, seat: 0, action: 10 } }]);
    expect(act(core, 'b', 11)).toEqual([{ to: '*', msg: { t: 'act', seq: 1, seat: 1, action: 11 } }]);
  });
  it('does not let a player act for somebody else', () => {
    const { core } = started();
    expect(errorOf(act(core, 'b', 1, 0))?.code).toBe('forbidden');
    expect(errorOf(act(core, 'b', 1, 2))?.code).toBe('forbidden'); // not a bot seat they run
  });
  it('lets the host act for a bot seat, and only the host', () => {
    const { core } = started();
    expect(act(core, 'a', 1, 2)[0]?.msg).toMatchObject({ t: 'act', seat: 2 });
    expect(errorOf(act(core, 'a', 1, 1))?.code).toBe('forbidden'); // a human seat
  });
  it('refuses actions before the game starts, and from someone who has not joined', () => {
    const core = room();
    joined(core, 'a', 'Ada');
    expect(errorOf(act(core, 'a', 1))?.code).toBe('not-started');
    expect(errorOf(act(core, 'zz', 1))?.code).toBe('forbidden');
  });
  it('lets a player come back with their token and replays them the whole log', () => {
    const { core, tb } = started();
    act(core, 'a', 1);
    act(core, 'b', 2);
    core.disconnect('b');
    const back = joined(core, 'b2', 'Bo', tb);
    const m = msgsFor(back, 'b2')[0] as Extract<ServerMsg, { t: 'joined' }>;
    expect(m).toMatchObject({ t: 'joined', you: 1, started: true, seats: ['human', 'human', 'bot'], data: 'setup' });
    expect(m.log.map((e) => [e.seat, e.action])).toEqual([[0, 1], [1, 2]]);
    expect(act(core, 'b2', 3)[0]?.msg).toMatchObject({ seat: 1, seq: 2 });
    expect(act(core, 'b', 4)[0]?.msg).toMatchObject({ t: 'error' }); // the old connection no longer holds the seat
  });
  it('keeps a disconnected player\'s seat, and hands the host\'s duties to the next connected player', () => {
    const { core } = started();
    const outs = core.disconnect('a');
    const toB = outs.find((o) => o.to === 'b')?.msg as Extract<ServerMsg, { t: 'players' }>;
    expect(toB.hostSeat).toBe(1);
    expect(toB.players.map((p) => [p.seat, p.connected])).toEqual([[0, false], [1, true]]);
    expect(act(core, 'b', 1, 2)[0]?.msg).toMatchObject({ t: 'act', seat: 2 }); // the new host drives the bot
  });
  it('knows when it is empty', () => {
    const { core } = started();
    expect(core.empty).toBe(false);
    core.disconnect('a');
    core.disconnect('b');
    expect(core.empty).toBe(true);
  });
  it('answers a ping', () => {
    expect(room().handle('x', { t: 'ping' })).toEqual([{ to: 'x', msg: { t: 'pong' } }]);
  });
});

describe('what the relay accepts from the network', () => {
  const ok = (m: ClientMsg) => parseClientMsg(JSON.stringify(m));
  it('accepts well-formed messages', () => {
    expect(ok({ t: 'join', name: 'Ada' })).toEqual({ ok: true, value: { t: 'join', name: 'Ada' } });
    expect(ok({ t: 'act', action: { type: 'pass' }, seat: 2 }).ok).toBe(true);
    expect(ok({ t: 'start', seats: ['human', 'bot'], data: { seed: 1 } }).ok).toBe(true);
  });
  it.each([
    ['not JSON', '{nope'],
    ['not an object', '[1]'],
    ['an unknown type', '{"t":"hack"}'],
    ['a join without a name', '{"t":"join","name":"   "}'],
    ['a join with a non-string name', '{"t":"join","name":5}'],
    ['a token that is too long', JSON.stringify({ t: 'join', name: 'A', token: 'x'.repeat(65) })],
    ['five seats', JSON.stringify({ t: 'start', seats: ['human', 'bot', 'bot', 'bot', 'bot'], data: null })],
    ['one seat', JSON.stringify({ t: 'start', seats: ['human'], data: null })],
    ['a seat that is not human or bot', JSON.stringify({ t: 'start', seats: ['human', 'cat'], data: null })],
    ['setup data that is too large', JSON.stringify({ t: 'start', seats: ['human', 'bot'], data: 'x'.repeat(2100) })],
    ['an action that is too large', JSON.stringify({ t: 'act', action: 'x'.repeat(1100) })],
    ['a seat that is not a whole number', JSON.stringify({ t: 'act', action: 1, seat: 1.5 })],
    ['a seat out of range', JSON.stringify({ t: 'act', action: 1, seat: 9 })],
  ])('refuses %s', (_name, text) => {
    expect(parseClientMsg(text).ok).toBe(false);
  });
  it('refuses a message over the size limit before parsing it', () => {
    expect(parseClientMsg('{"t":"ping","pad":"' + 'x'.repeat(9000) + '"}').ok).toBe(false);
    expect(parseClientMsg(42).ok).toBe(false);
  });
  it('cleans names: no control characters or angle brackets, tidy spaces, at most 20 characters', () => {
    expect(cleanName('  Ada\u0000  <b>Lovelace</b> ')).toBe('Ada bLovelace/b');
    expect(cleanName('x'.repeat(50))).toHaveLength(20);
    expect(cleanName(7)).toBe('');
  });
  it('reads only well-shaped messages from the relay', () => {
    expect(parseServerMsg('{"t":"pong"}')).toEqual({ t: 'pong' });
    expect(parseServerMsg('{"t":"mystery"}')).toBeNull();
    expect(parseServerMsg('nope')).toBeNull();
    expect(parseServerMsg(5)).toBeNull();
  });
  it('makes room codes of five easy-to-read characters', () => {
    for (let i = 0; i < 50; i++) expect(randomRoomCode()).toMatch(ROOM_CODE);
    expect(randomRoomCode((k) => k - 1)).toBe('99999');
  });
});
