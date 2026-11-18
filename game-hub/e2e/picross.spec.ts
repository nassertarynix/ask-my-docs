import { expect, test, type Page } from '@playwright/test';

const play = (page: Page) => page.locator('[data-screen="play"]');
const cell = (page: Page, i: number) => page.locator(`[data-cell="${i}"]`);

async function start(page: Page, size = '5 × 5', seed = 4) {
  await page.goto(`./#/play/picross?seed=${seed}`);
  await page.reload();
  await page.getByRole('radio', { name: new RegExp(size) }).check();
  await page.locator('[data-action="start"]').click();
  await expect(play(page)).toBeVisible();
}

/** The centre of square i on the page. */
async function centre(page: Page, i: number, n: number) {
  const box = (await page.locator('[data-overlay]').boundingBox())!;
  return { x: box.x + ((i % n) + 0.5) * (box.width / n), y: box.y + (Math.floor(i / n) + 0.5) * (box.height / n) };
}

test.describe('Picross', () => {
  test('is on the hub; every row and column has a clue', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('[data-game="picross"]')).toBeVisible();
    await start(page, '10 × 10');
    await expect(page.locator('[data-clue]')).toHaveCount(20);
    await expect(page.locator('[data-cell]')).toHaveCount(100);
  });

  test('a click fills a square, another clears it; the mark tool crosses it out', async ({ page }) => {
    await start(page);
    const p = await centre(page, 6, 5);
    await page.mouse.click(p.x, p.y);
    await expect(cell(page, 6)).toHaveAttribute('data-state', '1');
    await page.mouse.click(p.x, p.y);
    await expect(cell(page, 6)).toHaveAttribute('data-state', '0');
    await page.locator('[data-action="tool-mark"]').click();
    await page.mouse.click(p.x, p.y);
    await expect(cell(page, 6)).toHaveAttribute('data-state', '2');
    await page.mouse.click(p.x, p.y, { button: 'right' }); // right-click always marks: this unmarks it
    await expect(cell(page, 6)).toHaveAttribute('data-state', '0');
  });

  test('dragging paints a whole row with the same value, and undo takes the stroke back in one go', async ({ page }) => {
    await start(page);
    const a = await centre(page, 5, 5);
    const b = await centre(page, 9, 5);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.mouse.up();
    for (let i = 5; i <= 9; i++) await expect(cell(page, i)).toHaveAttribute('data-state', '1');
    await expect(play(page)).toHaveAttribute('data-filled', '5');
    await page.locator('[data-action="undo"]').click();
    await expect(play(page)).toHaveAttribute('data-filled', '0');
  });

  test('the hint adds one correct square, and Check flags a wrong one', async ({ page }) => {
    await start(page);
    await page.locator('[data-action="hint"]').click();
    await expect(page.locator('.sd-hints')).toHaveText('1 hint');
    expect(await page.locator('[data-state="1"], [data-state="2"]').count()).toBe(1);
    // fill squares until Check finds a wrong one (a 5 x 5 picture is 60% filled, so some square is empty)
    let flagged = false;
    for (let i = 0; i < 25 && !flagged; i++) {
      const p = await centre(page, i, 5);
      await page.mouse.click(p.x, p.y);
      await page.locator('[data-action="check"]').click();
      flagged = (await page.locator('.pc-bad').count()) > 0;
    }
    expect(flagged).toBe(true);
  });

  test('following the hints completes the picture: the end card shows, and clues grey out', async ({ page }) => {
    test.setTimeout(60_000);
    await start(page);
    for (let i = 0; i < 60 && (await play(page).getAttribute('data-solved')) !== 'yes'; i++) await page.locator('[data-action="hint"]').click();
    await expect(page.locator('.end-card')).toContainText('Picture complete');
    await expect(page.locator('.pc-done')).toHaveCount(10); // every clue is satisfied
    await page.locator('[data-action="again"]').click();
    await expect(play(page)).toHaveAttribute('data-solved', 'no');
  });

  test('the same address is the same picture', async ({ page }) => {
    await start(page, '5 × 5', 9);
    const a = await page.locator('[data-clue]').evaluateAll((els) => els.map((e) => e.textContent).join('|'));
    await start(page, '5 × 5', 9);
    const b = await page.locator('[data-clue]').evaluateAll((els) => els.map((e) => e.textContent).join('|'));
    expect(a).toBe(b);
  });

  for (const width of [320, 390, 1280]) {
    test(`no sideways scrolling at ${width}px on the 15 x 15 board, and the squares are still big enough to use`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await start(page, '15 × 15');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const box = (await page.locator('[data-overlay]').boundingBox())!;
      expect(box.width / 15).toBeGreaterThan(12);
    });
  }
});
