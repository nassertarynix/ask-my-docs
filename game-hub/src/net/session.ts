/**
 * One player's side of a room: joins, keeps the lobby list, replays the shared log through the game's engine, and (on the
 * host's device) plays the computer seats. The same class runs online (over a WebSocket to the relay) and offline against
 * computers (over `MemoryRelay`), so there is one code path to get right.
 *
 * Actions are never applied when they are sent. A device sends its action to the relay, and every device (the sender
 * included) applies it when the relay sends it back, in the relay's order. Illegal or out-of-turn actions are ignored by
 * the engine on every device alike, so nobody can be put out of step.
 */
import type { Json, PlayerInfo, SeatKind, ServerMsg } from './protocol';
import type { Connect, Transport } from './transport';

export interface Adapter<S, A, D> {
  /** The state a game starts in. */
  start(data: D): S;
  /** Play `action` for `seat`; null if it is not that seat's turn or the action is illegal. */
  apply(state: S, seat: number, action: A): S | null;
  turn(state: S): number;
  over(state: S): boolean;
  /** A computer seat's action. */
  bot(state: S, data: D, seat: number, step: number): A | null;
  seats(data: D): SeatKind[];
  /** Untrusted input from the network: return null unless it is exactly what the game expects. */
  parseData(raw: unknown): D | null;
  parseAction(raw: unknown): A | null;
  describe(before: S, seat: number, action: A, data: D): string;
}

export type Status = 'connecting' | 'lobby' | 'playing' | 'failed' | 'closed';

export interface Snapshot<S, A, D> {
  status: Status;
  error: string | null;
  code: string;
  you: number | null;
  hostSeat: number | null;
  players: PlayerInfo[];
  seats: SeatKind[];
  data: D | null;
  state: S | null;
  /** The actions that took effect, in order. */
  log: { seat: number; action: A }[];
  /** One line of text for each action in `log`. */
  lines: string[];
  /** Is the link to the relay up right now? */
  online: boolean;
}

export interface TokenStore {
  get(code: string): string | null;
  set(code: string, token: string): void;
}

/** Tokens kept for this tab only, so a refresh or a dropped connection gets the seat back. Never throws. */
export const sessionTokens: TokenStore = {
  get(code) {
    try {
      return sessionStorage.getItem(`paper-arcade:room:${code}`);
    } catch {
      return null;
    }
  },
  set(code, token) {
    try {
      sessionStorage.setItem(`paper-arcade:room:${code}`, token);
    } catch {
      /* private mode: no reconnect token, still works */
    }
  },
};

export interface SessionOptions<S, A, D> {
  adapter: Adapter<S, A, D>;
  connect: Connect;
  code: string;
  name: string;
  tokens?: TokenStore;
  /** How long a computer seat "thinks" before it plays. */
  botDelayMs?: number;
  /** When set, the first player to arrive starts the game with this setup at once (solo play against computers). */
  autoStart?: D;
}

export class OnlineSession<S, A, D> {
  private snap: Snapshot<S, A, D>;
  private readonly listeners = new Set<() => void>();
  private transport: Transport | null = null;
  private botTimer: ReturnType<typeof setTimeout> | null = null;
  private nextSeq = 0;
  private ended = false;

