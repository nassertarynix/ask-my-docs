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

const query = (seed = 5) => `relay=${encodeURIComponent(`ws://127.0.0.1:${relay.port}`)}&fast=1&seed=${seed}`;
const play = (page: Page) => page.locator('[data-screen="play"]');

async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto(`./#/play/pit-brawl?${query()}`);
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
  await page.goto(`./#/play/pit-brawl?room=${code}&${query()}`);
  await page.reload();
  await expect(page.locator('[data-field="code"]')).toHaveValue(code);
  await page.locator('[data-field="name"]').fill(name);
  await page.locator('[data-action="join"]').click();
  await expect(page.locator('[data-screen="lobby"]')).toBeVisible();
}

async function setBots(page: Page, n: number) {
  await page.locator('[data-field="bots"]').evaluate((el, v) => {
    const input = el as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, String(v));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, n);
  await expect(page.locator('[data-output="bots"]')).toHaveText(String(n));
}

/** Play one card for whoever's turn it is on this page, until the turn moves to someone else. */
async function takeTurn(page: Page) {
  const seat = await play(page).getAttribute('data-my-seat');
  for (let i = 0; i < 6 && (await play(page).getAttribute('data-turn')) === seat && (await play(page).getAttribute('data-over')) !== 'yes'; i++) {
    const before = `${await play(page).getAttribute('data-turns')}/${await play(page).getAttribute('data-plays')}`;
    await page.locator('.pb-card:not([disabled])').first().click();
    const target = page.locator('.pb-tile[data-target="yes"]').first();
    if (await target.count()) await target.click();
    else await page.locator('[data-action="play"]').click();
    await page.waitForFunction((b) => { const p = document.querySelector('[data-screen="play"]'); return !!p && `${p.getAttribute('data-turns')}/${p.getAttribute('data-plays')}` !== b; }, before, { timeout: 5000 });
  }
}

async function startTwoHumans(page: Page, guest: Page) {
  const code = await createRoom(page, 'Ada');
  await joinRoom(guest, code, 'Bo');
  await expect(page.locator('.gm-roster li')).toHaveCount(2);
  await page.locator('[data-action="begin"]').click();
  await expect(play(page)).toBeVisible();
  await expect(play(guest)).toBeVisible();
  return code;
}

