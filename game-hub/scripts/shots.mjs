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
