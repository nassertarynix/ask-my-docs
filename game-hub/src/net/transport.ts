/**
 * How a game talks to a room: a `Connect` function gives back a `Transport`. There are two kinds. `webSocketConnect` talks to
 * the real relay (it reconnects by itself, and the session re-joins with its token each time the link opens). `MemoryRelay`
 * keeps the rooms in the same page, which is what the tests use and what lets you play against computers with no network.
 */
import { parseServerMsg, type ClientMsg, type ServerMsg } from './protocol';
import { RoomCore } from './roomCore';

export interface TransportHandlers {
  /** The link is up (called again after every reconnect). */
  open(): void;
  message(msg: ServerMsg): void;
  /** The link went down; `willRetry` says whether a reconnect is coming. */
  close(willRetry: boolean): void;
}
export interface Transport {
  send(msg: ClientMsg): void;
  close(): void;
}
export type Connect = (handlers: TransportHandlers) => Transport;

export interface WebSocketOptions {
  retries?: number;
  baseDelayMs?: number;
  pingMs?: number;
  /** For tests. */
  WebSocketImpl?: typeof WebSocket;
}

export function webSocketConnect(url: string, options: WebSocketOptions = {}): Connect {
  const retries = options.retries ?? 8;
  const baseDelay = options.baseDelayMs ?? 700;
  const pingMs = options.pingMs ?? 20_000;
  const Impl = options.WebSocketImpl ?? WebSocket;
  return (h) => {
    let ws: WebSocket | null = null;
    let closedByUs = false;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    const connect = () => {
      const socket = new Impl(url);
      ws = socket;
      socket.onopen = () => {
        attempts = 0;
        ping = setInterval(() => socket.readyState === 1 && socket.send('{"t":"ping"}'), pingMs); // keeps idle connections from being dropped
        h.open();
      };
      socket.onmessage = (e) => {
        const msg = parseServerMsg(e.data);
        if (msg) h.message(msg);
      };
      socket.onerror = () => undefined; // a close always follows
      socket.onclose = () => {
        clearInterval(ping);
        if (closedByUs) return h.close(false);
        attempts++;
        if (attempts > retries) return h.close(false);
        h.close(true);
        retry = setTimeout(connect, baseDelay * Math.min(attempts, 5));
      };
    };
    connect();
    return {
      send(msg) {
        if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
      },
      close() {
        closedByUs = true;
        clearTimeout(retry);
        clearInterval(ping);
        ws?.close();
      },
    };
  };
}

/** Rooms kept in this page. Delivery is asynchronous (a microtask), like a real network, but never lost or reordered. */
export class MemoryRelay {
  private readonly rooms = new Map<string, RoomCore>();
  private readonly links = new Map<string, { room: string; handlers: TransportHandlers }>();
  private next = 0;
  private serial = 0;
  readonly transports: MemoryTransport[] = [];

  constructor(private readonly newToken: () => string = () => `mem-${++this.serial}-${Math.random().toString(36).slice(2, 10)}`) {}

  connect(room: string): Connect {
    return (handlers) => {
      const t = new MemoryTransport(this, room, handlers);
      this.transports.push(t);
      return t;
    };
  }

  /** @internal */
  attach(room: string, handlers: TransportHandlers): string {
    const conn = `m${++this.next}`;
    this.links.set(conn, { room, handlers });
    queueMicrotask(() => this.links.has(conn) && handlers.open());
    return conn;
  }

  /** @internal */
  handle(conn: string, room: string, msg: ClientMsg): void {
    let core = this.rooms.get(room);
    if (!core) {
      core = new RoomCore(this.newToken);
      this.rooms.set(room, core);
    }
    this.deliver(room, core.handle(conn, msg));
  }

  /** @internal */
  detach(conn: string, room: string): void {
    this.links.delete(conn);
    const core = this.rooms.get(room);
    if (!core) return;
    this.deliver(room, core.disconnect(conn));
    if (core.empty) this.rooms.delete(room);
  }

  private deliver(room: string, outs: { to: string; msg: ServerMsg }[]): void {
    for (const out of outs) {
      const targets = out.to === '*' ? [...this.links.entries()].filter(([, l]) => l.room === room).map(([c]) => c) : [out.to];
      for (const conn of targets) {
        const link = this.links.get(conn);
        if (link) queueMicrotask(() => this.links.has(conn) && link.handlers.message(out.msg));
      }
    }
  }
}

export class MemoryTransport implements Transport {
  private conn: string | null;
  constructor(
    private readonly relay: MemoryRelay,
    private readonly room: string,
    private readonly handlers: TransportHandlers,
  ) {
    this.conn = relay.attach(room, handlers);
  }
  send(msg: ClientMsg): void {
    if (this.conn) this.relay.handle(this.conn, this.room, msg);
  }
  close(): void {
    if (this.conn) this.relay.detach(this.conn, this.room);
    this.conn = null;
  }
  /** Test helper: the link drops (the phone went to sleep). */
  drop(): void {
    if (!this.conn) return;
    this.relay.detach(this.conn, this.room);
    this.conn = null;
    this.handlers.close(true);
  }
  /** Test helper: the link comes back. */
  restore(): void {
    if (this.conn) return;
    this.conn = this.relay.attach(this.room, this.handlers);
  }
}
