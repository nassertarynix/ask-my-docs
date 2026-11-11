// Screenshots of the running app, light and dark. Usage: node scripts/shots.mjs <outDir> [frontendUrl] [apiUrl] [token]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] ?? 'shots';
const front = process.argv[3] ?? 'http://127.0.0.1:1420/';
const api = process.argv[4] ?? 'http://127.0.0.1:8765';
const token = process.argv[5] ?? 'demo-token-0123456789abcdef';
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
for (const scheme of ['light', 'dark']) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: scheme });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
  page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));
  await page.goto(`${front}?api=${encodeURIComponent(api)}&token=${token}`);
  await page.getByRole('table').waitFor();
  await page.screenshot({ path: `${out}/${scheme}-root.png` });
  await page.getByRole('table').getByRole('button', { name: 'Documents', exact: true }).click();
  await page.getByText('Quarterly report Q3.pdf').waitFor();
  await page.getByRole('row', { name: /Quarterly report/ }).click();
  await page.screenshot({ path: `${out}/${scheme}-folder.png` });
  await context.close();
}
await browser.close();
