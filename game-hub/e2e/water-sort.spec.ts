import { expect, test, type Page } from '@playwright/test';

const play = (page: Page) => page.locator('[data-screen="play"]');
const tube = (page: Page, i: number) => page.locator(`[data-tube="${i}"]`);

async function start(page: Page) {
  await page.goto('./#/play/water-sort');
  await page.reload();
  await page.evaluate(() => localStorage.removeItem('paper-arcade:game:water-sort'));
  await page.reload();
  await page.locator('[data-action="start"]').click();
  await expect(play(page)).toBeVisible();
}

test.describe('Water Sort', () => {
  test('is on the hub; level 1 has three colours in three tubes plus two empty ones', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('[data-game="water-sort"]')).toBeVisible();
    await start(page);
    await expect(play(page)).toHaveAttribute('data-level', '1');
    await expect(page.locator('[data-tube]')).toHaveCount(5);
    await expect(page.locator('[data-tube][data-fill="0"]')).toHaveCount(2);
    await expect(page.locator('[data-tube][data-fill="4"]')).toHaveCount(3);
  });

  test('the same level is the same puzzle every time', async ({ page }) => {
    await start(page);
    const a = await page.locator('.ws-layer').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.color).join(''));
    await start(page);
    const b = await page.locator('.ws-layer').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.color).join(''));
    expect(a).toBe(b);
  });

  test('pick a tube, pour into an empty one, undo it; a refused pour is not counted', async ({ page }) => {
    await start(page);
    await tube(page, 0).click();
    await expect(tube(page, 0)).toHaveClass(/ws-picked/);
    await tube(page, 3).click(); // an empty tube
    await expect(play(page)).toHaveAttribute('data-moves', '1');
    await page.locator('[data-action="undo"]').click();
    await expect(play(page)).toHaveAttribute('data-moves', '0');
    await expect(tube(page, 3)).toHaveAttribute('data-fill', '0');
    // picking an empty tube does nothing
    await tube(page, 3).click();
    await expect(page.locator('.ws-picked')).toHaveCount(0);
  });

  test('the hint highlights a pour that can be played, and following hints wins the level', async ({ page }) => {
    test.setTimeout(60_000);
    await start(page);
    for (let i = 0; i < 80; i++) {
      if ((await play(page).getAttribute('data-won')) === 'yes') break;
      await page.locator('[data-action="hint"]').click();
      const from = Number(await page.locator('.ws-hint-from').getAttribute('data-tube'));
      const to = Number(await page.locator('.ws-hint-to').getAttribute('data-tube'));
      await tube(page, from).click();
      await tube(page, to).click();
    }
    await expect(page.locator('.end-card')).toContainText('Level 1 complete');
    await page.locator('[data-action="next"]').click();
    await expect(play(page)).toHaveAttribute('data-level', '2');
    await expect(play(page)).toHaveAttribute('data-won', 'no');
  });

  test('progress is remembered: after winning level 1 the start screen offers level 2', async ({ page }) => {
    test.setTimeout(60_000);
    await start(page);
    for (let i = 0; i < 80 && (await play(page).getAttribute('data-won')) !== 'yes'; i++) {
      await page.locator('[data-action="hint"]').click();
      const from = Number(await page.locator('.ws-hint-from').getAttribute('data-tube'));
      const to = Number(await page.locator('.ws-hint-to').getAttribute('data-tube'));
      await tube(page, from).click();
      await tube(page, to).click();
    }
    await page.reload();
    await expect(page.locator('[data-action="start"]')).toContainText('Play level 2');
  });

  test('adding a tube works once per level and restart resets it', async ({ page }) => {
    await start(page);
    await page.locator('[data-action="add-tube"]').click();
    await expect(page.locator('[data-tube]')).toHaveCount(6);
    await expect(page.locator('[data-action="add-tube"]')).toBeDisabled();
    await page.locator('[data-action="restart"]').click();
    await expect(page.locator('[data-tube]')).toHaveCount(5);
    await expect(page.locator('[data-action="add-tube"]')).toBeEnabled();
  });

  for (const width of [320, 390, 1280]) {
    test(`no sideways scrolling at ${width}px on a late level`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('./#/play/water-sort');
      await page.evaluate(() => localStorage.setItem('paper-arcade:game:water-sort', JSON.stringify({ level: 21 })));
      await page.reload();
      await page.locator('[data-action="start"]').click();
      await expect(page.locator('[data-tube]')).toHaveCount(14);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
});
