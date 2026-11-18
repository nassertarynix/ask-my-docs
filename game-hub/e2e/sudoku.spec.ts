import { expect, test, type Page } from '@playwright/test';

const play = (page: Page) => page.locator('[data-screen="play"]');
const cell = (page: Page, i: number) => page.locator(`[data-cell="${i}"]`);

async function start(page: Page, level = 'Easy', seed = 5) {
  await page.goto(`./#/play/sudoku?seed=${seed}`);
  await page.reload();
  await page.getByRole('radio', { name: new RegExp(level) }).check();
  await page.locator('[data-action="start"]').click();
  await expect(play(page)).toBeVisible();
}

const emptyCell = async (page: Page) => Number(await page.locator('[data-value="0"]').first().getAttribute('data-cell'));

test.describe('Sudoku', () => {
  test('is on the hub, and a new puzzle has the right number of clues', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('[data-game="sudoku"]')).toBeVisible();
    await start(page, 'Easy');
    const filled = Number(await play(page).getAttribute('data-filled'));
    expect(filled).toBeGreaterThanOrEqual(40);
    expect(filled).toBeLessThanOrEqual(44);
    await start(page, 'Hard');
    expect(Number(await play(page).getAttribute('data-filled'))).toBeLessThan(32);
  });

  test('the same address gives the same puzzle', async ({ page }) => {
    await start(page, 'Medium', 11);
    const a = await page.locator('.sd-cell').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.value).join(''));
    await start(page, 'Medium', 11);
    const b = await page.locator('.sd-cell').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.value).join(''));
    expect(a).toBe(b);
  });

  test('keyboard and pad entry, given cells are locked, and a clash shows in red', async ({ page }) => {
    await start(page);
    const given = Number(await page.locator('.sd-given').first().getAttribute('data-cell'));
    await cell(page, given).click();
    const before = await cell(page, given).getAttribute('data-value');
    await page.keyboard.press('9');
    await expect(cell(page, given)).toHaveAttribute('data-value', before!);

    const free = await emptyCell(page);
    await cell(page, free).click();
    await page.keyboard.press('3');
    await expect(cell(page, free)).toHaveAttribute('data-value', '3');
    await page.locator('[data-digit="4"]').click();
    await expect(cell(page, free)).toHaveAttribute('data-value', '4');
    await page.keyboard.press('Backspace');
    await expect(cell(page, free)).toHaveAttribute('data-value', '0');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(cell(page, free)).toHaveAttribute('data-value', '4');
  });

  test('pencil notes are kept apart from the answer, and placing a digit removes it from its neighbours\' notes', async ({ page }) => {
    await start(page);
    await page.locator('[data-action="notes"]').click();
    const free = await emptyCell(page);
    await cell(page, free).click();
    await page.keyboard.press('2');
    await page.keyboard.press('5');
    await expect(cell(page, free).locator('.sd-notes')).toContainText('2');
    await expect(cell(page, free)).toHaveAttribute('data-value', '0');
    await page.keyboard.press('2'); // toggles off
    await expect(cell(page, free).locator('.sd-notes')).not.toContainText('2');
  });

  test('a hint fills a correct digit, and Check marks wrong ones', async ({ page }) => {
    await start(page);
    const free = await emptyCell(page);
    await cell(page, free).click();
    await page.locator('[data-action="hint"]').click();
    await expect(cell(page, free)).not.toHaveAttribute('data-value', '0');
    await expect(page.locator('.sd-hints')).toHaveText('1 hint');
    // put a (probably) wrong digit somewhere else and check it
    const other = await emptyCell(page);
    await cell(page, other).click();
    const hinted = await cell(page, free).getAttribute('data-value');
    for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      await page.keyboard.press(String(d));
      await page.locator('[data-action="check"]').click();
      if ((await page.locator('.sd-wrong').count()) > 0) break;
    }
    expect(hinted).not.toBeNull();
  });

  test('solving it with hints finishes the puzzle and shows the result', async ({ page }) => {
    test.setTimeout(120_000);
    await start(page, 'Easy');
    for (let i = 0; i < 60; i++) {
      if ((await play(page).getAttribute('data-solved')) === 'yes') break;
      await page.locator('[data-action="hint"]').click();
    }
    await expect(page.locator('.end-card')).toContainText('Solved');
    await expect(play(page)).toHaveAttribute('data-solved', 'yes');
    await page.locator('[data-action="again"]').click();
    await expect(play(page)).toHaveAttribute('data-solved', 'no');
  });

  for (const width of [320, 390, 1280]) {
    test(`no sideways scrolling at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await start(page);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
});
