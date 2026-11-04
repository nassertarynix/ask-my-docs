// Records the terminal replay page. Usage: node record_terminal.js <output-dir> <absolute path to terminal.html>
const { chromium } = require('playwright');
const OUT = process.argv[2], PAGE = process.argv[3];
(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: OUT, size: { width: 1600, height: 900 } } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('file://' + PAGE);
  await page.waitForFunction(() => window.__done === true, null, { timeout: 240000 });
  const video = page.video(); await context.close();
  console.log('VIDEO', await video.path(), 'errors:', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('FAILED', e); process.exit(1); });