  constructor(private readonly opts: SessionOptions<S, A, D>) {
    this.snap = { status: 'connecting', error: null, code: opts.code, you: null, hostSeat: null, players: [], seats: [], data: null, state: null, log: [], lines: [], online: false };
    this.transport = opts.connect({
      open: () => this.onOpen(),
      message: (m) => this.onMessage(m),
      close: (willRetry) => this.onClose(willRetry),
    });
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  getSnapshot = (): Snapshot<S, A, D> => this.snap;

  private set(patch: Partial<Snapshot<S, A, D>>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
    this.driveBots();
  }

  private send(msg: Parameters<Transport['send']>[0]): void {
    this.transport?.send(msg);
  }

  private onOpen(): void {
    this.set({ online: true });
    const token = (this.opts.tokens ?? sessionTokens).get(this.opts.code);
    this.send(token ? { t: 'join', name: this.opts.name, token } : { t: 'join', name: this.opts.name });
  }

  private onClose(willRetry: boolean): void {
    if (this.ended) return;
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    if (willRetry) this.set({ online: false });
    else this.set({ online: false, status: 'failed', error: 'Could not reach the game server.' });
  }

  private onMessage(m: ServerMsg): void {
    const { adapter } = this.opts;
    switch (m.t) {
      case 'joined': {
        (this.opts.tokens ?? sessionTokens).set(this.opts.code, m.token);
        const patch: Partial<Snapshot<S, A, D>> = { you: m.you, hostSeat: m.hostSeat, players: m.players, error: null };
        if (m.started) {
          const data = adapter.parseData(m.data);
          if (!data) return this.set({ status: 'failed', error: 'The game setup was not understood.' });
          this.set({ ...patch, ...this.rebuild(data, m.log) });
        } else {
          this.set({ ...patch, status: 'lobby' });
          if (this.opts.autoStart && m.you === 0) this.start(this.opts.autoStart);
        }
        return;
      }
      case 'players':
        return this.set({ you: m.you, hostSeat: m.hostSeat, players: m.players });
      case 'started': {
        const data = adapter.parseData(m.data);
        if (!data) return this.set({ status: 'failed', error: 'The game setup was not understood.' });
        return this.set(this.rebuild(data, []));
      }
      case 'act': {
        const { state, data } = this.snap;
        if (this.snap.status !== 'playing' || !state || !data || m.seq < this.nextSeq) return;
        this.nextSeq = m.seq + 1;
        const action = adapter.parseAction(m.action);
        const next = action === null ? null : adapter.apply(state, m.seat, action);
        if (action === null || next === null) return; // everyone ignores it the same way
        return this.set({ state: next, log: [...this.snap.log, { seat: m.seat, action }], lines: [...this.snap.lines, adapter.describe(state, m.seat, action, data)] });
      }
      case 'error':
        if (this.snap.status === 'connecting' && (m.code === 'full' || m.code === 'started')) return this.set({ status: 'failed', error: m.message });
        return this.set({ error: m.message });
      case 'pong':
        return;
    }
  }

  /** Replay a whole log from the start (when the game begins, or when this device comes back). */
  private rebuild(data: D, entries: { seq: number; seat: number; action: Json }[]): Partial<Snapshot<S, A, D>> {
    const { adapter } = this.opts;
    let state = adapter.start(data);
    const log: { seat: number; action: A }[] = [];
    const lines: string[] = [];
    for (const e of entries) {
      const action = adapter.parseAction(e.action);
      const next = action === null ? null : adapter.apply(state, e.seat, action);
      if (action === null || next === null) continue;
      lines.push(adapter.describe(state, e.seat, action, data));
      log.push({ seat: e.seat, action });
      state = next;
    }
    this.nextSeq = entries.length;
    return { status: 'playing', data, seats: adapter.seats(data), state, log, lines };
  }

  /** Host only: begin the game. */
  start(data: D): void {
    if (this.snap.status !== 'lobby' || this.snap.you !== this.snap.hostSeat) return;
    this.send({ t: 'start', seats: this.opts.adapter.seats(data), data: data as unknown as Json });
  }

  /** Play an action for this device's seat. Returns false (and sends nothing) if it is not your turn or not legal. */
  submit(action: A): boolean {
    const { state, you, status } = this.snap;
    if (status !== 'playing' || state === null || you === null) return false;
    if (this.opts.adapter.over(state) || this.opts.adapter.turn(state) !== you || this.opts.adapter.apply(state, you, action) === null) return false;
    this.send({ t: 'act', action: action as unknown as Json });
    return true;
  }

  /** The host's device plays the computer seats. */
  private driveBots(): void {
    const { state, data, you, hostSeat, status, seats, log } = this.snap;
    if (status !== 'playing' || !state || !data || you === null || you !== hostSeat || this.ended) return;
    if (this.opts.adapter.over(state)) return;
    const seat = this.opts.adapter.turn(state);
    if (seats[seat] !== 'bot' || this.botTimer) return;
    const step = log.length;
    this.botTimer = setTimeout(() => {
      this.botTimer = null;
      const now = this.snap;
      if (this.ended || now.state === null || now.data === null || now.log.length !== step || now.you !== now.hostSeat) return this.driveBots();
      const action = this.opts.adapter.bot(now.state, now.data, seat, step);
      if (action !== null) this.send({ t: 'act', action: action as unknown as Json, seat });
    }, this.opts.botDelayMs ?? 700);
  }

  leave(): void {
    this.ended = true;
    if (this.botTimer) clearTimeout(this.botTimer);
    this.botTimer = null;
    this.transport?.close();
    this.snap = { ...this.snap, status: 'closed', online: false };
    for (const l of this.listeners) l();
  }
}
