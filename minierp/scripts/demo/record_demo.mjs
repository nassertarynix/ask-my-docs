// Records a phone-sized demo of MiniERP in a real browser. EVERYTHING in the video is live: the app runs
// for real, on its own SQLite database in WebAssembly, and every tap and typed value is performed by this
// script against the real page. (Nothing is replayed or faked; typing speed and the pause lengths are chosen
// so the video is readable.) A caption strip and a finger that shows taps are injected for the video only,
// because headless browsers draw neither.
//
// Sharpness: Playwright's video recorder ignores deviceScaleFactor and leaves the rest of its canvas grey,
// so this uses a phone-emulated browser with a 780x1848 viewport and a meta viewport of "width=390". The app lays
// out at 390 CSS pixels (a phone) while the page is zoomed 2x, like a pinch-zoom, which fills the frame sharply.
//
// Usage: node scripts/demo/record_demo.mjs <output-dir> [app-url]     (the app must be served, e.g. `npm run preview`)
import { chromium } from '@playwright/test';

const OUT = process.argv[2];
const APP = process.argv[3] ?? 'http://127.0.0.1:4173/';
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
      .shell{min-height:calc(100dvh - ${BAR}px) !important}
      #__bar{position:fixed;top:0;left:0;right:0;height:${BAR}px;box-sizing:border-box;background:#0b6b5d;color:#fff;display:flex;direction:ltr;text-align:left;
        align-items:center;padding:0 18px;font:600 15.5px/1.32 "IBM Plex Sans",system-ui,sans-serif;z-index:2147483646}
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
await page.getByRole('button', { name: 'Load the demo business' }).waitFor();
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
const button = (name, opts = {}) => page.getByRole('button', { name, ...opts });
const dialog = () => page.getByRole('dialog');

// ---- 1. welcome
await cap('MiniERP: sales, stock, purchases, invoices and payments. It runs entirely in your browser on a real SQLite database.');
await sleep(5200);
await cap('No server and no account. Start with a demo business.');
await sleep(1800);
await tap(button('Load the demo business'));
await page.waitForSelector('.kpis');
await sleep(800);

// ---- 2. dashboard
await cap('The dashboard: sales over the last 30 days, what customers owe, what is overdue, stock value.');
await sleep(4800);
await scrollTo(520);
await sleep(1200);
await cap('A chart of sales and profit by month, and what needs attention today.');
await sleep(3800);
await scrollTo(1500);
await sleep(1200);
await cap('Receivables by how late they are, and the products running low.');
await sleep(3800);
await scrollTo(0);
await sleep(900);

// ---- 3. collect an overdue invoice
await cap('Let us collect on an overdue invoice. Tap the overdue total.');
await sleep(2200);
await tap(page.locator('a.kpi.alert'));
await page.waitForSelector('.row-link');
await sleep(1000);
await cap('Only the overdue invoices, with how many days late each one is.');
await sleep(3200);
await tap(page.locator('a.row-link').first());
await page.getByRole('heading', { level: 1 }).waitFor();
await sleep(1200);
await cap('The invoice keeps the totals it was issued with. Its status is worked out from the payments.');
await sleep(4200);
await scrollTo('end');
await sleep(800);
await tap(button('Record payment'));
await dialog().waitFor();
await sleep(900);
await cap('The amount starts at the balance. Paying more than is owed is refused.');
await sleep(3800);
await tap(dialog().getByRole('button', { name: 'Record payment' }));
await sleep(700);
await scrollTo(0);
await cap('Paid. The invoice is settled and the overdue total on the dashboard drops.');
await sleep(3800);

// ---- 4. a new sale, with a stock shortage
await cap('Now a new sale. Open Sales, then New sale.');
await sleep(1800);
await tap(page.locator('nav.tabbar').getByRole('link', { name: 'Sales', exact: true }));
await page.waitForSelector('.row-link');
await sleep(800);
await tap(page.getByRole('link', { name: 'New sale' }));
await page.getByLabel('Customer', { exact: true }).waitFor();
await sleep(700);
await page.getByLabel('Customer', { exact: true }).selectOption({ label: 'Cafe Damascus' });
await sleep(800);
await page.getByLabel('Product', { exact: true }).selectOption({ label: 'Aleppo laurel soap (SOAP-ALP)' });
await sleep(700);
await cap('Choosing a product fills in its current price and shows how many are in stock.');
await sleep(3800);
await type(page.getByLabel('Qty', { exact: true }), '40');
await cap('Asking for more than the stock on hand shows a warning straight away.');
await sleep(3800);
await tap(button('Save'));
await page.getByRole('button', { name: 'Deliver from stock' }).waitFor();
await sleep(900);
await cap('The draft is saved. Delivering takes goods out of stock, so it must be possible.');
await sleep(3400);
await tap(button('Deliver from stock'));
await sleep(1200);
await cap('Refused: not enough stock. Nothing was changed, no half-finished delivery.');
await sleep(4200);

