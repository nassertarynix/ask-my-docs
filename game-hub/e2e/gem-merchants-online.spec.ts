import { expect, test, type Page } from '@playwright/test';
import { startRelay, type DevRelay } from '../relay/dev-server';

// These tests run the room relay locally (the same RoomCore the Cloudflare Worker uses) and play two real browser tabs against it.
test.describe.configure({ mode: 'serial' });

let relay: DevRelay;
test.beforeAll(async () => {
  relay = await startRelay(0);
});
test.afterAll(async () => {
  await relay.close();
});

const query = () => `relay=${encodeURIComponent(`ws://127.0.0.1:${relay.port}`)}&fast=1`;
const play = (page: Page) => page.locator('[data-screen="play"]');
const supply = (page: Page, gem: string) => page.locator(`[data-supply="${gem}"]`);

async function createRoom(page: Page, name: string): Promise<string> {
  await page.goto(`./#/play/gem-merchants?${query()}`);
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
  await page.goto(`./#/play/gem-merchants?room=${code}&${query()}`); // the invite link
  await page.reload();
  await expect(page.locator('[data-field="code"]')).toHaveValue(code); // the link filled it in
  await page.locator('[data-field="name"]').fill(name);
  await page.locator('[data-action="join"]').click();
  await expect(page.locator('[data-screen="lobby"]')).toBeVisible();
}

async function twoPlayerGame(page: Page, guest: Page) {
  const code = await createRoom(page, 'Ada');
  await joinRoom(guest, code, 'Bo');
  await expect(page.locator('.gm-roster li')).toHaveCount(2);
  await expect(guest.locator('.gm-roster li')).toHaveCount(2);
  await page.getByRole('radio', { name: /^2/ }).check();
  await page.locator('[data-action="begin"]').click();
  await expect(play(page)).toBeVisible();
  await expect(play(guest)).toBeVisible();
  return code;
}

