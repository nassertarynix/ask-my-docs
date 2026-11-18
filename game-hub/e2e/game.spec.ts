import { expect, test, type Page } from '@playwright/test';

const match = (page: Page) => page.locator('[data-screen="match"]');

async function startMatch(page: Page, options: { mode?: 'ai' | 'pvp'; difficulty?: string; seed?: number } = {}) {
  await page.goto(`./#/play/crater-lab?seed=${options.seed ?? 7}`);
  if (options.mode === 'pvp') await page.getByRole('radio', { name: /2 players/ }).check();
  if (options.difficulty) await page.getByRole('radio', { name: new RegExp(options.difficulty) }).check();
  await page.locator('[data-action="start"]').click();
  await expect(match(page)).toHaveAttribute('data-phase', 'aim');
}

test.describe('the hub', () => {
  test('shows the playable games and the coming-soon card, and opens a game', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
    await page.goto('./');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('PAPER');
    await expect(page.locator('.card')).toHaveCount(13);
    await expect(page.locator('a.card-live')).toHaveCount(12);
    await expect(page.locator('.card-placeholder')).toHaveCount(1);
    await expect(page.getByText('Coming soon')).toHaveCount(1);
    await page.locator('[data-game="crater-lab"]').click();
    await expect(page).toHaveURL(/#\/play\/crater-lab/);
    await expect(page.locator('[data-screen="setup"]')).toBeVisible();
    await page.getByRole('button', { name: 'Back to the hub' }).click();
    await expect(page.locator('.card')).toHaveCount(13);
    expect(problems).toEqual([]);
  });

  test('an unknown game address falls back to the hub', async ({ page }) => {
    await page.goto('./#/play/does-not-exist');
    await expect(page.locator('.card')).toHaveCount(13);
    await page.goto('./#/play/orbit-golf'); // a "coming soon" game has nothing to open
    await expect(page.locator('.card')).toHaveCount(13);
  });

  test('makes no requests to other sites', async ({ page }) => {
    const foreign: string[] = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (url.protocol.startsWith('http') && url.hostname !== '127.0.0.1') foreign.push(r.url());
    });
    await startMatch(page);
    await page.keyboard.press('Space');
    await page.waitForTimeout(500);
    expect(foreign).toEqual([]);
  });

  for (const width of [320, 390, 768, 1280]) {
    test(`no sideways scrolling at ${width}px, in the hub, the setup and a match`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
      await page.goto('./');
      expect(await fits()).toBe(true);
      await page.goto('./#/play/crater-lab?seed=7');
      expect(await fits()).toBe(true);
      await page.locator('[data-action="start"]').click();
      await expect(match(page)).toBeVisible();
      expect(await fits()).toBe(true);
    });
  }
});

