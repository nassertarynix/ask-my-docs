// Screenshots for the README, taken from the real build. Start a preview first:
//   npm run build && npx vite preview --port 4190 --host 127.0.0.1
//   node scripts/shots.mjs docs
import { chromium } from '@playwright/test';

const out = process.argv[2] ?? 'docs';
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4190/';
const browser = await chromium.launch();

const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
let page = await desktop.newPage();
await page.goto(base);
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/hub.png` });
await page.goto(`${base}#/play/crater-lab?seed=7`);
await page.reload();
await page.waitForSelector('[data-screen="setup"]');
await page.screenshot({ path: `${out}/setup.png` });
await page.getByRole('radio', { name: /2 players/ }).check();
await page.locator('[data-action="start"]').click();
await page.waitForSelector('[data-screen="match"]');
await page.getByLabel('Barrel angle').fill('128');
await page.getByLabel('Shot power').fill('74');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/match-aim.png` });
// a Tri-Splitter, split in the air, photographed as the fragments come down
await page.keyboard.press('2');
await page.keyboard.press('Space');
await page.waitForTimeout(1900);
await page.keyboard.press('Space');
await page.waitForTimeout(1250);
await page.screenshot({ path: `${out}/match-split.png` });
await page.waitForFunction(() => document.querySelector('.match')?.dataset.current === '1' && document.querySelector('.match')?.dataset.phase === 'aim');
// player 2 answers with a black hole
await page.keyboard.press('4');
await page.getByLabel('Barrel angle').fill('48');
await page.getByLabel('Shot power').fill('78');
await page.keyboard.press('Space');
await page.waitForFunction(() => document.querySelector('.match')?.dataset.phase !== 'aim');
for (let i = 0; i < 200; i++) {
  await page.waitForTimeout(60);
  const bars = await page.evaluate(() => document.querySelector('.match')?.dataset.phase);
  if (bars !== 'flight') break;
}
await page.screenshot({ path: `${out}/match-after.png` });
// the Retro Deck
await page.goto(`${base}#/play/retro`);
await page.waitForSelector('.cart');
await page.screenshot({ path: `${out}/retro-shelf.png` });
await page.locator('[data-rom="bundled:homebrew/novathesquirrel.nes"]').click();
await page.waitForSelector('[data-status="running"]');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${out}/retro-play.png` });
// the small games
await page.goto(`${base}#/play/mastermind`);
await page.reload();
await page.getByRole('radio', { name: /Never/ }).check();
await page.locator('[data-action="start"]').click();
for (const guess of [[0, 1, 2, 3], [1, 0, 4, 5], [2, 1, 3, 4]]) {
  for (const c of guess) await page.keyboard.press(String(c + 1));
  await page.keyboard.press('Enter');
}
for (const c of [3, 1, 0]) await page.keyboard.press(String(c + 1));
await page.screenshot({ path: `${out}/mastermind.png` });

await page.goto(`${base}#/play/dots-boxes`);
await page.reload();
await page.getByRole('radio', { name: /2 players/ }).check();
await page.locator('[data-action="start"]').click();
for (const e of [0, 12, 3, 13, 1, 4, 14, 24, 25, 5, 15, 27, 26, 36]) await page.locator(`[data-edge="${e}"]`).click({ force: true });
await page.screenshot({ path: `${out}/dots-boxes.png` });

await page.goto(`${base}#/play/mancala`);
await page.reload();
await page.getByRole('radio', { name: /2 players/ }).check();
await page.locator('[data-action="start"]').click();
for (const pit of [2, 0, 12, 5]) {
  await page.locator(`[data-pit="${pit}"]:not([disabled])`).click();
  await page.waitForSelector('[data-busy="no"]');
}
await page.screenshot({ path: `${out}/mancala.png` });

await page.goto(`${base}#/play/quoridor`);
await page.reload();
await page.getByRole('radio', { name: /2 players/ }).check();
await page.locator('[data-action="start"]').click();
const board = async (x, y) => {
  const box = await page.locator('.qd-board').boundingBox();
  const span = 12 * 2 + 9 * 40 + 8 * 10;
  return { x: box.x + (x / span) * box.width, y: box.y + (y / span) * box.height };
};
await page.locator('[data-dest="7,4"]').click();
await page.locator('[data-dest="1,4"]').click();
await page.locator('[data-dest="6,4"]').click();
for (const [x, y] of [[217, 207], [117, 107]]) {
  await page.locator('[data-action="mode-wall"]').click();
  const p = await board(x, y);
  await page.mouse.click(p.x, p.y);
}
await page.screenshot({ path: `${out}/quoridor.png` });
await page.goto(`${base}#/play/sudoku?seed=5`);
await page.reload();
await page.locator('[data-action="start"]').click();
await page.locator('[data-cell="40"]').click();
await page.screenshot({ path: `${out}/sudoku.png` });

await page.goto(`${base}#/play/minesweeper?seed=3`);
await page.reload();
await page.locator('[data-action="start"]').click();
await page.locator('[data-cell="40"]').click();
await page.locator('[data-cell="0"]').click({ button: 'right' });
await page.screenshot({ path: `${out}/minesweeper.png` });

