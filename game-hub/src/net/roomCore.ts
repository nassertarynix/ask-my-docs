/**
 * One room of the relay, with no platform in it: it takes a message from a connection and returns the messages to send.
 * The Cloudflare Durable Object (relay/) and the tests and the local development relay all wrap this same class.
 *
 *   lobby     players join and take seats in order; the first is the host. A player who disconnects leaves the lobby.
 *   playing    the host starts the game (choosing which seats are bots). From then on every `act` is stamped with its sender's
 *              seat, numbered, kept in a log and sent to everybody. A player who disconnects keeps their seat and can come back
 *              with their token; they get the whole log and replay it.
 *   bots       are driven by the host's device: the host may send actions for a bot seat. If the host leaves, the lowest
 *              connected seat takes over.
 *
 * The relay never looks inside an action. Whether an action is legal is decided by the game engine on every device, the
 * same way everywhere, so an illegal or out-of-turn action simply changes nothing for anyone.
 */
import { MAX_LOG, MAX_SEATS, type ClientMsg, type ErrorCode, type Json, type LogEntry, type PlayerInfo, type SeatKind, type ServerMsg } from './protocol';

interface Member {
  seat: number;
  name: string;
  token: string;
  conn: string | null;
}
export interface Out {
  /** A connection id, or '*' for every connected member. */
  to: string;
  msg: ServerMsg;
}

export class RoomCore {
  private members: Member[] = [];
  private started = false;
  private seats: SeatKind[] = [];
  private data: Json = null;
  private log: LogEntry[] = [];
  /** How many seats this room has: set by whoever creates it (the first to join), at most MAX_SEATS. */
  private maxSeats = MAX_SEATS;

  constructor(private readonly newToken: () => string) {}

  /** True when nobody is connected, so the room can be forgotten. */
  get empty(): boolean {
    return this.members.every((m) => m.conn === null);
  }

  private err(to: string, code: ErrorCode, message: string): Out[] {
    return [{ to, msg: { t: 'error', code, message } }];
  }

  private memberOf(conn: string): Member | undefined {
    return this.members.find((m) => m.conn === conn);
  }

  private get hostSeat(): number {
    return this.members.find((m) => m.conn !== null)?.seat ?? 0;
  }

  private infos(): PlayerInfo[] {
    return this.members.map((m) => ({ seat: m.seat, name: m.name, connected: m.conn !== null }));
  }

  /** Tell everyone who is here (each member is told their own seat too). */
  private roster(): Out[] {
    return this.members.filter((m) => m.conn !== null).map((m) => ({ to: m.conn as string, msg: { t: 'players', you: m.seat, hostSeat: this.hostSeat, players: this.infos() } }));
  }

  handle(conn: string, msg: ClientMsg): Out[] {
    if (msg.t === 'ping') return [{ to: conn, msg: { t: 'pong' } }];
    if (msg.t === 'join') return this.join(conn, msg.name, msg.token, msg.max);
    const me = this.memberOf(conn);
    if (!me) return this.err(conn, 'forbidden', 'Join the room first.');
    if (msg.t === 'start') return this.start(me, conn, msg.seats, msg.data);
    return this.act(me, conn, msg.action, msg.seat);
  }

  private join(conn: string, name: string, token: string | undefined, max: number | undefined): Out[] {
    const back = token ? this.members.find((m) => m.token === token) : undefined;
    let me: Member;
    if (back) {
      back.conn = conn; // coming back (a second tab with the same token takes over the seat)
      me = back;
    } else {
      if (this.started) return this.err(conn, 'started', 'That game has already started.');
      if (this.members.length >= this.maxSeats) return this.err(conn, 'full', 'That room is full.');
      if (this.members.length === 0 && max !== undefined) this.maxSeats = Math.min(MAX_SEATS, Math.max(2, max)); // only the creator decides the size
      me = { seat: this.members.length, name, token: this.newToken(), conn };
      this.members.push(me);
    }
    const joined: Out = {
      to: conn,
      msg: { t: 'joined', you: me.seat, token: me.token, hostSeat: this.hostSeat, players: this.infos(), started: this.started, seats: this.seats, data: this.data, log: this.log },
    };
    return [joined, ...this.roster().filter((o) => o.to !== conn)];
  }

  private start(me: Member, conn: string, seats: SeatKind[], data: Json): Out[] {
    if (me.seat !== this.hostSeat) return this.err(conn, 'forbidden', 'Only the host can start the game.');
    if (this.started) return this.err(conn, 'started', 'The game has already started.');
    const humans = seats.filter((k) => k === 'human').length;
    const humansFirst = seats.every((k, i) => (i < humans ? k === 'human' : k === 'bot'));
    if (seats.length < 2 || seats.length > this.maxSeats || humans !== this.members.length || !humansFirst) return this.err(conn, 'bad', 'The seats do not match the players in the room.');
    this.started = true;
    this.seats = seats;
    this.data = data;
    return [{ to: '*', msg: { t: 'started', seats, data } }];
  }

  private act(me: Member, conn: string, action: Json, seat: number | undefined): Out[] {
    if (!this.started) return this.err(conn, 'not-started', 'The game has not started.');
    const as = seat ?? me.seat;
    if (as !== me.seat && !(me.seat === this.hostSeat && this.seats[as] === 'bot')) return this.err(conn, 'forbidden', 'You can only act for your own seat.');
    if (this.log.length >= MAX_LOG) return this.err(conn, 'log-full', 'This game has gone on too long.');
    const entry: LogEntry = { seq: this.log.length, seat: as, action };
    this.log.push(entry);
    return [{ to: '*', msg: { t: 'act', seq: entry.seq, seat: as, action } }];
  }

  disconnect(conn: string): Out[] {
    const me = this.memberOf(conn);
    if (!me) return [];
    if (this.started) {
      me.conn = null;
    } else {
      this.members = this.members.filter((m) => m !== me).map((m, i) => ({ ...m, seat: i }));
    }
    return this.roster();
  }
}
