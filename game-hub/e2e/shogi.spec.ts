import { expect, test, type Page } from '@playwright/test';

const play = (page: Page) => page.locator('[data-screen="play"]');
const sq = (page: Page, name: string) => page.locator(`[data-square="${name}"]`);

async function start(page: Page, options: { mode?: 'pvp'; level?: string; side?: 'Gote'; sfen?: string; letters?: boolean } = {}) {
  await page.goto(`./#/play/shogi${options.sfen ? `?sfen=${encodeURIComponent(options.sfen)}` : ''}`);
  await page.reload();
  if (options.mode === 'pvp') await page.getByRole('radio', { name: /2 players/ }).check();
  if (options.level) await page.getByRole('radio', { name: new RegExp(options.level) }).check();
  if (options.side) await page.getByRole('radio', { name: new RegExp(options.side) }).check();
  if (options.letters) await page.getByRole('radio', { name: /Letters/ }).check();
  await page.locator('[data-action="start"]').click();
  await expect(play(page)).toBeVisible();
}

async function move(page: Page, from: string, to: string) {
  await sq(page, from).click();
  await sq(page, to).click();
}

test.describe('Shogi', () => {
  test('is on the hub, and starts from the usual position', async ({ page }) => {
    await page.goto('./');
    await expect(page.locator('[data-game="shogi"]')).toBeVisible();
    await start(page, { mode: 'pvp' });
    await expect(page.locator('[data-square]')).toHaveCount(81);
    await expect(sq(page, '5i')).toHaveAttribute('data-piece', 'b:K');
    await expect(sq(page, '5a')).toHaveAttribute('data-piece', 'w:K');
    await expect(sq(page, '8h')).toHaveAttribute('data-piece', 'b:B');
    await expect(sq(page, '2h')).toHaveAttribute('data-piece', 'b:R');
    await expect(sq(page, '8b')).toHaveAttribute('data-piece', 'w:R');
    await expect(sq(page, '5e')).toHaveAttribute('data-piece', '');
    await expect(play(page)).toHaveAttribute('data-turn', '0');
  });

  test('the tiles are written in kanji, or in letters if you prefer', async ({ page }) => {
    await start(page, { mode: 'pvp' });
    await expect(sq(page, '5i')).toContainText('王');
    await expect(sq(page, '5a')).toContainText('玉');
    await expect(sq(page, '8h')).toContainText('角');
    await page.reload();
    await start(page, { mode: 'pvp', letters: true });
    await expect(sq(page, '8h')).toContainText('B');
    await expect(sq(page, '8h')).not.toContainText('角');
  });

  test('tapping a piece shows where it can go; an illegal square or an enemy piece does nothing', async ({ page }) => {
    await start(page, { mode: 'pvp' });
    await sq(page, '7g').click();
    await expect(page.locator('[data-target="yes"]')).toHaveCount(1);
    await expect(sq(page, '7f')).toHaveAttribute('data-target', 'yes');
    await sq(page, '7e').click(); // two squares: not legal for a pawn
    await expect(play(page)).toHaveAttribute('data-moves', '0');
    await expect(page.locator('[data-target="yes"]')).toHaveCount(0);
    await sq(page, '7c').click(); // gote's pawn: not yours to pick up
    await expect(page.locator('[data-target="yes"]')).toHaveCount(0);
    await sq(page, '1g').click();
    await expect(sq(page, '1f')).toHaveAttribute('data-target', 'yes');
  });

  test('two players: a bishop trade promotes on request, the captured piece goes to the hand and can be dropped', async ({ page }) => {
    await start(page, { mode: 'pvp' });
    await move(page, '7g', '7f');
    await move(page, '3c', '3d');
    await move(page, '8h', '2b'); // bishop takes bishop, inside the promotion zone: the game asks
    await expect(page.locator('[data-promotion="yes"]')).toBeVisible();
    await page.locator('[data-promote="yes"]').click();
    await expect(sq(page, '2b')).toHaveAttribute('data-piece', 'b:+B');
    await expect(page.locator('[data-hand="B"][data-owner="0"]')).toHaveAttribute('data-count', '1');
    await move(page, '3a', '2b'); // the silver takes the horse back
    await expect(page.locator('[data-hand="B"][data-owner="1"]')).toHaveAttribute('data-count', '1');
    // sente drops the bishop in hand
    await page.locator('[data-hand="B"][data-owner="0"]').click();
    await expect(sq(page, '5e')).toHaveAttribute('data-target', 'yes');
    await expect(sq(page, '5i')).not.toHaveAttribute('data-target', 'yes'); // occupied
    await sq(page, '5e').click();
    await expect(sq(page, '5e')).toHaveAttribute('data-piece', 'b:B');
    await expect(page.locator('[data-hand="B"][data-owner="0"]')).toHaveCount(0);
    await expect(page.locator('.ch-moves')).toContainText('B*5e');
    await expect(play(page)).toHaveAttribute('data-turn', '1');
  });

  test('declining the promotion leaves the piece as it was', async ({ page }) => {
    await start(page, { mode: 'pvp' });
    await move(page, '7g', '7f');
    await move(page, '3c', '3d');
    await move(page, '8h', '2b');
    await page.locator('[data-promote="no"]').click();
    await expect(sq(page, '2b')).toHaveAttribute('data-piece', 'b:B');
  });

  test('a mate by a dropped piece ends the game, and play again starts over', async ({ page }) => {
    await start(page, { mode: 'pvp', sfen: '4k4/9/4L4/9/9/9/9/9/4K4 b G 1' });
    await page.locator('[data-hand="G"][data-owner="0"]').click();
    await sq(page, '5b').click();
    await expect(play(page)).toHaveAttribute('data-over', 'yes');
    await expect(play(page)).toHaveAttribute('data-result', 'mate');
    await expect(page.locator('.end-card')).toContainText('Sente wins');
    await expect(sq(page, '5e')).toBeDisabled();
    await page.locator('[data-action="again"]').click();
    await expect(play(page)).toHaveAttribute('data-moves', '0');
  });

  test('a pawn may not be dropped to give mate, nor on a file that already has one of your pawns', async ({ page }) => {
    await start(page, { mode: 'pvp', sfen: '8k/9/7G1/4B4/9/9/9/9/4K4 b P 1' });
    await page.locator('[data-hand="P"][data-owner="0"]').click();
    await expect(sq(page, '1b')).not.toHaveAttribute('data-target', 'yes'); // that would be mate
    await expect(sq(page, '5e')).toHaveAttribute('data-target', 'yes');
    await page.locator('[data-hand="P"][data-owner="0"]').click();
    await page.reload();
    await start(page, { mode: 'pvp', sfen: '4k4/9/9/9/9/9/4P4/9/4K4 b P 1' });
    await page.locator('[data-hand="P"][data-owner="0"]').click();
    await expect(sq(page, '5e')).not.toHaveAttribute('data-target', 'yes'); // two pawns on file 5
    await expect(sq(page, '4e')).toHaveAttribute('data-target', 'yes');
  });

  test('a check is shown, and only moves that answer it are offered', async ({ page }) => {
    await start(page, { mode: 'pvp', sfen: '4r3k/9/9/9/9/9/9/9/4K4 b G 1' });
    await expect(page.locator('.board-status')).toContainText('Check!');
    await sq(page, '5i').click();
    await expect(sq(page, '4i')).toHaveAttribute('data-target', 'yes');
    await expect(sq(page, '5h')).not.toHaveAttribute('data-target', 'yes');
  });

  test('moves are written down and can be taken back; resigning ends the game', async ({ page }) => {
    await start(page, { mode: 'pvp' });
    await move(page, '7g', '7f');
    await move(page, '3c', '3d');
    await expect(page.locator('.ch-moves')).toContainText('1. P7g-7f P3c-3d');
    await page.locator('[data-action="undo"]').click();
    await expect(play(page)).toHaveAttribute('data-moves', '1');
    await expect(sq(page, '3c')).toHaveAttribute('data-piece', 'w:P');
    await page.locator('[data-action="resign"]').click();
    await expect(page.locator('.end-card')).toContainText('Gote resigned');
    await expect(play(page)).toHaveAttribute('data-result', 'resigned');
  });

  test('against the computer: it replies by itself, you cannot move for it, and undo takes back both moves', async ({ page }) => {
    await start(page, { level: 'Easy' });
    await move(page, '7g', '7f');
    await expect(play(page)).toHaveAttribute('data-thinking', 'yes');
    await expect(page.locator('.board-status')).toContainText('Computer is thinking');
    await expect(sq(page, '7f')).toBeDisabled();
    await expect(play(page)).toHaveAttribute('data-turn', '0', { timeout: 10_000 });
    await expect(play(page)).toHaveAttribute('data-moves', '2');
    await page.locator('[data-action="undo"]').click();
    await expect(play(page)).toHaveAttribute('data-moves', '0');
    await expect(sq(page, '7g')).toHaveAttribute('data-piece', 'b:P');
  });

  test('playing Gote: the board is turned round and the computer opens', async ({ page }) => {
    await start(page, { level: 'Easy', side: 'Gote' });
    await expect(play(page)).toHaveAttribute('data-bottom', '1');
    await expect(play(page)).toHaveAttribute('data-moves', '1', { timeout: 10_000 });
    expect(await page.locator('[data-square]').first().getAttribute('data-square')).toBe('1i');
    await page.locator('[data-action="flip"]').click();
    await expect(play(page)).toHaveAttribute('data-bottom', '0');
  });

  for (const width of [320, 390, 1280]) {
    test(`no sideways scrolling at ${width}px, and the board is square`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await start(page, { mode: 'pvp' });
      for (const [a, b] of [['7g', '7f'], ['3c', '3d'], ['2g', '2f'], ['8c', '8d']] as [string, string][]) await move(page, a, b);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      const box = await page.locator('.sg-board').boundingBox();
      expect(Math.abs((box?.width ?? 0) - (box?.height ?? 1))).toBeLessThan(2);
      expect(box?.width ?? 0).toBeGreaterThan(Math.min(width, 560) - 40);
    });
  }
});
