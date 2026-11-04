// Records a phone-sized demo of the Ask My Docs web app: a real browser session with the real
// local model. The app runs unmodified inside an iframe on a small "stage" page that adds a
// caption strip above it and a finger that shows taps and swipes (headless browsers draw neither).
//
// Usage: node record_web.js <output-dir>
//   Needs the server running (python -m ask_my_docs serve) with an index of portfolio_docs.
//   Env: DEMO_URL (default http://127.0.0.1:8000/), DEMO_THEME (dark or light, default dark).
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2];
const APP = process.env.DEMO_URL || 'http://127.0.0.1:8000/';
const THEME = process.env.DEMO_THEME === 'light' ? 'light' : 'dark';
const W = 390, H = 844, BAR = 80, SCALE = 2;
const FONT = fs.readFileSync(path.join(__dirname, '..', '..', 'ask_my_docs', 'static', 'fonts', 'InstrumentSans-latin.woff2'));

const STAGE = `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=${W},initial-scale=1">
<style>
@font-face{font-family:"Instrument Sans";src:url(/font.woff2) format("woff2");font-weight:400 700}
html,body{margin:0;background:#0c0e1d;overflow:hidden}
#bar{height:${BAR}px;box-sizing:border-box;background:#3f4bde;color:#fff;display:flex;align-items:center;padding:0 18px;
  font:600 15.5px/1.32 "Instrument Sans",system-ui,sans-serif}
#cap{transition:opacity .3s;opacity:0;flex:1}
#speed{display:none;margin-left:12px;flex:none;font:700 11px/1 "Instrument Sans",system-ui,sans-serif;letter-spacing:.04em;background:rgba(255,255,255,.24);border-radius:999px;padding:6px 10px}
iframe{display:block;width:${W}px;height:${H}px;border:0}
#finger{position:fixed;left:200px;top:500px;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;pointer-events:none;z-index:9;
  background:rgba(255,255,255,.28);border:2px solid rgba(255,255,255,.85);box-shadow:0 2px 10px rgba(0,0,0,.35);
  transition:left .42s cubic-bezier(.3,.7,.2,1),top .42s cubic-bezier(.3,.7,.2,1),transform .12s;opacity:0}
#finger.on{opacity:1}
#finger.down{transform:scale(.72);background:rgba(255,255,255,.5)}
#finger.slow{transition:left .9s ease-in-out,top .9s ease-in-out,transform .12s}
</style></head><body>
<div id="bar"><span id="cap"></span><span id="speed">2× SPEED</span></div>
<iframe src="__APP__"></iframe>
<div id="finger"></div>
<script>
const f = document.getElementById('finger'), c = document.getElementById('cap');
window.__cap = (t) => { c.style.opacity = 0; setTimeout(() => { c.textContent = t || ''; c.style.opacity = t ? 1 : 0; }, 200); };
window.__move = (x, y) => { f.classList.add('on'); f.classList.remove('slow'); f.style.left = x + 'px'; f.style.top = y + 'px'; };
window.__swipe = (x1, y, x2) => { f.classList.add('on'); f.classList.remove('slow'); f.style.left = x1 + 'px'; f.style.top = y + 'px';
  setTimeout(() => { f.classList.add('down', 'slow'); f.style.left = x2 + 'px'; }, 450); setTimeout(() => f.classList.remove('down'), 1450); };
window.__speed = (on) => { document.getElementById('speed').style.display = on ? 'block' : 'none'; };
window.__down = () => f.classList.add('down');
window.__up = () => f.classList.remove('down');
</script></body></html>`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const marks = [];  // [start, end] seconds (since the page opened) spent waiting for the model

