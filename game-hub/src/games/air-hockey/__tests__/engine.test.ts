import { describe, expect, it } from 'vitest';
import {
  DT,
  FRICTION,
  GOAL_LEFT,
  GOAL_RIGHT,
  HEIGHT,
  MAX_PUCK_SPEED,
  PADDLE_R,
  PUCK_R,
  SERVE_DELAY,
  STALL_LIMIT,
  WIDTH,
  createGame,
  paddleBounds,
  predictCrossing,
  setPaddleSpeed,
  setTarget,
  step,
  type State,
} from '../engine';

/** A game in the "play" phase with the puck placed and moving as given, and both paddles out of the way. */
function play(puck: { x: number; y: number; vx?: number; vy?: number }, target = 7): State {
  const s = createGame(target);
  s.phase = 'play';
  s.puck = { x: puck.x, y: puck.y, vx: puck.vx ?? 0, vy: puck.vy ?? 0 };
  s.paddles[0].x = s.paddles[0].tx = 375; // out of the way in the right-hand corner
  s.paddles[1].x = s.paddles[1].tx = 375;
  return s;
}
const run = (s: State, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / DT) && s.phase !== 'over'; i++) step(s);
};

describe('the table', () => {
  it('is a tall rectangle with a centred goal at each end', () => {
    expect(HEIGHT).toBeGreaterThan(WIDTH);
    expect((GOAL_LEFT + GOAL_RIGHT) / 2).toBe(WIDTH / 2);
    expect(GOAL_RIGHT - GOAL_LEFT).toBeGreaterThan(PUCK_R * 4);
    expect(GOAL_RIGHT - GOAL_LEFT).toBeLessThan(WIDTH / 2);
  });

  it('a new game: 0-0, the puck waiting at centre, a serve delay, paddles at home in their own halves', () => {
    const s = createGame();
    expect(s.scores).toEqual([0, 0]);
    expect(s.phase).toBe('serve');
    expect(s.serveTimer).toBe(SERVE_DELAY);
    expect(s.paddles[0].y).toBeGreaterThan(HEIGHT / 2);
    expect(s.paddles[1].y).toBeLessThan(HEIGHT / 2);
    expect(() => createGame(0)).toThrow();
    expect(() => createGame(2.5)).toThrow();
  });

  it('the puck is held still until the serve delay is over, then released', () => {
    const s = createGame();
    const start = { ...s.puck };
    run(s, SERVE_DELAY - 0.1);
    expect(s.phase).toBe('serve');
    expect(s.puck).toEqual(start);
    run(s, 0.2);
    expect(s.phase).toBe('play');
  });
});

describe('puck motion and walls', () => {
  it('slows down with friction: the speed after a second matches exp(-FRICTION)', () => {
    const s = play({ x: 200, y: 350, vx: 0, vy: -0 });
    s.puck.vx = 100;
    run(s, 1);
    expect(s.puck.vx).toBeCloseTo(100 * Math.exp(-FRICTION), 0);
  });

  it('is deterministic: the same game twice gives exactly the same puck', () => {
    const make = () => {
      const s = play({ x: 120, y: 400, vx: 420, vy: -310 });
      for (let i = 0; i < 400; i++) {
        setTarget(s, 0, 100 + (i % 200), 600);
        step(s);
      }
      return s.puck;
    };
    expect(make()).toEqual(make());
  });

  it('bounces off a side wall: the sideways speed reverses (slightly reduced), the other speed is unchanged', () => {
    const s = play({ x: 40, y: 350, vx: -500, vy: 100 });
    step(s);
    run(s, 0.1);
    expect(s.puck.vx).toBeGreaterThan(0);
    expect(s.puck.vx).toBeLessThan(500);
    expect(s.puck.vy).toBeGreaterThan(90);
    expect(s.puck.x).toBeGreaterThanOrEqual(PUCK_R);
    expect(s.events.some((e) => e.type === 'wall')).toBe(true);
  });

  it('bounces off the end wall beside the goal, but passes through the goal mouth', () => {
    const wall = play({ x: 40, y: 30, vx: 0, vy: -600 });
    run(wall, 0.15);
    expect(wall.puck.vy).toBeGreaterThan(0);
    expect(wall.scores).toEqual([0, 0]);
    const goal = play({ x: 200, y: 60, vx: 0, vy: -600 });
    run(goal, 0.3);
    expect(goal.scores[0]).toBe(1);
  });

  it('never leaves the table, however hard it is hit, and never exceeds the top speed', () => {
    const s = play({ x: 200, y: 350, vx: 3000, vy: 2500 });
    for (let i = 0; i < 600; i++) {
      step(s);
      if (s.phase !== 'play') s.phase = 'play';
      expect(s.puck.x).toBeGreaterThanOrEqual(PUCK_R - 1e-6);
      expect(s.puck.x).toBeLessThanOrEqual(WIDTH - PUCK_R + 1e-6);
    }
    expect(Math.hypot(s.puck.vx, s.puck.vy)).toBeLessThanOrEqual(MAX_PUCK_SPEED + 1e-6);
  });
});

