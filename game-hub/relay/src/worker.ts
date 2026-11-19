/**
 * The room relay as a Cloudflare Worker. Each room is one Durable Object (named by its five-character code) that wraps the
 * same `RoomCore` the tests use; the Worker only checks the address, the Origin and that this is a WebSocket upgrade.
 *
 * Not deployed yet: see relay/README.md. Nothing here is reached until RELAY_URL in src/hub/config.ts is set.
 */
import { MAX_MESSAGE_CHARS, ROOM_CODE, parseClientMsg } from '../../src/net/protocol';
import { RoomCore } from '../../src/net/roomCore';

interface Env {
  ROOMS: DurableObjectNamespace;
  /** Comma-separated origins allowed to connect, e.g. "https://you.github.io". Empty allows any (fine for trying it out). */
  ALLOWED_ORIGINS?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');
    const match = /^\/room\/([A-Z0-9]{5})$/.exec(url.pathname);
    const code = match?.[1];
    if (!code || !ROOM_CODE.test(code)) return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean);
    if (allowed.length > 0 && !allowed.includes(request.headers.get('Origin') ?? '')) return new Response('Origin not allowed', { status: 403 });
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
  },
};

const WINDOW_MS = 5000;
const MAX_PER_WINDOW = 60; // a turn-based game sends a handful of messages a minute

export class Room {
  private readonly core = new RoomCore(() => crypto.randomUUID());
  private readonly sockets = new Map<string, WebSocket>();
  private readonly recent = new Map<string, number[]>();

  constructor(_state: DurableObjectState) {}

  async fetch(_request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    const conn = crypto.randomUUID();
    this.sockets.set(conn, server);

    server.addEventListener('message', (event) => {
      const data = (event as MessageEvent).data;
      if (typeof data !== 'string' || data.length > MAX_MESSAGE_CHARS || this.tooFast(conn)) return server.close(1008, 'slow down');
      const parsed = parseClientMsg(data);
      if (!parsed.ok) return server.send(JSON.stringify({ t: 'error', code: 'bad', message: `Not understood: ${parsed.reason}` }));
      this.send(this.core.handle(conn, parsed.value));
    });
    const gone = () => {
      if (!this.sockets.delete(conn)) return;
      this.recent.delete(conn);
      this.send(this.core.disconnect(conn));
    };
    server.addEventListener('close', gone);
    server.addEventListener('error', gone);
    return new Response(null, { status: 101, webSocket: client });
  }

  private tooFast(conn: string): boolean {
    const now = Date.now();
    const times = (this.recent.get(conn) ?? []).filter((t) => now - t < WINDOW_MS);
    times.push(now);
    this.recent.set(conn, times);
    return times.length > MAX_PER_WINDOW;
  }

  private send(outs: { to: string; msg: unknown }[]): void {
    for (const out of outs) {
      const text = JSON.stringify(out.msg);
      const targets = out.to === '*' ? [...this.sockets.values()] : [this.sockets.get(out.to)];
      for (const socket of targets) socket?.send(text);
    }
  }
}
