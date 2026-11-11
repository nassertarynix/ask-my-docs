// Records a desktop-sized demo of the real app. EVERYTHING in the video is live: the real backend and the real UI, every click and
// keystroke performed by this script. Nothing is replayed. IMPORTANT: the backend runs with a local folder standing in for the
// Telegram channel (and a speed limit so progress is visible); this is NOT real Telegram, and the closing caption says so.
//
// A caption bar and a cursor are injected for the video only (headless browsers draw neither).
//
// Usage: node scripts/demo/record_demo.mjs <output-dir> [frontend-url] [api-url] [token]
// Needs: the backend running with TGCS_BACKEND=local TGCS_CHUNK_MB=1 TGCS_LOCAL_THROTTLE_KBPS=1500 (and seeded by scripts/seed_demo.py),
//        and `npx vite preview --port 1420`.
import { chromium } from '@playwright/test';

const OUT = process.argv[2];
const FRONT = process.argv[3] ?? 'http://127.0.0.1:1420/';
const API = process.argv[4] ?? 'http://127.0.0.1:8765';
const TOKEN = process.argv[5] ?? 'demo-token-0123456789abcdef';
const W = 1280, H = 800, BAR = 64;

const OVERLAY = `
(() => {
  const setup = () => {
    const style = document.createElement('style');
    style.textContent = \`
      #root{height:calc(100% - ${BAR}px) !important}
      .fixed.bottom-10{bottom:${BAR + 24}px !important}
      #__bar{position:fixed;left:0;right:0;bottom:0;height:${BAR}px;box-sizing:border-box;background:#0e7490;color:#fff;display:flex;align-items:center;
        padding:0 28px;font:600 18px/1.3 'Inter Variable',Inter,system-ui,sans-serif;z-index:2147483646}
      #__cap{transition:opacity .3s;opacity:0}
      #__cur{position:fixed;left:-60px;top:-60px;width:24px;height:24px;border-radius:50%;border:2px solid #fff;background:rgba(14,116,144,.4);
        box-shadow:0 2px 10px rgba(0,0,0,.45);pointer-events:none;z-index:2147483647;transform:translate(-50%,-50%);transition:transform .1s}
      #__cur.down{transform:translate(-50%,-50%) scale(.7);background:rgba(14,116,144,.75)}\`;
    document.head.appendChild(style);
    const bar = document.createElement('div'); bar.id = '__bar'; bar.innerHTML = '<span id="__cap"></span>'; document.body.appendChild(bar);
    const cur = document.createElement('div'); cur.id = '__cur'; document.body.appendChild(cur);
    addEventListener('mousemove', (e) => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', () => cur.classList.add('down'), true);
    addEventListener('mouseup', () => cur.classList.remove('down'), true);
    const c = document.getElementById('__cap');
    window.__cap = (t) => { c.style.opacity = 0; setTimeout(() => { c.textContent = t || ''; c.style.opacity = t ? 1 : 0; }, 200); };
  };
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', setup); else setup();
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: OUT, size: { width: W, height: H } }, acceptDownloads: true });
await context.addInitScript(OVERLAY);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const t0 = Date.now();
const cap = (t) => { if (t) console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s  ${t}`); return page.evaluate((x) => window.__cap(x), t); };

async function point(locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
  await sleep(250);
}
async function click(locator) {
  await point(locator);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
}
async function type(locator, text) {
  await click(locator);
  await locator.pressSequentially(text, { delay: 85 });
  await sleep(300);
}

const table = page.getByRole('table', { name: 'Files and folders' });
const transfers = page.getByRole('dialog', { name: 'Transfers' });
const bytes = (n) => { const b = Buffer.allocUnsafe(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + (i >> 9)) % 251; return b; };

await page.goto(`${FRONT}?api=${encodeURIComponent(API)}&token=${TOKEN}`);
await table.waitFor();
await sleep(500);

// ---- 1. the library
await cap('Telegram Cloud Storage: a file manager whose storage is a private Telegram channel.');
await sleep(5200);
await cap('A local SQLite index remembers where every piece of every file is. Folders are virtual, so moving around is instant.');
await sleep(6200);
await click(table.getByRole('button', { name: 'Documents', exact: true }));
await page.getByText('Quarterly report Q3.pdf').waitFor();
await sleep(900);
await cap('Open a folder from the table or the tree. Sizes, types and upload times come from the index.');
await sleep(4800);
await click(table.getByRole('button', { name: 'Contracts', exact: true }));
await page.getByText('Lease agreement 2026.pdf').waitFor();
await sleep(1200);
await click(page.getByRole('navigation', { name: 'Location' }).getByRole('button', { name: 'My files' }));
await sleep(900);

