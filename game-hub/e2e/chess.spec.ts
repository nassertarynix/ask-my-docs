import { expect, test, type Page } from '@playwright/test';

const play = (page: Page) => page.locator('[data-screen="play"]');
const sq = (page: Page, name: string) => page.locator(`[data-square="${name}"]`);

async function start(page: Page, options: { mode?: 'pvp'; level?: string; side?: 'Black' } = {}) {
  await page.goto('./#/play/chess');
  await page.reload();
  if (options.mode === 'pvp') await page.getByRole('radio', { name: /2 players/ }).check();
  if (options.level) await page.getByRole('radio', { name: new RegExp(options.level) }).check();
  if (options.side) await page.getByRole('radio', { name: new RegExp(options.side) }).check();
  await page.locator('[data-action="start"]').click();
  await expect(play(page)).toBeVisible();
}

/** Click a move: the piece's square, then where it goes. */
async function move(page: Page, from: string, to: string) {
  await sq(page, from).click();
  await sq(page, to).click();
}

test.describe('Chess', () => {
  test('is on the hub, no longer a coming-soon card, and starts from the usual position', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('[data-game="chess"]')).toBeVisible();
    await start(page, { mode: 'pvp' });
    await expect(sq(page, 'e1')).toHaveAttribute('data-piece', 'wk');
    await expect(sq(page, 'd8')).toHaveAttribute('data-piece', 'bq');
    await expect(sq(page, 'e4')).toHaveAttribute('data-piece', '');
    await expect(page.locator('[data-square]')).toHaveCount(64);
    await expect(play(page)).toHaveAttribute('data-turn', 'w');
  });

  test('tapping a piece shows where it can go, and an illegal square does nothing', async ({ page }) => {
    await start(page, { mode: 'pvp' });
    await sq(page, 'g1').click();
    await expect(page.locator('[data-target="yes"]')).toHaveCount(2); // Nf3 and Nh3
    await expect(sq(page, 'f3')).toHaveAttribute('data-target', 'yes');
    await sq(page, 'g4').click(); // not a legal square for the knight
    await expect(play(page)).toHaveAttribute('data-moves', '0');
    await expect(page.locator('[data-target="yes"]')).toHaveCount(0);
    // the other side's piece cannot be picked up
    await sq(page, 'e7').click();
    await expect(page.locator('[data-target="yes"]')).toHaveCount(0);
  });

  test('two players: moves alternate, are written down, and can be taken back', async ({ page }) => {
    await start(page, { mode: 'pvp' });
    await move(page, 'e2', 'e4');
    await expect(play(page)).toHaveAttribute('data-turn', 'b');
    await move(page, 'e7', 'e5');
    await move(page, 'g1', 'f3');
    await expect(play(page)).toHaveAttribute('data-moves', '3');
    await expect(page.locator('.ch-moves')).toContainText('1. e4 e5');
    await expect(page.locator('.ch-moves')).toContainText('2. Nf3');
    await page.locator('[data-action="undo"]').click();
    await expect(play(page)).toHaveAttribute('data-moves', '2');
    await expect(sq(page, 'g1')).toHaveAttribute('data-piece', 'wn');
    await expect(play(page)).toHaveAttribute('data-turn', 'w');
  });

  test("a check has to be answered: only moves that end it are offered", async ({ page }) => {
    await start(page, { mode: 'pvp' });
    for (const [a, b] of [['e2', 'e4'], ['d7', 'd5'], ['f1', 'b5']] as [string, string][]) await move(page, a, b);
    // black's c6 pawn move would be fine, but the d7 pawn left e8 exposed: the bishop on b5 now checks
    await expect(page.locator('.board-status')).toContainText('Check!');
    await sq(page, 'a7').click();
    await expect(page.locator('[data-target="yes"]')).toHaveCount(0); // a7 does not answer the check
    await sq(page, 'c8').click(); // Bd7 blocks
    await expect(sq(page, 'd7')).toHaveAttribute('data-target', 'yes');
  });

  test("fool's mate ends the game with the right result, and play again starts over", async ({ page }) => {
    await start(page, { mode: 'pvp' });
    for (const [a, b] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']] as [string, string][]) await move(page, a, b);
    await expect(play(page)).toHaveAttribute('data-over', 'yes');
    await expect(play(page)).toHaveAttribute('data-result', 'checkmate');
    await expect(page.locator('.end-card')).toContainText('Black wins');
    await expect(sq(page, 'e1')).toBeDisabled();
    await page.locator('[data-action="again"]').click();
    await expect(play(page)).toHaveAttribute('data-moves', '0');
    await expect(sq(page, 'f2')).toHaveAttribute('data-piece', 'wp');
  });

  test('a pawn reaching the last rank asks what to become, and becomes it', async ({ page }) => {
    await start(page, { mode: 'pvp' });
    // a quick run of the h-pawn to h7, taking g7 and promoting on g8 by capture
    const line: [string, string][] = [
      ['h2', 'h4'], ['a7', 'a6'], ['h4', 'h5'], ['a6', 'a5'], ['h5', 'h6'], ['a5', 'a4'], ['h6', 'g7'], ['a4', 'a3'],
    ];
    for (const [a, b] of line) await move(page, a, b);
    await sq(page, 'g7').click();
    await sq(page, 'h8').click(); // capture the rook on h8 and promote
    await expect(page.locator('[data-promotion="yes"]')).toBeVisible();
    await expect(sq(page, 'a1')).toBeDisabled(); // nothing else can be played while choosing
    await page.locator('[data-promote="n"]').click();
    await expect(sq(page, 'h8')).toHaveAttribute('data-piece', 'wn');
    await expect(page.locator('.ch-moves')).toContainText('gxh8=N');
  });

  test('against the computer: it replies by itself, you cannot move for it, and undo takes back both moves', async ({ page }) => {
    await start(page, { level: 'Easy' });
    await move(page, 'e2', 'e4');
    await expect(play(page)).toHaveAttribute('data-thinking', 'yes');
    await expect(page.locator('.board-status')).toContainText('Computer is thinking');
    await expect(sq(page, 'e2')).toBeDisabled();
    await expect(play(page)).toHaveAttribute('data-turn', 'w', { timeout: 10_000 });
    await expect(play(page)).toHaveAttribute('data-moves', '2');
    await expect(page.locator('.board-status')).toContainText('your move');
    await page.locator('[data-action="undo"]').click();
    await expect(play(page)).toHaveAttribute('data-moves', '0');
    await expect(sq(page, 'e2')).toHaveAttribute('data-piece', 'wp');
  });

  test('playing Black: the board is turned round and the computer opens', async ({ page }) => {
    await start(page, { level: 'Easy', side: 'Black' });
    await expect(play(page)).toHaveAttribute('data-bottom', 'b');
    await expect(play(page)).toHaveAttribute('data-moves', '1', { timeout: 10_000 });
    await expect(play(page)).toHaveAttribute('data-turn', 'b');
    // black's own pieces are at the bottom: the first square of the page's board is h1 and the last is a8
    const first = await page.locator('[data-square]').first().getAttribute('data-square');
    expect(first).toBe('h1');
    await page.locator('[data-action="flip"]').click();
    await expect(play(page)).toHaveAttribute('data-bottom', 'w');
  });

  test('stalemate is a draw, not a win', async ({ page }) => {
    await start(page, { mode: 'pvp' });
    // the shortest stalemate (Sam Loyd, ten moves)
    const line: [string, string][] = [
      ['e2', 'e3'], ['a7', 'a5'], ['d1', 'h5'], ['a8', 'a6'], ['h5', 'a5'], ['h7', 'h5'], ['h2', 'h4'], ['a6', 'h6'],
      ['a5', 'c7'], ['f7', 'f6'], ['c7', 'd7'], ['e8', 'f7'], ['d7', 'b7'], ['d8', 'd3'], ['b7', 'b8'], ['d3', 'h7'],
      ['b8', 'c8'], ['f7', 'g6'], ['c8', 'e6'],
    ];
    for (const [a, b] of line) await move(page, a, b);
    await expect(play(page)).toHaveAttribute('data-result', 'draw');
    await expect(page.locator('.end-card')).toContainText('stalemate');
  });

  for (const width of [320, 390, 1280]) {
    test(`no sideways scrolling at ${width}px, and the board is square`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await start(page, { mode: 'pvp' });
      for (const [a, b] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'c4'], ['g8', 'f6']] as [string, string][]) await move(page, a, b);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const box = await page.locator('.ch-board').boundingBox();
      expect(Math.abs((box?.width ?? 0) - (box?.height ?? 1))).toBeLessThan(2);
      expect(box?.width ?? 0).toBeGreaterThan(Math.min(width, 560) - 40);
    });
  }
});
