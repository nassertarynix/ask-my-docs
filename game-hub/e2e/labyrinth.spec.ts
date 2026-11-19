import { expect, test, type Page } from '@playwright/test';

const play = (page: Page) => page.locator('[data-screen="play"]');
const targets = (page: Page) => page.locator('[data-target="yes"]');

async function start(page: Page, options: { opponents?: 'One' | 'Two' | 'Three'; level?: string; fast?: boolean; seed?: number } = {}) {
  await page.goto(`./#/play/labyrinth?seed=${options.seed ?? 1}${options.fast === false ? '' : '&fast=1'}`);
  await page.reload();
  await page.getByRole('radio', { name: /Against computers/ }).check();
  const hint = { One: /Two players: get two/, Two: /Three players/, Three: /Four players/ }[options.opponents ?? 'One'];
  await page.getByRole('radio', { name: hint }).check();
  await page.getByRole('radio', { name: new RegExp(options.level ?? 'Easy') }).check();
  await page.locator('[data-action="start"]').click();
  await expect(play(page)).toBeVisible();
}

/** Do whatever the die asks, once, with the first sensible choice. */
async function act(page: Page) {
  const face = await play(page).getAttribute('data-face');
  if (face === 'wall') {
    const fresh = page.locator('[data-action="new-wall"]');
    if (await fresh.isEnabled()) await fresh.click();
    else await page.locator('.lb-ready').first().click();
  } else if (face !== 'minotaur') {
    await page.locator('.lb-ready').first().click();
  }
  await targets(page).first().click();
}

