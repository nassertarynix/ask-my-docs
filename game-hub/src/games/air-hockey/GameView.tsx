import { Bot, Users } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { GameProps } from '../../hub/types';
import { sfx } from '../../shared/audio';
import { RadioCards } from '../../shared/RadioCards';
import { store } from '../../shared/storage';
import { steerAi, type Difficulty } from './ai';
import { DT, GOAL_LEFT, GOAL_RIGHT, HEIGHT, PADDLE_R, PUCK_R, WIDTH, createGame, setPaddleSpeed, setTarget, step, type GameEvent, type Player, type State } from './engine';

export const GAME_ID = 'air-hockey';
type Mode = 'ai' | 'pvp';
const COLORS = ['#FF5A4E', '#3B6CF6'] as const;
const INK = '#18181B';
const KEY_SPEED = 720; // px/s for a paddle moved with the keyboard
const isDifficulty = (v: string): v is Difficulty => v === 'easy' || v === 'normal' || v === 'hard';

/** `?fast=4` runs the simulation four times as fast (for tests and for the impatient). */
function fastFromUrl(): number {
  const n = Number(new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('fast'));
  return Number.isFinite(n) && n >= 1 && n <= 16 ? Math.floor(n) : 1;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  age: number;
  color: string;
}

interface Hud {
  scores: [number, number];
  phase: State['phase'];
  winner: Player | null;
}

