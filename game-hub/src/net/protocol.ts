/**
 * The messages between a game and the room relay. The relay is deliberately dumb: it knows rooms, seats and an ordered log
 * of actions, and nothing about any game's rules. Every device replays the same log with the same engine, so they agree.
 * Everything arriving from the network is untrusted: it is parsed and size-checked here before anything uses it.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export const MAX_SEATS = 4;
export const MAX_MESSAGE_CHARS = 8192;
export const MAX_NAME_CHARS = 20;
export const MAX_DATA_CHARS = 2000;
export const MAX_ACTION_CHARS = 1000;
export const MAX_LOG = 2000;
export const ROOM_CODE = /^[A-HJ-NP-Z2-9]{5}$/;
export const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

export type SeatKind = 'human' | 'bot';
export interface PlayerInfo {
  seat: number;
  name: string;
  connected: boolean;
}
export interface LogEntry {
  seq: number;
  seat: number;
  action: Json;
}
export type ErrorCode = 'full' | 'started' | 'bad' | 'forbidden' | 'log-full' | 'not-started';

export type ClientMsg =
  | { t: 'join'; name: string; token?: string }
  | { t: 'start'; seats: SeatKind[]; data: Json }
  | { t: 'act'; action: Json; seat?: number }
  | { t: 'ping' };

export type ServerMsg =
  | { t: 'joined'; you: number; token: string; hostSeat: number; players: PlayerInfo[]; started: boolean; seats: SeatKind[]; data: Json; log: LogEntry[] }
  | { t: 'players'; you: number; hostSeat: number; players: PlayerInfo[] }
  | { t: 'started'; seats: SeatKind[]; data: Json }
  | { t: 'act'; seq: number; seat: number; action: Json }
  | { t: 'error'; code: ErrorCode; message: string }
  | { t: 'pong' };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const sizeOf = (v: unknown): number => {
  try {
    return JSON.stringify(v)?.length ?? Infinity;
  } catch {
    return Infinity;
  }
};

/** A name safe to show: control characters removed, spaces tidied, at most 20 characters. Empty if nothing is left. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return raw.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_CHARS);
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

export function parseClientMsg(text: unknown): Parsed<ClientMsg> {
  if (typeof text !== 'string' || text.length > MAX_MESSAGE_CHARS) return { ok: false, reason: 'message too large' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'not JSON' };
  }
  if (!isRecord(raw)) return { ok: false, reason: 'not an object' };
  switch (raw.t) {
    case 'ping':
      return { ok: true, value: { t: 'ping' } };
    case 'join': {
      const name = cleanName(raw.name);
      if (!name) return { ok: false, reason: 'a name is needed' };
      if (raw.token !== undefined && (typeof raw.token !== 'string' || raw.token.length > 64)) return { ok: false, reason: 'bad token' };
      return { ok: true, value: raw.token === undefined ? { t: 'join', name } : { t: 'join', name, token: raw.token as string } };
    }
    case 'start': {
      const seats = raw.seats;
      if (!Array.isArray(seats) || seats.length < 2 || seats.length > MAX_SEATS || !seats.every((k) => k === 'human' || k === 'bot')) return { ok: false, reason: 'bad seats' };
      if (sizeOf(raw.data) > MAX_DATA_CHARS) return { ok: false, reason: 'setup too large' };
      return { ok: true, value: { t: 'start', seats: seats as SeatKind[], data: raw.data as Json } };
    }
    case 'act': {
      if (sizeOf(raw.action) > MAX_ACTION_CHARS) return { ok: false, reason: 'action too large' };
      if (raw.seat !== undefined && !(Number.isInteger(raw.seat) && (raw.seat as number) >= 0 && (raw.seat as number) < MAX_SEATS)) return { ok: false, reason: 'bad seat' };
      return { ok: true, value: raw.seat === undefined ? { t: 'act', action: raw.action as Json } : { t: 'act', action: raw.action as Json, seat: raw.seat as number } };
    }
    default:
      return { ok: false, reason: 'unknown message' };
  }
}

/** A message from the relay, checked only as far as its shape: the data inside is checked by the game that reads it. */
export function parseServerMsg(text: unknown): ServerMsg | null {
  if (typeof text !== 'string' || text.length > 4 * MAX_MESSAGE_CHARS * 8) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw) || typeof raw.t !== 'string') return null;
    if (!['joined', 'players', 'started', 'act', 'error', 'pong'].includes(raw.t)) return null;
    return raw as unknown as ServerMsg;
  } catch {
    return null;
  }
}

export function randomRoomCode(random: (n: number) => number = defaultRandom): string {
  let out = '';
  for (let i = 0; i < 5; i++) out += ROOM_ALPHABET.charAt(random(ROOM_ALPHABET.length));
  return out;
}

function defaultRandom(n: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return (buf[0] as number) % n;
}
