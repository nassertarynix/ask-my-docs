import { expect, test, type Page } from '@playwright/test';

const play = (page: Page) => page.locator('[data-screen="play"]');
const cell = (page: Page, i: number) => page.locator(`[data-cell="${i}"]`);

async function start(page: Page, size = 'Beginner', seed = 3) {
  await page.goto(`./#/play/minesweeper?seed=${seed}`);
  await page.reload();
  await page.getByRole('radio', { name: new RegExp(size) }).check();
  await page.locator('[data-action="start"]').click();
  await expect(play(page)).toBeVisible();
}

test.describe('Minesweeper', () => {
  test('is on the hub; the first click is safe and opens an area; the clock starts', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('[data-game="minesweeper"]')).toBeVisible();
    await start(page);
    await expect(play(page)).toHaveAttribute('data-status', 'ready');
    await cell(page, 40).click();
    await expect(play(page)).toHaveAttribute('data-status', 'playing');
    expect(await page.locator('[data-state="open"]').count()).toBeGreaterThan(9);
    await expect(page.locator('[data-state="boom"]')).toHaveCount(0);
    await expect(play(page).locator('.ms-led').first()).toHaveText('010');
  });

  test('right-click flags and unflags; the counter follows; a flagged square is not opened by a click', async ({ page }) => {
    await start(page);
    await cell(page, 0).click({ button: 'right' });
    await expect(cell(page, 0)).toHaveAttribute('data-state', 'flag');
    await expect(play(page)).toHaveAttribute('data-left', '9');
    await cell(page, 0).click();
    await expect(cell(page, 0)).toHaveAttribute('data-state', 'flag');
    await cell(page, 0).click({ button: 'right' });
    await expect(cell(page, 0)).toHaveAttribute('data-state', 'hidden');
    await expect(play(page)).toHaveAttribute('data-left', '10');
  });

  test('flag mode (for touch): taps flag instead of digging', async ({ page }) => {
    await start(page);
    await page.locator('[data-action="flag-mode"]').click();
    await cell(page, 5).click();
    await expect(cell(page, 5)).toHaveAttribute('data-state', 'flag');
    await page.locator('[data-action="flag-mode"]').click();
    await cell(page, 5).click(); // a flagged square stays shut
    await expect(cell(page, 5)).toHaveAttribute('data-state', 'flag');
  });

  test('digging blindly eventually hits a mine: the game is lost, mines show, the board locks, and Try again starts afresh', async ({ page }) => {
    test.setTimeout(90_000);
    await start(page, 'Expert');
    await cell(page, 200).click();
    for (let i = 0; i < 480; i++) {
      if ((await play(page).getAttribute('data-status')) === 'lost') break;
      const hidden = page.locator('[data-state="hidden"]').first();
      if (!(await hidden.count())) break;
      await hidden.click({ force: true, timeout: 2000 }).catch(() => undefined);
    }
    await expect(play(page)).toHaveAttribute('data-status', 'lost');
    await expect(page.locator('[data-state="boom"]')).toHaveCount(1);
    expect(await page.locator('[data-state="mine"]').count()).toBeGreaterThan(5);
    await expect(page.locator('.end-card')).toContainText('Boom');
    await page.locator('[data-action="again"]').click();
    await expect(play(page)).toHaveAttribute('data-status', 'ready');
    await expect(page.locator('[data-state="hidden"]')).toHaveCount(480);
  });

  test('the face button restarts', async ({ page }) => {
    await start(page);
    await cell(page, 40).click();
    await page.locator('[data-action="restart"]').click();
    await expect(play(page)).toHaveAttribute('data-status', 'ready');
  });

  for (const width of [320, 390, 1280]) {
    test(`no sideways page scrolling at ${width}px, even on the widest board`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await start(page, 'Expert');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
});
