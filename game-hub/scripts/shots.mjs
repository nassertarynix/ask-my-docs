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