test.describe('Laby // Rinth (against computers)', () => {
  test('is on the hub, and online play says it is not switched on while no relay is connected', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('[data-game="labyrinth"]')).toBeVisible();
    await page.goto('./#/play/labyrinth');
    await page.reload();
    await page.getByRole('radio', { name: /Online with friends/ }).check();
    await expect(page.locator('[data-online="off"]')).toContainText('not switched on');
  });

  test('a two-player board: the maze, the temple, twelve start squares, six heroes and the Minotaur at home', async ({ page }) => {
    await start(page);
    await expect(page.locator('[data-cell]')).toHaveCount(225);
    await expect(page.locator('[data-kind="start"]')).toHaveCount(12);
    await expect(page.locator('[data-kind="lair"]')).toHaveCount(1);
    await expect(page.locator('[data-kind="goal"]')).toHaveCount(8);
    await expect(page.locator('[data-kind="hedge"]')).not.toHaveCount(0);
    await expect(page.locator('[data-hero]')).toHaveCount(6);
    await expect(page.locator('[data-kind="lair"] [data-minotaur]')).toHaveCount(1);
    await expect(page.locator('.lb-players .score')).toHaveCount(2);
    await expect(play(page)).toHaveAttribute('data-turn', '0');
    await expect(play(page)).toHaveAttribute('data-face', '4');
    await expect(page.locator('.lb-players [data-seat="0"] output')).toHaveText('0/2'); // two heroes must get home with two players
  });

  test('three or four players need only one hero home', async ({ page }) => {
    await start(page, { opponents: 'Three' });
    await expect(page.locator('[data-hero]')).toHaveCount(12);
    await expect(page.locator('.lb-players [data-seat="3"] output')).toHaveText('0/1');
  });

  test('a number roll: tap a hero, then one of the lit squares, and the hero is there', async ({ page }) => {
    await start(page, { fast: false });
    await expect(targets(page)).toHaveCount(0);
    await expect(page.locator('.lb-ready')).not.toHaveCount(0); // heroes that can move glow
    const hero = page.locator('[data-hero="0:0"]');
    await hero.click();
    await expect(page.locator('.board-status')).toContainText('Where should it go');
    const lit = await targets(page).count();
    expect(lit).toBe(3); // the maze and its walls leave exactly three ways to go with a 4 from the start block
    const to = targets(page).first();
    const cell = await to.getAttribute('data-cell');
    await to.click();
    await expect(page.locator(`[data-cell="${cell}"] [data-hero="0:0"]`)).toHaveCount(1);
    await expect(page.locator('[data-kind="start"] [data-hero="0:0"]')).toHaveCount(0);
    await expect(play(page)).toHaveAttribute('data-turn', '1');
    await expect(page.locator('.gm-log')).toContainText('rolled 4 and moved a hero');
  });

  test('tapping the same hero again, or empty ground, lets go of the choice', async ({ page }) => {
    await start(page, { fast: false });
    await page.locator('[data-hero="0:0"]').click();
    await expect(targets(page)).not.toHaveCount(0);
    await page.locator('[data-hero="0:0"]').click();
    await expect(targets(page)).toHaveCount(0);
  });

  test('a wall roll: take a new wall and put it on a lit square', async ({ page }) => {
    await start(page, { seed: 5, fast: false });
    await expect(play(page)).toHaveAttribute('data-face', 'wall');
    const before = await page.locator('[data-kind="wall"]').count();
    await page.locator('[data-action="new-wall"]').click();
    expect(await targets(page).count()).toBeGreaterThan(20);
    const to = targets(page).nth(5);
    const cell = await to.getAttribute('data-cell');
    await to.click();
    await expect(page.locator('[data-kind="wall"]')).toHaveCount(before + 1);
    await expect(page.locator(`[data-cell="${cell}"]`)).toHaveAttribute('data-kind', 'wall');
    await expect(page.locator('.lb-legend')).toContainText('at the edge');
    await expect(play(page)).toHaveAttribute('data-turn', '1');
  });

  test('a wall roll: an existing wall can be picked up and moved instead', async ({ page }) => {
    await start(page, { seed: 5, fast: false });
    const wall = page.locator('[data-kind="wall"].lb-ready').first();
    const from = await wall.getAttribute('data-cell');
    const before = await page.locator('[data-kind="wall"]').count();
    await wall.click();
    const to = targets(page).first();
    const cell = await to.getAttribute('data-cell');
    await to.click();
    await expect(page.locator('[data-kind="wall"]')).toHaveCount(before);
    await expect(page.locator(`[data-cell="${cell}"]`)).toHaveAttribute('data-kind', 'wall');
    await expect(page.locator(`[data-cell="${from}"]`)).not.toHaveAttribute('data-kind', 'wall');
  });

  test('a Minotaur roll: lit squares, and tapping one sends it there', async ({ page }) => {
    await start(page, { seed: 15, fast: false });
    await expect(play(page)).toHaveAttribute('data-face', 'minotaur');
    await expect(page.locator('.board-status')).toContainText('Minotaur');
    expect(await targets(page).count()).toBeGreaterThan(5);
    const to = targets(page).first();
    const cell = await to.getAttribute('data-cell');
    await to.click();
    await expect(page.locator(`[data-cell="${cell}"] [data-minotaur]`)).toHaveCount(1);
    await expect(page.locator('[data-kind="lair"] [data-minotaur]')).toHaveCount(0);
    await expect(page.locator('.gm-log')).toContainText('moved it eight squares');
  });

  test('nothing can be tapped while a computer is playing', async ({ page }) => {
    await start(page, { fast: false });
    await page.locator('[data-hero="0:0"]').click();
    await targets(page).first().click();
    await expect(page.locator('.board-status')).toContainText('thinking');
    await expect(page.locator('button.lb-cell')).toHaveCount(0);
  });

  test('a whole game against an easy computer can be played to the temple', async ({ page }) => {
    test.setTimeout(240_000);
    await start(page, { seed: 2 });
    const deadline = Date.now() + 200_000;
    while (Date.now() < deadline && (await play(page).getAttribute('data-over')) !== 'yes') {
      if ((await play(page).getAttribute('data-turn')) !== '0') {
        await page.waitForTimeout(30);
        continue;
      }
      const before = await play(page).getAttribute('data-turns');
      await act(page).catch(() => undefined);
      await page.waitForFunction((b) => document.querySelector('[data-screen="play"]')?.getAttribute('data-turns') !== b, before, { timeout: 5000 }).catch(() => undefined);
    }
    await expect(page.locator('.end-card')).toBeVisible();
    await expect(page.locator('.end-card')).toContainText('reached the temple');
    await page.locator('[data-action="again"]').click();
    await expect(page.locator('[data-hero]')).toHaveCount(6);
  });

  test('leaving goes back to the menu', async ({ page }) => {
    await start(page);
    await page.locator('[data-action="leave"]').click();
    await expect(page.locator('[data-screen="setup"]')).toBeVisible();
  });

  for (const width of [320, 390, 1280]) {
    test(`no sideways scrolling at ${width}px with four at the table, and the squares stay tappable`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await start(page, { opponents: 'Three' });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const box = await page.locator('.lb-board').boundingBox();
      expect(Math.abs((box?.width ?? 0) - (box?.height ?? 1))).toBeLessThan(2);
      expect((box?.width ?? 0) / 15).toBeGreaterThan(18);
    });
  }
});
