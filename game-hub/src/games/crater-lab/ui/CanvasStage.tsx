/**
 * The playfield: a Canvas 2D renderer that also owns the game clock and the pointer.
 *
 * Each animation frame it (1) advances the engine in fixed 1/60 s ticks, however fast the screen
 * refreshes, (2) turns the engine's events into particles, numbers, shake and sound, and (3) draws.
 * Nothing in here decides anything about the game: all of that is the engine's. The random numbers
 * used here are only for decoration (which way a spark flies) and never reach the engine.
 */
import { useEffect, useRef } from 'react';
import {
  BARREL_LENGTH,
  DT,
  TANK_HALF_WIDTH,
  TANK_HEIGHT,
  TANK_MAX_HP,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type GameEvent,
  type GameState,
  type Tank,
  type WeaponId,
} from '../engine/types';
import { step, worldOf } from '../engine/game';
import { barrelPivot, simulateShot } from '../engine/physics';
import { groundY } from '../engine/terrain';
import { sfx } from '../../../shared/audio';

export const PLAYER_COLORS = ['#FF5A4E', '#3B6CF6'] as const;
const INK = '#18181B';
const PAPER = '#FAF9F6';
const GRID = '#EEECE4';
const DIRT = '#F1D9A7';
const DIRT_SHADE = '#DDBF83';
const WEAPON_COLORS: Record<WeaponId, string> = {
  standard: INK,
  splitter: '#F5B700',
  mound: '#9A6B3F',
  blackhole: '#7C3AED',
  bouncer: '#16A34A',
};

/** World pixels of drag for one point of power: dragging 240 px from the tank is full power. */
const DRAG_PER_POWER = 2.4;
/** Freeze the simulation this long on a direct hit. */
const HIT_STOP_MS = 40;
/** The aim preview shows this much of the flight. */
const PREVIEW_FRACTION = 0.25;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  size: number;
  color: string;
  gravity: number;
  /** Pulled towards this point instead of flying free (black hole dust). */
  towards?: { x: number; y: number };
}
interface Ring {
  x: number;
  y: number;
  from: number;
  to: number;
  life: number;
  age: number;
  color: string;
  width: number;
}
interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  size: number;
  life: number;
  age: number;
}
interface WindMote {
  x: number;
  y: number;
  speed: number;
  length: number;
}

interface Fx {
  particles: Particle[];
  rings: Ring[];
  floaters: Floater[];
  motes: WindMote[];
  trails: Map<number, { x: number; y: number }[]>;
  shake: number;
  flash: number;
  camX: number;
  focusX: number;
  time: number;
}

function createFx(): Fx {
  const motes: WindMote[] = [];
  for (let i = 0; i < 46; i++) {
    motes.push({ x: Math.random() * WORLD_WIDTH, y: 20 + Math.random() * (WORLD_HEIGHT * 0.62), speed: 0.6 + Math.random() * 0.9, length: 8 + Math.random() * 16 });
  }
  return { particles: [], rings: [], floaters: [], motes, trails: new Map(), shake: 0, flash: 0, camX: 0, focusX: WORLD_WIDTH / 2, time: 0 };
}

function burst(fx: Fx, x: number, y: number, count: number, speed: number, colors: string[], options: { up?: boolean; gravity?: number; life?: number; size?: number } = {}): void {
  for (let i = 0; i < count; i++) {
    const angle = options.up ? -Math.PI / 2 + (Math.random() - 0.5) * 1.5 : Math.random() * Math.PI * 2;
    const v = speed * (0.35 + Math.random() * 0.65);
    fx.particles.push({
      x,
      y,
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v,
      life: (options.life ?? 0.7) * (0.6 + Math.random() * 0.6),
      age: 0,
      size: (options.size ?? 4) * (0.6 + Math.random() * 0.8),
      color: colors[i % colors.length] ?? INK,
      gravity: options.gravity ?? 320,
    });
  }
}

