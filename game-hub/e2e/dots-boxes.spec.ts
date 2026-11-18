import { expect, test, type Page } from '@playwright/test';

const play = (page: Page) => page.locator('[data-screen="play"]');
const edge = (page: Page, id: number) => page.locator(`[data-edge="${id}"]`);

async function start(page: Page, options: { mode?: 'pvp'; level?: string; size?: string } = {}) {
  await page.goto('./#/play/dots-boxes');
  await page.reload();
  if (options.mode === 'pvp') await page.getByRole('radio', { name: /2 players/ }).check();
  if (options.level) await page.getByRole('radio', { name: new RegExp(options.level) }).check();
  await page.getByRole('radio', { name: new RegExp(options.size ?? '3 × 3') }).check();
  await page.locator('[data-action="start"]').click();
  await expect(play(page)).toBeVisible();
}

test.describe('Dots and Boxes', () => {
  test('is on the hub', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('[data-game="dots-boxes"]')).toBeVisible();
  });

  test('two players: drawing the fourth side of a box scores it and keeps the turn', async ({ page }) => {
    await start(page, { mode: 'pvp' });
    // 3x3 board: top-left box has edges 0 (top), 3 (bottom), 12 (left) and 13 (right)
    await edge(page, 0).click({ force: true });
    await expect(play(page)).toHaveAttribute('data-current', '1');
    await edge(page, 3).click({ force: true });
    await expect(play(page)).toHaveAttribute('data-current', '0');
    await edge(page, 12).click({ force: true });
    await expect(play(page)).toHaveAttribute('data-current', '1');
    await edge(page, 13).click({ force: true });
    await expect(play(page)).toHaveAttribute('data-score1', '1');
    await expect(play(page)).toHaveAttribute('data-current', '1'); // completed a box: moves again
    await expect(page.locator('[data-box-owner="1"]')).toHaveCount(1);
    await expect(page.locator('.score-active')).toContainText('Player 2');
  });

  test('against the computer: it answers each move, and a whole game ends with a result and a play-again button', async ({ page }) => {
    await start(page, { level: 'Easy' });
    for (let i = 0; i < 40; i++) {
      if ((await play(page).getAttribute('data-over')) === 'yes') break;
      // wait for our turn (the computer answers after a short pause)
      await expect(page.locator('.board-status')).toHaveText(/your move|Game over/, { timeout: 15_000 });
      if ((await play(page).getAttribute('data-over')) === 'yes') break;
      const drawn = Number(await play(page).getAttribute('data-drawn'));
      await page.locator('[data-edge]').first().click({ force: true });
      await expect.poll(async () => Number(await play(page).getAttribute('data-drawn'))).toBeGreaterThan(drawn);
    }
    await expect(page.locator('.end-card')).toBeVisible({ timeout: 30_000 });
    const s0 = Number(await play(page).getAttribute('data-score0'));
    const s1 = Number(await play(page).getAttribute('data-score1'));
    expect(s0 + s1).toBe(9);
    await expect(page.locator('[data-box-owner]')).toHaveCount(9);
    await page.locator('[data-action="again"]').click();
    await expect(play(page)).toHaveAttribute('data-drawn', '0');
  });

  test('the player cannot draw while the computer is thinking', async ({ page }) => {
    await start(page, { level: 'Normal' });
    await page.locator('[data-edge]').first().click({ force: true });
    await expect(page.locator('.board-status')).toHaveText('Computer is thinking…');
    const drawn = Number(await play(page).getAttribute('data-drawn'));
    await page.locator('[data-edge]').last().click({ force: true });
    expect(Number(await play(page).getAttribute('data-drawn'))).toBe(drawn);
    await expect(page.locator('.board-status')).toHaveText('You: your move', { timeout: 15_000 });
  });

  for (const width of [320, 390, 1280]) {
    test(`no sideways scrolling at ${width}px on the largest board`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await start(page, { mode: 'pvp', size: '5 × 5' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
});
