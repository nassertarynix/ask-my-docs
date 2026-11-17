/**
 * Every sound in the hub is synthesised here with the Web Audio API: oscillators, gain envelopes
 * and filtered white noise. There are no audio files to download.
 *
 * Browsers only allow sound after a user gesture, so the AudioContext is created lazily, the first
 * time a sound is requested from inside a click, tap or key press. Where Web Audio does not exist
 * (tests, very old browsers) every call is a silent no-op.
 */
import { store } from './storage';

type Ctx = AudioContext;

interface WindowWithWebkit {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

let ctx: Ctx | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let muted = store.loadSettings().muted;
const listeners = new Set<() => void>();

const MASTER_VOLUME = 0.5;

function context(): Ctx | null {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
    return ctx;
  }
  if (typeof window === 'undefined') return null;
  const w = window as unknown as WindowWithWebkit;
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER_VOLUME;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
  }
  return ctx;
}

/** One second of white noise, made once and reused by every noisy sound. */
function noise(c: Ctx): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  // a fixed little generator rather than Math.random: the same noise every time
  let seed = 22222;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 16807) % 2147483647;
    data[i] = (seed / 2147483647) * 2 - 1;
  }
  return noiseBuffer;
}

interface ToneOptions {
  type: OscillatorType;
  /** Start frequency in Hz. */
  from: number;
  /** End frequency in Hz (an exponential sweep); defaults to `from`. */
  to?: number;
  /** Seconds. */
  duration: number;
  /** Peak gain, 0..1. */
  volume: number;
  /** Seconds from now. */
  delay?: number;
  /** Seconds to reach the peak. */
  attack?: number;
}

/** An oscillator with a quick attack and an exponential decay to silence. */
function tone(c: Ctx, out: AudioNode, o: ToneOptions): void {
  const start = c.currentTime + (o.delay ?? 0);
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = o.type;
  osc.frequency.setValueAtTime(Math.max(1, o.from), start);
  if (o.to !== undefined && o.to !== o.from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), start + o.duration);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.volume), start + (o.attack ?? 0.005));
  gain.gain.exponentialRampToValueAtTime(0.0001, start + o.duration);
  osc.connect(gain).connect(out);
  osc.start(start);
  osc.stop(start + o.duration + 0.02);
}

interface NoiseOptions {
  duration: number;
  volume: number;
  filter: BiquadFilterType;
  /** Filter frequency at the start, and optionally where it sweeps to. */
  from: number;
  to?: number;
  delay?: number;
  q?: number;
}

/** A burst of filtered white noise with an exponential decay. */
function burst(c: Ctx, out: AudioNode, o: NoiseOptions): void {
  const start = c.currentTime + (o.delay ?? 0);
  const src = c.createBufferSource();
  src.buffer = noise(c);
  src.loop = o.duration > 0.9;
  const filter = c.createBiquadFilter();
  filter.type = o.filter;
  filter.Q.value = o.q ?? 0.7;
  filter.frequency.setValueAtTime(o.from, start);
  if (o.to !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), start + o.duration);
  const gain = c.createGain();
  gain.gain.setValueAtTime(Math.max(0.0002, o.volume), start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + o.duration);
  src.connect(filter).connect(gain).connect(out);
  src.start(start);
  src.stop(start + o.duration + 0.02);
}

/** Run a sound recipe if sound is available and not muted. */
function play(recipe: (c: Ctx, out: AudioNode) => void): void {
  if (muted) return;
  const c = context();
  if (!c || !master) return;
  try {
    recipe(c, master);
  } catch {
    /* a sound that fails to play must never break the game */
  }
}

