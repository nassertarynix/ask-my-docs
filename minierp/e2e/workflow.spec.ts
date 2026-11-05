import { expect, test, Page } from '@playwright/test';

const startEmpty = async (page: Page) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start with an empty business' }).click();
};
const openTab = async (page: Page, name: string) => {
  const nav = page.viewportSize()!.width >= 960 ? page.getByRole('complementary') : page.locator('nav.tabbar');
  await nav.getByRole('link', { name, exact: true }).click();
};

test('the whole order-to-cash workflow, from an empty business', async ({ page }) => {
  await startEmpty(page);

  // a product with opening stock
  await openTab(page, 'Stock');
  await page.locator('header').getByRole('button', { name: 'New product' }).click();
  await page.getByLabel('Name').fill('Aleppo soap');
  await page.getByLabel('SKU').fill('SOAP');
  await page.getByLabel('Sell price').fill('10');
  await page.getByLabel('Tax %').fill('15');
  await page.getByLabel('Opening stock').fill('10');
  await page.getByLabel('Cost per unit').fill('4');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Aleppo soap')).toBeVisible();

  // a sale for a customer created on the spot
  await page.goto('#/sales/new');
  await page.getByRole('button', { name: 'New customer' }).click();
  await page.getByLabel('Name').fill('Cafe Damascus');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByLabel('Product').selectOption({ label: 'Aleppo soap (SOAP)' });
  await expect(page.getByLabel('Unit price')).toHaveValue('10.00');
  await page.getByLabel('Qty').fill('3');
  await expect(page.getByText('$34.50').first()).toBeVisible(); // 3 x 10.00 + 15 % tax
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: /^SO-\d{4}-0001$/ })).toBeVisible();

  // deliver: stock goes 10 -> 7
  await page.getByRole('button', { name: 'Deliver from stock' }).click();
  await expect(page.getByText('Delivered. Stock updated.')).toBeVisible();
  await page.goto('#/stock');
  await expect(page.getByRole('link', { name: /Aleppo soap/ })).toContainText('7');

  // invoice and pay in two parts
  await page.goto('#/sales');
  await page.getByRole('link', { name: /Cafe Damascus/ }).click();
  await page.getByRole('button', { name: 'Create invoice' }).click();
  await expect(page.getByRole('heading', { name: /^INV-\d{4}-0001$/ })).toBeVisible();
  await expect(page.getByText('Unpaid').first()).toBeVisible();

  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByLabel('Amount').fill('10');
  await page.getByRole('button', { name: 'Record payment' }).last().click();
  await expect(page.getByText('Part paid').first()).toBeVisible();

  // paying more than is owed is refused with a clear message
  await page.getByRole('button', { name: 'Record payment' }).click();
  await page.getByLabel('Amount').fill('999');
  await page.getByRole('button', { name: 'Record payment' }).last().click();
  await expect(page.getByText(/more than the \$24\.50 still owed/)).toBeVisible();
  await page.getByLabel('Amount').fill('24.50');
  await page.getByRole('button', { name: 'Record payment' }).last().click();
  await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
});

test('stock shortage stops a delivery and changes nothing', async ({ page }) => {
  await startEmpty(page);
  await page.goto('#/stock');
  await page.locator('header').getByRole('button', { name: 'New product' }).click();
  await page.getByLabel('Name').fill('Olive oil');
  await page.getByLabel('SKU').fill('OIL');
  await page.getByLabel('Sell price').fill('20');
  await page.getByLabel('Opening stock').fill('2');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();

  await page.goto('#/sales/new');
  await page.getByRole('button', { name: 'New customer' }).click();
  await page.getByLabel('Name').fill('Big Buyer');
  await page.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
  await page.getByLabel('Product').selectOption({ label: 'Olive oil (OIL)' });
  await page.getByLabel('Qty').fill('5');
  await expect(page.getByText('Only 2 in stock')).toBeVisible();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Not enough stock to deliver this order')).toBeVisible();
  await page.getByRole('button', { name: 'Deliver from stock' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Not enough Olive oil' })).toBeVisible();
  await expect(page.getByText('Draft', { exact: true }).first()).toBeVisible();
});

test('data survives a reload (it is saved in the browser)', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Load the demo business' }).click();
  await expect(page.getByRole('heading', { name: 'Levant Pantry Co.' })).toBeVisible();
  await expect(page.getByText('Saved on this device').or(page.getByText('Saving'))).toBeAttached();
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Levant Pantry Co.' })).toBeVisible();
});

test('the downloaded backup is a real SQLite file that can be restored', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Load the demo business' }).click();
  await page.goto('#/data');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download database/ }).click()]);
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 15).toString('latin1')).toBe('SQLite format 3');

  // erase, then restore from that file
  await page.getByRole('button', { name: 'Erase everything' }).click();
  await page.getByRole('button', { name: 'Erase everything' }).last().click();
  await page.goto('#/');
  await expect(page.getByRole('heading', { name: 'Welcome to MiniERP' })).toBeVisible();
  await page.goto('#/data');
  await page.locator('input[type=file]').setInputFiles(path);
  await page.getByRole('button', { name: 'Restore from file' }).last().click();
  await page.goto('#/');
  await expect(page.getByRole('heading', { name: 'Levant Pantry Co.' })).toBeVisible();
});

test('a file that is not a database is refused', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Start with an empty business' }).click();
  await page.goto('#/data');
  await page.locator('input[type=file]').setInputFiles({ name: 'notes.sqlite', mimeType: 'application/octet-stream', buffer: Buffer.from('definitely not a database at all') });
  await page.getByRole('button', { name: 'Restore from file' }).last().click();
  await expect(page.getByText('That file is not a SQLite database.')).toBeVisible();
});

test('the app makes no requests to other sites', async ({ page }) => {
  const foreign: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && url.protocol.startsWith('http')) foreign.push(request.url());
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Load the demo business' }).click();
  for (const hash of ['#/', '#/sales', '#/stock', '#/invoices', '#/reports', '#/more', '#/data']) {
    await page.goto(hash);
    await page.waitForTimeout(150);
  }
  expect(foreign).toEqual([]);
});

test('keeps working with no network once it has been opened (offline support)', async ({ page, context }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Load the demo business' }).click();
  await expect(page.getByRole('heading', { name: 'Levant Pantry Co.' })).toBeVisible();
  await page.waitForTimeout(800); // let the debounced save reach IndexedDB before reloading
  // wait for the service worker to take control and fill its cache
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await page.waitForTimeout(800);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Levant Pantry Co.' })).toBeVisible();
  await page.goto('#/invoices');
  await expect(page.getByRole('heading', { name: 'Invoices' })).toBeVisible();
  await context.setOffline(false);
});