(async () => {
  const server = http.createServer((req, res) => {
    if (req.url.endsWith('.woff2')) { res.writeHead(200, { 'Content-Type': 'font/woff2' }); return res.end(FONT); }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(STAGE.replace('__APP__', APP));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const stageUrl = 'http://127.0.0.1:' + server.address().port + '/';

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: W, height: H + BAR }, deviceScaleFactor: SCALE, isMobile: true, hasTouch: true, colorScheme: THEME,
    recordVideo: { dir: OUT, size: { width: W * SCALE, height: (H + BAR) * SCALE } },
  });
  const t0 = Date.now();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(stageUrl);
  const handle = await page.waitForSelector('iframe');
  const frame = await handle.contentFrame();
  await frame.waitForSelector('.examples button');
  await sleep(500);

  const cap = (t) => page.evaluate((x) => window.__cap(x), t);
  const now = () => (Date.now() - t0) / 1000;
  async function waitForModel(promise) {
    const start = now();
    await page.evaluate(() => window.__speed(true));
    await promise;
    await page.evaluate(() => window.__speed(false));
    marks.push([start, now()]);
  }
  const loc = (sel) => frame.locator(sel).first();
  const answered = () => frame.waitForFunction(
    () => /^Answered/.test(document.querySelector('.turn:last-of-type .status span:last-child')?.textContent || ''), null, { timeout: 240000 });
  const scrollPage = (to) => frame.evaluate((v) => window.scrollTo({ top: v === 'end' ? document.documentElement.scrollHeight : v, behavior: 'smooth' }), to);
  async function tap(selector) {
    await loc(selector).scrollIntoViewIfNeeded();
    const box = await loc(selector).boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.evaluate(([a, b]) => window.__move(a, b), [x, y]);
    await sleep(520);
    await page.evaluate(() => window.__down());
    await sleep(110);
    await page.touchscreen.tap(x, y);
    await sleep(140);
    await page.evaluate(() => window.__up());
  }

  // ---- 1. the welcome screen
  await cap('Ask My Docs answers questions from your own documents. It runs on your device: private, with no API key.');
  await sleep(5200);

  // ---- 2. type a question
  await cap('Step 1: type a question in plain language.');
  await sleep(1200);
  await tap('#question');
  await loc('#question').pressSequentially('What does Al-Nasser do at Tarynix?', { delay: 62 });
  await sleep(900);
  await tap('#submit');

  // ---- 3. retrieval first, then the answer
  await cap('Step 2: it first finds the passages most relevant to the question…');
  await frame.waitForSelector('.src');
  await sleep(2600);
  await cap('…then a local AI model writes the answer using only those passages, and cites them.');
  await waitForModel(answered());
  await scrollPage('end');
  await sleep(3800);

  // ---- 4. swipe through the passages
  await cap('Swipe through the passages it found. The ones the answer cited are marked.');
  await frame.evaluate(() => document.querySelector('.turn .rail').scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await sleep(1300);
  const rail = await loc('.turn .rail').boundingBox();
  await page.evaluate(([x1, y, x2]) => window.__swipe(x1, y, x2), [rail.x + rail.width - 40, rail.y + rail.height / 2, rail.x + 60]);
  await frame.evaluate(() => setTimeout(() => document.querySelector('.turn .rail').scrollTo({ left: 300, behavior: 'smooth' }), 480));
  await sleep(2600);

  // ---- 5. read a cited passage
  await cap('Tap a citation to read the exact passage it came from.');
  await scrollPage('end');
  await sleep(1300);
  await tap('.answer .cite');
  await sleep(4600);
  await tap('#sheet-close');
  await sleep(700);

  // ---- 6. a question the documents cannot answer
  await cap('Start a new chat and try a question the documents cannot answer…');
  await tap('#new-chat');
  await sleep(1400);
  await tap('.examples li:nth-child(4) button');
  await frame.waitForSelector('.turn .src');
  await waitForModel(answered());
  await scrollPage('end');
  await cap('…and it says so, instead of making something up.');
  await sleep(5200);

  // ---- 7. options
  await cap('Options: choose how many passages to read, or show only the passages.');
  await tap('#opt-btn');
  await sleep(4200);
  await tap('#opt-btn');
  await sleep(700);

  // ---- 8. themes
  await cap('It follows your phone’s light or dark setting.');
  await page.emulateMedia({ colorScheme: THEME === 'dark' ? 'light' : 'dark' });
  await sleep(3600);
  await page.evaluate(() => document.getElementById('finger').classList.remove('on'));
  await cap('Private, cited and open source: Ask My Docs.');
  await sleep(3200);
  await cap('');
  await sleep(500);

  const video = page.video();
  await context.close();
  fs.writeFileSync(path.join(OUT, 'marks.json'), JSON.stringify(marks));
  console.log('VIDEO', await video.path(), 'errors:', JSON.stringify(errors));
  await browser.close();
  server.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
