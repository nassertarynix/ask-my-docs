// Phone screenshots, light and dark. Usage: node scripts/shots.mjs <outDir> [url]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const out = process.argv[2] ?? 'shots', base = process.argv[3] ?? 'http://127.0.0.1:4180/';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  await page.goto(base);
  await page.waitForSelector('.hero');
  await page.screenshot({ path: `${out}/${scheme}-top.png` });
  await page.screenshot({ path: `${out}/${scheme}-full.png`, fullPage: true });
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}/${scheme}-dialog.png` });
  await context.close();
}
await browser.close();
