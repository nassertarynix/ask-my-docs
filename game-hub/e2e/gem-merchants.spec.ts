import { expect, test, type Page } from '@playwright/test';

const play = (page: Page) => page.locator('[data-screen="play"]');
const mine = (page: Page, gem: string) => page.locator(`[data-mine="${gem}"]`);
const supply = (page: Page, gem: string) => page.locator(`[data-supply="${gem}"]`);

async function start(page: Page, options: { bots?: 'One' | 'Two' | 'Three'; level?: string; fast?: boolean } = {}) {
  await page.goto(`./#/play/gem-merchants${options.fast === false ? '' : '?fast=1'}`);
  await page.reload();
  await page.getByRole('radio', { name: /Against computers/ }).check();
  const hint = { One: /Two at the table/, Two: /Three at the table/, Three: /Four at the table/ }[options.bots ?? 'One'];
  await page.getByRole('radio', { name: hint }).check();
  await page.getByRole('radio', { name: new RegExp(options.level ?? 'Easy') }).check();
  await page.locator('[data-action="start"]').click();
  await expect(play(page)).toBeVisible();
}

test.describe('Gem Merchants (against computers)', () => {
  test('is on the hub, and online play says it is not switched on while no relay is connected', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('[data-game="gem-merchants"]')).toBeVisible();
    await page.goto('./#/play/gem-merchants');
    await page.reload();
    await page.getByRole('radio', { name: /Online with friends/ }).check();
    await expect(page.locator('[data-online="off"]')).toContainText('not switched on');
    await expect(page.locator('[data-action="create"]')).toHaveCount(0);
  });

  test('a two-player table: twelve stalls on show, three decks, three patrons and the right gems in the supply', async ({ page }) => {
    await start(page);
    await expect(page.locator('.gm-board [data-card]')).toHaveCount(12);
    await expect(page.locator('.gm-board .gm-back')).toHaveCount(3);
    await expect(page.locator('.gm-patron')).toHaveCount(3);
    for (const g of ['amber', 'azure', 'jade', 'pearl', 'jet']) await expect(supply(page, g)).toHaveAttribute('data-count', '4');
    await expect(supply(page, 'gold')).toHaveAttribute('data-count', '5');
    await expect(page.locator('.gm-other')).toHaveCount(1);
    await expect(play(page)).toHaveAttribute('data-my-seat', '0');
    await expect(play(page)).toHaveAttribute('data-turn', '0');
  });

  test('more computers means more gems and patrons', async ({ page }) => {
    await start(page, { bots: 'Three' });
    await expect(supply(page, 'jade')).toHaveAttribute('data-count', '7');
    await expect(page.locator('.gm-patron')).toHaveCount(5);
    await expect(page.locator('.gm-other')).toHaveCount(3);
  });

  test('taking three different gems moves them to you, then a computer replies', async ({ page }) => {
    await start(page);
    for (const g of ['amber', 'azure', 'jade']) await supply(page, g).click();
    await expect(page.locator('[data-action="take"]')).toBeEnabled();
    await page.locator('[data-action="take"]').click();
    for (const g of ['amber', 'azure', 'jade']) await expect(mine(page, g)).toHaveAttribute('data-count', '1');
    await expect(supply(page, 'amber')).toHaveAttribute('data-count', '3');
    await expect(play(page)).toHaveAttribute('data-turns', /^[2-9]/, { timeout: 10_000 }); // the computer took its turn
    await expect(play(page)).toHaveAttribute('data-turn', '0');
    await expect(page.locator('.gm-log')).toContainText('took');
  });

  test('tapping one colour twice takes a pair', async ({ page }) => {
    await start(page);
    await supply(page, 'jade').click();
    await supply(page, 'jade').click();
    await expect(page.locator('[data-action="take"]')).toHaveText('Take two Jade');
    await page.locator('[data-action="take"]').click();
    await expect(mine(page, 'jade')).toHaveAttribute('data-count', '2');
    await expect(supply(page, 'jade')).toHaveAttribute('data-count', '2');
  });

  test('a pick that is not allowed cannot be taken, and clearing starts again', async ({ page }) => {
    await start(page);
    await supply(page, 'amber').click();
    await supply(page, 'azure').click();
    await expect(page.locator('[data-action="take"]')).toBeDisabled(); // two different gems is not a move
    await expect(page.locator('.gm-hint')).toContainText('three different');
    await page.locator('[data-action="clear"]').click();
    await expect(page.locator('.gm-actionbar')).toHaveCount(0);
  });

  test('reserving a stall gives you gold, and you cannot buy what you cannot afford', async ({ page }) => {
    await start(page);
    await page.locator('.gm-board [data-card]').first().click();
    await expect(page.locator('[data-action="buy"]')).toBeDisabled();
    await expect(page.locator('.gm-hint')).toContainText('cannot afford');
    await page.locator('[data-action="reserve"]').click();
    await expect(mine(page, 'gold')).toHaveAttribute('data-count', '1');
    await expect(supply(page, 'gold')).toHaveAttribute('data-count', '4');
    await expect(page.locator('.gm-reserved .gm-card')).toHaveCount(1);
    await expect(page.locator('.gm-board [data-card]')).toHaveCount(12); // the empty slot was refilled
  });

  test('you cannot act while it is a computer\'s turn', async ({ page }) => {
    await start(page, { fast: false }); // normal speed: the computer takes a moment
    for (const g of ['amber', 'azure', 'jade']) await supply(page, g).click();
    await page.locator('[data-action="take"]').click();
    await expect(play(page)).toHaveAttribute('data-turn', '1');
    await expect(supply(page, 'pearl')).toBeDisabled();
    await expect(page.locator('.board-status')).toContainText('thinking');
  });

  test('a whole game against an easy computer can be played through to the final scores', async ({ page }) => {
    test.setTimeout(240_000);
    await start(page);
    const deadline = Date.now() + 200_000;
    while (Date.now() < deadline && (await play(page).getAttribute('data-over')) !== 'yes') {
      if ((await play(page).getAttribute('data-turn')) !== '0') {
        await page.waitForTimeout(40);
        continue;
      }
      const before = await play(page).getAttribute('data-turns');
      const phase = await play(page).getAttribute('data-phase');
      if (phase === 'discard') {
        const give = page.locator('.gm-giveback:not([data-mine="gold"])');
        await ((await give.count()) ? give.first() : page.locator('.gm-giveback').first()).click({ timeout: 2000 }).catch(() => undefined);
      } else if (phase === 'patron') {
        await page.locator('.gm-patron.gm-affordable').first().click({ timeout: 2000 }).catch(() => undefined);
      } else {
        const buy = page.locator('.gm-board .gm-affordable, .gm-reserved .gm-affordable').first();
        if (await buy.count()) {
          await buy.click();
          await page.locator('[data-action="buy"]').click();
        } else {
          const open = page.locator('button[data-supply]:not([disabled])');
          if ((await open.count()) >= 3) {
            for (let i = 0; i < 3; i++) await open.nth(i).click();
            await page.locator('[data-action="take"]').click();
          } else {
            await page.locator('.gm-board [data-card]').first().click();
            await page.locator('[data-action="reserve"]').click();
          }
        }
      }
      await expect(play(page)).not.toHaveAttribute('data-turns', before ?? '', { timeout: 5000 }).catch(() => undefined);
    }
    await expect(page.locator('.end-card')).toBeVisible();
    await expect(page.locator('.gm-final tr')).toHaveCount(2);
    const scores = (await play(page).getAttribute('data-scores'))?.split(',').map(Number) ?? [];
    expect(Math.max(...scores)).toBeGreaterThanOrEqual(15);
    await page.locator('[data-action="again"]').click();
    await expect(play(page)).toHaveAttribute('data-turns', '0');
  });

  test('leaving goes back to the menu', async ({ page }) => {
    await start(page);
    await page.locator('[data-action="leave"]').click();
    await expect(page.locator('[data-screen="setup"]')).toBeVisible();
  });

  for (const width of [320, 390, 1280]) {
    test(`no sideways scrolling at ${width}px with four at the table`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await start(page, { bots: 'Three' });
      await supply(page, 'amber').click();
      await page.locator('.gm-board [data-card]').first().click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const card = await page.locator('.gm-board [data-card]').first().boundingBox();
      expect(card?.width ?? 0).toBeGreaterThan(40);
    });
  }
});