export const sfx = {
  /** UI click: a short sine blip. */
  click(): void {
    play((c, out) => tone(c, out, { type: 'sine', from: 660, to: 880, duration: 0.06, volume: 0.18 }));
  },

  /** Aim tick: a very short blip whose pitch follows the barrel angle (0..180°), so you can hear where you are aiming. */
  angleTick(angleDeg: number): void {
    const t = Math.min(1, Math.max(0, angleDeg / 180));
    play((c, out) => tone(c, out, { type: 'sine', from: 320 + t * 640, duration: 0.035, volume: 0.09 }));
  },

  /** Cannon: a low triangle sweeping down, with a short crack of noise on top. Louder for more power (0..100). */
  cannon(power: number): void {
    const p = Math.min(1, Math.max(0.2, power / 100));
    play((c, out) => {
      tone(c, out, { type: 'triangle', from: 190 + 60 * p, to: 42, duration: 0.3, volume: 0.5 * p + 0.15 });
      burst(c, out, { duration: 0.09, volume: 0.35 * p + 0.1, filter: 'highpass', from: 900 });
    });
  },

  /** Explosion: low-passed noise decaying away over a sub-bass thump. `size` is the crater radius in px. */
  explosion(size: number): void {
    const s = Math.min(1.4, Math.max(0.5, size / 38));
    play((c, out) => {
      burst(c, out, { duration: 0.55 * s, volume: 0.75, filter: 'lowpass', from: 1700, to: 110, q: 0.9 });
      tone(c, out, { type: 'sine', from: 105, to: 30, duration: 0.5 * s, volume: 0.85, attack: 0.008 });
    });
  },

  /** Dirt mound: rising arpeggio of soft triangle notes, like a marimba run. */
  mound(): void {
    const notes = [196, 247, 294, 392, 494]; // G major, climbing
    play((c, out) => {
      notes.forEach((f, i) => {
        tone(c, out, { type: 'triangle', from: f, duration: 0.22, volume: 0.26, delay: i * 0.07, attack: 0.004 });
        tone(c, out, { type: 'sine', from: f * 4, duration: 0.07, volume: 0.06, delay: i * 0.07 }); // the mallet's click
      });
      burst(c, out, { duration: 0.4, volume: 0.16, filter: 'bandpass', from: 300, to: 900, q: 1.2 });
    });
  },

  /** Victory: four notes of a major chord climbing to the octave, the last one held. */
  victory(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5]; // C E G C
    play((c, out) => {
      notes.forEach((f, i) => {
        const last = i === notes.length - 1;
        tone(c, out, { type: 'triangle', from: f, duration: last ? 0.7 : 0.2, volume: 0.3, delay: i * 0.15, attack: 0.01 });
        tone(c, out, { type: 'square', from: f / 2, duration: last ? 0.6 : 0.16, volume: 0.06, delay: i * 0.15 });
      });
    });
  },

  /** Defeat: three notes falling. */
  defeat(): void {
    play((c, out) => {
      [392, 330, 247].forEach((f, i) => tone(c, out, { type: 'triangle', from: f, to: f * 0.97, duration: 0.3, volume: 0.24, delay: i * 0.2, attack: 0.01 }));
    });
  },

  /** Rubber bomb bounce: a quick upward boing. */
  bounce(): void {
    play((c, out) => tone(c, out, { type: 'sine', from: 170, to: 520, duration: 0.13, volume: 0.3 }));
  },

  /** Shell splitting: three quick high chirps. */
  split(): void {
    play((c, out) => {
      [0, 1, 2].forEach((i) => tone(c, out, { type: 'square', from: 900 + i * 260, to: 1500 + i * 260, duration: 0.05, volume: 0.1, delay: i * 0.035 }));
    });
  },

  /** Black hole opening: a long downward moan with a rising hiss, lasting about as long as the pull. */
  singularity(): void {
    play((c, out) => {
      tone(c, out, { type: 'sawtooth', from: 240, to: 36, duration: 1.1, volume: 0.2, attack: 0.05 });
      burst(c, out, { duration: 1.1, volume: 0.12, filter: 'bandpass', from: 200, to: 2400, q: 4 });
    });
  },

  /** Being hit: a short dull knock. */
  hit(): void {
    play((c, out) => tone(c, out, { type: 'square', from: 150, to: 70, duration: 0.12, volume: 0.2 }));
  },

  /** A new turn. */
  turn(): void {
    play((c, out) => tone(c, out, { type: 'sine', from: 520, to: 700, duration: 0.09, volume: 0.12 }));
  },
};

export function isMuted(): boolean {
  return muted;
}

export function setMuted(next: boolean): void {
  if (muted === next) return;
  muted = next;
  store.saveSettings({ muted });
  if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : MASTER_VOLUME, ctx.currentTime, 0.02);
  for (const listener of listeners) listener();
}

/** For React's useSyncExternalStore: be told when mute changes. */
export function subscribeMuted(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Call from the first click or key press so later sounds (an explosion mid-animation) are allowed to play. */
export function unlockAudio(): void {
  context();
}
