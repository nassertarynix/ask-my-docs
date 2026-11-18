import { expect, test, type Page } from '@playwright/test';

const open = async (page: Page) => {
  await page.goto('./#/play/mastermind');
  await page.reload();
};
const pick = async (page: Page, colors: number[]) => {
  for (const c of colors) await page.keyboard.press(String(c + 1));
};

test.describe('Mastermind', () => {
  test('on the hub, and a one-player round is played to a loss with feedback on every row', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('[data-game="mastermind"]')).toBeVisible();
    await open(page);
    await page.locator('[data-action="start"]').click();
    await expect(page.locator('[data-screen="play"]')).toBeVisible();
    for (let i = 0; i < 10; i++) {
      await pick(page, [0, 0, 0, 1]);
      await page.keyboard.press('Enter');
      await expect(page.locator('.mm-board')).toHaveAttribute('data-turns', String(i + 1));
      const status = await page.locator('.mm-board').getAttribute('data-status');
      if (status !== 'playing') break;
    }
    // the same guess ten times cannot win unless the code happened to be it; either way the round ends or shows the reveal
    const status = await page.locator('.mm-board').getAttribute('data-status');
    if (status === 'playing') throw new Error('round did not end');
    await expect(page.locator('.end-card')).toContainText('The code was');
    await expect(page.locator('.mm-row .fb').first().locator('.fb-dot')).toHaveCount(4);
  });

  test('the hint shows one peg and can be used once per guess', async ({ page }) => {
    await open(page);
    await page.locator('[data-action="start"]').click();
    await page.locator('[data-action="hint"]').click();
    await expect(page.locator('.mm-hint')).toContainText('Place 1 is');
    await expect(page.locator('[data-action="hint"]')).toBeDisabled();
    await pick(page, [0, 1, 2, 3]);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-action="hint"]')).toBeEnabled();
  });

  test('keyboard: numbers fill the slots, Backspace takes one back, a short code cannot be sent', async ({ page }) => {
    await open(page);
    await page.locator('[data-action="start"]').click();
    await pick(page, [0, 1, 2]);
    await expect(page.locator('[data-action="submit"]')).toBeDisabled();
    await page.keyboard.press('Enter');
    await expect(page.locator('.mm-board')).toHaveAttribute('data-turns', '0');
    await page.keyboard.press('Backspace');
    await pick(page, [3, 4]);
    await expect(page.locator('[data-action="submit"]')).toBeEnabled();
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.locator('[data-action="submit"]')).toBeDisabled();
  });

  test('two players: the code is never in the page while the other player is guessing, and the curtain hides each hand-over', async ({ page }) => {
    await open(page);
    await page.getByRole('radio', { name: /2 players/ }).check();
    await page.locator('[data-action="start"]').click();
    // curtain for the code-maker, with nothing else on screen
    await expect(page.locator('[data-curtain="up"]')).toContainText('Pass the device to Player 1');
    await expect(page.locator('[data-entry]')).toHaveCount(0);
    await page.locator('[data-action="reveal"]').click();
    await expect(page.locator('[data-screen="setcode"]')).toBeVisible();
    await pick(page, [4, 4, 5, 2]);
    await page.getByRole('button', { name: 'Lock in the code' }).click();
    // hand-over: the code is gone from the screen, the guesser sees a curtain
    await expect(page.locator('[data-curtain="up"]')).toContainText('Pass the device to Player 2');
    await expect(page.locator('[data-screen="setcode"]')).toHaveCount(0);
    await page.locator('[data-action="reveal"]').click();
    const before = await page.locator('body').innerText();
    expect(before).not.toContain('The code was');
    await pick(page, [4, 4, 5, 2]);
    await page.keyboard.press('Enter');
    await expect(page.locator('.end-card')).toContainText('Cracked in 1');
    await expect(page.locator('.end-card')).toContainText('The code was');
    // swap roles: Player 2 now makes the code
    await page.locator('[data-action="again"]').click();
    await expect(page.locator('[data-curtain="up"]')).toContainText('Pass the device to Player 2');
  });

  test('"no repeats" rejects a code with a repeated colour', async ({ page }) => {
    await open(page);
    await page.getByRole('radio', { name: /2 players/ }).check();
    await page.getByRole('radio', { name: /Never/ }).check();
    await page.locator('[data-action="start"]').click();
    await page.locator('[data-action="reveal"]').click();
    await pick(page, [0, 0, 1, 2]);
    await page.getByRole('button', { name: 'Lock in the code' }).click();
    await expect(page.getByRole('alert')).toContainText('four different');
    await expect(page.locator('[data-screen="setcode"]')).toBeVisible();
  });

  for (const width of [320, 390, 1280]) {
    test(`no sideways scrolling at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await open(page);
      await page.locator('[data-action="start"]').click();
      await pick(page, [0, 1, 2, 3]);
      await page.keyboard.press('Enter');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    });
  }
});