/** Turn what the engine reports into things to see and hear. Returns true if the frame should freeze (a direct hit). */
function react(fx: Fx, events: GameEvent[], calm: boolean): boolean {
  let hitStop = false;
  const amount = calm ? 0.4 : 1;
  for (const e of events) {
    switch (e.type) {
      case 'fire':
        sfx.cannon(e.power);
        fx.rings.push({ x: e.x, y: e.y, from: 3, to: 16, life: 0.18, age: 0, color: INK, width: 3 });
        burst(fx, e.x, e.y, Math.round(8 * amount), 90, ['#A1A1AA', INK], { gravity: -30, life: 0.5, size: 3 });
        fx.shake = Math.max(fx.shake, 2.5);
        break;
      case 'explosion': {
        sfx.explosion(e.radius);
        const tint = WEAPON_COLORS[e.weapon];
        fx.rings.push({ x: e.x, y: e.y, from: e.radius * 0.3, to: e.radius * 1.25, life: 0.32, age: 0, color: INK, width: 4 });
        fx.rings.push({ x: e.x, y: e.y, from: 2, to: e.radius * 0.9, life: 0.22, age: 0, color: tint === INK ? '#FF7A45' : tint, width: 8 });
        burst(fx, e.x, e.y, Math.round((e.radius * 0.75 + 6) * amount), e.radius * 6.5, [DIRT_SHADE, INK, DIRT, '#FF7A45']);
        fx.shake = Math.max(fx.shake, Math.min(15, e.radius * 0.3));
        fx.flash = Math.max(fx.flash, 0.16);
        break;
      }
      case 'mound':
        sfx.mound();
        fx.rings.push({ x: e.x, y: e.y, from: 6, to: e.radius, life: 0.4, age: 0, color: WEAPON_COLORS.mound, width: 4 });
        burst(fx, e.x, e.y - 6, Math.round(30 * amount), 250, [DIRT_SHADE, DIRT, WEAPON_COLORS.mound], { up: true, size: 5, life: 0.9 });
        fx.shake = Math.max(fx.shake, 5);
        break;
      case 'bounce':
        sfx.bounce();
        fx.rings.push({ x: e.x, y: e.y, from: 2, to: 13, life: 0.2, age: 0, color: WEAPON_COLORS.bouncer, width: 3 });
        burst(fx, e.x, e.y, Math.round(5 * amount), 80, [DIRT_SHADE, INK], { up: true, size: 3, life: 0.4 });
        break;
      case 'split':
        sfx.split();
        fx.rings.push({ x: e.x, y: e.y, from: 2, to: 20, life: 0.22, age: 0, color: WEAPON_COLORS.splitter, width: 3 });
        burst(fx, e.x, e.y, Math.round(10 * amount), 130, [WEAPON_COLORS.splitter, INK], { gravity: 80, size: 3, life: 0.4 });
        break;
      case 'singularity':
        sfx.singularity();
        fx.rings.push({ x: e.x, y: e.y, from: 120, to: 8, life: 0.5, age: 0, color: WEAPON_COLORS.blackhole, width: 3 });
        break;
      case 'implosion':
        fx.rings.push({ x: e.x, y: e.y, from: 6, to: e.radius * 2.2, life: 0.45, age: 0, color: WEAPON_COLORS.blackhole, width: 6 });
        break;
      case 'damage': {
        if (e.cause === 'fall') sfx.hit();
        const color = PLAYER_COLORS[e.tank];
        fx.floaters.push({ x: e.x, y: e.y - 8, text: `-${e.amount}`, color, size: e.direct ? 30 : 22, life: 1.25, age: 0 });
        if (e.direct) {
          fx.floaters.push({ x: e.x, y: e.y - 38, text: 'DIRECT HIT', color: INK, size: 13, life: 1.1, age: 0 });
          hitStop = true;
        } else if (e.cause === 'fall') {
          fx.floaters.push({ x: e.x, y: e.y - 30, text: 'OUCH', color: INK, size: 12, life: 1, age: 0 });
        }
        break;
      }
      case 'miss':
        fx.floaters.push({ x: Math.min(WORLD_WIDTH - 40, Math.max(40, e.x)), y: Math.min(WORLD_HEIGHT - 120, Math.max(60, e.y)), text: 'OUT!', color: INK, size: 18, life: 1.1, age: 0 });
        break;
      default:
        break;
    }
  }
  return hitStop;
}

