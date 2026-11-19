import { expect, test, type Page } from '@playwright/test';

const play = (page: Page) => page.locator('[data-screen="play"]');
const tile = (page: Page, seat: number) => page.locator(`.pb-tile[data-seat="${seat}"]`);

async function setRange(page: Page, value: number) {
  await page.locator('[data-field="opponents"]').evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function start(page: Page, options: { opponents?: number; hero?: number; level?: string; fast?: boolean; seed?: number } = {}) {
  await page.goto(`./#/play/pit-brawl?seed=${options.seed ?? 5}${options.fast === false ? '' : '&fast=1'}`);
  await page.reload();
  await page.getByRole('radio', { name: /Against computers/ }).check();
  await page.locator(`[data-hero="${options.hero ?? 0}"]`).click();
  await setRange(page, options.opponents ?? 3);
  await page.getByRole('radio', { name: new RegExp(options.level ?? 'Easy') }).check();
  await page.locator('[data-action="start"]').click();
  await expect(play(page)).toBeVisible();
}

test.describe('Pit Brawl (against computers)', () => {
  test('is on the hub, and online play says it is not switched on while no relay is connected', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('[data-game="pit-brawl"]')).toBeVisible();
    await page.goto('./#/play/pit-brawl');
    await page.reload();
    await page.getByRole('radio', { name: /Online with friends/ }).check();
    await expect(page.locator('[data-online="off"]')).toContainText('not switched on');
  });

  test('the menu offers ten heroes and a random one, and up to nine computer opponents', async ({ page }) => {
    await page.goto('./#/play/pit-brawl');
    await page.reload();
    await expect(page.locator('[data-hero]')).toHaveCount(11);
    await setRange(page, 9);
    await expect(page.locator('[data-output="opponents"]')).toHaveText('9');
    await expect(page.locator('[data-field="opponents"]')).toHaveAttribute('max', '9');
  });

  test('a four-player table: everyone at full health, my chosen hero, and a hand of cards', async ({ page }) => {
    await start(page);
    await expect(page.locator('.pb-tile')).toHaveCount(4);
    for (let i = 0; i < 4; i++) await expect(tile(page, i)).toHaveAttribute('data-hp', '10');
    await expect(page.locator('.pb-me')).toContainText('Brakka');
    await expect(page.locator('.pb-card')).toHaveCount(3);
    await expect(play(page)).toHaveAttribute('data-my-seat', '0');
    await expect(play(page)).toHaveAttribute('data-turn', '0');
  });

  test('a big table has more health, and ten players fit', async ({ page }) => {
    await start(page, { opponents: 9 });
    await expect(page.locator('.pb-tile')).toHaveCount(10);
    await expect(tile(page, 0)).toHaveAttribute('data-hp', '22');
    await expect(tile(page, 9)).toHaveAttribute('data-hp', '22');
  });

  test('a card that needs a target lights up the opponents, and tapping one plays it on them', async ({ page }) => {
    await start(page, { fast: false });
    await page.locator('.pb-card[data-name="Cleaver Chop"]').click();
    await expect(page.locator('.board-status')).toContainText('Choose who');
    await expect(page.locator('.pb-tile[data-target="yes"]')).toHaveCount(3);
    await expect(page.locator('.pb-me[data-target="yes"]')).toHaveCount(0); // not yourself
    const victim = page.locator('.pb-tile[data-target="yes"]').first();
    const seat = Number(await victim.getAttribute('data-seat'));
    await victim.click();
    await expect(tile(page, seat)).toHaveAttribute('data-hp', '7'); // hit for 3
    await expect(page.locator('.gm-log')).toContainText('Brawler played Cleaver Chop');
    await expect(page.locator('.pb-card')).toHaveCount(2);
    await expect(play(page)).not.toHaveAttribute('data-turn', '0');
  });

  test('a card with no target is played from the action bar and shields me', async ({ page }) => {
    await start(page, { fast: false });
    await page.locator('.pb-card[data-name="Iron Hide"]').click();
    await expect(page.locator('[data-action="play"]')).toBeVisible();
    await expect(page.locator('.pb-tile[data-target="yes"]')).toHaveCount(0);
    await page.locator('[data-action="play"]').click();
    await expect(tile(page, 0)).toHaveAttribute('data-shield', '4');
  });

  test('picking a card can be undone, and cards cannot be played while a computer thinks', async ({ page }) => {
    await start(page, { fast: false });
    await page.locator('.pb-card[data-name="Iron Hide"]').click();
    await page.locator('[data-action="cancel"]').click();
    await expect(page.locator('.gm-actionbar')).toHaveCount(0);
    await page.locator('.pb-card[data-name="Iron Hide"]').click();
    await page.locator('[data-action="play"]').click();
    await expect(page.locator('.board-status')).toContainText('thinking');
    await expect(page.locator('.pb-card').first()).toBeDisabled();
  });

  test('a whole game against computers can be played to the last hero standing', async ({ page }) => {
    test.setTimeout(240_000);
    await start(page, { opponents: 3 });
    const deadline = Date.now() + 200_000;
    while (Date.now() < deadline && (await play(page).getAttribute('data-over')) !== 'yes') {
      if ((await play(page).getAttribute('data-turn')) !== '0' || (await tile(page, 0).getAttribute('data-alive')) !== 'yes') {
        await page.waitForTimeout(30);
        continue;
      }
      const before = `${await play(page).getAttribute('data-turns')}/${await play(page).getAttribute('data-plays')}`;
      const cards = page.locator('.pb-card:not([disabled])');
      if (!(await cards.count())) {
        await page.waitForTimeout(30);
        continue;
      }
      await cards.first().click({ timeout: 2000 }).catch(() => undefined);
      const target = page.locator('.pb-tile[data-target="yes"]').first();
      if (await target.count()) await target.click({ timeout: 2000 }).catch(() => undefined);
      else await page.locator('[data-action="play"]').click({ timeout: 2000 }).catch(() => undefined);
      await page.waitForFunction((b) => { const p = document.querySelector('[data-screen="play"]'); return !!p && `${p.getAttribute('data-turns')}/${p.getAttribute('data-plays')}` !== b; }, before, { timeout: 5000 }).catch(() => undefined);
    }
    await expect(page.locator('.end-card')).toBeVisible();
    await expect(page.locator('.end-card')).toContainText('last standing');
    await page.locator('[data-action="again"]').click();
    await expect(play(page)).toHaveAttribute('data-turns', /^[0-9]+$/);
    await expect(page.locator('.pb-tile')).toHaveCount(4);
  });

  test('leaving goes back to the menu', async ({ page }) => {
    await start(page);
    await page.locator('[data-action="leave"]').click();
    await expect(page.locator('[data-screen="setup"]')).toBeVisible();
  });

  for (const width of [320, 390, 1280]) {
    test(`no sideways scrolling at ${width}px with ten at the table`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await start(page, { opponents: 9 });
      await page.locator('.pb-card').first().click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const box = await page.locator('.pb-card').first().boundingBox();
      expect(box?.width ?? 0).toBeGreaterThan(80);
    });
  }
});