test.describe('Gem Merchants (online, through a local relay)', () => {
  test('a room has a code; a friend joins from the invite link and sees who is hosting', async ({ page, context }) => {
    const guest = await context.newPage();
    const code = await createRoom(page, 'Ada');
    await expect(page.locator('.gm-roster')).toContainText('Ada (you) · host');
    await expect(page.locator('[data-action="begin"]')).toBeEnabled();
    await joinRoom(guest, code, 'Bo');
    await expect(guest.locator('.gm-roster')).toContainText('Ada · host');
    await expect(guest.locator('.gm-roster')).toContainText('Bo (you)');
    await expect(guest.locator('[data-action="begin"]')).toHaveCount(0); // only the host starts
    await expect(guest.locator('.gm-note')).toContainText('Waiting for Ada');
    await expect(page.locator('.gm-roster li')).toHaveCount(2);
  });

  test('the host starts the game and both players are in it, in their own seats', async ({ page, context }) => {
    const guest = await context.newPage();
    await twoPlayerGame(page, guest);
    await expect(play(page)).toHaveAttribute('data-my-seat', '0');
    await expect(play(guest)).toHaveAttribute('data-my-seat', '1');
    await expect(play(page)).toHaveAttribute('data-scores', '0,0');
    await expect(play(guest)).toHaveAttribute('data-scores', '0,0');
    // the same stalls on both screens
    const cards = (p: Page) => p.locator('.gm-board [data-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')));
    expect(await cards(guest)).toEqual(await cards(page));
  });

  test('moves reach the other player, in turn, and only the player whose turn it is can move', async ({ page, context }) => {
    const guest = await context.newPage();
    await twoPlayerGame(page, guest);
    await expect(supply(guest, 'amber')).toBeDisabled(); // not the guest's turn
    for (const g of ['amber', 'azure', 'jade']) await supply(page, g).click();
    await page.locator('[data-action="take"]').click();
    await expect(play(guest)).toHaveAttribute('data-turn', '1');
    await expect(guest.locator('.gm-other[data-seat="0"]')).toHaveAttribute('data-tokens', '3');
    await expect(guest.locator('.gm-log')).toContainText('Ada took Amber, Azure, Jade');
    await expect(supply(page, 'pearl')).toBeDisabled(); // now it is the guest's turn
    await supply(guest, 'pearl').click();
    await supply(guest, 'pearl').click();
    await guest.locator('[data-action="take"]').click();
    await expect(play(page)).toHaveAttribute('data-turn', '0');
    await expect(page.locator('.gm-other[data-seat="1"]')).toHaveAttribute('data-tokens', '2');
    await expect(page.locator('.gm-log')).toContainText('Bo took two Pearl');
    await expect(supply(page, 'pearl')).toHaveAttribute('data-count', '2');
    await expect(supply(guest, 'pearl')).toHaveAttribute('data-count', '2');
  });

  test('a player who refreshes the page is put back in their seat with the game as it was', async ({ page, context }) => {
    const guest = await context.newPage();
    await twoPlayerGame(page, guest);
    for (const g of ['amber', 'azure', 'jade']) await supply(page, g).click();
    await page.locator('[data-action="take"]').click();
    await expect(play(guest)).toHaveAttribute('data-turn', '1');
    await guest.reload(); // as if the phone had thrown the tab away
    await expect(play(guest)).toBeVisible({ timeout: 10_000 });
    await expect(play(guest)).toHaveAttribute('data-my-seat', '1');
    await expect(play(guest)).toHaveAttribute('data-turn', '1');
    await expect(guest.locator('.gm-other[data-seat="0"]')).toHaveAttribute('data-tokens', '3');
    await supply(guest, 'jet').click();
    await supply(guest, 'pearl').click();
    await supply(guest, 'azure').click();
    await guest.locator('[data-action="take"]').click();
    await expect(play(page)).toHaveAttribute('data-turn', '0');
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
    await expect(guest.locator('.gm-other')).toHaveCount(2);
    for (const g of ['amber', 'azure', 'jade']) await supply(page, g).click();
    await page.locator('[data-action="take"]').click();
    await supply(guest, 'pearl').click();
    await supply(guest, 'jet').click();
    await supply(guest, 'azure').click();
    await guest.locator('[data-action="take"]').click();
    await expect(play(page)).toHaveAttribute('data-turn', '0', { timeout: 10_000 }); // the computer in seat 2 played in between
    await expect(play(guest)).toHaveAttribute('data-turns', '3');
    await expect(guest.locator('.gm-log')).toContainText('Marlowe');
  });

  test('a latecomer is told the game has already started', async ({ page, context }) => {
    const guest = await context.newPage();
    const late = await context.newPage();
    const code = await twoPlayerGame(page, guest);
    await late.goto(`./#/play/gem-merchants?room=${code}&${query()}`);
    await late.reload();
    await late.locator('[data-field="name"]').fill('Cy');
    await late.locator('[data-action="join"]').click();
    await expect(late.locator('[data-screen="failed"]')).toContainText('already started');
  });

  test('if the host leaves the lobby, the next player becomes host', async ({ page, context }) => {
    const guest = await context.newPage();
    const code = await createRoom(page, 'Ada');
    await joinRoom(guest, code, 'Bo');
    await expect(guest.locator('.gm-note')).toContainText('Waiting for Ada');
    await page.getByRole('button', { name: 'Leave' }).click();
    await expect(guest.locator('[data-action="begin"]')).toBeVisible();
    await expect(guest.locator('.gm-roster li')).toHaveCount(1);
  });

  test('a fifth player is refused', async ({ page, context }) => {
    const names = ['Bo', 'Cy', 'Di'];
    const code = await createRoom(page, 'Ada');
    for (const n of names) await joinRoom(await context.newPage(), code, n);
    await expect(page.locator('.gm-roster li')).toHaveCount(4);
    const fifth = await context.newPage();
    await fifth.goto(`./#/play/gem-merchants?room=${code}&${query()}`);
    await fifth.reload();
    await fifth.locator('[data-field="name"]').fill('Ed');
    await fifth.locator('[data-action="join"]').click();
    await expect(fifth.locator('[data-screen="failed"]')).toContainText('full');
  });

  test('the page makes no request to any other site while playing online', async ({ page, context }) => {
    const foreign: string[] = [];
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (!['127.0.0.1'].includes(u.hostname) && u.protocol.startsWith('http')) foreign.push(r.url());
    });
    const guest = await context.newPage();
    await twoPlayerGame(page, guest);
    expect(foreign).toEqual([]);
  });
});
