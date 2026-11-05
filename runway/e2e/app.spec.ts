import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('./'); });

test('opens on an example that shows when the money runs out', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /Money runs out on/ })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('example data');
});

test('switching an item off changes the answer', async ({ page }) => {
  await expect(page.getByRole('heading', { name: /Money runs out on/ })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Include New van' }).setChecked(false, { force: true });
  await expect(page.getByRole('heading', { name: /Stays above zero through/ })).toBeVisible();
  await page.getByRole('checkbox', { name: 'Include New van' }).setChecked(true, { force: true });
  await expect(page.getByRole('heading', { name: /Money runs out on/ })).toBeVisible();
});

test('starts a forecast from nothing: clear, add income and a cost, see the result', async ({ page }) => {
  await page.getByRole('button', { name: 'Clear it and start your own' }).click();
  await expect(page.getByText('Nothing here yet')).toBeVisible();
  await page.getByLabel('Balance on the start date').fill('1000');
  await page.locator('#start').fill('2027-01-01');
  await page.locator('#start').blur();
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.getByRole('radio', { name: 'Money out' }).check({ force: true });
  await page.locator('#f-name').fill('Rent');
  await page.locator('#f-amount').fill('400');
  await page.locator('#f-start').fill('2027-01-05');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('heading', { name: 'Money runs out on Mar 5, 2027' })).toBeVisible();
  await page.getByLabel('Look ahead').selectOption('3');
  await expect(page.getByRole('row')).toHaveCount(4); // header + 3 months
});

test('refuses a bad amount and explains why', async ({ page }) => {
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.locator('#f-name').fill('Mystery');
  await page.locator('#f-amount').fill('12abc');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Enter an amount above zero')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('keeps your data after a reload', async ({ page }) => {
  await page.getByRole('button', { name: 'Clear it and start your own' }).click();
  await page.getByRole('button', { name: 'Add item' }).click();
  await page.locator('#f-name').fill('Consulting');
  await page.getByRole('radio', { name: 'Money in' }).check({ force: true });
  await page.locator('#f-amount').fill('2500');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Edit Consulting' })).toBeVisible();
  await expect(page.getByRole('note')).toHaveCount(0);
});

test('a backup downloads and loads back; a wrong file is refused', async ({ page }) => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
  const path = await download.path();
  await page.getByRole('button', { name: 'Clear it and start your own' }).click();
  await expect(page.getByText('Nothing here yet')).toBeVisible();
  await page.getByLabel('Load backup').setInputFiles(path);
  await expect(page.getByRole('button', { name: 'Edit New van' })).toBeVisible();
  await page.getByLabel('Load backup').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByText('not a Runway export')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit New van' })).toBeVisible();
});

test('no horizontal scroll and no requests to other sites', async ({ page }) => {
  const foreign: string[] = [];
  page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1')  && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) foreign.push(r.url()); });
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('./');
    await expect(page.getByRole('heading', { name: /Money runs out on/ })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `width ${width}`).toBeLessThanOrEqual(0);
  }
  expect(foreign).toEqual([]);
});
