import { describe, expect, it } from 'vitest';
import { PROFILES, aiTarget, steerAi, type Difficulty } from '../ai';
import { HEIGHT, PADDLE_R, WIDTH, createGame, paddleBounds, setTarget, step, type Player, type State } from '../engine';

const LEVELS: Difficulty[] = ['easy', 'normal', 'hard'];

/** Run a game where `controllers[p]` steers each player every tick. Returns the final state. */
function simulate(controllers: [(s: State) => void, (s: State) => void], seconds: number, target = 3): State {
  const s = createGame(target);
  for (let i = 0; i < seconds * 60 && s.phase !== 'over'; i++) {
    controllers[0](s);
    controllers[1](s);
    step(s);
  }
  return s;
}
const idle = (): void => undefined;
const ai = (p: Player, level: Difficulty) => (s: State) => steerAi(s, p, level);

describe('the computer paddle', () => {
  it('goes to where an incoming shot will cross its defence line', () => {
    const s = createGame();
    s.phase = 'play';
    s.tick = 5;
    s.puck = { x: 300, y: 400, vx: 0, vy: -500 }; // straight at the top paddle's side
    const t = aiTarget(s, 1, 'hard');
    expect(Math.abs(t.x - 300)).toBeLessThan(25);
    expect(t.y).toBeLessThan(HEIGHT / 2);
  });

  it('follows bounces: a shot off the side wall is met where it will arrive, not where it is now', () => {
    const s = createGame();
    s.phase = 'play';
    s.puck = { x: 330, y: 450, vx: 380, vy: -420 }; // heads for the right wall, then back across
    const t = aiTarget(s, 1, 'hard');
    expect(t.x).toBeLessThan(330); // not simply chasing the puck's x
  });

  it('attacks a slow puck on its own half: it heads for a spot behind the puck', () => {
    const s = createGame();
    s.phase = 'play';
    s.paddles[1].x = 200;
    s.paddles[1].y = 80;
    s.puck = { x: 150, y: 250, vx: 0, vy: 10 };
    for (const level of LEVELS) {
      const t = aiTarget(s, 1, level);
      expect(Math.hypot(t.x - 150, t.y - 250)).toBeLessThan(PADDLE_R + 15 + 40);
      expect(t.y).toBeLessThanOrEqual(250); // on the near side of the puck, so the drive goes towards the far goal
    }
  });

  it('works for the bottom player too (mirrored)', () => {
    const s = createGame();
    s.phase = 'play';
    s.puck = { x: 300, y: 300, vx: 0, vy: 500 };
    const t = aiTarget(s, 0, 'hard');
    expect(Math.abs(t.x - 300)).toBeLessThan(25);
    expect(t.y).toBeGreaterThan(HEIGHT / 2);
  });

  it('always asks for a spot inside its own half, however the puck moves', () => {
    for (const level of LEVELS) {
      for (const p of [0, 1] as Player[]) {
        const s = createGame();
        s.phase = 'play';
        for (let i = 0; i < 40; i++) {
          s.tick = i * 7;
          s.puck = { x: (i * 53) % WIDTH, y: (i * 97) % HEIGHT, vx: ((i * 37) % 800) - 400, vy: ((i * 71) % 900) - 450 };
          const t = aiTarget(s, p, level);
          const b = paddleBounds(p);
          expect(t.x).toBeGreaterThanOrEqual(b.minX);
          expect(t.x).toBeLessThanOrEqual(b.maxX);
          expect(t.y).toBeGreaterThanOrEqual(b.minY);
          expect(t.y).toBeLessThanOrEqual(b.maxY);
        }
      }
    }
  });

  it('is deterministic: same state, same level, same answer', () => {
    const s = createGame();
    s.phase = 'play';
    s.tick = 77;
    s.puck = { x: 123, y: 321, vx: 40, vy: -260 };
    expect(aiTarget(s, 1, 'normal')).toEqual(aiTarget(s, 1, 'normal'));
  });

  it('harder levels are faster and more accurate', () => {
    expect(PROFILES.easy.speed).toBeLessThan(PROFILES.normal.speed);
    expect(PROFILES.normal.speed).toBeLessThan(PROFILES.hard.speed);
    expect(PROFILES.easy.noise).toBeGreaterThan(PROFILES.normal.noise);
    expect(PROFILES.normal.noise).toBeGreaterThan(PROFILES.hard.noise);
  });
});

describe('whole matches', () => {
  it('a computer scores against someone who does not move (normal and hard)', () => {
    for (const level of ['normal', 'hard'] as Difficulty[]) {
      const s = simulate([idle, ai(1, level)], 150, 3);
      expect(s.scores[1]).toBeGreaterThanOrEqual(2);
    }
  });

  it('a computer that defends concedes few goals to a plain "hit it straight" attacker', () => {
    // player 0 just stands in the middle of its half and swings at the puck when it comes close
    const swinger = (s: State) => {
      const puck = s.puck;
      if (puck.y > HEIGHT / 2 && Math.hypot(puck.x - s.paddles[0].x, puck.y - s.paddles[0].y) < 140) setTarget(s, 0, puck.x, puck.y - 40);
      else setTarget(s, 0, WIDTH / 2, HEIGHT - 120);
    };
    const s = simulate([swinger, ai(1, 'hard')], 90, 5);
    expect(s.scores[1]).toBeGreaterThanOrEqual(s.scores[0]);
  });

  it('hard beats easy, from either side', () => {
    let hardWins = 0;
    for (const hardSide of [0, 1] as Player[]) {
      const controllers: [(s: State) => void, (s: State) => void] = hardSide === 0 ? [ai(0, 'hard'), ai(1, 'easy')] : [ai(0, 'easy'), ai(1, 'hard')];
      const s = simulate(controllers, 240, 3);
      expect(s.phase).toBe('over'); // it ends: nobody stalls forever
      if (s.winner === hardSide) hardWins++;
    }
    expect(hardWins).toBe(2);
  });

  it('a game between two computers always finishes', () => {
    for (const [a, b] of [['normal', 'normal'], ['easy', 'easy']] as [Difficulty, Difficulty][]) {
      const s = simulate([ai(0, a), ai(1, b)], 400, 3);
      expect(s.phase).toBe('over');
    }
  });
});
