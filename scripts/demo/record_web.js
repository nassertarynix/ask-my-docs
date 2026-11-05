// Records a phone-sized demo of the Ask My Docs web app in a real browser. A caption strip and a
// finger that shows taps and swipes are injected into the page for the video (headless browsers
// draw neither). The app's own code is untouched; only its header is nudged down so the caption
// strip does not cover it.
//
// The model's answers are REPLAYED, not generated live. Recording at phone resolution takes so much
// CPU that a CPU-only model slows to a crawl, so capture_streams.js first records the real streamed
// answers (with their timing) while nothing else is running, and this script replays them through a
// small proxy that forwards everything else to the real app. The video says so in its last caption.
//
// Sharpness: Playwright's video recorder ignores deviceScaleFactor. It draws the page, at 1x, into
// the top-left corner of a larger canvas and leaves the rest grey. So this runs a phone-emulated
// browser with a 780x1848 viewport and a meta viewport of "width=390": the app lays out at 390 CSS
// pixels (a phone) while the page is zoomed 2x, like a pinch-zoom, which fills the whole frame
// and is painted sharply.
//
// Usage: node record_web.js <output-dir> <streams.json>
//   Needs the server running (python -m ask_my_docs serve) with an index of portfolio_docs.
//   Env: DEMO_URL (the real app, default http://127.0.0.1:8000/), DEMO_THEME (dark or light, default dark).
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2];
const STREAMS = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const APP = process.env.DEMO_URL || 'http://127.0.0.1:8000/';
const THEME = process.env.DEMO_THEME === 'light' ? 'light' : 'dark';
const W = 390, H = 924, BAR = 80, S = 2;   // phone size in CSS px (incl. caption strip), strip height, zoom