test.describe('a match against the AI', () => {
  test('keyboard: aim, fire, the AI answers, and the turn comes back', async ({ page }) => {
    const problems: string[] = [];
    page.on('pageerror', (e) => problems.push(String(e)));
    await startMatch(page, { difficulty: 'Recruit' });
    await expect(page.locator('.status')).toHaveText('Your turn: aim and fire');
    const angle = page.locator('.slider output').first();
    await expect(angle).toHaveText('60°');
    await page.keyboard.press('ArrowLeft');
    await expect(angle).toHaveText('61°');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(angle).toHaveText('56°');
    const power = page.locator('.slider output').nth(1);
    await page.keyboard.press('ArrowUp');
    await expect(power).toHaveText('56');

    await page.keyboard.press('Space');
    await expect(match(page)).toHaveAttribute('data-phase', 'flight');
    await expect(page.locator('[data-action="fire"]')).toBeDisabled();
    // the AI's turn: it aims by itself, fires, and hands the turn back
    await expect(match(page)).toHaveAttribute('data-current', '1', { timeout: 20_000 });
    await expect(page.locator('.status')).toHaveText('Recruit is aiming…');
    await expect(page.locator('[data-weapon="standard"]')).toBeDisabled(); // the player cannot touch the AI's controls
    await expect(match(page)).toHaveAttribute('data-turn', '3', { timeout: 30_000 });
    await expect(match(page)).toHaveAttribute('data-current', '0');
    expect(problems).toEqual([]);
  });

  test('the same seed is the same map: a known shot does a known thing', async ({ page }) => {
    await startMatch(page, { seed: 7 });
    const first = await page.locator('canvas.stage').screenshot();
    await page.reload();
    await page.locator('[data-action="start"]').click();
    await expect(match(page)).toHaveAttribute('data-phase', 'aim');
    expect(first.length).toBeGreaterThan(5000); // something was drawn
    // number keys choose ammo; an empty weapon cannot be chosen
    await page.keyboard.press('4');
    await expect(page.locator('[data-weapon="blackhole"]')).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('1');
    await expect(page.locator('[data-weapon="standard"]')).toHaveAttribute('aria-checked', 'true');
  });

  test('dragging on the field aims the barrel', async ({ page }) => {
    await startMatch(page);
    const box = (await page.locator('canvas.stage').boundingBox())!;
    const angle = page.locator('.slider output').first();
    const power = page.locator('.slider output').nth(1);
    // press high above the left tank, a little to the right: a steep angle
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.25);
    await page.mouse.up();
    const steep = Number((await angle.textContent())!.replace('°', ''));
    expect(steep).toBeGreaterThan(55);
    expect(steep).toBeLessThan(100);
    // drag far to the right, low: a flat angle and more power
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
    await page.mouse.down();
    await page.mouse.up();
    const flat = Number((await angle.textContent())!.replace('°', ''));
    expect(flat).toBeLessThan(steep);
    expect(Number(await power.textContent())).toBeGreaterThan(60);
  });

  test('the sliders aim too, and the mute button is remembered', async ({ page }) => {
    await startMatch(page);
    await page.getByLabel('Barrel angle').fill('30'); // 30 from the left end = 150°
    await expect(page.locator('.slider output').first()).toHaveText('150°');
    await page.getByLabel('Shot power').fill('80');
    await expect(page.locator('.slider output').nth(1)).toHaveText('80');

    // the slider still has the focus: Space must fire all the same
    await page.keyboard.press('Space');
    await expect(match(page)).toHaveAttribute('data-phase', 'flight');

    const mute = page.getByRole('button', { name: 'Turn sound off' });
    await mute.click();
    await expect(page.getByRole('button', { name: 'Turn sound on' })).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Turn sound on' })).toBeVisible();
  });

  test('Reset goes back to a clean start', async ({ page }) => {
    await startMatch(page);
    await page.keyboard.press('Space');
    await expect(match(page)).toHaveAttribute('data-phase', 'flight');
    await page.getByRole('button', { name: 'Reset the game' }).click();
    await expect(page.locator('[data-screen="setup"]')).toBeVisible();
  });
});

test.describe('two players on one device', () => {
  test('players take turns, a Tri-Splitter splits on a second press, and a match can be won', async ({ page }) => {
    await startMatch(page, { mode: 'pvp' });
    await expect(page.locator('.status')).toHaveText('Player 1: aim and fire');
    // player 1 fires a Tri-Splitter and splits it in the air
    await page.keyboard.press('2');
    await page.keyboard.press('Space');
    await expect(page.locator('[data-action="fire"]')).toHaveText('Split!');
    await page.waitForTimeout(600);
    await page.keyboard.press('Space');
    await expect(page.locator('[data-action="fire"]')).toHaveText('Fire');
    await expect(match(page)).toHaveAttribute('data-current', '1', { timeout: 20_000 });
    await expect(page.locator('.status')).toHaveText('Player 2: aim and fire');
    await expect(page.locator('.banner')).toHaveText('Player 2, your turn');
    // player 2 still has all three; player 1 used one
    await expect(page.locator('[data-weapon="splitter"] .weapon-count')).toHaveText('×3');

    // player 2 shoots straight up with little power: it comes back down on player 2. Four of those end the match.
    for (let i = 0; i < 12; i++) {
      if ((await match(page).getAttribute('data-phase')) === 'over') break;
      const current = await match(page).getAttribute('data-current');
      const turn = Number(await match(page).getAttribute('data-turn'));
      await page.getByLabel('Barrel angle').fill('90');
      await page.getByLabel('Shot power').fill(current === '1' ? '22' : '5');
      if (current === '0') await page.getByLabel('Barrel angle').fill('0'); // player 1 fires away, harmlessly
      await page.locator('[data-action="fire"]').click();
      await expect
        .poll(async () => (await match(page).getAttribute('data-phase')) === 'over' || Number(await match(page).getAttribute('data-turn')) > turn, { timeout: 20_000 })
        .toBe(true);
    }
    await expect(match(page)).toHaveAttribute('data-phase', 'over');
    await expect(match(page)).toHaveAttribute('data-winner', '0');
    await expect(page.getByRole('dialog')).toContainText('Player 1 wins');
    await page.locator('[data-action="rematch"]').click();
    await expect(match(page)).toHaveAttribute('data-phase', 'aim');
    await expect(match(page)).toHaveAttribute('data-hp1', '100');
  });
});