test.describe('Pit Brawl (online, through a local relay)', () => {
  test('a friend joins from the invite link; the host can add computers, up to ten at the table', async ({ page, context }) => {
    const guest = await context.newPage();
    const code = await createRoom(page, 'Ada');
    await joinRoom(guest, code, 'Bo');
    await expect(guest.locator('.gm-roster')).toContainText('Ada · host');
    await expect(guest.locator('[data-action="begin"]')).toHaveCount(0);
    await expect(guest.locator('.gm-note')).toContainText('Waiting for Ada');
    await expect(page.locator('[data-field="bots"]')).toHaveAttribute('max', '8'); // two people here, ten seats
    await setBots(page, 8);
  });

  test('both players are in the game, with their own hand and a different hero each', async ({ page, context }) => {
    const guest = await context.newPage();
    await startTwoHumans(page, guest);
    await expect(play(page)).toHaveAttribute('data-my-seat', '0');
    await expect(play(guest)).toHaveAttribute('data-my-seat', '1');
    await expect(page.locator('.pb-tile')).toHaveCount(2);
    await expect(guest.locator('.pb-tile')).toHaveCount(2);
    const heroes = async (p: Page) => p.locator('.pb-tile-name small').allTextContents();
    expect(await heroes(page)).toEqual(await heroes(guest));
    expect(new Set(await heroes(page)).size).toBe(2);
    await expect(page.locator('.pb-card')).not.toHaveCount(0);
    await expect(guest.locator('.pb-card')).not.toHaveCount(0);
  });

  test('plays reach the other player, and only the player whose turn it is can play', async ({ page, context }) => {
    const guest = await context.newPage();
    await startTwoHumans(page, guest);
    const turn = Number(await play(page).getAttribute('data-turn'));
    const [mover, waiter] = turn === 0 ? [page, guest] : [guest, page];
    await expect(waiter.locator('.pb-card').first()).toBeDisabled();
    await takeTurn(mover);
    await expect(play(waiter)).toHaveAttribute('data-turn', String(1 - turn));
    await expect(waiter.locator('.gm-log')).toContainText('played');
    await expect(mover.locator('.gm-log')).toContainText('played');
    await expect(mover.locator('.pb-card').first()).toBeDisabled();
    await expect(waiter.locator('.pb-card:not([disabled])').first()).toBeVisible();
    // and the other way round
    await takeTurn(waiter);
    await expect(play(mover)).toHaveAttribute('data-turn', String(turn));
  });

  test('three people and seven computers make a table of ten, and the host\'s device plays the computers', async ({ page, context }) => {
    const g1 = await context.newPage();
    const g2 = await context.newPage();
    const code = await createRoom(page, 'Ada');
    await joinRoom(g1, code, 'Bo');
    await joinRoom(g2, code, 'Cy');
    await expect(page.locator('.gm-roster li')).toHaveCount(3);
    await setBots(page, 7);
    await page.locator('[data-action="begin"]').click();
    for (const p of [page, g1, g2]) {
      await expect(p.locator('.pb-tile')).toHaveCount(10);
      await expect(p.locator('.pb-tile').first()).toHaveAttribute('data-hp', '22');
    }
    await expect(g2.locator('.pb-tile-name').filter({ hasText: 'Rook' })).toHaveCount(1);
    // let the game run: whenever it is one of the people's turn, they play; the computers play by themselves
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline && Number(await g1.locator('[data-screen="play"]').getAttribute('data-turns')) < 25) {
      for (const p of [page, g1, g2]) {
        if ((await play(p).getAttribute('data-over')) === 'yes') break;
        const seat = await play(p).getAttribute('data-my-seat');
        if ((await play(p).getAttribute('data-turn')) === seat && (await p.locator(`.pb-tile[data-seat="${seat}"]`).getAttribute('data-alive')) === 'yes') await takeTurn(p).catch(() => undefined);
      }
      await page.waitForTimeout(30);
    }
    expect(Number(await g1.locator('[data-screen="play"]').getAttribute('data-turns'))).toBeGreaterThanOrEqual(25);
    await expect(g1.locator('.gm-log')).toContainText(/played/);
    const states = async (p: Page) => (await p.locator('.pb-tile').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-hp')}/${e.getAttribute('data-alive')}`))).join(',');
    await page.waitForTimeout(300); // let the last message land everywhere
    expect(await states(g1)).toBe(await states(page));
    expect(await states(g2)).toBe(await states(page));
  });

  test('a player who refreshes the page is put back in their seat with the game as it was', async ({ page, context }) => {
    const guest = await context.newPage();
    await startTwoHumans(page, guest);
    const turn = Number(await play(page).getAttribute('data-turn'));
    await takeTurn(turn === 0 ? page : guest);
    await guest.reload();
    await expect(play(guest)).toBeVisible({ timeout: 10_000 });
    await expect(play(guest)).toHaveAttribute('data-my-seat', '1');
    const tiles = async (p: Page) => (await p.locator('.pb-tile').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-hp')}/${e.getAttribute('data-hand')}`))).join(',');
    expect(await tiles(guest)).toBe(await tiles(page));
  });

  test('a room takes more than four people (the card game next door stops at four)', async ({ page, context }) => {
    const code = await createRoom(page, 'Ada');
    for (const n of ['Bo', 'Cy', 'Di', 'Ed']) await joinRoom(await context.newPage(), code, n);
    await expect(page.locator('.gm-roster li')).toHaveCount(5);
    await expect(page.locator('[data-field="bots"]')).toHaveAttribute('max', '5');
  });
});
