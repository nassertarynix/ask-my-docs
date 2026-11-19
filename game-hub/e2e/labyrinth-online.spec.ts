import { expect, test, type Page } from '@playwright/test';
import { startRelay, type DevRelay } from '../relay/dev-server';

// These tests run the room relay locally (the same RoomCore the Cloudflare Worker uses) and play real browser tabs against it.
test.describe.configure({ mode: 'serial' });

let relay: DevRelay;
test.beforeAll(async () => {
  relay = await startRelay(0);
});
test.afterAll(async () => {
  await relay.close();
});

const query = (seed = 1) => `relay=${encodeURIComponent(`ws://127.0.0.1:${relay.port}`)}&fast=1&seed=${seed}`;
const play = (page: Page) => page.locator('[data-screen="play"]');

async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto(`./#/play/labyrinth?${query()}`);
  await page.reload();
  await page.getByRole('radio', { name: /Online with friends/ }).check();
  await page.locator('[data-field="name"]').fill(name);
  await page.locator('[data-action="create"]').click();
  await expect(page.locator('[data-screen="lobby"]')).toBeVisible();
  const code = await page.locator('[data-room-code]').getAttribute('data-room-code');
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
  return code as string;
}

async function joinRoom(page: Page, code: string, name: string) {
  await page.goto(`./#/play/labyrinth?room=${code}&${query()}`);
  await page.reload();
  await expect(page.locator('[data-field="code"]')).toHaveValue(code);
  await page.locator('[data-field="name"]').fill(name);
  await page.locator('[data-action="join"]').click();
  await expect(page.locator('[data-screen="lobby"]')).toBeVisible();
}

/** Do whatever the die asks for whoever's turn it is on this page, once. */
async function act(page: Page) {
  const face = await play(page).getAttribute('data-face');
  if (face === 'wall') {
    const fresh = page.locator('[data-action="new-wall"]');
    if (await fresh.isEnabled()) await fresh.click();
    else await page.locator('.lb-ready').first().click();
  } else if (face !== 'minotaur') {
    await page.locator('.lb-ready').first().click();
  }
  await page.locator('[data-target="yes"]').first().click();
}

const board = async (p: Page) => (await p.locator('[data-hero],[data-minotaur]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-hero') ?? 'M'}@${e.parentElement?.getAttribute('data-cell')}`))).sort().join(',');

async function startTwoHumans(page: Page, guest: Page) {
  const code = await createRoom(page, 'Ada');
  await joinRoom(guest, code, 'Bo');
  await expect(page.locator('.gm-roster li')).toHaveCount(2);
  await page.locator('[data-action="begin"]').click();
  await expect(play(page)).toBeVisible();
  await expect(play(guest)).toBeVisible();
  return code;
}

test.describe('Laby // Rinth (online, through a local relay)', () => {
  test('a friend joins from the invite link and both are on the same board in their own seats', async ({ page, context }) => {
    const guest = await context.newPage();
    await startTwoHumans(page, guest);
    await expect(play(page)).toHaveAttribute('data-my-seat', '0');
    await expect(play(guest)).toHaveAttribute('data-my-seat', '1');
    await expect(page.locator('[data-cell]')).toHaveCount(225);
    expect(await board(guest)).toBe(await board(page));
    await expect(guest.locator('.lb-players .score')).toHaveCount(2);
  });

  test('moves reach the other player, in turn, and only the player whose turn it is can act', async ({ page, context }) => {
    const guest = await context.newPage();
    await startTwoHumans(page, guest);
    const turn = Number(await play(page).getAttribute('data-turn'));
    const [mover, waiter] = turn === 0 ? [page, guest] : [guest, page];
    await expect(waiter.locator('button.lb-cell')).toHaveCount(0); // nothing to tap when it is not your turn
    const before = await board(waiter);
    await act(mover);
    await expect(play(waiter)).toHaveAttribute('data-turn', String(1 - turn));
    await expect.poll(() => board(waiter)).not.toBe(before);
    expect(await board(waiter)).toBe(await board(mover));
    await expect(waiter.locator('.gm-log')).toContainText('rolled');
    await expect(waiter.locator('button.lb-cell, [data-action="new-wall"]').first()).toBeVisible(); // now it is the waiter's turn
  });

  test('a player who refreshes the page is put back in their seat with the board as it was', async ({ page, context }) => {
    const guest = await context.newPage();
    await startTwoHumans(page, guest);
    const turn = Number(await play(page).getAttribute('data-turn'));
    await act(turn === 0 ? page : guest);
    await expect(play(turn === 0 ? guest : page)).toHaveAttribute('data-turn', String(1 - turn));
    await guest.reload();
    await expect(play(guest)).toBeVisible({ timeout: 10_000 });
    await expect(play(guest)).toHaveAttribute('data-my-seat', '1');
    expect(await board(guest)).toBe(await board(page));
  });

  test('empty seats are filled by computers that the host\'s device plays', async ({ page, context }) => {
    const guest = await context.newPage();
    const code = await createRoom(page, 'Ada');
    await joinRoom(guest, code, 'Bo');
    await expect(page.locator('.gm-roster li')).toHaveCount(2);
    await page.getByRole('radio', { name: /^3/ }).check();
    await page.getByRole('radio', { name: /^Easy/ }).check();
    await page.locator('[data-action="begin"]').click();
    await expect(play(guest)).toBeVisible();
    await expect(guest.locator('.lb-players .score')).toHaveCount(3);
    await expect(guest.locator('.lb-players')).toContainText('Ariadne');
    // play a few turns: the people act when it is their turn, the computer plays by itself
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline && Number(await guest.locator('[data-screen="play"]').getAttribute('data-turns')) < 9) {
      for (const p of [page, guest]) {
        const seat = await play(p).getAttribute('data-my-seat');
        if ((await play(p).getAttribute('data-turn')) === seat && (await play(p).getAttribute('data-over')) !== 'yes') await act(p).catch(() => undefined);
      }
      await page.waitForTimeout(30);
    }
    expect(Number(await guest.locator('[data-screen="play"]').getAttribute('data-turns'))).toBeGreaterThanOrEqual(9);
    await expect(guest.locator('.gm-log')).toContainText('Ariadne');
    await page.waitForTimeout(300);
    expect(await board(guest)).toBe(await board(page));
  });

  test('a fifth player is refused (four at most)', async ({ page, context }) => {
    const code = await createRoom(page, 'Ada');
    for (const n of ['Bo', 'Cy', 'Di']) await joinRoom(await context.newPage(), code, n);
    await expect(page.locator('.gm-roster li')).toHaveCount(4);
    const fifth = await context.newPage();
    await fifth.goto(`./#/play/labyrinth?room=${code}&${query()}`);
    await fifth.reload();
    await fifth.locator('[data-field="name"]').fill('Ed');
    await fifth.locator('[data-action="join"]').click();
    await expect(fifth.locator('[data-screen="failed"]')).toContainText('full');
  });
});
