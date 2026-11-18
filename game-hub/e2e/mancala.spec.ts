import { expect, test, type Page } from '@playwright/test';

const play = (page: Page) => page.locator('[data-screen="play"]');
const pit = (page: Page, i: number) => page.locator(`[data-pit="${i}"]`);

async function start(page: Page, options: { mode?: 'pvp'; level?: string } = {}) {
  await page.goto('./#/play/mancala');
  await page.reload();
  if (options.mode === 'pvp') await page.getByRole('radio', { name: /2 players/ }).check();
  if (options.level) await page.getByRole('radio', { name: new RegExp(options.level) }).check();
  await page.locator('[data-action="start"]').click();
  await expect(play(page)).toBeVisible();
}

test.describe('Mancala', () => {
  test('is on the hub, and starts with four stones in each pit', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('[data-game="mancala"]')).toBeVisible();
    await start(page, { mode: 'pvp' });
    for (const i of [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12]) await expect(pit(page, i)).toHaveAttribute('data-count', '4');
    await expect(play(page)).toHaveAttribute('data-score0', '0');
  });

  test('two players: sowing moves stones one by one, an extra turn keeps the turn, and only your own pits are playable', async ({ page }) => {
    await start(page, { mode: 'pvp' });
    await expect(pit(page, 7)).toBeDisabled(); // player 1's pit is not playable on player 0's turn
    await pit(page, 2).click(); // 4 stones from pit 2 end in the store: another turn
    await expect(play(page)).toHaveAttribute('data-busy', 'yes');
    await expect(play(page)).toHaveAttribute('data-busy', 'no', { timeout: 5000 });
    await expect(play(page)).toHaveAttribute('data-score0', '1');
    await expect(play(page)).toHaveAttribute('data-current', '0');
    await expect(page.locator('.mc-note')).toContainText('Another turn');
    await expect(pit(page, 2)).toHaveAttribute('data-count', '0');
    await expect(pit(page, 3)).toHaveAttribute('data-count', '5');
    // the next, ordinary move passes the turn
    await pit(page, 0).click();
    await expect(play(page)).toHaveAttribute('data-current', '1', { timeout: 5000 });
    await expect(pit(page, 12)).toBeEnabled();
    await expect(pit(page, 0)).toBeDisabled();
  });

  test('against the computer: it replies by itself, and cannot be hurried', async ({ page }) => {
    await start(page, { level: 'Easy' });
    await pit(page, 0).click();
    await expect(play(page)).toHaveAttribute('data-current', '1', { timeout: 5000 });
    await expect(page.locator('.board-status')).toContainText(/Computer|Sowing/);
    await expect(play(page)).toHaveAttribute('data-current', '0', { timeout: 20_000 });
    await expect(page.locator('.board-status')).toContainText('You: pick a pit');
  });

  test('a whole game against the computer ends with the stores holding all 48 stones', async ({ page }) => {
    test.setTimeout(200_000);
    await start(page, { level: 'Easy' });
    const deadline = Date.now() + 150_000; // animation and the computer's thinking make a game take a minute or two
    while (Date.now() < deadline && (await play(page).getAttribute('data-over')) !== 'yes') {
      const mine = page.locator('.mc-pit-playable').first();
      if (await mine.count()) await mine.click({ timeout: 2000 }).catch(() => undefined);
      await page.waitForTimeout(250);
    }
    await expect(page.locator('.end-card')).toBeVisible({ timeout: 30_000 });
    const a = Number(await play(page).getAttribute('data-score0'));
    const b = Number(await play(page).getAttribute('data-score1'));
    expect(a + b).toBe(48);
    await page.locator('[data-action="again"]').click();
    await expect(pit(page, 0)).toHaveAttribute('data-count', '4');
  });

  for (const width of [320, 390, 1280]) {
    test(`no sideways scrolling at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await start(page, { mode: 'pvp' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
});
