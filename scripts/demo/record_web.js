// Records a real browser session of the Ask My Docs web app (real model, real streaming).
// Usage: node record_web.js <output-dir>   (server must be running; DEMO_URL overrides the address)
const { chromium } = require('playwright');
const path = require('path');
const OUT = process.argv[2];
const W = 1180, H = 740;

const OVERLAY = `
(() => {
  const add = () => {
    if (document.getElementById('__cap')) return;
    const style = document.createElement('style');
    style.textContent = \`
      #__cap{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:1000px;width:max-content;
        background:rgba(4,10,20,.92);color:#fff;font:600 24px/1.35 system-ui,Segoe UI,Roboto,sans-serif;
        padding:16px 26px;border-radius:14px;border-left:6px solid #00d4f0;z-index:2147483646;
        box-shadow:0 8px 30px rgba(0,0,0,.45);opacity:0;transition:opacity .35s;pointer-events:none;text-align:left}
      #__cap.on{opacity:1}
      #__cursor{position:fixed;left:0;top:0;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;
        background:rgba(0,212,240,.35);border:3px solid #00d4f0;z-index:2147483647;pointer-events:none;
        transition:transform .12s}
      #__cursor.down{transform:scale(.7);background:rgba(0,212,240,.7)}\`;
    document.head.appendChild(style);
    const cap = document.createElement('div'); cap.id='__cap'; document.body.appendChild(cap);
    const cur = document.createElement('div'); cur.id='__cursor'; cur.style.left="590px"; cur.style.top="370px"; document.body.appendChild(cur);
    addEventListener('mousemove', e => { cur.style.left=e.clientX+'px'; cur.style.top=e.clientY+'px'; }, true);
    addEventListener('mousedown', () => cur.classList.add('down'), true);
    addEventListener('mouseup', () => cur.classList.remove('down'), true);
    window.__cap = (t) => { cap.textContent = t || ''; cap.classList.toggle('on', !!t); };
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', add); else add();
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: OUT, size: { width: W, height: H } },
    colorScheme: 'dark',
  });
  await context.addInitScript(OVERLAY);
  const page = await context.newPage();
  const cap = (t) => page.evaluate((x) => window.__cap(x), t);
  const glide = async (selector, dy = 0) => {
    const box = await page.locator(selector).first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + dy, { steps: 28 });
  };
  const waitDone = () => page.waitForFunction(
    () => document.querySelector('#timing').textContent.startsWith('done'), null, { timeout: 240000 });
  const scrollTo = async (y) => { await page.evaluate((v) => window.scrollTo({ top: v, behavior: 'smooth' }), y); await sleep(900); };

  await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:8000/');
  await page.waitForSelector('.chip');
  await sleep(400);

  await cap('Ask My Docs: ask questions about your own documents. It runs entirely on this computer, with no API key and no cloud.');
  await sleep(5200);
  await cap('Here it has indexed 9 documents about a developer’s portfolio (30 text passages).');
  await glide('#status');
  await sleep(4200);

  // ---- Question 1: typed by hand
  await cap('Step 1: type a question in plain language.');
  await glide('#question');
  await page.click('#question');
  await page.keyboard.type('What does Al-Nasser do at Tarynix?', { delay: 55 });
  await sleep(1200);
  await glide('#submit');
  await cap('Step 2: it first finds the passages most relevant to the question…');
  await page.click('#submit');
  await page.waitForSelector('.source');
  await sleep(2200);
  await cap('…then a local AI model writes the answer using ONLY those passages, and cites them as [1], [2]…');
  await scrollTo(330);
  await waitDone();
  await sleep(2600);
  await cap('Every answer shows how fast it was and which passages it came from.');
  await sleep(3200);

  // ---- Citations and sources
  await cap('Click a citation to jump to the passage it came from.');
  await glide('.cite');
  await sleep(900);
  await page.locator('.cite').first().click();
  await sleep(1500);
  await page.locator('.source details summary').first().click();
  await sleep(300);
  await cap('Each source shows the file, a similarity score, and the exact text, so you can check the answer.');
  await sleep(5200);

  // ---- Question 2: chip
  await scrollTo(0);
  await cap('Another question, using an example button…');
  await glide('.chip >> nth=1');
  await sleep(900);
  await page.locator('.chip').nth(1).click();
  await page.waitForSelector('.source');
  await scrollTo(330);
  await waitDone();
  await sleep(3800);

  // ---- Question 3: not in the documents
  await scrollTo(0);
  await cap('Now a question the documents cannot answer…');
  await glide('#question');
  await page.click('#question', { clickCount: 3 });
  await page.keyboard.type('Does Al-Nasser know Rust?', { delay: 55 });
  await sleep(900);
  await glide('#submit');
  await page.click('#submit');
  await page.waitForSelector('.source');
  await scrollTo(330);
  await waitDone();
  await cap('…so it says “I don’t know” instead of making something up. That is the point of RAG.');
  await sleep(6000);

  await cap('Retrieval (find the right passages) + grounded generation (answer only from them). Open source, MIT licensed.');
  await sleep(5200);
  await cap('');
  await sleep(600);

  const video = page.video();
  await context.close();
  console.log('VIDEO', await video.path());
  await browser.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