const OVERLAY = `
(() => {
  const setup = () => {
    const meta = document.querySelector('meta[name=viewport]');
    if (meta) meta.setAttribute('content', 'width=${W}');
    const style = document.createElement('style');
    style.textContent = \`
      html{padding-top:${BAR}px}
      .top{top:${BAR}px !important}
      .app{min-height:calc(100dvh - ${BAR}px) !important}
      .turn{scroll-margin-top:${BAR + 68}px !important}
      #__bar{position:fixed;top:0;left:0;right:0;height:${BAR}px;box-sizing:border-box;background:#3f4bde;color:#fff;display:flex;
        align-items:center;padding:0 18px;font:600 15.5px/1.32 "Instrument Sans",system-ui,sans-serif;z-index:2147483646}
      #__cap{transition:opacity .3s;opacity:0;flex:1}
      #__finger{position:fixed;left:200px;top:500px;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;pointer-events:none;
        z-index:2147483647;background:rgba(255,255,255,.28);border:2px solid rgba(255,255,255,.85);box-shadow:0 2px 10px rgba(0,0,0,.35);
        transition:left .42s cubic-bezier(.3,.7,.2,1),top .42s cubic-bezier(.3,.7,.2,1),transform .12s;opacity:0}
      #__finger.on{opacity:1}
      #__finger.down{transform:scale(.72);background:rgba(255,255,255,.5)}
      #__finger.slow{transition:left .9s ease-in-out,top .9s ease-in-out,transform .12s}\`;
    document.head.appendChild(style);
    const bar = document.createElement('div'); bar.id = '__bar';
    bar.innerHTML = '<span id="__cap"></span>';
    document.body.appendChild(bar);
    const f = document.createElement('div'); f.id = '__finger'; document.body.appendChild(f);
    const c = document.getElementById('__cap');
    window.__cap = (t) => { c.style.opacity = 0; setTimeout(() => { c.textContent = t || ''; c.style.opacity = t ? 1 : 0; }, 200); };
    window.__move = (x, y) => { f.classList.add('on'); f.classList.remove('slow'); f.style.left = x + 'px'; f.style.top = y + 'px'; };
    window.__swipe = (x1, y, x2) => { f.classList.add('on'); f.classList.remove('slow'); f.style.left = x1 + 'px'; f.style.top = y + 'px';
      setTimeout(() => { f.classList.add('down', 'slow'); f.style.left = x2 + 'px'; }, 450); setTimeout(() => f.classList.remove('down'), 1450); };
    window.__down = () => f.classList.add('down');
    window.__up = () => f.classList.remove('down');
    window.__hideFinger = () => f.classList.remove('on');
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', setup); else setup();
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Forwards everything to the real app, except POST /api/ask, which replays a captured answer
// with its original timing.
function startProxy(target) {
  const to = new URL(target);
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/ask') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const events = STREAMS[(JSON.parse(body).question || '').trim()];
        if (!events) { res.writeHead(404); return res.end('no captured answer for this question'); }
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-cache' });
        events.forEach((e) => setTimeout(() => res.write(e.line + '\n'), e.t * 1000));
        setTimeout(() => res.end(), events[events.length - 1].t * 1000 + 50);
      });
      return;
    }
    const upstream = http.request({ host: to.hostname, port: to.port, path: req.url, method: req.method, headers: req.headers },
      (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    req.pipe(upstream);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const proxy = await startProxy(APP);
  const appUrl = 'http://127.0.0.1:' + proxy.address().port + '/';
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: W * S, height: H * S }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, colorScheme: THEME,
    recordVideo: { dir: OUT, size: { width: W * S, height: H * S } },
  });
  await context.addInitScript(OVERLAY);
  const t0 = Date.now();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(appUrl);
  await page.waitForSelector('.examples button');
  await sleep(500);

  const now = () => (Date.now() - t0) / 1000;
  const cap = (t) => { if (t) console.log(now().toFixed(1) + 's  ' + t); return page.evaluate((x) => window.__cap(x), t); };
  const loc = (sel) => page.locator(sel).first();
  const answered = () => page.waitForFunction(
    () => /^Answered/.test(document.querySelector('.turn:last-of-type .status span:last-child')?.textContent || ''), null, { timeout: 120000 });
  const scrollPage = (to) => page.evaluate((v) => window.scrollTo({ top: v === 'end' ? document.documentElement.scrollHeight : v, behavior: 'smooth' }), to);
  const rectOf = (selector) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height }; }, selector);

  async function tap(selector) {
    await loc(selector).scrollIntoViewIfNeeded();
    const r = await rectOf(selector);
    await page.evaluate(([a, b]) => window.__move(a, b), [r.x + r.w / 2, r.y + r.h / 2]);
    await sleep(520);
    await page.evaluate(() => window.__down());
    await sleep(110);
    await loc(selector).tap();
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
  await page.waitForSelector('.src');
  await sleep(2600);
  await cap('…then a local AI model writes the answer using only those passages, and cites them.');
  await answered();
  await scrollPage('end');
  await sleep(3800);

  // ---- 4. swipe through the passages
  await cap('Swipe through the passages it found. The ones the answer cited are marked.');
  await page.evaluate(() => document.querySelector('.turn .rail').scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await sleep(1300);
  const rail = await rectOf('.turn .rail');
  await page.evaluate(([x1, y, x2]) => window.__swipe(x1, y, x2), [rail.x + rail.w - 40, rail.y + rail.h / 2, rail.x + 60]);
  await page.evaluate(() => setTimeout(() => document.querySelector('.turn .rail').scrollTo({ left: 300, behavior: 'smooth' }), 480));
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
  await page.waitForSelector('.turn .src');
  await answered();
  await scrollPage('end');
  await cap('…and it says so, instead of making something up.');
  await sleep(5200);

  // ---- 7. a PDF: the answer cites the page
  await cap('It reads PDFs too, and cites the page. A sample policy PDF is indexed here next to the notes.');
  await tap('#new-chat');
  await sleep(1400);
  await tap('#question');
  await loc('#question').pressSequentially('What is the meal allowance while travelling?', { delay: 62 });
  await sleep(800);
  await tap('#submit');
  await page.waitForSelector('.turn .src');
  await answered();
  await page.evaluate(() => document.querySelector('.turn .rail').scrollIntoView({ block: 'center', behavior: 'smooth' }));
  await sleep(1200);
  await cap('The passage card shows its page: p. 2 of the PDF.');
  await sleep(4200);
  await scrollPage('end');
  await sleep(900);
  await cap('Tap the citation to read that page.');
  await tap('.answer .cite');
  await sleep(4800);
  await tap('#sheet-close');
  await sleep(700);

  // ---- 8. options
  await cap('Options: choose how many passages to read, or show only the passages.');
  await tap('#opt-btn');
  await sleep(4200);
  await tap('#opt-btn');
  await sleep(700);

  // ---- 9. themes, and the disclosure
  await cap('It follows your phone’s light or dark setting.');
  await page.emulateMedia({ colorScheme: THEME === 'dark' ? 'light' : 'dark' });
  await sleep(3600);
  await page.evaluate(() => window.__hideFinger());
  await cap('Private, cited and open source: Ask My Docs.');
  await sleep(2800);
  await cap('The answers in this video were captured from a real run of the model and replayed, so that recording does not slow it down.');
  await sleep(5200);
  await cap('');
  await sleep(500);

  const video = page.video();
  await context.close();
  console.log('VIDEO', await video.path(), 'errors:', JSON.stringify(errors));
  await browser.close();
  proxy.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