function updateFx(fx: Fx, game: GameState, dt: number, calm: boolean): void {
  fx.time += dt;
  // shake and flash die away exponentially: a damped camera
  fx.shake *= Math.exp(-dt * 9);
  if (fx.shake < 0.05 || calm) fx.shake = 0;
  fx.flash *= Math.exp(-dt * 12);

  for (const p of fx.particles) {
    p.age += dt;
    if (p.towards) {
      const dx = p.towards.x - p.x;
      const dy = p.towards.y - p.y;
      const d = Math.hypot(dx, dy) || 1;
      // spiral in: mostly inwards, a little sideways
      p.vx += ((dx / d) * 900 - (dy / d) * 300) * dt;
      p.vy += ((dy / d) * 900 + (dx / d) * 300) * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      if (d < 8) p.age = p.life;
    } else {
      p.vy += p.gravity * dt;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  fx.particles = fx.particles.filter((p) => p.age < p.life);
  for (const r of fx.rings) r.age += dt;
  fx.rings = fx.rings.filter((r) => r.age < r.life);
  for (const f of fx.floaters) {
    f.age += dt;
    f.y -= 30 * dt * (1 - f.age / f.life);
  }
  fx.floaters = fx.floaters.filter((f) => f.age < f.life);

  // wind motes drift with the wind (and a little on their own, so calm air still looks alive)
  const drift = game.wind * 9;
  for (const m of fx.motes) {
    m.x += (drift * m.speed + 6) * dt;
    if (m.x > WORLD_WIDTH + 30) m.x = -30;
    if (m.x < -30) m.x = WORLD_WIDTH + 30;
  }

  // black holes pull dust inwards
  if (!calm) {
    for (const hole of game.singularities) {
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = 70 + Math.random() * 90;
        fx.particles.push({ x: hole.x + Math.cos(a) * d, y: hole.y + Math.sin(a) * d, vx: 0, vy: 0, life: 0.9, age: 0, size: 3, color: Math.random() < 0.5 ? WEAPON_COLORS.blackhole : INK, gravity: 0, towards: hole });
      }
    }
  }

  // trails: remember where each projectile has been
  const alive = new Set<number>();
  for (const p of game.projectiles) {
    alive.add(p.id);
    let trail = fx.trails.get(p.id);
    if (!trail) {
      trail = [];
      fx.trails.set(p.id, trail);
    }
    trail.push({ x: p.x, y: p.y });
    if (trail.length > 22) trail.shift();
  }
  for (const id of fx.trails.keys()) if (!alive.has(id)) fx.trails.delete(id);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTank(ctx: CanvasRenderingContext2D, tank: Tank, active: boolean, time: number): void {
  const dead = tank.hp <= 0;
  const color = dead ? '#B4B4BB' : PLAYER_COLORS[tank.index];
  const pivot = barrelPivot(tank);
  const rad = (tank.angle * Math.PI) / 180;

  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // barrel (drawn first so the turret covers its root); a wreck's barrel droops
  const droop = dead ? (tank.index === 0 ? -0.5 : Math.PI + 0.5) : rad;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(pivot.x, pivot.y);
  ctx.lineTo(pivot.x + Math.cos(droop) * BARREL_LENGTH, pivot.y - Math.sin(droop) * BARREL_LENGTH);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();

  // turret
  ctx.fillStyle = color;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(pivot.x, pivot.y + 1, 7.5, Math.PI, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // body
  roundRect(ctx, tank.x - TANK_HALF_WIDTH, tank.y - TANK_HEIGHT, TANK_HALF_WIDTH * 2, TANK_HEIGHT, 3.5);
  ctx.fill();
  ctx.stroke();
  // tracks
  ctx.fillStyle = INK;
  ctx.fillRect(tank.x - TANK_HALF_WIDTH + 3, tank.y - 3.5, TANK_HALF_WIDTH * 2 - 6, 2);

  if (dead) return;
  // hit points above the tank
  const w = 34;
  const top = tank.y - TANK_HEIGHT - 26;
  ctx.fillStyle = PAPER;
  ctx.fillRect(tank.x - w / 2, top, w, 6);
  ctx.fillStyle = color;
  ctx.fillRect(tank.x - w / 2, top, (w * tank.hp) / TANK_MAX_HP, 6);
  ctx.strokeRect(tank.x - w / 2, top, w, 6);

  if (active) {
    const bob = Math.sin(time * 5) * 3;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.moveTo(tank.x - 6, top - 14 + bob);
    ctx.lineTo(tank.x + 6, top - 14 + bob);
    ctx.lineTo(tank.x, top - 6 + bob);
    ctx.closePath();
    ctx.fill();
  }
}

function drawWindVane(ctx: CanvasRenderingContext2D, wind: number, time: number, x: number): void {
  const top = 16;
  const poleHeight = 34;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, top + poleHeight);
  ctx.lineTo(x, top);
  ctx.stroke();
  // a streamer that gets longer and flatter the harder it blows, and hangs limp in calm air
  const strength = Math.abs(wind) / 15;
  const dir = wind >= 0 ? 1 : -1;
  const length = 12 + strength * 54;
  const segments = 8;
  ctx.beginPath();
  ctx.moveTo(x, top + 2);
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const sag = (1 - strength) * 22 * t * t;
    const wave = Math.sin(time * (3 + strength * 7) - t * 5) * (2 + strength * 3) * t;
    ctx.lineTo(x + dir * length * t * (0.25 + 0.75 * strength), top + 2 + sag + wave);
  }
  ctx.strokeStyle = '#FF7A45';
  ctx.lineWidth = 6;
  ctx.stroke();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = '700 13px "Space Grotesk", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const arrow = wind === 0 ? '' : wind > 0 ? ' →' : '← ';
  ctx.fillText(wind > 0 ? `WIND ${Math.abs(wind).toFixed(1)}${arrow}` : `${arrow}WIND ${Math.abs(wind).toFixed(1)}`, x, top + poleHeight + 5);
}

interface View {
  cssWidth: number;
  cssHeight: number;
  scale: number;
  dpr: number;
}

function draw(ctx: CanvasRenderingContext2D, game: GameState, fx: Fx, view: View, showAim: boolean): void {
  const { scale, dpr } = view;
  const viewWidth = view.cssWidth / scale;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, view.cssWidth, view.cssHeight);

  const shakeX = fx.shake ? (Math.random() * 2 - 1) * fx.shake : 0;
  const shakeY = fx.shake ? (Math.random() * 2 - 1) * fx.shake : 0;
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, (-fx.camX + shakeX) * dpr * scale, shakeY * dpr * scale);

  const left = fx.camX - 20;
  const right = fx.camX + viewWidth + 20;

  // graph-paper sky
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = Math.floor(left / 50) * 50; x <= right; x += 50) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, WORLD_HEIGHT);
  }
  for (let y = 0; y <= WORLD_HEIGHT; y += 50) {
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
  }
  ctx.stroke();

  // wind motes
  ctx.strokeStyle = '#C9C6BB';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const lean = Math.max(-1, Math.min(1, game.wind / 15));
  for (const m of fx.motes) {
    if (m.x < left || m.x > right) continue;
    ctx.moveTo(m.x, m.y);
    ctx.lineTo(m.x - (4 + m.length * Math.abs(lean)) * (lean >= 0 ? 1 : -1), m.y);
  }
  ctx.stroke();

  // the ground: fill, a darker band just under the surface, then the ink outline
  const x0 = Math.max(0, Math.floor(left));
  const x1 = Math.min(game.width - 1, Math.ceil(right));
  const surface = (offset: number) => {
    ctx.beginPath();
    ctx.moveTo(x0, groundY(game.terrain, game.height, x0) + offset);
    for (let x = x0 + 2; x <= x1; x += 2) ctx.lineTo(x, groundY(game.terrain, game.height, x) + offset);
    ctx.lineTo(x1, groundY(game.terrain, game.height, x1) + offset);
  };
  surface(0);
  ctx.lineTo(x1, WORLD_HEIGHT + 40);
  ctx.lineTo(x0, WORLD_HEIGHT + 40);
  ctx.closePath();
  ctx.fillStyle = DIRT;
  ctx.fill();
  ctx.lineJoin = 'round';
  surface(9);
  ctx.strokeStyle = DIRT_SHADE;
  ctx.lineWidth = 3;
  ctx.stroke();
  surface(0);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();

  // aim preview: the first quarter of where this shot would fly, as dots
  const current = game.tanks[game.current];
  if (showAim && game.phase === 'aim' && current.hp > 0) {
    const path = simulateShot(worldOf(game), current, current.angle, current.power, current.weapon).path;
    const shown = Math.max(6, Math.floor(path.length * PREVIEW_FRACTION));
    ctx.fillStyle = INK;
    for (let i = 3; i < shown && i < path.length; i += 3) {
      const p = path[i];
      if (!p) continue;
      ctx.globalAlpha = 0.85 * (1 - i / shown) + 0.15;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // the drag handle: where to put your finger for this angle and power
    const pivot = barrelPivot(current);
    const rad = (current.angle * Math.PI) / 180;
    const hx = pivot.x + Math.cos(rad) * current.power * DRAG_PER_POWER;
    const hy = pivot.y - Math.sin(rad) * current.power * DRAG_PER_POWER;
    ctx.strokeStyle = PLAYER_COLORS[current.index];
    ctx.lineWidth = 2;
    ctx.setLineDash([2, 7]);
    ctx.beginPath();
    ctx.moveTo(pivot.x, pivot.y);
    ctx.lineTo(hx, hy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = PAPER;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(hx, hy, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = PLAYER_COLORS[current.index];
    ctx.beginPath();
    ctx.arc(hx, hy, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const tank of game.tanks) drawTank(ctx, tank, game.phase === 'aim' && tank.index === game.current, fx.time);

  // black holes
  for (const hole of game.singularities) {
    const pulse = 12 + Math.sin(fx.time * 18) * 2.5;
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = WEAPON_COLORS.blackhole;
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 8]);
    ctx.lineDashOffset = -fx.time * 60;
    ctx.beginPath();
    ctx.arc(hole.x, hole.y, pulse + 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // trails and projectiles
  for (const p of game.projectiles) {
    const trail = fx.trails.get(p.id);
    const tint = WEAPON_COLORS[p.weapon];
    if (trail && trail.length > 1) {
      for (let i = 1; i < trail.length; i++) {
        const a = trail[i - 1];
        const b = trail[i];
        if (!a || !b) continue;
        ctx.strokeStyle = tint;
        ctx.globalAlpha = (i / trail.length) * 0.5;
        ctx.lineWidth = 1 + (i / trail.length) * 3;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    const r = p.fragment ? 3.5 : 5;
    ctx.fillStyle = tint;
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  for (const r of fx.rings) {
    const t = r.age / r.life;
    ctx.globalAlpha = 1 - t;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = r.width * (1 - t * 0.6);
    ctx.beginPath();
    ctx.arc(r.x, r.y, Math.max(0.5, r.from + (r.to - r.from) * (1 - (1 - t) * (1 - t))), 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const p of fx.particles) {
    ctx.globalAlpha = Math.min(1, (1 - p.age / p.life) * 1.6);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  // floating numbers: bold, with a paper outline so they read over anything
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const f of fx.floaters) {
    const t = f.age / f.life;
    const pop = t < 0.12 ? 0.6 + (t / 0.12) * 0.55 : 1.15 - Math.min(0.15, (t - 0.12) * 0.6);
    ctx.globalAlpha = t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1;
    ctx.font = `700 ${Math.round(f.size * pop)}px "Space Grotesk", system-ui, sans-serif`;
    ctx.strokeStyle = PAPER;
    ctx.lineWidth = 5;
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.globalAlpha = 1;

  // screen space: the wind vane, and the flash of a blast
  ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
  drawWindVane(ctx, game.wind, fx.time, viewWidth / 2);
  if (fx.flash > 0.01) {
    ctx.fillStyle = `rgba(255,255,255,${fx.flash})`;
    ctx.fillRect(0, 0, viewWidth, WORLD_HEIGHT);
  }
}

export interface CanvasStageProps {
  /** The live engine state. The stage advances it and reads it; it is mutated in place. */
  game: GameState;
  /** A person may aim right now (their turn, nothing in the air). Shows the preview and accepts drags. */
  canAim: boolean;
  onAim: (angle: number, power: number) => void;
  /** A tap or click on the field while a shot is in the air (splits a Tri-Splitter). */
  onAction: () => void;
  /** Called with everything the engine reported since the last frame. */
  onEvents: (events: GameEvent[]) => void;
}

export function CanvasStage({ game, canAim, onAim, onAction, onEvents }: CanvasStageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // the loop reads the latest props through this ref, so it never has to restart
  const latest = useRef({ canAim, onAim, onAction, onEvents });
  useEffect(() => {
    latest.current = { canAim, onAim, onAction, onEvents };
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const fx = createFx();
    const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const view: View = { cssWidth: 1, cssHeight: 1, scale: 1, dpr: 1 };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      view.cssWidth = Math.max(1, rect.width);
      view.cssHeight = Math.max(1, rect.height);
      view.dpr = Math.min(2, window.devicePixelRatio || 1);
      view.scale = view.cssHeight / WORLD_HEIGHT;
      canvas.width = Math.round(view.cssWidth * view.dpr);
      canvas.height = Math.round(view.cssHeight * view.dpr);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    /** Where the camera would like to look: the action. Only matters when the view is narrower than the world. */
    const focus = (): number => {
      if (game.projectiles.length > 0) return game.projectiles.reduce((sum, p) => sum + p.x, 0) / game.projectiles.length;
      const hole = game.singularities[0];
      if (hole) return hole.x;
      if (game.phase === 'aim') {
        const me = game.tanks[game.current];
        const them = game.tanks[game.current === 0 ? 1 : 0];
        return me.x + Math.sign(them.x - me.x) * (view.cssWidth / view.scale) * 0.22;
      }
      return fx.focusX;
    };

    let raf = 0;
    let last = performance.now();
    let accumulator = 0;
    let frozenUntil = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const elapsed = Math.min(0.1, (now - last) / 1000); // a background tab must not come back as a huge jump
      last = now;

      if (now >= frozenUntil) {
        accumulator += elapsed;
        while (accumulator >= DT) {
          accumulator -= DT;
          step(game);
          if (game.events.length > 0) {
            const events = game.events.splice(0, game.events.length);
            if (react(fx, events, calm) && !calm) {
              frozenUntil = now + HIT_STOP_MS; // hit-stop: hold this frame for a moment
              accumulator = 0;
            }
            latest.current.onEvents(events);
            if (frozenUntil > now) break;
          }
        }
      }
      // events raised outside the loop (the shot being fired from a click) are picked up here
      if (game.events.length > 0) {
        const events = game.events.splice(0, game.events.length);
        react(fx, events, calm);
        latest.current.onEvents(events);
      }

      updateFx(fx, game, elapsed, calm);
      const viewWidth = view.cssWidth / view.scale;
      if (viewWidth >= game.width) {
        fx.camX = (game.width - viewWidth) / 2;
      } else {
        fx.focusX = focus();
        const target = Math.min(game.width - viewWidth, Math.max(0, fx.focusX - viewWidth / 2));
        fx.camX += (target - fx.camX) * Math.min(1, elapsed * 5);
      }
      draw(ctx, game, fx, view, latest.current.canAim);
    };
    raf = requestAnimationFrame(frame);

    // ---- pointer: drag towards where you want to shoot; further away is more power ----
    let dragging = false;
    const aimAt = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const wx = (event.clientX - rect.left) / view.scale + fx.camX;
      const wy = (event.clientY - rect.top) / view.scale;
      const pivot = barrelPivot(game.tanks[game.current]);
      const dx = wx - pivot.x;
      const dy = pivot.y - wy;
      const angle = Math.min(180, Math.max(0, (Math.atan2(Math.max(0, dy), dx) * 180) / Math.PI));
      latest.current.onAim(angle, Math.hypot(dx, dy) / DRAG_PER_POWER);
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      if (game.phase === 'aim' && latest.current.canAim) {
        dragging = true;
        canvas.setPointerCapture(event.pointerId);
        aimAt(event);
      } else if (game.phase === 'flight') {
        latest.current.onAction();
      }
      event.preventDefault();
    };
    const move = (event: PointerEvent) => {
      if (dragging && game.phase === 'aim' && latest.current.canAim) aimAt(event);
    };
    const up = (event: PointerEvent) => {
      dragging = false;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    };
  }, [game]);

  return (
    <canvas
      ref={canvasRef}
      className="stage"
      role="img"
      aria-label="The battlefield: two tanks on hilly ground. Use the controls below, or drag on the field, to aim."
    />
  );
}
