/**
 * CRATER // LAB's screens: choosing a mode, then the match (HUD, weapon bar, aim controls, results).
 * The playfield itself is CanvasStage. This file owns turn-taking: who may aim, the computer's turn,
 * the keyboard, and recording the result.
 */
import { Activity, Bomb, Bot, Mountain, Orbit, Split, Trophy, Users, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GameProps } from '../../../hub/types';
import { sfx } from '../../../shared/audio';
import { store, type GameStats } from '../../../shared/storage';
import { MAX_POWER, MIN_POWER, TANK_MAX_HP, WEAPON_IDS, type GameEvent, type GameState, type PlayerIndex, type WeaponId, type Winner } from '../engine/types';
import { canSplitNow, clampAngle, clampPower, createGame, fire, selectWeapon, setAim, triggerSplit } from '../engine/game';
import { DIFFICULTIES, planShot, type Difficulty } from '../engine/ai';
import { createRng } from '../engine/rng';
import { WEAPONS } from '../engine/weapons';
import { CanvasStage, PLAYER_COLORS } from './CanvasStage';

const GAME_ID = 'crater-lab';
type Mode = 'ai' | 'pvp';
const DIFFICULTY_ORDER: Difficulty[] = ['recruit', 'tactician', 'savant'];
const WEAPON_ICONS: Record<WeaponId, LucideIcon> = { standard: Bomb, splitter: Split, mound: Mountain, blackhole: Orbit, bouncer: Activity };
/** In a match against the computer, the person is always the left tank. */
const AI_PLAYER: PlayerIndex = 1;

interface MatchConfig {
  mode: Mode;
  difficulty: Difficulty;
  seed: number;
}

