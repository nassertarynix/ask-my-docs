// Take screenshots of the running app at phone size. Usage: node scripts/shots.mjs <outDir> [url]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'shots';
const base = process.argv[3] ?? 'http://127.0.0.1:4173/';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
  await page.goto(base);
  await page.getByRole('button', { name: /demo business/i }).click();
  await page.waitForSelector('.kpis');
  const shots = [['home', '#/'], ['sales', '#/sales'], ['stock', '#/stock'], ['invoices', '#/invoices'], ['more', '#/more'], ['reports', '#/reports'], ['new-sale', '#/sales/new']];
  for (const [name, hash] of shots) {
    await page.goto(base + hash);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/${scheme}-${name}.png`, fullPage: name === 'home' || name === 'reports' });
  }
  await context.close();
}
await browser.close();