function Table({ mode, difficulty, target, onFinish }: { mode: Mode; difficulty: Difficulty; target: number; onFinish: (hud: Hud) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hud, setHud] = useState<Hud>({ scores: [0, 0], phase: 'serve', winner: null });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const game: State = createGame(target);
    const fast = fastFromUrl();
    const calm = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const sparks: Spark[] = [];
    const trail: { x: number; y: number }[] = [];
    let flash = 0;
    let shake = 0;
    const keys = new Set<string>();
    const pointers = new Map<number, Player>();
    let scale = 1;
    let dpr = 1;
    let finished = false;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      scale = rect.width / WIDTH;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const burst = (x: number, y: number, n: number, speed: number, color: string) => {
      if (calm) return;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = speed * (0.3 + Math.random() * 0.7);
        sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.35 + Math.random() * 0.25, age: 0, color });
      }
    };

    const react = (events: GameEvent[]) => {
      for (const e of events) {
        if (e.type === 'wall') {
          sfx.angleTick(180 + Math.min(500, e.speed / 2));
          burst(e.x, e.y, 3, 120, INK);
        } else if (e.type === 'paddle') {
          sfx.angleTick(320 + Math.min(700, e.speed / 2));
          burst(e.x, e.y, 6, 200, COLORS[e.player]);
          shake = Math.max(shake, Math.min(5, e.speed / 260));
        } else if (e.type === 'goal') {
          sfx.explosion(46);
          burst(WIDTH / 2, e.scorer === 0 ? 4 : HEIGHT - 4, 30, 380, COLORS[e.scorer]);
          flash = 0.5;
          shake = 8;
        } else if (e.type === 'serve') {
          sfx.turn();
        } else if (e.type === 'gameover') {
          if (mode === 'pvp' || e.winner === 0) sfx.victory();
          else sfx.defeat();
        }
      }
    };

    const snapshot = () => setHud({ scores: [game.scores[0], game.scores[1]], phase: game.phase, winner: game.winner });

    const point = (e: PointerEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return { x: ((e.clientX - rect.left) / rect.width) * WIDTH, y: ((e.clientY - rect.top) / rect.height) * HEIGHT };
    };
    const owner = (e: PointerEvent, y: number): Player => {
      if (mode === 'ai') return 0;
      return pointers.get(e.pointerId) ?? (y > HEIGHT / 2 ? 0 : 1);
    };
    const onDown = (e: PointerEvent) => {
      const p = point(e);
      const who: Player = mode === 'ai' ? 0 : p.y > HEIGHT / 2 ? 0 : 1;
      pointers.set(e.pointerId, who);
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* a pointer that is not active (a synthetic one) cannot be captured: the paddle still follows it */
      }
      setPaddleSpeed(game, who, 1500);
      setTarget(game, who, p.x, p.y);
      e.preventDefault();
    };
    const onMove = (e: PointerEvent) => {
      const p = point(e);
      // a held finger keeps its own paddle; a mouse (no button) steers the paddle of the half it is over
      if (e.pointerType === 'mouse' && e.buttons === 0) {
        const who = mode === 'ai' ? 0 : p.y > HEIGHT / 2 ? 0 : 1;
        setPaddleSpeed(game, who as Player, 1500);
        setTarget(game, who as Player, p.x, p.y);
        return;
      }
      if (!pointers.has(e.pointerId)) return;
      const who = owner(e, p.y);
      setTarget(game, who, p.x, p.y);
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
    };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    // keyboard: arrows move the bottom paddle; in two-player games W A S D move the top one (in one-player games they also move the bottom one)
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'a', 'd', 'w', 's'].includes(k)) {
        keys.add(k);
        e.preventDefault();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const applyKeys = () => {
      const dir = (left: string, right: string, up: string, down: string) => ({ x: (keys.has(right) ? 1 : 0) - (keys.has(left) ? 1 : 0), y: (keys.has(down) ? 1 : 0) - (keys.has(up) ? 1 : 0) });
      const groups: [Player, { x: number; y: number }][] =
        mode === 'pvp'
          ? [
              [0, dir('arrowleft', 'arrowright', 'arrowup', 'arrowdown')],
              [1, dir('a', 'd', 'w', 's')],
            ]
          : [[0, { x: dir('arrowleft', 'arrowright', 'arrowup', 'arrowdown').x + dir('a', 'd', 'w', 's').x, y: dir('arrowleft', 'arrowright', 'arrowup', 'arrowdown').y + dir('a', 'd', 'w', 's').y }]];
      for (const [who, d] of groups) {
        if (d.x === 0 && d.y === 0) continue;
        const pad = game.paddles[who];
        setPaddleSpeed(game, who, KEY_SPEED);
        setTarget(game, who, pad.x + Math.sign(d.x) * 120, pad.y + Math.sign(d.y) * 120);
      }
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const w = WIDTH * scale;
      const h = HEIGHT * scale;
      ctx.fillStyle = '#FAF9F6';
      ctx.fillRect(0, 0, w, h);
      const sx = shake && !calm ? (Math.random() * 2 - 1) * shake : 0;
      const sy = shake && !calm ? (Math.random() * 2 - 1) * shake : 0;
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, sx * dpr, sy * dpr);

      // the table: white, with the centre line, circle and the two goal mouths
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      ctx.strokeStyle = '#E5E3DA';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(0, HEIGHT / 2);
      ctx.lineTo(WIDTH, HEIGHT / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(WIDTH / 2, HEIGHT / 2, 62, 0, Math.PI * 2);
      ctx.stroke();
      // the big score, one for each half, the top one upside down so the player facing it can read it
      ctx.fillStyle = 'rgba(24,24,27,0.08)';
      ctx.font = '700 150px "Space Grotesk", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(game.scores[0]), WIDTH / 2, HEIGHT * 0.75);
      ctx.save();
      ctx.translate(WIDTH / 2, HEIGHT * 0.25);
      ctx.rotate(Math.PI);
      ctx.fillText(String(game.scores[1]), 0, 0);
      ctx.restore();

      // goals
      for (const [y, color] of [[0, COLORS[1]], [HEIGHT, COLORS[0]]] as const) {
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.18;
        ctx.fillRect(GOAL_LEFT, y === 0 ? 0 : HEIGHT - 14, GOAL_RIGHT - GOAL_LEFT, 14);
        ctx.globalAlpha = 1;
      }
      // the rim
      ctx.strokeStyle = INK;
      ctx.lineWidth = 8;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(GOAL_LEFT, 0);
      ctx.lineTo(0, 0);
      ctx.lineTo(0, HEIGHT);
      ctx.lineTo(GOAL_LEFT, HEIGHT);
      ctx.moveTo(GOAL_RIGHT, 0);
      ctx.lineTo(WIDTH, 0);
      ctx.lineTo(WIDTH, HEIGHT);
      ctx.lineTo(GOAL_RIGHT, HEIGHT);
      ctx.stroke();

      // puck trail, puck
      for (let i = 1; i < trail.length; i++) {
        ctx.strokeStyle = `rgba(24,24,27,${(i / trail.length) * 0.25})`;
        ctx.lineWidth = PUCK_R * 1.4 * (i / trail.length);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo((trail[i - 1] as { x: number }).x, (trail[i - 1] as { y: number }).y);
        ctx.lineTo((trail[i] as { x: number }).x, (trail[i] as { y: number }).y);
        ctx.stroke();
      }
      ctx.fillStyle = INK;
      ctx.beginPath();
      ctx.arc(game.puck.x, game.puck.y, PUCK_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FAF9F6';
      ctx.beginPath();
      ctx.arc(game.puck.x, game.puck.y, PUCK_R * 0.45, 0, Math.PI * 2);
      ctx.fill();

      // paddles
      for (const p of [0, 1] as Player[]) {
        const pad = game.paddles[p];
        ctx.fillStyle = COLORS[p];
        ctx.strokeStyle = INK;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(pad.x, pad.y, PADDLE_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(pad.x, pad.y, PADDLE_R * 0.4, 0, Math.PI * 2);
        ctx.stroke();
      }

      for (const sp of sparks) {
        ctx.globalAlpha = 1 - sp.age / sp.life;
        ctx.fillStyle = sp.color;
        ctx.fillRect(sp.x - 2, sp.y - 2, 4, 4);
      }
      ctx.globalAlpha = 1;

      // a countdown while the puck is held
      if (game.phase === 'serve') {
        ctx.fillStyle = INK;
        ctx.font = '700 44px "Space Grotesk", system-ui, sans-serif';
        const seconds = Math.max(1, Math.ceil(game.serveTimer));
        const y = game.server === 0 ? HEIGHT / 2 + 60 : HEIGHT / 2 - 60;
        ctx.save();
        ctx.translate(WIDTH / 2, y);
        if (game.server === 1 && mode === 'pvp') ctx.rotate(Math.PI);
        ctx.globalAlpha = 0.7;
        ctx.fillText(seconds === 1 && game.serveTimer < 0.5 ? 'GO' : String(seconds), 0, 0);
        ctx.restore();
        ctx.globalAlpha = 1;
      }
      if (flash > 0.01) {
        ctx.fillStyle = `rgba(255,255,255,${flash})`;
        ctx.fillRect(0, 0, WIDTH, HEIGHT);
      }
    };

    let raf = 0;
    let last = performance.now();
    let accumulator = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const elapsed = Math.min(0.1, (now - last) / 1000);
      last = now;
      accumulator += elapsed * fast;
      let changed = false;
      while (accumulator >= DT) {
        accumulator -= DT;
        if (mode === 'ai') steerAi(game, 1, difficulty);
        applyKeys();
        step(game);
        if (game.events.length > 0) {
          const events = game.events.splice(0, game.events.length);
          react(events);
          if (events.some((e) => e.type === 'goal' || e.type === 'serve' || e.type === 'gameover')) changed = true;
        }
        trail.push({ x: game.puck.x, y: game.puck.y });
        if (trail.length > 14) trail.shift();
      }
      if (changed) {
        snapshot();
        if (game.phase === 'over' && !finished) {
          finished = true;
          onFinish({ scores: [game.scores[0], game.scores[1]], phase: 'over', winner: game.winner });
        }
      }
      for (const sp of sparks) {
        sp.age += elapsed;
        sp.x += sp.vx * elapsed;
        sp.y += sp.vy * elapsed;
      }
      for (let i = sparks.length - 1; i >= 0; i--) if ((sparks[i] as Spark).age >= (sparks[i] as Spark).life) sparks.splice(i, 1);
      shake *= Math.exp(-elapsed * 10);
      flash *= Math.exp(-elapsed * 8);
      canvas.dataset.puck = `${Math.round(game.puck.x)},${Math.round(game.puck.y)}`;
      canvas.dataset.paddle0 = `${Math.round(game.paddles[0].x)},${Math.round(game.paddles[0].y)}`;
      canvas.dataset.paddle1 = `${Math.round(game.paddles[1].x)},${Math.round(game.paddles[1].y)}`;
      canvas.dataset.phase = game.phase;
      draw();
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
    // the simulation is created once per match
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const label = (p: Player) => (mode === 'pvp' ? `Player ${p + 1}` : p === 0 ? 'You' : 'Computer');
  return (
    <div className="board-wrap ah-wrap" data-screen="play" data-score0={hud.scores[0]} data-score1={hud.scores[1]} data-phase={hud.phase} data-winner={hud.winner ?? ''}>
      <div className="scorebar">
        {([0, 1] as Player[]).map((p) => (
          <div key={p} className="score" style={{ opacity: 1, ['--player' as string]: COLORS[p] }}>
            <span>
              <span className="score-dot" />
              {label(p)}
            </span>
            <output aria-label={`${label(p)} goals`}>
              {hud.scores[p]} / {target}
            </output>
          </div>
        ))}
      </div>
      <canvas ref={canvasRef} className="ah-table" role="img" aria-label="The air hockey table. Drag to move your paddle, or use the keyboard." />
    </div>
  );
}

export default function GameView(_props: GameProps) {
  const [saved] = useState(() => store.loadGameSettings(GAME_ID, { mode: 'ai', difficulty: 'normal', target: 7 }));
  const [mode, setMode] = useState<Mode>(saved.mode === 'pvp' ? 'pvp' : 'ai');
  const [difficulty, setDifficulty] = useState<Difficulty>(isDifficulty(saved.difficulty) ? saved.difficulty : 'normal');
  const [target, setTarget_] = useState<string>(String([5, 7, 11].includes(saved.target) ? saved.target : 7));
  const [round, setRound] = useState<number | null>(null);
  const [result, setResult] = useState<Hud | null>(null);

  const start = () => {
    sfx.click();
    store.saveGameSettings(GAME_ID, { mode, difficulty, target: Number(target) });
    setResult(null);
    setRound((n) => (n ?? 0) + 1);
  };

  const finish = (hud: Hud) => {
    setResult(hud);
    if (mode === 'pvp') store.recordResult(GAME_ID, 'played');
    else store.recordResult(GAME_ID, hud.winner === 0 ? 'win' : 'loss');
  };

  if (round === null) {
    const stats = store.loadStats(GAME_ID);
    return (
      <div className="setup" data-screen="setup">
        <p className="setup-lede">Flick the puck into their goal. First to the target score wins.</p>
        <RadioCards
          legend="Who is playing?"
          name="ah-mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'ai', title: '1 player', hint: 'You at the bottom, the computer at the top', icon: <Bot size={22} aria-hidden="true" /> },
            { value: 'pvp', title: '2 players', hint: 'One device, one finger each: split screen', icon: <Users size={22} aria-hidden="true" /> },
          ]}
        />
        {mode === 'ai' && (
          <RadioCards
            legend="How good is the computer?"
            name="ah-level"
            value={difficulty}
            onChange={setDifficulty}
            options={[
              { value: 'easy', title: 'Easy', hint: 'Slow, and only follows the puck' },
              { value: 'normal', title: 'Normal', hint: 'Predicts shots and hits back' },
              { value: 'hard', title: 'Hard', hint: 'Fast, accurate, and aims' },
            ]}
          />
        )}
        <RadioCards
          legend="First to"
          name="ah-target"
          value={target}
          onChange={setTarget_}
          options={[
            { value: '5', title: '5 goals', hint: 'Quick' },
            { value: '7', title: '7 goals', hint: 'Standard' },
            { value: '11', title: '11 goals', hint: 'A long one' },
          ]}
        />
        <button type="button" className="btn btn-primary btn-big" onClick={start} data-action="start">
          Start
        </button>
        {stats.plays > 0 && (
          <p className="setup-stats">
            Against the computer: {stats.wins} won, {stats.losses} lost.
          </p>
        )}
        <p className="armory-keys">
          Drag to move your paddle (it stays on your half). In two-player games each player uses their own half of the screen, with one finger each. Keyboard: <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd> for the bottom paddle, <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd> for the top one. A puck nobody touches for five seconds goes to the other side.
        </p>
      </div>
    );
  }

  return (
    <div className="ah-stage">
      <Table key={round} mode={mode} difficulty={difficulty} target={Number(target)} onFinish={finish} />
      {result && (
        <div className="end-card ah-end" role="status" data-result={result.winner}>
          <h2>{mode === 'ai' ? (result.winner === 0 ? 'You win!' : 'The computer wins') : `Player ${(result.winner ?? 0) + 1} wins`}</h2>
          <p>
            {result.scores[0]} : {result.scores[1]}
          </p>
          <div className="board-actions">
            <button type="button" className="btn btn-primary" onClick={start} data-action="again" autoFocus>
              Rematch
            </button>
            <button type="button" className="btn" onClick={() => setRound(null)}>
              Change settings
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
