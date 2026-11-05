import { expect, test } from '@playwright/test';

const ROUTES = ['#/', '#/sales', '#/sales/new', '#/stock', '#/invoices', '#/purchases', '#/purchases/new', '#/contacts', '#/reports', '#/more', '#/data'];
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1280];

for (const lang of ['en', 'ar'] as const) {
  test(`no horizontal page scroll at any width (${lang})`, async ({ page }) => {
    await page.addInitScript((l) => localStorage.setItem('minierp.lang', l), lang);
    await page.goto('./');
    await page.getByRole('button', { name: lang === 'en' ? 'Load the demo business' : 'تحميل النشاط التجريبي' }).click();
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      for (const hash of ROUTES) {
        await page.goto(hash);
        await page.waitForTimeout(60);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${hash} at ${width}px`).toBeLessThanOrEqual(0);
      }
    }
  });
}

test('Arabic switches the page to right-to-left and translates the screens', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('button', { name: 'Load the demo business' }).click();
  await page.goto('#/more');
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await page.goto('#/invoices');
  await expect(page.getByRole('heading', { name: 'الفواتير' })).toBeVisible();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl'); // the choice is remembered
});

test('touch targets are at least 44px on the main screens', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'phone only');
  await page.goto('./');
  await page.getByRole('button', { name: 'Load the demo business' }).click();
  for (const hash of ['#/', '#/sales', '#/stock', '#/invoices', '#/sales/new']) {
    await page.goto(hash);
    const small = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('button, a.btn, a.tab, select, input:not([type=hidden]):not([type=file])')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < 43.5 || r.width < 43.5) bad.push(`${el.tagName}.${el.className} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent ?? '').trim().slice(0, 20)}"`);
      }
      return bad;
    });
    expect(small, hash).toEqual([]);
  }
});
