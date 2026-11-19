// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import worker from '../src/worker';
import { startRelay, type DevRelay } from '../dev-server';
import type { ServerMsg } from '../../src/net/protocol';

let relay: DevRelay;
beforeAll(async () => {
  relay = await startRelay(0);
});
afterAll(() => relay.close());

/** A raw client: collects what the relay sends. */
async function client(room: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${relay.port}/room/${room}`);
  const got: ServerMsg[] = [];
  ws.on('message', (d) => got.push(JSON.parse(d.toString()) as ServerMsg));
  await new Promise<void>((res, rej) => (ws.once('open', () => res()), ws.once('error', rej)));
  const send = (m: unknown) => ws.send(JSON.stringify(m));
  const wait = async (pred: (m: ServerMsg) => boolean) => {
    for (let i = 0; i < 300; i++) {
      const m = got.find(pred);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error('timed out');
  };
  return { ws, got, send, wait };
}

describe('the development relay (same RoomCore as the Worker, behind real WebSockets)', () => {
  it('seats two players, starts a game and sends every action to both in order', async () => {
    const a = await client('TEST2');
    a.send({ t: 'join', name: 'Ada' });
    await a.wait((m) => m.t === 'joined');
    const b = await client('TEST2');
    b.send({ t: 'join', name: 'Bo' });
    const joined = (await b.wait((m) => m.t === 'joined')) as Extract<ServerMsg, { t: 'joined' }>;
    expect(joined.you).toBe(1);
    a.send({ t: 'start', seats: ['human', 'human'], data: { seed: 1 } });
    await a.wait((m) => m.t === 'started');
    await b.wait((m) => m.t === 'started');
    a.send({ t: 'act', action: { n: 1 } });
    b.send({ t: 'act', action: { n: 2 } });
    await a.wait((m) => m.t === 'act' && m.seq === 1);
    await b.wait((m) => m.t === 'act' && m.seq === 1);
    const acts = (c: typeof a) => c.got.filter((m): m is Extract<ServerMsg, { t: 'act' }> => m.t === 'act').map((m) => [m.seq, m.seat]);
    expect(acts(a)).toEqual(acts(b));
    expect(acts(a)).toHaveLength(2);
    a.ws.close();
    b.ws.close();
  });

  it('keeps rooms apart, and answers garbage with an error instead of crashing', async () => {
    const a = await client('KKAAA');
    const b = await client('KKBBB');
    a.send({ t: 'join', name: 'Ada' });
    b.send({ t: 'join', name: 'Bo' });
    const ja = (await a.wait((m) => m.t === 'joined')) as Extract<ServerMsg, { t: 'joined' }>;
    const jb = (await b.wait((m) => m.t === 'joined')) as Extract<ServerMsg, { t: 'joined' }>;
    expect([ja.you, jb.you]).toEqual([0, 0]); // each is first in its own room
    a.ws.send('this is not json');
    await a.wait((m) => m.t === 'error');
    a.ws.send(JSON.stringify({ t: 'start', seats: 'lots', data: null }));
    await new Promise((r) => setTimeout(r, 30));
    a.ws.send(JSON.stringify({ t: 'ping' }));
    await a.wait((m) => m.t === 'pong'); // still alive
    a.ws.close();
    b.ws.close();
  });

  it('refuses addresses that are not a room', async () => {
    const res = await fetch(`http://127.0.0.1:${relay.port}/nothing`);
    expect(res.status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${relay.port}/health`)).status).toBe(200);
    const bad = new WebSocket(`ws://127.0.0.1:${relay.port}/room/oops`);
    await new Promise<void>((res) => bad.once('error', () => res()));
  });
});

describe('the Cloudflare Worker entry point (the parts that do not need the Workers runtime)', () => {
  const env = { ROOMS: { idFromName: () => ({}), get: () => ({ fetch: async () => new Response('forwarded') }) } as never };
  const req = (path: string, headers: Record<string, string> = {}) => new Request(`https://relay.test${path}`, { headers });

  it('answers a health check and refuses anything that is not a room address', async () => {
    expect(await (await worker.fetch(req('/health'), env)).text()).toBe('ok');
    expect((await worker.fetch(req('/'), env)).status).toBe(404);
    expect((await worker.fetch(req('/room/abc'), env)).status).toBe(404);
    expect((await worker.fetch(req('/room/ABCDE/extra'), env)).status).toBe(404);
  });
  it('wants a WebSocket upgrade', async () => {
    expect((await worker.fetch(req('/room/ABCDE'), env)).status).toBe(426);
  });
  it('forwards a good request to the room, and checks the Origin when origins are listed', async () => {
    const ok = await worker.fetch(req('/room/ABCDE', { Upgrade: 'websocket' }), env);
    expect(await ok.text()).toBe('forwarded');
    const listed = { ...env, ALLOWED_ORIGINS: 'https://me.github.io, https://other.test' };
    expect((await worker.fetch(req('/room/ABCDE', { Upgrade: 'websocket', Origin: 'https://evil.test' }), listed)).status).toBe(403);
    expect((await worker.fetch(req('/room/ABCDE', { Upgrade: 'websocket' }), listed)).status).toBe(403);
    expect(await (await worker.fetch(req('/room/ABCDE', { Upgrade: 'websocket', Origin: 'https://me.github.io' }), listed)).text()).toBe('forwarded');
  });
});
