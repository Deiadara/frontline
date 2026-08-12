import { CITY_DISTRICTS } from '@frontline/shared';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * REAL end-to-end: no `/api` interception. This drives the actual UI against the
 * real Fastify server (started on :4000, proxied through Vite's dev server) and
 * exercises the full flow — register → pick overseer → game → base → battle —
 * proving the two halves talk (proxy, JWT header, shared Zod parsing on real
 * payloads). A screenshot is captured at every step.
 */

test.use({ viewport: { width: 1280, height: 800 } });

/** External noise we never treat as an app bug. */
function isBenign(text: string): boolean {
  return (
    /fonts\.(googleapis|gstatic)/i.test(text) ||
    /favicon/i.test(text) ||
    /ResizeObserver loop/i.test(text)
  );
}

const shot = (page: Page, step: string) =>
  page.screenshot({ path: `screenshots/live/${step}.png`, fullPage: false });

test('live: register → overseer → game → base → battle against the real backend', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => {
    if (!isBenign(err.message)) pageErrors.push(err.message);
  });
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' && !isBenign(msg.text())) consoleErrors.push(msg.text());
  });

  // Unique per run so reruns never collide on the UNIQUE username constraint.
  const username = `live_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const password = 'password1234';

  // --- STEP 1: auth (register a fresh operator) ---
  await page.goto('/auth');
  await expect(page.getByRole('heading', { name: 'FRONTLINE' })).toBeVisible();
  await page.getByRole('button', { name: 'register', exact: true }).click();
  await page.getByLabel('Operator ID').fill(username);
  await page.getByLabel('Passphrase').fill(password);
  await shot(page, 'auth');
  await page.getByRole('button', { name: 'Enlist' }).click();

  // --- STEP 2: character select (redirected here once registered, no overseer yet) ---
  await expect(page.getByRole('heading', { name: 'CHOOSE YOUR OVERSEER' })).toBeVisible();
  const overseerName = 'Marcus "Bulwark" Kane';
  await page.getByText(overseerName).click();
  const confirm = page.getByRole('button', { name: 'Confirm Overseer' });
  await expect(confirm).toBeEnabled();
  await shot(page, 'character-select');
  await confirm.click();

  // --- STEP 3: game shell + city map ---
  await page.waitForURL('**/game');
  const hud = page.locator('header'); // the TopHud; scopes name away from the char-select DOM
  await expect(hud.getByText(overseerName)).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  // Starting stockpile is rendered in the HUD before any battle.
  await expect(hud).toContainText('500');
  await page.waitForTimeout(800); // let Pixi paint the map before the screenshot
  await shot(page, 'game');

  // --- STEP 4: base panel ---
  await page.getByRole('link', { name: 'Base', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Foothold/ })).toBeVisible();
  await expect(page.getByText('Command Center')).toBeVisible();
  await expect(page.getByText('Fusion Reactor')).toBeVisible();
  await shot(page, 'base');

  // --- STEP 5: battle (attack a raid node, retry through the coin-flip until a win) ---
  await page.getByRole('link', { name: 'Map', exact: true }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(800);

  const rustyard = CITY_DISTRICTS.find((d) => d.id === 'rustyard');
  if (!rustyard) throw new Error('missing rustyard district');
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(
    box.x + rustyard.position.x * box.width,
    box.y + rustyard.position.y * box.height,
  );
  // Selecting the node surfaces its intel + the attack action.
  await expect(page.getByRole('heading', { name: 'The Rustyard' })).toBeVisible();
  const launch = page.getByRole('button', { name: 'Launch Attack' });
  await expect(launch).toBeVisible();

  let won = false;
  for (let attempt = 0; attempt < 15 && !won; attempt++) {
    await launch.click();
    const outcome = page.getByRole('heading', { name: /VICTORY|DEFEAT/ });
    await expect(outcome).toBeVisible();
    won = ((await outcome.textContent()) ?? '').includes('VICTORY');
    if (won) break;
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(launch).toBeVisible();
  }
  expect(won, 'attacker should win within 15 coin-flips').toBe(true);

  // Rustyard pays alloy 120 + credits 60, so the first win lifts the fresh base
  // from its 500/200 start to exactly 560/320 — proof the reward was applied.
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'VICTORY' })).toBeVisible();
  await expect(dialog).toContainText('560'); // credits
  await expect(dialog).toContainText('320'); // alloy
  await shot(page, 'battle');

  // The updated stockpile is also reflected in the persistent HUD after refetch.
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('header')).toContainText('560');

  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
});