// ---- 2. a new folder
await cap('Create a folder. It exists only in the index; nothing is sent to Telegram.');
await sleep(2400);
await click(page.getByRole('button', { name: 'New folder' }));
await page.getByLabel('Folder name').waitFor();
await type(page.getByLabel('Folder name'), 'Receipts 2026');
await sleep(500);
await click(page.getByRole('button', { name: 'Create' }));
await table.getByRole('button', { name: 'Receipts 2026', exact: true }).waitFor();
await sleep(900);
await click(table.getByRole('button', { name: 'Receipts 2026', exact: true }));
await page.getByText('This folder is empty').waitFor();
await sleep(1500);

// ---- 3. upload with progress
await cap('Upload a file. It is hashed, split into 1 MB pieces here (20 MB by default) and sent piece by piece.');
await sleep(3600);
const chooser = page.waitForEvent('filechooser');
await click(page.getByRole('button', { name: 'Upload', exact: true }));
await (await chooser).setFiles({ name: 'Project backup.zip', mimeType: 'application/zip', buffer: bytes(8 * 1024 * 1024 + 4321) });
await transfers.waitFor();
await cap('Each part carries a caption with the file id, part number and checksums, so the index can be rebuilt from the channel alone.');
await transfers.getByText('Uploaded').waitFor({ timeout: 90_000 });
await sleep(1500);
await click(transfers.getByRole('button', { name: 'Done' }));
await sleep(700);

// ---- 4. drag and drop
await cap('Or drag files anywhere into the window.');
await sleep(2000);
const dt = await page.evaluateHandle(() => {
  const d = new DataTransfer();
  d.items.add(new File([new Uint8Array(180_000).fill(65)], 'Meeting recording notes.txt', { type: 'text/plain' }));
  return d;
});
await page.mouse.move(640, 380, { steps: 20 });
await page.dispatchEvent('main', 'dragenter', { dataTransfer: dt });
await sleep(2600);
await page.dispatchEvent('main', 'drop', { dataTransfer: dt });
await transfers.getByText('Uploaded').first().waitFor({ timeout: 60_000 });
await sleep(1300);
await click(transfers.getByRole('button', { name: 'Done' }));
await sleep(900);

// ---- 5. download and verify
await cap('Download: the parts are fetched in order and the whole file is checked against its SHA-256 before it is handed over.');
await sleep(1800);
const saved = page.waitForEvent('download').catch(() => null);
await click(table.getByRole('row', { name: /Project backup.zip/ }));
await sleep(500);
await click(page.getByRole('button', { name: 'Download selected files' }));
await transfers.waitFor();
await transfers.getByText('Downloaded').waitFor({ timeout: 90_000 });
await saved;
await sleep(1800);
await click(transfers.getByRole('button', { name: 'Done' }));
await sleep(800);

// ---- 6. delete
await cap('Delete removes the records and the Telegram messages. It asks first.');
await sleep(2200);
await page.keyboard.press('Control+a');
await sleep(500);
await click(page.getByRole('button', { name: 'Delete selected items' }));
await page.getByRole('dialog').waitFor();
await sleep(3200);
await click(page.getByRole('dialog').getByRole('button', { name: 'Delete' }));
await page.getByText('This folder is empty').waitFor();
await sleep(1800);

// ---- 7. connection
await cap('In real use, this is where you connect your Telegram account and channel.');
await sleep(2000);
await click(page.getByRole('button', { name: /Connection settings/ }));
await page.getByRole('dialog').waitFor();
await sleep(1200);
await cap('This recording uses a local folder in place of the channel, so it shows the app, not Telegram itself.');
await sleep(6500);
await click(page.getByRole('dialog').getByRole('button', { name: 'Close' }));
await sleep(900);
await cap('Backend: 124 tests. Interface: 15 unit and 11 browser tests. The Telegram layer is tested with a fake client, not real Telegram.');
await sleep(7000);

await context.close();
await browser.close();
console.log(errors.length ? 'page errors: ' + errors.join(' | ') : 'page errors: none');
