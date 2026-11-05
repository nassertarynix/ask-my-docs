// End-to-end check of adding and removing documents from the web page, in a phone-sized browser
// (plus drag and drop on a desktop-sized one). Uses the real server and the real models.
// Not part of `pytest`.
//
// IMPORTANT: start the server on an EMPTY index first, because the check begins from "no documents"
// and ends by removing everything it added:
//     INDEX_DIR=$(mktemp -d) python -m ask_my_docs serve --port 8000
//     node scripts/ui_upload_flow.js            (UI_URL overrides http://127.0.0.1:8000/)
// Needs Ollama running (documents are embedded and a question is answered), and Playwright for Node.
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const BASE = process.env.UI_URL || 'http://127.0.0.1:8000/';
const R = path.resolve(__dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ask-my-docs-flow-'));   // bad files made fresh for each run
fs.writeFileSync(path.join(T, 'notes.docx'), 'not really a word file');
fs.writeFileSync(path.join(T, 'empty.md'), '');
fs.writeFileSync(path.join(T, 'fake.pdf'), 'this is plain text pretending to be a pdf');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '   ' + extra : '')); if (!ok) failures++; };

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  async function phone(scheme) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(e.message));
    await page.goto(BASE);
    await page.waitForSelector('#status-text');
    return { ctx, page };
  }
  const txt = (page, sel) => page.locator(sel).first().textContent();

  // ---------- light theme: the whole flow ----------
  let { ctx, page } = await phone('light');
  check('empty state is shown when there is no index', await page.locator('#empty').isVisible() && await page.locator('#docs-row').isHidden());
  check('pill says there are no documents', (await txt(page, '#status')).includes('No documents'));
  check('send is disabled with nothing indexed', await page.locator('#submit').isDisabled());
  

  const chooserPromise = page.waitForEvent('filechooser');
  await page.tap('#empty-add');
  const chooser = await chooserPromise;
  check('Add documents opens the sheet and the file picker', await page.locator('#docs-sheet').evaluate(d => d.open));
  await chooser.setFiles([
    R + '/sample_docs/orbit_labs_expenses.pdf', R + '/sample_docs/security.md',
    T + '/notes.docx', T + '/empty.md', T + '/fake.pdf',
  ]);
  await page.waitForFunction(() => document.querySelectorAll('#queue li').length === 5 && !document.querySelector('#queue li.busy'), null, { timeout: 120000 });
  const states = await page.locator('#queue li').evaluateAll(lis => lis.map(li => [li.querySelector('.q-name').textContent, li.className, li.querySelector('.q-state').textContent]));
  const by = Object.fromEntries(states.map(([n, c, s]) => [n, { c, s }]));
  check('PDF added with its page count', by['orbit_labs_expenses.pdf'].c === 'ok' && /from 2 pages/.test(by['orbit_labs_expenses.pdf'].s), by['orbit_labs_expenses.pdf'].s);
  check('markdown file added', by['security.md'].c === 'ok', by['security.md'].s);
  check('unsupported type is refused in the browser', by['notes.docx'].c === 'err' && /supported/.test(by['notes.docx'].s), by['notes.docx'].s);
  check('empty file is refused', by['empty.md'].c === 'err' && /empty/.test(by['empty.md'].s), by['empty.md'].s);
  check('a fake PDF is refused by the server', by['fake.pdf'].c === 'err' && /PDF/.test(by['fake.pdf'].s), by['fake.pdf'].s);
  check('pill and list updated', (await txt(page, '#status')).includes('2 docs') && await page.locator('#doc-items .doc').count() === 2);
  check('only uploaded documents have a Remove button', await page.locator('.doc-remove').count() === 2);
  

  await page.tap('#docs-close'); await sleep(400);
  check('welcome now shows the documents row, not the empty state', await page.locator('#docs-row').isVisible() && await page.locator('#empty').isHidden());
  check('send is enabled once documents exist', await page.locator('#submit').isEnabled());

  await page.locator('#question').fill('What is the meal allowance while travelling?');
  await page.tap('#submit');
  await page.waitForFunction(() => /^Answered/.test(document.querySelector('.turn .status span:last-child')?.textContent || ''), null, { timeout: 180000 });
  const answer = await txt(page, '.turn .answer');
  check('a question about the uploaded PDF is answered from it', /45/.test(answer), answer.slice(0, 90));
  check('the passage card shows the PDF page', (await page.locator('.src .pg').allTextContents()).some(t => /p\. \d/.test(t)));
  

  // replace, then remove with the two-step confirm
  await page.tap('#status'); await sleep(300);
  const c2 = page.waitForEvent('filechooser'); await page.tap('#pick'); (await c2).setFiles([R + '/sample_docs/security.md']);
  await page.waitForFunction(() => /Replaced/.test(document.querySelector('#queue li .q-state')?.textContent || ''), null, { timeout: 60000 });
  check('uploading the same name again replaces it', await page.locator('#doc-items .doc').count() === 2);
  const removeBtn = page.locator('.doc', { hasText: 'security.md' }).locator('.doc-remove');
  await removeBtn.tap();
  check('first tap on Remove only asks for confirmation', (await removeBtn.textContent()) === 'Tap to confirm' && await page.locator('#doc-items .doc').count() === 2);
  await removeBtn.tap(); await sleep(800);
  check('second tap removes the document', await page.locator('#doc-items .doc').count() === 1 && (await txt(page, '#status')).includes('1 doc'));
  await page.tap('.doc-remove'); await page.tap('.doc-remove'); await sleep(800);
  check('removing the last document returns to the empty state', await page.locator('#doc-items .doc-meta', { hasText: 'No documents yet' }).count() === 1);
  await page.tap('#docs-close'); await sleep(400);
  check('empty state is back and sending is disabled', await page.locator('#empty').isVisible() && await page.locator('#submit').isDisabled());
  await ctx.close();

  // ---------- dark theme: the sheet ----------
  ({ ctx, page } = await phone('dark'));
  const c3 = page.waitForEvent('filechooser'); await page.tap('#empty-add'); (await c3).setFiles([R + '/sample_docs/orbit_labs_expenses.pdf', T + '/notes.docx']);
  await page.waitForFunction(() => document.querySelectorAll('#queue li').length === 2 && !document.querySelector('#queue li.busy'), null, { timeout: 120000 });
  
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check('no horizontal overflow with the sheet open', !overflow);
  await ctx.close();

  // ---------- desktop: drag and drop ----------
  const dctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
  const dp = await dctx.newPage(); dp.on('pageerror', e => errs.push(e.message));
  await dp.goto(BASE); await dp.waitForSelector('#status-text');
  await dp.evaluate(() => {
    const dt = new DataTransfer(); dt.items.add(new File(['# Dropped\n\nA note about otters.'], 'dropped.md', { type: 'text/markdown' }));
    window.__dt = dt;
    window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
  });
  check('dragging a file over the page shows the drop overlay', await dp.locator('#dropover').isVisible());
  await dp.evaluate(() => window.dispatchEvent(new DragEvent('drop', { dataTransfer: window.__dt, bubbles: true, cancelable: true })));
  await dp.waitForFunction(() => /Added/.test(document.querySelector('#queue li .q-state')?.textContent || ''), null, { timeout: 60000 });
  check('dropping a file adds it and opens the sheet', await dp.locator('#docs-sheet').evaluate(d => d.open) && await dp.locator('#dropover').isHidden());
  
  await dctx.close();

  fs.rmSync(T, { recursive: true, force: true });
  console.log('page errors:', JSON.stringify(errs));
  await browser.close();
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