await page.goto(`${base}#/play/picross?seed=4`);
await page.reload();
await page.getByRole('radio', { name: /10 × 10/ }).check();
await page.locator('[data-action="start"]').click();
for (let i = 0; i < 18; i++) await page.locator('[data-action="hint"]').click();
await page.screenshot({ path: `${out}/picross.png` });

await page.goto(`${base}#/play/battleship`);
await page.reload();
await page.locator('[data-action="start"]').click();
await page.locator('[data-action="random"]').click();
await page.locator('[data-action="ready"]').click();
for (let i = 0; i < 14; i++) {
  await page.locator('.bs-big [data-state="water"]').nth(i * 3 % 40).click();
  await page.waitForSelector('[data-fired="no"]', { timeout: 15000 });
}
await page.screenshot({ path: `${out}/battleship.png` });

await page.goto(`${base}#/play/air-hockey?fast=2`);
await page.reload();
await page.locator('[data-action="start"]').click();
await page.mouse.move(700, 600, { steps: 4 });
await page.waitForTimeout(6500);
await page.screenshot({ path: `${out}/air-hockey.png` });

await page.goto(`${base}#/play/chess`);
await page.reload();
await page.getByRole('radio', { name: /2 players/ }).check();
await page.locator('[data-action="start"]').click();
for (const [from, to] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'c4'], ['g8', 'f6'], ['f3', 'g5'], ['d7', 'd5'], ['e4', 'd5'], ['c6', 'a5']]) {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}
await page.locator('[data-square="c4"]').click();
await page.screenshot({ path: `${out}/chess.png` });

await page.goto(`${base}#/play/shogi`);
await page.reload();
await page.getByRole('radio', { name: /2 players/ }).check();
await page.locator('[data-action="start"]').click();
for (const [from, to] of [['7g', '7f'], ['3c', '3d'], ['8h', '2b'], ['3a', '2b'], ['2g', '2f'], ['8c', '8d']]) {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
  if (await page.locator('[data-promote="yes"]').count()) await page.locator('[data-promote="yes"]').click();
}
await page.locator('[data-hand="B"][data-owner="0"]').click();
await page.screenshot({ path: `${out}/shogi.png` });

await page.goto(`${base}#/play/gem-merchants?fast=1`);
await page.reload();
await page.getByRole('radio', { name: /Three at the table/ }).check();
await page.getByRole('radio', { name: /Normal/ }).check();
await page.locator('[data-action="start"]').click();
for (let i = 0; i < 3; i++) {
  await page.locator('button[data-supply]:not([disabled])').nth(0).click();
  await page.locator('button[data-supply]:not([disabled])').nth(1).click();
  await page.locator('button[data-supply]:not([disabled])').nth(2).click();
  await page.locator('[data-action="take"]').click();
  await page.waitForFunction(() => document.querySelector('[data-screen="play"]')?.getAttribute('data-turn') === '0' && ['action', 'discard'].includes(document.querySelector('[data-screen="play"]')?.getAttribute('data-phase') ?? ''));
  if ((await page.locator('[data-screen="play"]').getAttribute('data-phase')) === 'discard') {
    while ((await page.locator('[data-screen="play"]').getAttribute('data-phase')) === 'discard') await page.locator('.gm-giveback').first().click();
    await page.waitForFunction(() => document.querySelector('[data-screen="play"]')?.getAttribute('data-turn') === '0' && document.querySelector('[data-screen="play"]')?.getAttribute('data-phase') === 'action');
  }
}
await page.locator('.gm-board [data-card]').nth(5).click();
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: `${out}/gem-merchants.png`, fullPage: true });

await page.goto(`${base}#/play/pit-brawl?fast=1&seed=5`);
await page.reload();
await page.locator('[data-hero="0"]').click();
await page.locator('[data-field="opponents"]').evaluate((el) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, '7');
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.getByRole('radio', { name: /Normal/ }).check();
await page.locator('[data-action="start"]').click();
await page.waitForSelector('[data-screen="play"]');
// seed 5 deals a hand with Cleaver Chop and the first turn to the player: select it to show the highlighted targets
await page.locator('.pb-card[data-name="Cleaver Chop"]').click();
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: `${out}/pit-brawl.png`, fullPage: true });

await page.goto(`${base}#/play/water-sort`);
await page.evaluate(() => localStorage.setItem('paper-arcade:game:water-sort', JSON.stringify({ level: 7 })));
await page.reload();
await page.locator('[data-action="start"]').click();
await page.locator('[data-tube="1"]').click();
await page.screenshot({ path: `${out}/water-sort.png` });
await desktop.close();

const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
page = await phone.newPage();
await page.goto(`${base}#/play/crater-lab?seed=7`);
await page.locator('[data-action="start"]').click();
await page.waitForSelector('[data-screen="match"]');
await page.waitForTimeout(900);
await page.screenshot({ path: `${out}/phone-match.png` });
await page.goto(base);
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/phone-hub.png` });
await browser.close();
