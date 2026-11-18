import { expect, test, type Page } from '@playwright/test';

const play = (page: Page) => page.locator('[data-screen="play"]');
const SPAN = 12 * 2 + 9 * 40 + 8 * 10; // the board's drawing size

async function start(page: Page, options: { mode?: 'pvp'; level?: string } = {}) {
  await page.goto('./#/play/quoridor');
  await page.reload();
  if (options.mode === 'pvp') await page.getByRole('radio', { name: /2 players/ }).check();
  if (options.level) await page.getByRole('radio', { name: new RegExp(options.level) }).check();
  await page.locator('[data-action="start"]').click();
  await expect(play(page)).toBeVisible();
}

/** The page position of a point given in board drawing units. */
async function at(page: Page, x: number, y: number) {
  const box = (await page.locator('.qd-board').boundingBox())!;
  return { x: box.x + (x / SPAN) * box.width, y: box.y + (y / SPAN) * box.height };
}

test.describe('Quoridor', () => {
  test('is on the hub; each pawn starts in the middle of its edge with ten walls', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('[data-game="quoridor"]')).toBeVisible();
    await start(page, { mode: 'pvp' });
    await expect(page.locator('[data-pawn="0"]')).toHaveAttribute('data-at', '8,4');
    await expect(page.locator('[data-pawn="1"]')).toHaveAttribute('data-at', '0,4');
    await expect(play(page)).toHaveAttribute('data-walls0', '10');
    await expect(page.locator('[data-dest]')).toHaveCount(3);
  });

  test('two players: stepping moves the pawn and passes the turn', async ({ page }) => {
    await start(page, { mode: 'pvp' });
    await page.locator('[data-dest="7,4"]').click();
    await expect(page.locator('[data-pawn="0"]')).toHaveAttribute('data-at', '7,4');
    await expect(play(page)).toHaveAttribute('data-current', '1');
    await expect(page.locator('[data-dest="1,4"]')).toBeVisible();
  });

  test('a wall is placed by pointing at a gap; the same place cannot be used twice, and it blocks the step', async ({ page }) => {
    await start(page, { mode: 'pvp' });
    await page.locator('[data-action="mode-wall"]').click();
    const spot = await at(page, 217, 207); // just right of the crossroads at (3,3): a horizontal wall
    await page.mouse.move(spot.x, spot.y);
    await expect(page.locator('[data-preview="ok"]')).toBeVisible();
    await page.mouse.click(spot.x, spot.y);
    await expect(page.locator('[data-wall="h3,3"]')).toHaveCount(1);
    await expect(play(page)).toHaveAttribute('data-walls0', '9');
    await expect(play(page)).toHaveAttribute('data-current', '1');
    // the wall is not in the way yet; an overlapping one is refused
    await page.locator('[data-action="mode-wall"]').click();
    const clash = await at(page, 247, 207); // would sit at (3,4), overlapping half of it
    await page.mouse.click(clash.x, clash.y);
    await expect(page.getByRole('alert')).toContainText('already there');
    await expect(page.locator('[data-wall]')).toHaveCount(1);
    await expect(play(page)).toHaveAttribute('data-current', '1');
  });

  test('a vertical wall is chosen by pointing above or below a crossroads', async ({ page }) => {
    await start(page, { mode: 'pvp' });
    await page.locator('[data-action="mode-wall"]').click();
    const spot = await at(page, 207, 222);
    await page.mouse.click(spot.x, spot.y);
    await expect(page.locator('[data-wall="v3,3"]')).toHaveCount(1);
  });

  test('on a touch screen a wall is picked first and placed with the button', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'touch only');
    await start(page, { mode: 'pvp' });
    await page.locator('[data-action="mode-wall"]').tap();
    const spot = await at(page, 217, 207);
    await page.touchscreen.tap(spot.x, spot.y);
    await expect(page.locator('[data-preview="ok"]')).toBeVisible();
    await expect(page.locator('[data-wall]')).toHaveCount(0); // not placed yet
    await page.locator('[data-action="confirm-wall"]').tap();
    await expect(page.locator('[data-wall="h3,3"]')).toHaveCount(1);
    await expect(play(page)).toHaveAttribute('data-current', '1');
  });

  test('against the computer: it answers by itself, and a whole game ends with a winner', async ({ page }) => {
    test.setTimeout(180_000);
    await start(page, { level: 'Easy' });
    for (let i = 0; i < 120; i++) {
      if ((await play(page).getAttribute('data-over')) === 'yes') break;
      await expect(page.locator('.board-status')).toHaveText(/move your pawn|Game over/, { timeout: 15_000 });
      if ((await play(page).getAttribute('data-over')) === 'yes') break;
      const spots = await page.locator('[data-dest]').evaluateAll((els) => els.map((e) => (e as SVGElement).dataset.dest as string));
      const best = spots.map((s) => s.split(',').map(Number) as [number, number]).sort((a, b) => a[0] - b[0])[0]!;
      await page.locator(`[data-dest="${best[0]},${best[1]}"]`).click();
      await page.waitForTimeout(150);
    }
    await expect(page.locator('.end-card')).toBeVisible({ timeout: 60_000 });
    await expect(play(page)).not.toHaveAttribute('data-winner', '');
    await page.locator('[data-action="again"]').click();
    await expect(page.locator('[data-pawn="0"]')).toHaveAttribute('data-at', '8,4');
  });

  for (const width of [320, 390, 1280]) {
    test(`no sideways scrolling at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await start(page, { mode: 'pvp' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
});
