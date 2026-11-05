// Records a phone-sized demo of Runway in a real browser. EVERYTHING in the video is live: the app runs
// for real, on its own SQLite database in WebAssembly, and every tap and typed value is performed by this
// script against the real page. (Nothing is replayed or faked; typing speed and the pause lengths are chosen
// so the video is readable.) A caption strip and a finger that shows taps are injected for the video only,
// because headless browsers draw neither.
//
// Sharpness: Playwright's video recorder ignores deviceScaleFactor and leaves the rest of its canvas grey,
// so this uses a phone-emulated browser with a 780x1848 viewport and a meta viewport of "width=390". The app lays
// out at 390 CSS pixels (a phone) while the page is zoomed 2x, like a pinch-zoom, which fills the frame sharply.
//
// Usage: node scripts/demo/record_demo.mjs <output-dir> [app-url]     (the app must be served, e.g. `npx vite preview --port 4180`)
import { chromium } from '@playwright/test';

const OUT = process.argv[2];
const APP = process.argv[3] ?? 'http://127.0.0.1:4180/';
const THEME = process.env.DEMO_THEME === 'dark' ? 'dark' : 'light';
const W = 390, H = 924, BAR = 80, S = 2;

const OVERLAY = `
(() => {
  const setup = () => {
    const meta = document.querySelector('meta[name=viewport]');
    if (meta) meta.setAttribute('content', 'width=${W}');
    const style = document.createElement('style');
    style.textContent = \`
      html{padding-top:${BAR}px}
      #__bar{position:fixed;top:0;left:0;right:0;height:${BAR}px;box-sizing:border-box;background:#14295f;color:#fff;display:flex;direction:ltr;text-align:left;
        align-items:center;padding:0 18px;font:600 15.5px/1.32 "DM Sans",system-ui,sans-serif;z-index:2147483646}
      #__cap{transition:opacity .3s;opacity:0;flex:1}
      #__finger{position:fixed;left:200px;top:500px;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;pointer-events:none;
        z-index:2147483647;background:rgba(0,0,0,.14);border:2px solid rgba(255,255,255,.9);box-shadow:0 2px 10px rgba(0,0,0,.4);
        transition:left .42s cubic-bezier(.3,.7,.2,1),top .42s cubic-bezier(.3,.7,.2,1),transform .12s;opacity:0}
      #__finger.on{opacity:1}
      #__finger.down{transform:scale(.72);background:rgba(0,0,0,.32)}\`;
    document.head.appendChild(style);
    const bar = document.createElement('div'); bar.id = '__bar';
    bar.innerHTML = '<span id="__cap"></span>';
    document.body.appendChild(bar);
    const f = document.createElement('div'); f.id = '__finger'; document.body.appendChild(f);
    const c = document.getElementById('__cap');
    window.__cap = (t) => { c.style.opacity = 0; setTimeout(() => { c.textContent = t || ''; c.style.opacity = t ? 1 : 0; }, 200); };
    window.__move = (x, y) => { f.classList.add('on'); f.style.left = x + 'px'; f.style.top = y + 'px'; };
    window.__down = () => f.classList.add('down');
    window.__up = () => f.classList.remove('down');
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', setup); else setup();
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
await page.goto(APP);
await page.getByRole('heading', { name: /Money runs out/ }).waitFor();
await sleep(600);

const now = () => ((Date.now() - t0) / 1000).toFixed(1);
const cap = (t) => { if (t) console.log(`${now()}s  ${t}`); return page.evaluate((x) => window.__cap(x), t); };
const scrollTo = (to) => page.evaluate((v) => window.scrollTo({ top: v === 'end' ? document.documentElement.scrollHeight : v, behavior: 'smooth' }), to);

async function tap(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  // boundingBox is in layout pixels of the 2x zoomed page; the overlay works in CSS pixels
  const x = box.x / S + box.width / S / 2 + 0, y = box.y / S + box.height / S / 2;
  await page.evaluate(([a, b]) => window.__move(a, b), [x, y]);
  await sleep(520);
  await page.evaluate(() => window.__down());
  await sleep(110);
  await locator.tap();
  await sleep(140);
  await page.evaluate(() => window.__up());
}
async function type(locator, text) {
  await tap(locator);
  await locator.fill('');
  await locator.pressSequentially(text, { delay: 110 });
  await sleep(300);
}
const dialog = () => page.getByRole('dialog');

// ---- 1. the answer
await cap('Runway: a cash-flow forecast. It runs in your browser and nothing is uploaded.');
await sleep(4200);
await cap('It opens on example data for a small shop. The answer is at the top: money runs out on Mar 28.');
await sleep(5200);
await scrollTo(380);
await sleep(900);
await cap('The chart steps down on the day each payment happens. The dot marks the lowest point.');
await sleep(5000);
await scrollTo(0);
await sleep(700);

// ---- 2. what if
await cap('What if the new van is postponed? Switch it off.');
await sleep(2400);
await scrollTo('end');
await page.evaluate(() => document.querySelector('.items')?.scrollIntoView({ block: 'center' }));
await sleep(800);
const van = page.getByRole('checkbox', { name: 'Include New van' });
await tap(van);
await sleep(700);
await scrollTo(0);
await cap('The headline changes at once: it stays above zero for the whole year.');
await sleep(4800);
await page.evaluate(() => document.querySelector('.items')?.scrollIntoView({ block: 'center' }));
await tap(van);
await sleep(600);
await scrollTo(0);
await cap('Switch it back on. Nothing is deleted; the item was only left out.');
await sleep(3600);

// ---- 3. add an item
await cap('Add something new: a delivery bike, paid once.');
await sleep(2200);
await page.evaluate(() => document.querySelector('.row-head')?.scrollIntoView({ block: 'center' }));
await sleep(700);
await tap(page.getByRole('button', { name: 'Add item' }));
await dialog().waitFor();
await sleep(900);
await tap(dialog().getByRole('radio', { name: 'Money out' }).locator('..'));
await type(page.locator('#f-name'), 'Delivery bike');
await type(page.locator('#f-amount'), '1800');
await page.locator('#f-every').selectOption('once');
await sleep(700);
await page.locator('#f-start').fill('2027-01-12');
await sleep(900);
await cap('A name, an amount, how often, and a date. Amounts are checked before saving.');
await sleep(4200);
await tap(dialog().getByRole('button', { name: 'Save' }));
await sleep(900);
await page.evaluate(() => document.querySelector('.items')?.scrollIntoView({ block: 'end' }));
await cap('It joins the list straight away, and the forecast is recalculated.');
await sleep(3800);
await scrollTo(0);
await sleep(900);
await cap('The runway is shorter now: the bike made the dip arrive sooner.');
await sleep(4200);

// ---- 4. months and data
await page.evaluate(() => document.getElementById('m-h')?.scrollIntoView({ block: 'start' }));
await sleep(800);
await cap('Month by month: money in, money out, and the balance at the end of each month.');
await sleep(5200);
await page.evaluate(() => document.getElementById('d-h')?.scrollIntoView({ block: 'center' }));
await sleep(800);
await cap('Your data stays in this browser. Download a backup, or the whole forecast as a CSV.');
await sleep(5200);
await scrollTo(0);
await sleep(800);
await cap('Runway: TypeScript and React. 28 unit tests and 14 browser tests. No backend.');
await sleep(4800);

await context.close();
await browser.close();
console.log(errors.length ? 'page errors: ' + errors.join(' | ') : 'page errors: none');