// ---- 5. fix and deliver
await tap(page.getByRole('link', { name: 'Edit' }));
await page.getByLabel('Qty', { exact: true }).waitFor();
await sleep(600);
await type(page.getByLabel('Qty', { exact: true }), '5');
await tap(button('Save'));
await page.getByRole('button', { name: 'Deliver from stock' }).waitFor();
await sleep(800);
await tap(button('Deliver from stock'));
await sleep(900);
await cap('Delivered. The stock ledger now has a movement for it, and the cost of the goods is fixed on the order.');
await sleep(4600);
await tap(button('Create invoice'));
await page.getByRole('heading', { name: /^INV-/ }).waitFor();
await sleep(1000);
await cap('Invoice created, due after the payment terms. Tax is rounded per line.');
await sleep(4000);
await scrollTo('end');
await sleep(700);
await tap(button('Record payment'));
await dialog().waitFor();
await type(dialog().getByLabel('Amount'), '20');
await tap(dialog().getByRole('button', { name: 'Record payment' }));
await sleep(700);
await scrollTo(0);
await cap('A part payment: the invoice is now Part paid, with the balance still due.');
await sleep(4200);

// ---- 6. stock history and receiving goods
await cap('Stock on hand is never typed in. It is the sum of the stock ledger.');
await sleep(2400);
await tap(page.locator('nav.tabbar').getByRole('link', { name: 'Stock', exact: true }));
await page.waitForSelector('.row-link');
await sleep(800);
await tap(page.getByRole('link', { name: /Aleppo laurel soap/ }));
await page.getByText('Stock movements').waitFor();
await sleep(700);
await scrollTo(380);
await sleep(900);
await cap('Every delivery, receipt and adjustment, in order.');
await sleep(3800);
await scrollTo(0);
await tap(page.locator('nav.tabbar').getByRole('link', { name: 'More', exact: true }));
await sleep(600);
await tap(page.getByRole('link', { name: /Purchases/ }));
await page.waitForSelector('.row-link');
await sleep(700);
await cap('Purchases: an order on its way from a supplier. Receiving it adds stock and updates the average cost.');
await sleep(4200);
await tap(page.locator('a.row-link').first());
await page.getByRole('button', { name: 'Receive goods' }).waitFor();
await sleep(1000);
await tap(button('Receive goods'));
await sleep(900);
await cap('Goods received. Stock went up and each product’s weighted average cost was recalculated.');
await sleep(4400);

// ---- 7. Arabic
await tap(page.locator('nav.tabbar').getByRole('link', { name: 'More', exact: true }));
await sleep(500);
await cap('The whole app is also in Arabic, mirrored right to left.');
await sleep(2400);
await tap(button('العربية'));
await sleep(1500);
await tap(page.locator('nav.tabbar a').first());
await page.waitForSelector('.kpis');
await sleep(1200);
await cap('Arabic and right-to-left: same data, mirrored layout.');
await sleep(4200);
await scrollTo(520);
await sleep(2400);
await scrollTo(0);
await tap(page.locator('nav.tabbar a').last());
await sleep(500);
await tap(button('English'));
await sleep(900);

// ---- 8. data
await cap('Your data stays in this browser. You can download it as a real SQLite file and restore it later.');
await sleep(2600);
await tap(page.getByRole('link', { name: /Data & settings/ }));
await page.getByRole('button', { name: /Download database/ }).waitFor();
await sleep(1500);
await scrollTo(260);
await sleep(3600);
await cap('MiniERP: TypeScript, React and SQLite in WebAssembly. 66 unit tests and 21 browser tests. No backend.');
await sleep(5400);
await cap('');
await sleep(600);

console.log('page errors:', errors.length ? errors : 'none');
await context.close();
await browser.close();
