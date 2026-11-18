import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const NOVA = '[data-rom="bundled:homebrew/novathesquirrel.nes"]';
const emu = (page: Page) => page.locator('[data-screen="player"]');

async function openShelf(page: Page) {
  await page.goto('./#/play/retro');
  await expect(page.locator('.cart').first()).toBeVisible();
}

async function play(page: Page, selector: string) {
  await page.locator(selector).click();
  await expect(emu(page)).toHaveAttribute('data-status', 'running', { timeout: 30_000 });
}

/** A picture of the emulator's screen, to tell whether it changed. */
const screen = (page: Page) => page.locator('.emu-canvas').screenshot();

test.describe('the Retro Deck shelf', () => {
  test('the hub has a card for it, and the shelf lists the nine free homebrew games by console', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('a.card-live')).toHaveCount(12);
    await page.locator('[data-game="retro"]').click();
    await expect(page.locator('[data-screen="shelf"]')).toBeVisible();
    await expect(page.locator('.cart')).toHaveCount(9);
    await expect(page.getByRole('region', { name: 'NES', exact: true }).locator('.cart')).toHaveCount(3);
    await expect(page.getByRole('region', { name: 'Super NES' }).locator('.cart')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Mega Drive / Genesis' }).locator('.cart')).toHaveCount(2);
    await expect(page.getByRole('region', { name: 'Game Boy Color' }).locator('.cart')).toHaveCount(1);
    await expect(page.getByRole('region', { name: 'Game Boy Advance' }).locator('.cart')).toHaveCount(2);
    await expect(page.locator('.cart[data-source="bundled"]')).toHaveCount(9);
    // each one says who made it, under what licence, and links to its source
    await expect(page.locator(NOVA)).toContainText('GPL-3.0');
    await expect(page.locator('.cart-source')).toHaveCount(9);
    for (const link of await page.locator('.cart-source').all()) expect(await link.getAttribute('href')).toMatch(/^https:\/\/github\.com\//);
    await expect(page.getByText('public/roms/')).toBeVisible();
  });

  test('a file that is not a game is refused with a reason', async ({ page }) => {
    await openShelf(page);
    await page.getByLabel('Add game files').setInputFiles([
      { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
      { name: 'empty.nes', mimeType: 'application/octet-stream', buffer: Buffer.alloc(0) },
    ]);
    await expect(page.locator('.shelf-messages')).toContainText('notes.txt: not a ROM this deck can play.');
    await expect(page.locator('.shelf-messages')).toContainText('empty.nes: the file is empty.');
    await expect(page.locator('.cart')).toHaveCount(9);
  });

  test('your own file: add it once, it stays on the shelf, it plays, and it can be removed', async ({ page }) => {
    await openShelf(page);
    const rom = readFileSync('public/retro/homebrew/thwaite.nes');
    await page.getByLabel('Add game files').setInputFiles({ name: 'My_Own_Game (USA) [!].nes', mimeType: 'application/octet-stream', buffer: rom });
    await expect(page.locator('.shelf-messages')).toContainText('1 game added to the shelf.');
    const mine = page.locator('.cart[data-source="imported"]');
    await expect(mine).toHaveCount(1);
    await expect(mine).toContainText('My Own Game');
    await expect(mine).toContainText('In this browser');
    // adding the same file again does not make a second copy
    await page.getByLabel('Add game files').setInputFiles({ name: 'copy.nes', mimeType: 'application/octet-stream', buffer: rom });
    await expect(page.locator('.cart')).toHaveCount(10);

    await page.reload();
    await expect(page.locator('.cart[data-source="imported"]')).toHaveCount(1);
    await play(page, '.cart[data-source="imported"]');
    await page.getByRole('button', { name: 'Shelf' }).click();

    page.once('dialog', (d) => void d.accept());
    await page.locator('.cart-remove').click();
    await expect(page.locator('.cart')).toHaveCount(9);
    await page.reload();
    await expect(page.locator('.cart').first()).toBeVisible();
    await expect(page.locator('.cart[data-source="imported"]')).toHaveCount(0);
  });

  for (const width of [320, 390, 1280]) {
    test(`no sideways scrolling at ${width}px on the shelf or while playing`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      await openShelf(page);
      expect(await fits()).toBe(true);
      await play(page, NOVA);
      expect(await fits()).toBe(true);
    });
  }
});

