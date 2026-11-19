/**
 * A local copy of the relay for development and the browser tests: the same RoomCore as the Cloudflare Worker, behind a
 * plain Node WebSocket server. Run it with `npm run relay:dev`, then open the hub with `#/play/gem-merchants?relay=ws://127.0.0.1:8787`
 * (the hub only accepts that override for localhost addresses).
 */
import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { MAX_MESSAGE_CHARS, ROOM_CODE, parseClientMsg } from '../src/net/protocol';
import { RoomCore } from '../src/net/roomCore';

export interface DevRelay {
  port: number;
  server: Server;
  close(): Promise<void>;
}

export function startRelay(port = 0): Promise<DevRelay> {
  const rooms = new Map<string, RoomCore>();
  const sockets = new Map<string, { room: string; ws: import('ws').WebSocket }>();
  const http = createServer((req, res) => {
    res.writeHead(req.url === '/health' ? 200 : 404).end(req.url === '/health' ? 'ok' : 'Not found');
  });
  const wss = new WebSocketServer({ noServer: true });

  http.on('upgrade', (req, socket, head) => {
    const code = /^\/room\/([A-Z0-9]{5})$/.exec(req.url ?? '')?.[1];
    if (!code || !ROOM_CODE.test(code)) return void socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => {
      const conn = randomUUID();
      sockets.set(conn, { room: code, ws });
      let core = rooms.get(code);
      if (!core) rooms.set(code, (core = new RoomCore(() => randomUUID())));
      const room = core;
      const deliver = (outs: { to: string; msg: unknown }[]) => {
        for (const out of outs) {
          const text = JSON.stringify(out.msg);
          const targets = out.to === '*' ? [...sockets.entries()].filter(([, s]) => s.room === code).map(([c]) => c) : [out.to];
          for (const c of targets) sockets.get(c)?.ws.send(text);
        }
      };
      ws.on('message', (data) => {
        const text = data.toString();
        if (text.length > MAX_MESSAGE_CHARS) return ws.close(1009);
        const parsed = parseClientMsg(text);
        if (!parsed.ok) return ws.send(JSON.stringify({ t: 'error', code: 'bad', message: `Not understood: ${parsed.reason}` }));
        deliver(room.handle(conn, parsed.value));
      });
      ws.on('close', () => {
        sockets.delete(conn);
        deliver(room.disconnect(conn));
        if (room.empty) rooms.delete(code);
      });
    });
  });

  return new Promise((resolve) => {
    http.listen(port, '127.0.0.1', () => {
      const address = http.address();
      const actual = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: actual,
        server: http,
        close: () =>
          new Promise<void>((done) => {
            for (const { ws } of sockets.values()) ws.terminate();
            wss.close();
            http.close(() => done());
          }),
      });
    });
  });
}

// run directly: node-style entry (tsx relay/dev-server.ts)
if (process.argv[1] && /dev-server\.ts$/.test(process.argv[1])) {
  const port = Number(process.env.PORT ?? 8787);
  startRelay(port).then((r) => console.log(`Relay listening on ws://127.0.0.1:${r.port}/room/<CODE>`));
}