/** `#/play/crater-lab?seed=7` plays a fixed map (handy for sharing a map, and for the browser tests). */
function seedFromUrl(): number | null {
  const query = window.location.hash.split('?')[1] ?? '';
  const raw = new URLSearchParams(query).get('seed');
  const n = raw === null ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function newSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

function isMode(v: string): v is Mode {
  return v === 'ai' || v === 'pvp';
}
function isDifficulty(v: string): v is Difficulty {
  return v === 'recruit' || v === 'tactician' || v === 'savant';
}

// ------------------------------------------------------------------ setup

function Setup({ onStart }: { onStart: (config: MatchConfig) => void }) {
  const [saved] = useState(() => store.loadGameSettings(GAME_ID, { mode: 'ai', difficulty: 'tactician' }));
  const [mode, setMode] = useState<Mode>(isMode(saved.mode) ? saved.mode : 'ai');
  const [difficulty, setDifficulty] = useState<Difficulty>(isDifficulty(saved.difficulty) ? saved.difficulty : 'tactician');
  const [stats] = useState<GameStats>(() => store.loadStats(GAME_ID));

  const start = () => {
    sfx.click();
    store.saveGameSettings(GAME_ID, { mode, difficulty });
    onStart({ mode, difficulty, seed: seedFromUrl() ?? newSeed() });
  };

  return (
    <div className="setup" data-screen="setup">
      <p className="setup-lede">Two tanks, one hill between them, and a crate of ammunition nobody should have approved.</p>

      <fieldset className="choice-group">
        <legend>Who is playing?</legend>
        <div className="choices choices-2">
          <label className="choice">
            <input type="radio" name="mode" checked={mode === 'ai'} onChange={() => setMode('ai')} />
            <span className="choice-box">
              <Bot size={22} aria-hidden="true" />
              <strong>1 player</strong>
              <small>You against the ballistics AI</small>
            </span>
          </label>
          <label className="choice">
            <input type="radio" name="mode" checked={mode === 'pvp'} onChange={() => setMode('pvp')} />
            <span className="choice-box">
              <Users size={22} aria-hidden="true" />
              <strong>2 players</strong>
              <small>Pass the device after each shot</small>
            </span>
          </label>
        </div>
      </fieldset>

      {mode === 'ai' && (
        <fieldset className="choice-group">
          <legend>How good is the AI?</legend>
          <div className="choices choices-3">
            {DIFFICULTY_ORDER.map((id) => (
              <label className="choice" key={id}>
                <input type="radio" name="difficulty" checked={difficulty === id} onChange={() => setDifficulty(id)} />
                <span className="choice-box">
                  <strong>{DIFFICULTIES[id].name}</strong>
                  <small>{DIFFICULTIES[id].blurb}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <button type="button" className="btn btn-primary btn-big" onClick={start} data-action="start">
        Start the match
      </button>

      {stats.plays > 0 && (
        <p className="setup-stats">
          <Trophy size={15} aria-hidden="true" /> Against the AI: {stats.wins} won, {stats.losses} lost
          {stats.bestStreak > 1 ? `, best streak ${stats.bestStreak}` : ''}.
        </p>
      )}

      <section className="armory" aria-label="The ammunition">
        <h2>The ammunition</h2>
        <ul>
          {WEAPON_IDS.map((id) => {
            const Icon = WEAPON_ICONS[id];
            return (
              <li key={id}>
                <Icon size={18} aria-hidden="true" />
                <span>
                  <strong>{WEAPONS[id].name}</strong> <em>{Number.isFinite(WEAPONS[id].ammo) ? `×${WEAPONS[id].ammo}` : 'unlimited'}</em>
                  <br />
                  {WEAPONS[id].blurb}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="armory-keys">
          Drag on the field to aim, or use <kbd>←</kbd> <kbd>→</kbd> for the angle and <kbd>↑</kbd> <kbd>↓</kbd> for power. <kbd>Space</kbd> fires, and <kbd>Space</kbd> again splits a
          Tri-Splitter in the air. <kbd>1</kbd>–<kbd>5</kbd> pick the ammo.
        </p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ match

/** What the HUD shows: a plain copy of the bits of engine state React needs to draw. */
interface Hud {
  phase: GameState['phase'];
  current: PlayerIndex;
  turn: number;
  wind: number;
  winner: Winner;
  canSplit: boolean;
  tanks: { hp: number; angle: number; power: number; weapon: WeaponId; ammo: Record<WeaponId, number> }[];
}

function snapshot(game: GameState): Hud {
  return {
    phase: game.phase,
    current: game.current,
    turn: game.turn,
    wind: game.wind,
    winner: game.winner,
    canSplit: canSplitNow(game),
    tanks: game.tanks.map((t) => ({ hp: t.hp, angle: t.angle, power: t.power, weapon: t.weapon, ammo: { ...t.ammo } })),
  };
}

function playerName(config: MatchConfig, index: PlayerIndex): string {
  if (config.mode === 'pvp') return `Player ${index + 1}`;
  return index === AI_PLAYER ? DIFFICULTIES[config.difficulty].name : 'You';
}

function Match({ config, onRematch, onChangeMode }: { config: MatchConfig; onRematch: () => void; onChangeMode: () => void }) {
  // The engine state is one mutable object for the whole match. It lives in state (never replaced)
  // and React is told about changes through `hud`, a snapshot taken whenever something visible changes.
  const [game] = useState(() => createGame({ seed: config.seed }));
  const [aiRng] = useState(() => createRng((config.seed ^ 0x9e3779b9) >>> 0));
  const [hud, setHud] = useState<Hud>(() => snapshot(game));
  const [result, setResult] = useState<{ stats: GameStats } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const aiShots = useRef(0);
  const sync = useCallback(() => setHud(snapshot(game)), [game]);

  const aiTurn = config.mode === 'ai' && hud.current === AI_PLAYER;
  const canAim = hud.phase === 'aim' && !aiTurn;
  const me = hud.tanks[hud.current];

  // ---- the person's controls ----
  const aim = useCallback(
    (angle: number, power: number, tick = true) => {
      if (game.phase !== 'aim' || (config.mode === 'ai' && game.current === AI_PLAYER)) return;
      const before = game.tanks[game.current].angle;
      setAim(game, clampAngle(angle), clampPower(power));
      const after = game.tanks[game.current].angle;
      if (tick && Math.round(before) !== Math.round(after)) sfx.angleTick(after);
      sync();
    },
    [game, config.mode, sync],
  );

  const choose = useCallback(
    (weapon: WeaponId) => {
      if (game.phase !== 'aim' || (config.mode === 'ai' && game.current === AI_PLAYER)) return;
      if (selectWeapon(game, weapon)) {
        sfx.click();
        sync();
      }
    },
    [game, config.mode, sync],
  );

  /** The one big button: fire while aiming, split while a Tri-Splitter is in the air. */
  const act = useCallback(() => {
    const computerOwnsShot = config.mode === 'ai' && game.current === AI_PLAYER;
    if (game.phase === 'aim' && !computerOwnsShot) {
      if (fire(game)) sync();
    } else if (game.phase === 'flight' && !computerOwnsShot && triggerSplit(game)) {
      sync();
    }
  }, [game, config.mode, sync]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName ?? '';
      // A focused slider keeps its own arrow keys, but Space and the number keys still play the game:
      // after dragging a slider with the mouse it keeps the focus, and Space must still fire.
      const onSlider = tag === 'INPUT';
      if (onSlider && event.key.startsWith('Arrow')) return;
      if (tag === 'SELECT' || tag === 'TEXTAREA') return;
      const tank = game.tanks[game.current];
      const big = event.shiftKey ? 5 : 1;
      switch (event.key) {
        case 'ArrowLeft':
          aim(tank.angle + big, tank.power);
          break;
        case 'ArrowRight':
          aim(tank.angle - big, tank.power);
          break;
        case 'ArrowUp':
          aim(tank.angle, tank.power + big);
          break;
        case 'ArrowDown':
          aim(tank.angle, tank.power - big);
          break;
        case ' ':
        case 'Enter':
          if (tag === 'BUTTON' || tag === 'A') return; // let a focused button do its own thing
          act();
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5': {
          const weapon = WEAPON_IDS[Number(event.key) - 1];
          if (weapon) choose(weapon);
          break;
        }
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game, aim, act, choose]);

  // ---- the computer's turn: think, swing the barrel round, fire ----
  useEffect(() => {
    if (hud.phase !== 'aim' || !aiTurn) return;
    let cancelled = false;
    let raf = 0;
    const timers: number[] = [];
    timers.push(
      window.setTimeout(() => {
        if (cancelled) return;
        const plan = planShot(game, AI_PLAYER, config.difficulty, aiRng, { shotsTaken: aiShots.current });
        selectWeapon(game, plan.weapon);
        const tank = game.tanks[AI_PLAYER];
        const from = { angle: tank.angle, power: tank.power };
        const started = performance.now();
        const swing = (now: number) => {
          if (cancelled) return;
          const t = Math.min(1, (now - started) / 750);
          const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          const before = Math.round(tank.angle / 3);
          setAim(game, from.angle + (plan.angle - from.angle) * eased, from.power + (plan.power - from.power) * eased);
          if (Math.round(tank.angle / 3) !== before) sfx.angleTick(tank.angle);
          sync();
          if (t < 1) {
            raf = requestAnimationFrame(swing);
            return;
          }
          timers.push(
            window.setTimeout(() => {
              if (cancelled) return;
              aiShots.current += 1;
              fire(game, { autoSplit: plan.autoSplit });
              sync();
            }, 280),
          );
        };
        raf = requestAnimationFrame(swing);
      }, 700),
    );
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      timers.forEach((id) => window.clearTimeout(id));
    };
  }, [hud.phase, hud.turn, aiTurn, game, config.difficulty, aiRng, sync]);

  // ---- what the engine reports ----
  const onEvents = useCallback(
    (events: GameEvent[]) => {
      for (const e of events) {
        if (e.type === 'turn') {
          sfx.turn();
          if (config.mode === 'pvp') setBanner(`Player ${e.current + 1}, your turn`);
        } else if (e.type === 'gameover') {
          const outcome = config.mode === 'pvp' ? 'played' : e.winner === 'draw' ? 'draw' : e.winner === AI_PLAYER ? 'loss' : 'win';
          setResult({ stats: store.recordResult(GAME_ID, outcome) });
          if (outcome === 'loss') sfx.defeat();
          else sfx.victory();
        }
      }
      sync();
    },
    [config.mode, sync],
  );

  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner(null), 1500);
    return () => window.clearTimeout(id);
  }, [banner]);

  const status =
    hud.phase === 'over'
      ? 'Match over'
      : hud.phase !== 'aim'
        ? hud.canSplit && !aiTurn
          ? 'Split it now!'
          : 'Incoming…'
        : aiTurn
          ? `${playerName(config, AI_PLAYER)} is aiming…`
          : config.mode === 'pvp'
            ? `Player ${hud.current + 1}: aim and fire`
            : 'Your turn: aim and fire';

  const headline =
    hud.winner === 'draw'
      ? 'Mutual destruction'
      : hud.winner === null
        ? ''
        : config.mode === 'pvp'
          ? `Player ${hud.winner + 1} wins`
          : hud.winner === AI_PLAYER
            ? `${playerName(config, AI_PLAYER)} wins`
            : 'You win';

  return (
    <div
      className="match"
      data-screen="match"
      data-phase={hud.phase}
      data-current={hud.current}
      data-turn={hud.turn}
      data-hp0={hud.tanks[0]?.hp}
      data-hp1={hud.tanks[1]?.hp}
      data-winner={hud.winner ?? ''}
    >
      <div className="hud">
        {([0, 1] as PlayerIndex[]).map((index) => {
          const tank = hud.tanks[index];
          if (!tank) return null;
          const active = hud.current === index && hud.phase !== 'over';
          return (
            <div key={index} className={`player player-${index}${active ? ' player-active' : ''}`} style={{ '--player': PLAYER_COLORS[index] } as CSSProperties}>
              <span className="player-name">{playerName(config, index)}</span>
              <span className="hp" role="meter" aria-label={`${playerName(config, index)} hit points`} aria-valuemin={0} aria-valuemax={TANK_MAX_HP} aria-valuenow={tank.hp}>
                <span className="hp-fill" style={{ width: `${(tank.hp / TANK_MAX_HP) * 100}%` }} />
              </span>
              <span className="hp-number">{tank.hp}</span>
            </div>
          );
        })}
        <p className="status" role="status">
          {status}
        </p>
      </div>

      <div className="stage-wrap">
        <CanvasStage game={game} canAim={canAim} onAim={aim} onAction={act} onEvents={onEvents} />
        {banner && hud.phase === 'aim' && (
          <div className="banner" aria-hidden="true">
            {banner}
          </div>
        )}
        {result && (
          <div className="result" role="dialog" aria-modal="false" aria-label="Match result">
            <h2>{headline}</h2>
            <p>
              {hud.tanks[0]?.hp} : {hud.tanks[1]?.hp} after {Math.ceil(hud.turn / 2)} rounds.
              {config.mode === 'ai' && result.stats.streak > 1 ? ` That is ${result.stats.streak} in a row.` : ''}
            </p>
            <div className="result-actions">
              <button type="button" className="btn btn-primary" onClick={onRematch} data-action="rematch" autoFocus>
                Rematch
              </button>
              <button type="button" className="btn" onClick={onChangeMode}>
                Change mode
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="controls">
        <div className="weapons" role="radiogroup" aria-label="Ammunition">
          {WEAPON_IDS.map((id, i) => {
            const Icon = WEAPON_ICONS[id];
            const left = me?.ammo[id] ?? 0;
            const selected = me?.weapon === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`weapon${selected ? ' weapon-selected' : ''}`}
                disabled={!canAim || left <= 0}
                title={`${WEAPONS[id].name}: ${WEAPONS[id].blurb} (key ${i + 1})`}
                data-weapon={id}
                onClick={(event) => {
                  choose(id);
                  if (event.detail > 0) event.currentTarget.blur(); // after a mouse click, Space should fire, not re-press this
                }}
              >
                <Icon size={18} aria-hidden="true" />
                <span className="weapon-name">{WEAPONS[id].name}</span>
                <span className="weapon-count">{Number.isFinite(left) ? `×${left}` : '∞'}</span>
              </button>
            );
          })}
        </div>

        <div className="aim">
          <label className="slider">
            <span>
              Angle <output>{Math.round(me?.angle ?? 0)}°</output>
            </span>
            {/* the slider runs left to right like the barrel does: left end aims left (180°) */}
            <input
              type="range"
              min={0}
              max={180}
              step={1}
              value={180 - Math.round(me?.angle ?? 0)}
              disabled={!canAim}
              aria-label="Barrel angle"
              onChange={(e) => aim(180 - Number(e.target.value), me?.power ?? 50)}
            />
          </label>
          <label className="slider">
            <span>
              Power <output>{Math.round(me?.power ?? 0)}</output>
            </span>
            <input
              type="range"
              min={MIN_POWER}
              max={MAX_POWER}
              step={1}
              value={Math.round(me?.power ?? 0)}
              disabled={!canAim}
              aria-label="Shot power"
              onChange={(e) => aim(me?.angle ?? 60, Number(e.target.value), false)}
            />
          </label>
          <button
            type="button"
            className={`btn btn-primary btn-fire${hud.canSplit && !aiTurn ? ' btn-split' : ''}`}
            disabled={!(canAim || (hud.canSplit && !aiTurn))}
            data-action="fire"
            onClick={(event) => {
              act();
              if (event.detail > 0) event.currentTarget.blur();
            }}
          >
            {hud.canSplit && !aiTurn ? 'Split!' : 'Fire'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the game

export default function GameView(_props: GameProps) {
  const [config, setConfig] = useState<MatchConfig | null>(null);
  const [round, setRound] = useState(0);

  if (!config) return <Setup onStart={setConfig} />;
  return (
    <Match
      key={round}
      config={config}
      onRematch={() => {
        sfx.click();
        // a rematch is a new map, unless the URL pins one
        setConfig({ ...config, seed: seedFromUrl() ?? newSeed() });
        setRound((n) => n + 1);
      }}
      onChangeMode={() => {
        sfx.click();
        setConfig(null);
      }}
    />
  );
}
