import { expect, test, type Page } from '@playwright/test';

const play = (page: Page) => page.locator('[data-screen="play"]');
const cell = (page: Page, i: number) => page.locator(`[data-cell="${i}"]`);

async function start(page: Page, options: { mode?: 'pvp'; level?: string } = {}) {
  await page.goto('./#/play/battleship');
  await page.reload();
  if (options.mode === 'pvp') await page.getByRole('radio', { name: /2 players/ }).check();
  if (options.level) await page.getByRole('radio', { name: new RegExp(options.level) }).check();
  await page.locator('[data-action="start"]').click();
}

/** Place the fleet quickly with the Shuffle button, then press Ready. */
async function readyFleet(page: Page) {
  await page.locator('[data-action="random"]').click();
  await page.locator('[data-action="ready"]').click();
}

test.describe('Battleship', () => {
  test('is on the hub; placing needs all five ships; Shuffle places them; Ready starts the battle', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('[data-game="battleship"]')).toBeVisible();
    await start(page);
    await expect(page.locator('[data-screen="place"]')).toBeVisible();
    await expect(page.locator('[data-action="ready"]')).toBeDisabled();
    await page.locator('[data-action="random"]').click();
    await expect(page.locator('.bs-grid [data-state="ship"]')).toHaveCount(17);
    await expect(page.locator('[data-action="ready"]')).toBeEnabled();
    await page.locator('[data-action="ready"]').click();
    await expect(play(page)).toBeVisible();
  });

  test('placing by hand: ships go where you click, cannot overlap or leave the grid, and can be picked up', async ({ page }) => {
    await start(page);
    await cell(page, 0).click(); // the carrier, across from A1
    await expect(page.locator('[data-screen="place"]')).toHaveAttribute('data-placed', '1');
    for (const i of [0, 1, 2, 3, 4]) await expect(cell(page, i)).toHaveAttribute('data-state', 'ship');
    await cell(page, 2).click(); // that is on the carrier: picks it up
    await expect(page.locator('[data-screen="place"]')).toHaveAttribute('data-placed', '0');
    await cell(page, 8).click(); // the carrier does not fit from column I: refused
    await expect(page.locator('[data-screen="place"]')).toHaveAttribute('data-placed', '0');
    await page.locator('[data-action="rotate"]').click();
    await cell(page, 8).click(); // down from I1 fits
    for (const i of [8, 18, 28, 38, 48]) await expect(cell(page, i)).toHaveAttribute('data-state', 'ship');
    await page.locator('[data-action="rotate"]').click();
    await cell(page, 25).click(); // the battleship across from F3 would run over the carrier at I3: refused
    await expect(page.locator('[data-screen="place"]')).toHaveAttribute('data-placed', '1');
  });

  test('against the computer: a shot says hit or miss, the computer answers, and a whole game ends with both fleets shown', async ({ page }) => {
    test.setTimeout(240_000);
    await start(page, { level: 'Hard' });
    await readyFleet(page);
    for (let i = 0; i < 100; i++) {
      if ((await play(page).getAttribute('data-over')) === 'yes') break;
      await expect(play(page)).toHaveAttribute('data-fired', 'no', { timeout: 15_000 });
      const free = page.locator('.bs-big [data-state="water"]');
      if (!(await free.count())) break;
      await free.first().click();
      await expect(page.locator('[role="status"]').first()).toContainText(/hit|miss|win/i);
    }
    await expect(page.locator('.end-card')).toBeVisible({ timeout: 30_000 });
    await expect(play(page)).not.toHaveAttribute('data-winner', '');
    // at the end every ship is visible on both grids
    expect(await page.locator('.bs-grid [data-state="ship"], .bs-grid [data-state="sunk"], .bs-grid [data-state="hit"]').count()).toBeGreaterThanOrEqual(17);
    await page.locator('[data-action="again"]').click();
    await expect(page.locator('[data-screen="place"]')).toBeVisible();
  });

  test('two players: each fleet is placed behind a curtain, and the other player\'s fleet is never on the screen', async ({ page }) => {
    await start(page, { mode: 'pvp' });
    await expect(page.locator('[data-curtain="up"]')).toContainText('Pass the device to Player 1');
    await expect(page.locator('.bs-grid')).toHaveCount(0); // nothing of the board is in the page behind the curtain
    await page.locator('[data-action="reveal"]').click();
    await readyFleet(page);
    await expect(page.locator('[data-curtain="up"]')).toContainText('Pass the device to Player 2');
    await expect(page.locator('.bs-grid')).toHaveCount(0); // player 1's fleet is gone from the page
    await page.locator('[data-action="reveal"]').click();
    await readyFleet(page);
    // the battle begins with player 1, behind a curtain
    await expect(page.locator('[data-curtain="up"]')).toContainText('Pass the device to Player 1');
    await page.locator('[data-action="reveal"]').click();
    await expect(play(page)).toHaveAttribute('data-current', '0');
    // player 1 sees only their own ships (17) on their own grid and none on the enemy grid
    await expect(page.locator('.bs-small [data-state="ship"]')).toHaveCount(17);
    await expect(page.locator('.bs-big [data-state="ship"]')).toHaveCount(0);
    await page.locator('.bs-big [data-cell="0"]').click();
    await expect(page.locator('[data-action="end-turn"]')).toBeVisible();
    // a second shot in the same turn is not possible
    await expect(play(page)).toHaveAttribute('data-fired', 'yes');
    await page.locator('.bs-big [data-cell="1"]').click({ force: true, timeout: 1000 }).catch(() => undefined);
    await expect(page.locator('.bs-big [data-cell="1"]')).toHaveAttribute('data-state', 'water');
    await page.locator('[data-action="end-turn"]').click();
    await expect(page.locator('[data-curtain="up"]')).toContainText('Pass the device to Player 2');
    await expect(page.locator('.bs-grid')).toHaveCount(0);
    await page.locator('[data-action="reveal"]').click();
    await expect(play(page)).toHaveAttribute('data-current', '1');
    // player 2 sees the result of player 1's shot on their own grid
    const result = await page.locator('.bs-small [data-cell="0"]').getAttribute('data-state');
    expect(['miss', 'hit', 'sunk']).toContain(result);
  });

  for (const width of [320, 390, 1280]) {
    test(`no sideways scrolling at ${width}px while placing and while firing`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await start(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await readyFleet(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
});
