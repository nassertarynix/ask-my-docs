import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const API = 'http://127.0.0.1:8765';
const TOKEN = 'e2e-token-0123456789abcdef';
const CHUNK = 64 * 1024;

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const bytes = (n, seed = 5) => Buffer.from(Array.from({ length: n }, (_, i) => (i * seed + (i >> 8)) % 256));
const api = (path, init = {}) => fetch(`${API}${path}`, { ...init, headers: { 'X-TGCS-Token': TOKEN, 'Content-Type': 'application/json', ...init.headers } }).then((r) => r.json());

test.beforeEach(async ({ page, request }) => {
  // start every test from an empty library
  const root = await api('/api/folders');
  await api('/api/items', { method: 'DELETE', body: JSON.stringify({ file_ids: root.files.map((f) => f.id), folder_ids: root.folders.map((f) => f.id) }) });
  await page.goto(`/?api=${encodeURIComponent(API)}&token=${TOKEN}`);
  await expect(page.getByText('This folder is empty')).toBeVisible();
  void request;
});

const table = (page) => page.getByRole('table', { name: 'Files and folders' });

test('shows the empty state, then creates a folder and navigates into it and back', async ({ page }) => {
  await page.getByRole('button', { name: 'New folder' }).click();
  await page.getByLabel('Folder name').fill('Photos');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(table(page).getByRole('button', { name: 'Photos', exact: true })).toBeVisible();
  await expect(page.getByRole('tree').getByText('Photos')).toBeVisible();

  await table(page).getByRole('button', { name: 'Photos', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Location' })).toContainText('Photos');
  await expect(page.getByText('This folder is empty')).toBeVisible();

  await page.getByRole('button', { name: 'Up one level' }).click();
  await expect(table(page).getByRole('button', { name: 'Photos', exact: true })).toBeVisible();
});

test('a duplicate or invalid folder name is explained and the dialog stays open', async ({ page }) => {
  for (const name of ['Docs', 'docs', 'a/b']) {
    await page.getByRole('button', { name: 'New folder' }).click();
    await page.getByLabel('Folder name').fill(name);
    await page.getByRole('button', { name: 'Create' }).click();
    if (name === 'Docs') await expect(table(page).getByText('Docs', { exact: true })).toBeVisible();
    else {
      await expect(page.getByRole('alert')).toBeVisible();
      await page.getByRole('button', { name: 'Cancel' }).click();
    }
  }
});

test('uploads a multi-chunk file with live progress, then downloads it byte for byte', async ({ page }) => {
  const body = bytes(4 * CHUNK + 1234);
  await page.getByLabel('Choose files to upload').setInputFiles({ name: 'big report.pdf', mimeType: 'application/pdf', buffer: body });
  const panel = page.getByRole('dialog', { name: 'Transfers' });
  await expect(panel.getByRole('progressbar', { name: 'big report.pdf progress' })).toHaveAttribute('aria-valuenow', '100', { timeout: 20_000 });
  await expect(panel.getByText('Uploaded')).toBeVisible();
  await panel.getByRole('button', { name: 'Done' }).click();

  const row = table(page).getByRole('row', { name: /big report.pdf/ });
  await expect(row).toContainText('PDF file');
  await expect(row).toContainText('257 KB');

  await row.click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download selected files' }).click()]);
  expect(download.suggestedFilename()).toBe('big report.pdf');
  expect(sha(readFileSync(await download.path()))).toBe(sha(body));
});

test('dropping files on the window shows the drop zone and uploads them', async ({ page }) => {
  const dataTransfer = await page.evaluateHandle(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(70000).fill(7)], 'dropped.bin', { type: 'application/octet-stream' }));
    return dt;
  });
  await page.dispatchEvent('main', 'dragenter', { dataTransfer });
  await expect(page.getByText('Drop files to upload')).toBeVisible();
  await page.dispatchEvent('main', 'drop', { dataTransfer });
  await expect(page.getByText('Drop files to upload')).toBeHidden();
  const panel = page.getByRole('dialog', { name: 'Transfers' });
  await expect(panel.getByRole('progressbar', { name: 'dropped.bin progress' })).toHaveAttribute('aria-valuenow', '100', { timeout: 20_000 });
  await panel.getByRole('button', { name: 'Done' }).click();
  await expect(table(page).getByText('dropped.bin')).toBeVisible();
});