test.describe('playing', () => {
  test('one click starts the game, it draws, it answers the keyboard, and nothing is fetched from another site', async ({ page }) => {
    const foreign: string[] = [];
    const problems: string[] = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (url.protocol.startsWith('http') && url.hostname !== '127.0.0.1') foreign.push(r.url());
    });
    // the emulator asks to keep the screen awake; a test browser refuses, which is not a fault of the page
    page.on('pageerror', (e) => !/Wake Lock/.test(String(e)) && problems.push(String(e)));
    await openShelf(page);
    await play(page, NOVA);
    await expect(emu(page).getByRole('heading')).toContainText('Nova the Squirrel');
    await page.waitForTimeout(1500);
    const title = await screen(page);
    expect(new Set(title).size).toBeGreaterThan(40); // a real picture, not one flat colour

    // Start leaves the title screen
    await expect
      .poll(
        async () => {
          await page.keyboard.down('Enter');
          await page.waitForTimeout(150);
          await page.keyboard.up('Enter');
          await page.waitForTimeout(700);
          return !(await screen(page)).equals(title);
        },
        { timeout: 20_000 },
      )
      .toBe(true);
    expect(foreign).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('pause stops the picture and resume starts it again', async ({ page }) => {
    await openShelf(page);
    await play(page, '[data-rom="bundled:homebrew/thwaite.nes"]');
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(emu(page)).toHaveAttribute('data-status', 'paused');
    await expect(page.locator('.emu-overlay')).toHaveText('Paused');
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(emu(page)).toHaveAttribute('data-status', 'running');
    await expect(page.locator('.emu-overlay')).toHaveCount(0);
  });

  test('a save made in one visit can be loaded in the next', async ({ page }) => {
    await openShelf(page);
    await play(page, NOVA);
    await expect(page.getByRole('button', { name: 'Load the save' })).toBeDisabled();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Save here' }).click();
    await expect(page.locator('.emu-note')).toHaveText('Saved');
    await expect(page.getByRole('button', { name: 'Load the save' })).toBeEnabled();

    await page.reload();
    await play(page, NOVA);
    await expect(page.getByRole('button', { name: 'Load the save' })).toBeEnabled();
    await page.getByRole('button', { name: 'Load the save' }).click();
    await expect(page.locator('.emu-note')).toHaveText('Loaded');
  });

  test('the Game Boy core runs too', async ({ page }) => {
    await openShelf(page);
    await play(page, '[data-rom="bundled:homebrew/ucity.gbc"]');
    await expect(emu(page).getByRole('heading')).toContainText('Game Boy Color');
    await page.waitForTimeout(1500);
    expect(new Set(await screen(page)).size).toBeGreaterThan(40);
  });

  for (const [console, rom] of [
    ['Mega Drive / Genesis', 'miniplanets.md'],
    ['Mega Drive / Genesis', 'dragonscastle.md'],
    ['Game Boy Advance', 'voxelburg.gba'],
    ['Game Boy Advance', 'galacticquest.gba'],
  ] as const) {
    test(`the ${console} core runs ${rom}`, async ({ page }) => {
      await openShelf(page);
      await play(page, `[data-rom="bundled:homebrew/${rom}"]`);
      await expect(emu(page).getByRole('heading')).toContainText(console);
      // it draws a real picture, and the picture moves (the game is running, not frozen on one frame)
      await expect.poll(async () => new Set(await screen(page)).size, { timeout: 20_000 }).toBeGreaterThan(40);
      const first = await screen(page);
      await expect
        .poll(
          async () => {
            await page.keyboard.down('Enter');
            await page.waitForTimeout(150);
            await page.keyboard.up('Enter');
            await page.waitForTimeout(600);
            return !(await screen(page)).equals(first);
          },
          { timeout: 20_000 },
        )
        .toBe(true);
    });
  }

  test('the Super NES core runs, and its face buttons arrive (the demo changes its effect on A)', async ({ page }) => {
    await openShelf(page);
    await play(page, '[data-rom="bundled:homebrew/colormath.sfc"]');
    await expect(emu(page).getByRole('heading')).toContainText('Super NES');
    await expect.poll(async () => new Set(await screen(page)).size, { timeout: 20_000 }).toBeGreaterThan(40);
    await page.waitForTimeout(500);
    const before = await screen(page);
    expect((await screen(page)).equals(before)).toBe(true); // a still picture until a button is pressed
    await expect
      .poll(
        async () => {
          await page.keyboard.down('x'); // the keyboard's X is the pad's A
          await page.waitForTimeout(150);
          await page.keyboard.up('x');
          await page.waitForTimeout(500);
          return !(await screen(page)).equals(before);
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  });

  test('going back to the shelf stops the game, and another one can be started', async ({ page }) => {
    await openShelf(page);
    await play(page, NOVA);
    await page.getByRole('button', { name: 'Shelf' }).click();
    await expect(page.locator('.cart')).toHaveCount(9);
    await play(page, '[data-rom="bundled:homebrew/croom.nes"]');
    await expect(emu(page).getByRole('heading')).toContainText('Concentration Room');
  });

  test('on a touch screen there is a pad, and its Start button works', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'the pad only shows on touch screens');
    await openShelf(page);
    await play(page, NOVA);
    await expect(page.locator('.pad')).toBeVisible();
    for (const name of ['up', 'down', 'left', 'right', 'a', 'b', 'start', 'select']) await expect(page.locator(`.pad-${name}`)).toBeVisible();
    await page.waitForTimeout(1500);
    const title = await screen(page);
    await expect
      .poll(
        async () => {
          await page.locator('.pad-start').dispatchEvent('pointerdown', { pointerId: 1 });
          await page.waitForTimeout(150);
          await page.locator('.pad-start').dispatchEvent('pointerup', { pointerId: 1 });
          await page.waitForTimeout(700);
          return !(await screen(page)).equals(title);
        },
        { timeout: 20_000 },
      )
      .toBe(true);
  });
});