describe('paddles', () => {
  it('follow their target at the speed limit, and stay in their own half', () => {
    const s = createGame();
    s.phase = 'play';
    setTarget(s, 0, 50, 100); // far into the other half
    run(s, 2);
    const b = paddleBounds(0);
    expect(s.paddles[0].y).toBeGreaterThanOrEqual(b.minY - 1e-6);
    expect(s.paddles[0].x).toBeCloseTo(50, 0);
    expect(s.paddles[0].y).toBeCloseTo(b.minY, 0);
    setTarget(s, 1, 300, 600);
    run(s, 2);
    expect(s.paddles[1].y).toBeLessThanOrEqual(paddleBounds(1).maxY + 1e-6);
  });

  it('a slower paddle takes proportionally longer to get there', () => {
    const fast = createGame();
    const slow = createGame();
    setPaddleSpeed(slow, 0, 300);
    for (const s of [fast, slow]) setTarget(s, 0, 50, 650);
    run(fast, 0.2);
    run(slow, 0.2);
    expect(Math.abs(slow.paddles[0].x - 200)).toBeLessThan(Math.abs(fast.paddles[0].x - 200));
  });

  it('a paddle hit sends the puck away from the paddle, and a moving paddle hits harder than a still one', () => {
    const hit = (paddleSpeed: number) => {
      const s = play({ x: 200, y: 470, vx: 0, vy: 0 });
      s.phase = 'play';
      s.paddles[0].x = s.paddles[0].tx = 200;
      s.paddles[0].y = s.paddles[0].ty = 560;
      setPaddleSpeed(s, 0, paddleSpeed);
      setTarget(s, 0, 200, 470); // drives straight at the puck
      run(s, 0.25);
      return s.puck;
    };
    const slow = hit(300);
    const fast = hit(1200);
    expect(slow.vy).toBeLessThan(0); // away from the paddle: up the table
    expect(fast.vy).toBeLessThan(slow.vy); // faster, and in the same direction
    expect(Math.abs(fast.vy)).toBeGreaterThan(400);
  });

  it('the puck leaves a paddle at an angle that depends on where it struck: off-centre hits deflect sideways', () => {
    const s = play({ x: 200 + 22, y: 440, vx: 0, vy: 150 });
    s.paddles[0].x = s.paddles[0].tx = 200;
    s.paddles[0].y = s.paddles[0].ty = 440 + PADDLE_R + PUCK_R - 4;
    run(s, 0.1);
    expect(s.puck.vx).toBeGreaterThan(5); // hit on its right: it goes off to the right
    const mirror = play({ x: 200 - 22, y: 440, vx: 0, vy: 150 });
    mirror.paddles[0].x = mirror.paddles[0].tx = 200;
    mirror.paddles[0].y = mirror.paddles[0].ty = 440 + PADDLE_R + PUCK_R - 4;
    run(mirror, 0.1);
    expect(mirror.puck.vx).toBeCloseTo(-s.puck.vx, 3);
  });

  it('a fast puck cannot pass through a paddle (no tunnelling), at the top speed, from many angles', () => {
    for (let angle = 0; angle < 12; angle++) {
      const dir = (angle / 12) * Math.PI * 0.5 + 0.2;
      const s = play({ x: 200 - Math.cos(dir) * 250, y: 560 - Math.sin(dir) * 250, vx: Math.cos(dir) * MAX_PUCK_SPEED, vy: Math.sin(dir) * MAX_PUCK_SPEED });
      s.paddles[0].x = s.paddles[0].tx = 200;
      s.paddles[0].y = s.paddles[0].ty = 560;
      let passed = false;
      for (let i = 0; i < 60; i++) {
        step(s);
        const d = Math.hypot(s.puck.x - s.paddles[0].x, s.puck.y - s.paddles[0].y);
        if (d < PADDLE_R + PUCK_R - 1.5) passed = true;
      }
      expect(passed).toBe(false);
    }
  });
});

