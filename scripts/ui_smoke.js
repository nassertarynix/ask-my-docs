// UI smoke test for the web interface, run in a phone-sized browser. Not part of `pytest`.
// Needs: the server running (python -m ask_my_docs serve) with an index of portfolio_docs,
// Ollama running (retrieval uses the embedding model), and Playwright for Node.
// Usage: node scripts/ui_smoke.js        (UI_URL overrides http://127.0.0.1:8000/)
const { chromium } = require('playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) failures++; };
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto((process.env.UI_URL || 'http://127.0.0.1:8000/')); await page.waitForSelector('.examples button');

  // retrieval only (answer writing off), submitted with Enter
  await page.tap('#opt-btn');
  await page.locator('#use-llm').uncheck();
  await page.tap('label[for=k2]');
  await page.tap('#opt-btn');
  await page.locator('#question').fill('What backend does Tayar use?');
  await page.locator('#question').press('Enter');
  await page.waitForSelector('.turn .src');
  await sleep(400);
  check('Enter submits the question', await page.locator('.turn').count() === 1);
  check('passages-only mode shows 2 passages (set to 2)', await page.locator('.turn .src').count() === 2);
  check('passages-only mode hides the answer card', await page.locator('.turn .answer-card').isHidden());
  check('passages-only mode explains itself', (await page.locator('.turn .note').textContent()).includes('only the passages'));
  check('send button re-enabled when done', await page.locator('#submit').isEnabled());

  // sheet: open by tapping a card, close with Escape
  await page.tap('.src >> nth=0'); await sleep(400);
  check('tapping a passage opens the sheet', await page.locator('#sheet').evaluate(d => d.open));
  check('sheet shows the passage text', (await page.locator('#sheet-text').textContent()).length > 50);
  await page.keyboard.press('Escape'); await sleep(300);
  check('Escape closes the sheet', await page.locator('#sheet').evaluate(d => !d.open));

  // new chat resets to the welcome screen
  await page.tap('#new-chat'); await sleep(400);
  check('New chat clears the thread', await page.locator('.turn').count() === 0 && await page.locator('#welcome').isVisible());
  check('New chat button hides again', await page.locator('#new-chat').isHidden());

  // empty question does nothing
  await page.locator('#question').fill('   ');
  await page.locator('#question').press('Enter'); await sleep(200);
  check('blank question is ignored', await page.locator('.turn').count() === 0);

  // model server unreachable: stop pointing the app at Ollama by intercepting the stream with an error event
  await page.route('**/api/ask', route => route.fulfill({ status: 200, contentType: 'application/x-ndjson',
    body: JSON.stringify({ type: 'sources', sources: [{ n: 1, source: 'a.md', chunk: 0, score: 0.5, text: 'x' }] }) + '\n' +
          JSON.stringify({ type: 'error', message: 'Could not reach the model server at http://localhost:11434/v1. Is Ollama running?' }) + '\n' }));
  await page.locator('#use-llm').check({ force: true }).catch(() => {});
  await page.locator('#question').fill('hello'); await page.locator('#question').press('Enter');
  await page.waitForSelector('.answer-card.error'); 
  check('an error event shows a readable error card', (await page.locator('.answer-card.error .answer').textContent()).includes('Is Ollama running'));
  check('failed turn is not left spinning', await page.locator('.turn .status.done').count() === 1);

  // horizontal overflow at several widths
  for (const w of [320, 360, 414, 768, 1280]) {
    await page.setViewportSize({ width: w, height: 800 }); await sleep(150);
    const o = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check(`no horizontal overflow at ${w}px`, !o);
  }
  check('no page errors', errs.length === 0, JSON.stringify(errs));
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
