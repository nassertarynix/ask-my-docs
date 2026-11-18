import { expect, test, type Page } from '@playwright/test';

const play = (page: Page) => page.locator('[data-screen="play"]');
const table = (page: Page) => page.locator('canvas.ah-table');

async function start(page: Page, options: { mode?: 'pvp'; level?: string; target?: string; fast?: number } = {}) {
  await page.goto(`./#/play/air-hockey${options.fast ? `?fast=${options.fast}` : ''}`);
  await page.reload();
  if (options.mode === 'pvp') await page.getByRole('radio', { name: /2 players/ }).check();
  if (options.level) await page.getByRole('radio', { name: new RegExp(options.level) }).check();
  if (options.target) await page.getByRole('radio', { name: new RegExp(`^${options.target} goals`) }).check();
  await page.locator('[data-action="start"]').click();
  await expect(table(page)).toBeVisible();
}

const pos = async (page: Page, name: 'puck' | 'paddle0' | 'paddle1') => {
  const raw = await table(page).getAttribute(`data-${name}`);
  const [x, y] = (raw ?? '0,0').split(',').map(Number) as [number, number];
  return { x, y };
};

/** A point on the table, given as fractions of its width and height, in page coordinates. */
async function at(page: Page, fx: number, fy: number) {
  const box = (await table(page).boundingBox())!;
  return { x: box.x + fx * box.width, y: box.y + fy * box.height };
}

test.describe('Air Hockey', () => {
  test('is on the hub; the puck is held for a countdown, then play begins', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('[data-game="air-hockey"]')).toBeVisible();
    await start(page);
    await expect(table(page)).toHaveAttribute('data-phase', 'serve');
    await expect(table(page)).toHaveAttribute('data-phase', 'play', { timeout: 5000 });
    await expect(play(page)).toHaveAttribute('data-score0', '0');
  });

  test('the mouse moves your paddle, and it cannot cross into the other half', async ({ page }) => {
    await start(page);
    const p = await at(page, 0.8, 0.85);
    await page.mouse.move(p.x, p.y, { steps: 5 });
    await expect.poll(async () => (await pos(page, 'paddle0')).x, { timeout: 3000 }).toBeGreaterThan(280);
    const up = await at(page, 0.3, 0.1); // far into the computer's half
    await page.mouse.move(up.x, up.y, { steps: 5 });
    await expect.poll(async () => (await pos(page, 'paddle0')).x, { timeout: 3000 }).toBeLessThan(140);
    expect((await pos(page, 'paddle0')).y).toBeGreaterThanOrEqual(350); // still on its own half
  });

  test('the computer plays by itself: once the idle puck is handed to its side it goes after it', async ({ page }) => {
    await start(page, { level: 'Hard', fast: 4 });
    const before = await pos(page, 'paddle1');
    // nobody touches the puck on our side; after five (simulated) seconds it is handed to the computer, which attacks it
    await expect
      .poll(async () => {
        const now = await pos(page, 'paddle1');
        return Math.hypot(now.x - before.x, now.y - before.y);
      }, { timeout: 20_000 })
      .toBeGreaterThan(40);
    expect((await pos(page, 'paddle1')).y).toBeLessThan(350); // and it stays on its half
  });

  test('keyboard: the arrows steer the bottom paddle; in two-player games W A S D steer the top one', async ({ page }) => {
    await start(page, { mode: 'pvp' });
    const bottom = await pos(page, 'paddle0');
    const top = await pos(page, 'paddle1');
    await page.keyboard.down('ArrowLeft');
    await page.keyboard.down('a');
    await page.waitForTimeout(600);
    await page.keyboard.up('ArrowLeft');
    await page.keyboard.up('a');
    expect((await pos(page, 'paddle0')).x).toBeLessThan(bottom.x - 40);
    expect((await pos(page, 'paddle1')).x).toBeLessThan(top.x - 40);
    await page.keyboard.down('ArrowRight');
    await page.keyboard.down('d');
    await page.waitForTimeout(900);
    await page.keyboard.up('ArrowRight');
    await page.keyboard.up('d');
    expect((await pos(page, 'paddle0')).x).toBeGreaterThan(bottom.x);
    expect((await pos(page, 'paddle1')).x).toBeGreaterThan(top.x);
  });

  test('two fingers at once: each finger steers the paddle of the half it started in', async ({ page }) => {
    await start(page, { mode: 'pvp' });
    const lowerLeft = await at(page, 0.2, 0.85);
    const upperRight = await at(page, 0.85, 0.15);
    await page.evaluate(
      ([a, b]) => {
        const canvas = document.querySelector('canvas.ah-table') as HTMLCanvasElement;
        const fire = (type: string, id: number, p: { x: number; y: number }) =>
          canvas.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: p.x, clientY: p.y, bubbles: true, buttons: type === 'pointerup' ? 0 : 1 }));
        fire('pointerdown', 11, a as { x: number; y: number });
        fire('pointerdown', 12, b as { x: number; y: number });
      },
      [lowerLeft, upperRight],
    );
    await expect.poll(async () => (await pos(page, 'paddle0')).x, { timeout: 3000 }).toBeLessThan(120);
    await expect.poll(async () => (await pos(page, 'paddle1')).x, { timeout: 3000 }).toBeGreaterThan(280);
    expect((await pos(page, 'paddle0')).y).toBeGreaterThan(350);
    expect((await pos(page, 'paddle1')).y).toBeLessThan(350);
  });

  test('a whole match against a computer that nobody opposes ends: first to 5 wins, the end card shows the score, rematch restarts', async ({ page }) => {
    test.setTimeout(120_000);
    await start(page, { level: 'Normal', target: '5', fast: 16 });
    await expect(page.locator('.end-card')).toBeVisible({ timeout: 90_000 });
    await expect(play(page)).toHaveAttribute('data-winner', '1');
    await expect(play(page)).toHaveAttribute('data-score1', '5');
    await expect(page.locator('.end-card')).toContainText('The computer wins');
    await page.locator('[data-action="again"]').click();
    await expect(play(page)).toHaveAttribute('data-score1', '0');
    await expect(page.locator('.end-card')).toHaveCount(0);
  });

  for (const width of [320, 390, 1280]) {
    test(`no sideways scrolling at ${width}px, and the table keeps its shape`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await start(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const box = (await table(page).boundingBox())!;
      expect(box.height / box.width).toBeGreaterThan(1.7);
      expect(box.height / box.width).toBeLessThan(1.8);
    });
  }
});