test('a file with the same name is kept as "name (1)", not refused', async ({ page }) => {
  const upload = async (text) => {
    await page.getByLabel('Choose files to upload').setInputFiles({ name: 'same.txt', mimeType: 'text/plain', buffer: Buffer.from(text) });
    const panel = page.getByRole('dialog', { name: 'Transfers' });
    await expect(panel.getByText('Uploaded').first()).toBeVisible({ timeout: 20_000 });
    await panel.getByRole('button', { name: 'Done' }).click();
  };
  await upload('one');
  await page.reload();
  await upload('two');
  await expect(table(page).getByText('same (1).txt')).toBeVisible();
});

test('deleting asks first, then removes the file and its chunks', async ({ page }) => {
  await page.getByLabel('Choose files to upload').setInputFiles({ name: 'doomed.bin', mimeType: 'application/octet-stream', buffer: bytes(3 * CHUNK) });
  await expect(page.getByRole('dialog', { name: 'Transfers' }).getByText('Uploaded')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  expect((await api('/api/status')).stats.files).toBe(1);

  await page.getByRole('checkbox', { name: 'Select doomed.bin' }).check();
  await page.getByRole('button', { name: 'Delete selected items' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm).toContainText('also removed from your Telegram channel');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(table(page).getByText('doomed.bin')).toBeVisible(); // cancelling deletes nothing

  await page.getByRole('button', { name: 'Delete selected items' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('This folder is empty')).toBeVisible();
  expect((await api('/api/status')).stats.files).toBe(0);
});

test('sorting by size and searching narrow the list', async ({ page }) => {
  for (const [name, size] of [['small.txt', 10], ['large.txt', 5000], ['medium.txt', 300]]) {
    await api(`/api/upload?name=${name}`, { method: 'POST', body: Buffer.alloc(size, 1), headers: { 'Content-Type': 'application/octet-stream' } }).catch(() => {});
  }
  await page.reload();
  const names = async () => (await table(page).locator('tbody tr td:nth-child(2)').allInnerTexts()).map((t) => t.trim());
  await expect.poll(names).toEqual(['large.txt', 'medium.txt', 'small.txt']);
  await page.getByRole('button', { name: 'Size' }).click();
  await expect.poll(names).toEqual(['small.txt', 'medium.txt', 'large.txt']);
  await page.getByRole('button', { name: 'Size' }).click();
  await expect.poll(names).toEqual(['large.txt', 'medium.txt', 'small.txt']);
  await page.getByPlaceholder('Search this folder').fill('med');
  await expect.poll(names).toEqual(['medium.txt']);
  await page.getByPlaceholder('Search this folder').fill('zzz');
  await expect(page.getByText('Nothing matches your search')).toBeVisible();
});

test('keyboard: select all with Ctrl+A, Delete opens the confirmation, Escape clears the selection', async ({ page }) => {
  for (const name of ['a.txt', 'b.txt']) await api(`/api/upload?name=${name}`, { method: 'POST', body: Buffer.from(name), headers: { 'Content-Type': 'application/octet-stream' } });
  await page.reload();
  await expect(table(page).getByText('b.txt')).toBeVisible();
  await page.keyboard.press('Control+a');
  await expect(page.getByText('2 selected')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('2 selected')).toBeHidden();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  await expect(page.getByRole('dialog', { name: 'Delete 2 items?' })).toBeVisible();
});

test('the app makes no requests to any site except the local backend', async ({ page }) => {
  const foreign = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('http://127.0.0.1:1420') && !u.startsWith(API) && !u.startsWith('ws://127.0.0.1:8765') && !u.startsWith('data:') && !u.startsWith('blob:')) foreign.push(u);
  });
  await page.reload();
  await page.getByRole('button', { name: 'Connection settings. Local test storage' }).click();
  await expect(page.getByRole('dialog', { name: 'Connect Telegram' })).toBeVisible();
  expect(foreign).toEqual([]);
});

test('the layout never scrolls sideways, even in a narrow window', async ({ page }) => {
  await api('/api/upload?name=' + encodeURIComponent('a very long file name that goes on and on and on and on and on.txt'), { method: 'POST', body: Buffer.from('x'), headers: { 'Content-Type': 'application/octet-stream' } });
  for (const width of [640, 900, 1280]) {
    await page.setViewportSize({ width, height: 700 });
    await page.reload();
    await expect(table(page)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `width ${width}`).toBeLessThanOrEqual(0);
  }
});

test('the connection dialog explains the local test mode', async ({ page }) => {
  await page.getByRole('button', { name: 'Connection settings. Local test storage' }).click();
  const dialog = page.getByRole('dialog', { name: 'Connect Telegram' });
  await expect(dialog).toContainText('local folder standing in for the Telegram channel');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});
