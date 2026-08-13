import {
  BOT_DISTRICT_ID,
  MVP_DEV_CREDENTIALS,
  STARTING_RESOURCES,
  buildingCost,
  spendResources,
  addResources,
  findDistrict,
} from '@frontline/shared';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * REAL end-to-end: no `/api` interception. This drives the actual UI against the real
 * Fastify server (both servers are started by playwright.config.ts against a throwaway
 * database) and exercises the MOU-113 flow — log in as the seeded operator, pick an
 * overseer, find the AI rival on the city map, inspect the base, raid the rival and see
 * the salvage land. Every step is captured at both supported viewports.
 */

/** The viewports the board reviews the build at. */
const VIEWPORTS = [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
] as const;

const [DEFAULT_VIEWPORT] = VIEWPORTS;

const botDistrict = findDistrict(BOT_DISTRICT_ID);
if (!botDistrict) throw new Error('fixture error: the bot district is missing from the city map');

/** What standing up the Foundry costs (GDD §D3) — spent in STEP 4, before the raid. */
const FOUNDRY = buildingCost('foundry', 1);

/** Stockpile after the Foundry is paid for and the first raid on the rival is won. */
const AFTER_BUILD = spendResources(STARTING_RESOURCES, FOUNDRY);
const AFTER_RAID = addResources(AFTER_BUILD, botDistrict.rewards);

/** External noise we never treat as an app bug. */
function isBenign(text: string): boolean {
  return /favicon/i.test(text) || /ResizeObserver loop/i.test(text);
}

/** The origins this flow is allowed to touch — everything else is a third-party dependency. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1']);

/**
 * Screenshot the current screen at every supported viewport, then restore the default.
 * The map is Pixi-rendered off a ResizeObserver, so each resize needs a beat to repaint.
 */
async function shootEveryViewport(page: Page, step: string): Promise<void> {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(600);
    await page.screenshot({
      path: `screenshots/live/${viewport.width}x${viewport.height}/${step}.png`,
      fullPage: false,
    });
  }
  await page.setViewportSize(DEFAULT_VIEWPORT);
  await page.waitForTimeout(400);
}

/** Click a district node on the Pixi canvas by its normalized map position. */
async function clickDistrict(page: Page, position: { x: number; y: number }): Promise<void> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(box.x + position.x * box.width, box.y + position.y * box.height);
}

test('live: Nikos logs in, meets the AI rival and raids it against the real backend', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  // A failed third-party fetch is invisible to both listeners below — Chromium reports it on
  // `requestfailed`, never as a console message — so the hosted-webfont regression MOU-197 closed
  // has to be watched for by origin. `visual.spec.ts` guards `/overseer`; this is the whole flow.
  const offOrigin: string[] = [];
  page.on('request', (req) => {
    if (!LOCAL_HOSTS.has(new URL(req.url()).hostname)) offOrigin.push(req.url());
  });
  page.on('pageerror', (err) => {
    if (!isBenign(err.message)) pageErrors.push(err.message);
  });
  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' && !isBenign(msg.text())) consoleErrors.push(msg.text());
  });

  // --- STEP 1: login as the seeded MVP operator (credentials arrive prefilled) ---
  await page.goto('/auth');
  await expect(page.getByRole('heading', { name: 'FRONTLINE' })).toBeVisible();
  await expect(page.getByLabel('Operator ID')).toHaveValue(MVP_DEV_CREDENTIALS.username);
  await expect(page.getByLabel('Passphrase')).toHaveValue(MVP_DEV_CREDENTIALS.password);
  await expect(page.getByText(/MVP build — dev login prefilled/)).toBeVisible();
  await shootEveryViewport(page, 'login');
  await page.getByRole('button', { name: 'Jack In' }).click();

  // --- STEP 2: overseer select (the seeded operator has no overseer yet) ---
  await expect(page.getByRole('heading', { name: 'CHOOSE YOUR OVERSEER' })).toBeVisible();
  const overseerName = 'Marcus "Bulwark" Kane';
  await page.getByText(overseerName).click();
  const confirm = page.getByRole('button', { name: 'Confirm Overseer' });
  await expect(confirm).toBeEnabled();
  await shootEveryViewport(page, 'overseer-select');
  await confirm.click();

  // --- STEP 3: city map, with the hostile rival marker on Ashen Terraces ---
  await page.waitForURL('**/game');
  const hud = page.locator('header'); // the TopHud; scopes the name away from the char-select DOM
  await expect(hud.getByText(overseerName)).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await expect(hud).toContainText(String(STARTING_RESOURCES.caps));
  await page.waitForTimeout(800); // let Pixi paint the map before the screenshot
  await shootEveryViewport(page, 'city-map');

  // --- STEP 4: the hideout, and building in it against the real server (GDD §A1, §D3) ---
  await page.getByRole('link', { name: 'Base', exact: true }).click();
  await expect(page.getByRole('heading', { name: /Foothold/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Command Center —/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Fusion Reactor —/ })).toBeVisible();
  await shootEveryViewport(page, 'base');

  /*
   * The one place `POST /api/base/build` is exercised end to end: real route, real ledger, real
   * §I1 award. Every other build test stubs the response, so this is what would catch a spend the
   * server refuses for a reason the client mirrored wrongly — the village says it can afford the
   * Foundry, so the server must agree.
   */
  const foundry = page.getByRole('button', { name: /^Foundry —/ });
  await expect(foundry).toHaveAttribute('aria-label', /vacant plot/);
  await foundry.click();
  const plotDialog = page.getByRole('dialog');
  await plotDialog.getByRole('button', { name: 'Build' }).click();
  await expect(foundry).toHaveAttribute('aria-label', /level 1/);
  await plotDialog.getByRole('button', { name: 'Close' }).click();
  // §D3: the oil left the HUD's ledger, not a second counter of the hideout's own.
  await expect(hud).toContainText(String(AFTER_BUILD.oil));
  await shootEveryViewport(page, 'hideout-built');

  // --- STEP 5: raid the AI rival ---
  await page.getByRole('link', { name: 'Map', exact: true }).click();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(800);
  await clickDistrict(page, botDistrict.position);

  // Selecting the rival's district surfaces its intel and the attack action.
  await expect(page.getByRole('heading', { name: botDistrict.name })).toBeVisible();
  await expect(page.getByText('Rival Base')).toBeVisible();
  await expect(page.getByText('Vex Holdings')).toBeVisible();
  await expect(page.getByText(/Hostile/)).toBeVisible();
  const launch = page.getByRole('button', { name: 'Launch Attack' });
  await expect(launch).toBeVisible();
  await shootEveryViewport(page, 'rival-intel');

  // The MVP engine is a coin flip, so retry until the assault lands.
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

  // Losses pay nothing, so the first win lifts the starting stockpile by exactly the
  // rival district's rewards.
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'VICTORY' })).toBeVisible();
  await expect(dialog).toContainText(String(AFTER_RAID.caps));
  await expect(dialog).toContainText(String(AFTER_RAID.scrap));
  // A player never sees a UUID: the narration names the base it deployed from.
  await expect(dialog).toContainText("Nikos's Foothold");
  expect(await dialog.innerText()).not.toMatch(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  );
  await shootEveryViewport(page, 'raid-result');

  // The salvage is also reflected in the persistent HUD after the refetch.
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(dialog).toBeHidden();
  await expect(hud).toContainText(String(AFTER_RAID.caps));

  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  expect(offOrigin, `the flow fetched third-party assets: ${offOrigin.join(' | ')}`).toEqual([]);
});