describe('goals, serves and the end', () => {
  it('a goal scores for the attacker, announces it, and serves to the player who conceded', () => {
    const s = play({ x: 200, y: 40, vx: 0, vy: -700 });
    run(s, 0.4);
    expect(s.scores).toEqual([1, 0]);
    expect(s.events).toContainEqual({ type: 'goal', scorer: 0 });
    expect(s.events).toContainEqual({ type: 'serve', to: 1 });
    expect(s.phase).toBe('serve');
    expect(s.puck.y).toBeLessThan(HEIGHT / 2); // waiting on the conceding player's half
    expect(s.puck.vx).toBe(0);
    expect(s.puck.vy).toBe(0);
    const bottom = play({ x: 200, y: HEIGHT - 40, vx: 0, vy: 700 });
    run(bottom, 0.4);
    expect(bottom.scores).toEqual([0, 1]);
    expect(bottom.puck.y).toBeGreaterThan(HEIGHT / 2);
  });

  it('the first to the target wins and the game stops', () => {
    const s = play({ x: 200, y: 40, vx: 0, vy: -700 }, 1);
    run(s, 0.4);
    expect(s.phase).toBe('over');
    expect(s.winner).toBe(0);
    expect(s.events).toContainEqual({ type: 'gameover', winner: 0 });
    const tick = s.tick;
    step(s);
    expect(s.tick).toBe(tick);
  });

  it('a game to 3 needs exactly 3 goals', () => {
    const s = createGame(3);
    for (let goals = 1; goals <= 3; goals++) {
      s.phase = 'play';
      s.puck = { x: 200, y: 40, vx: 0, vy: -700 };
      run(s, 0.4);
      expect(s.scores[0]).toBe(goals);
      expect(s.phase).toBe(goals === 3 ? 'over' : 'serve');
    }
  });
});

describe('a puck nobody plays', () => {
  it('after five idle seconds it is handed to the other player\'s half, with no point scored', () => {
    const s = play({ x: 200, y: 480, vx: 0, vy: 0 }); // resting on player 0's half
    run(s, STALL_LIMIT - 0.5);
    expect(s.phase).toBe('play');
    expect(s.events.some((e) => e.type === 'serve')).toBe(false);
    run(s, 1);
    expect(s.events).toContainEqual({ type: 'serve', to: 1 });
    expect(s.puck.y).toBeLessThan(HEIGHT / 2);
    expect(s.scores).toEqual([0, 0]);
    expect(s.phase === 'serve' || s.phase === 'play').toBe(true);
  });

  it('a moving puck never triggers it, and being hit resets the clock', () => {
    const s = play({ x: 200, y: 480, vx: 0, vy: 0 });
    run(s, 4);
    s.puck.vx = 200; // someone hits it
    run(s, 0.2);
    expect(s.stillFor).toBe(0);
    expect(s.events.some((e) => e.type === 'serve')).toBe(false);
  });
});

describe('predicting the puck', () => {
  it('finds where a straight shot will arrive, and bounces it off the side walls', () => {
    const straight = predictCrossing({ x: 200, y: 400, vx: 0, vy: -300 }, 100)!;
    expect(straight.x).toBeCloseTo(200, 3);
    expect(straight.time).toBeCloseTo(-Math.log(1 - FRICTION) / FRICTION, 5); // a little over a second: friction slows the trip
    const angled = predictCrossing({ x: 100, y: 400, vx: 100, vy: -300 }, 100)!;
    expect(angled.x).toBeGreaterThan(100);
    expect(angled.x).toBeLessThan(WIDTH - PUCK_R);
    const bounced = predictCrossing({ x: 350, y: 400, vx: 400, vy: -300 }, 100)!; // would end far right of the table: it bounces back
    expect(bounced.x).toBeLessThan(WIDTH - PUCK_R);
    expect(bounced.x).toBeGreaterThan(PUCK_R);
    expect(predictCrossing({ x: 200, y: 400, vx: 0, vy: 300 }, 100)).toBeNull(); // moving away
    expect(predictCrossing({ x: 200, y: 400, vx: 50, vy: 0 }, 100)).toBeNull();
  });

  it('its prediction matches the real simulation within a few pixels', () => {
    for (const vx of [-250, 0, 180, 330]) {
      const s = play({ x: 200, y: 450, vx, vy: -420 });
      const guess = predictCrossing(s.puck, 120)!;
      let hit: number | null = null;
      for (let i = 0; i < 300 && hit === null; i++) {
        step(s);
        if (s.puck.y <= 120) hit = s.puck.x;
      }
      expect(Math.abs((hit as number) - guess.x)).toBeLessThan(14);
    }
  });
});
