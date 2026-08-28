import {
  BOT_DISTRICT_ID,
  MVP_DEV_CREDENTIALS,
  STARTING_RESOURCES,
  buildingCost,
  spendResources,
  findDistrict,
} from '@frontline/shared';
import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * REAL end-to-end: no `/api` interception. This drives the actual UI against the real
 * Fastify server (both servers are started by playwright.config.ts against a throwaway
 * database) and exercises the MOU-113 flow: log in as the seeded operator, pick an
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

/**
 * What ordering the Quarters costs (GDD §D3): spent in STEP 4, before the raid.
 *
 * The Quarters because they are the cheapest thing a level-1 Nexus authorises, and the shortest:
 * this is the one test that waits for a real build to land against a real server clock, and the
 * bottom of the curve is where that wait is measured in seconds rather than hours.
 */
const STARTING_DISTRICT = [
  { id: 'b1', kind: 'nexus' as const, level: 1, modifications: [], damage: 0, fortification: 0 },
  {
    id: 'b2',
    kind: 'generator' as const,
    level: 1,
    modifications: [],
    damage: 0,
    fortification: 0,
  },
];
const QUARTERS = buildingCost('quarters', 1, STARTING_DISTRICT);

/** Stockpile after the Quarters are paid for. */
const AFTER_BUILD = spendResources(STARTING_RESOURCES, QUARTERS);

/** External noise we never treat as an app bug. */
function isBenign(text: string): boolean {
  return /favicon/i.test(text) || /ResizeObserver loop/i.test(text);
}

/** The origins this flow is allowed to touch: everything else is a third-party dependency. */
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

test('live: Nikos logs in, meets the AI rival and raids it against the real backend', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  // A failed third-party fetch is invisible to both listeners below: Chromium reports it on
  // `requestfailed`, never as a console message, so the hosted-webfont regression MOU-197 closed
  // has to be watched for by origin. `visual.spec.ts` guards `/overseer`; this is the whole flow.
  const offOrigin: string[] = [];
  page.on('request', (req) => {
    const url = new URL(req.url());
    // `blob:` and `data:` are the page handing bytes to itself: Pixi builds its image-decode
    // workers that way, two per session. They have no hostname, so an origin test reads them as
    // off-origin, and the guard would then fail on the renderer starting up rather than on anything
    // being fetched from a third party. Nothing leaves the machine either way.
    if (url.protocol === 'blob:' || url.protocol === 'data:') return;
    if (!LOCAL_HOSTS.has(url.hostname)) offOrigin.push(req.url());
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
  await expect(page.getByText(/MVP build. Dev login prefilled/)).toBeVisible();
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
  // By the door rather than by the text: below 1560px the HUD shows the face and drops the
  // nameplate, so the name lives in the link's accessible name at every width the game runs at.
  await expect(
    hud.getByRole('link', { name: new RegExp(`^${overseerName}, Overseer`) }),
  ).toBeVisible();
  await expect(page.getByTestId('city-room')).toBeVisible();
  await expect(hud).toContainText(String(STARTING_RESOURCES.caps));
  await shootEveryViewport(page, 'city');

  // --- STEP 4: the hideout, and building in it against the real server (GDD §A1, §D3) ---
  await page.getByRole('link', { name: 'District', exact: true }).click();
  // The crew's name, read off the sign in the middle of the standing bar. It stopped being a
  // heading when the plaque moved there: the bar carries no page heading now.
  await expect(page.getByTestId('faction-plaque')).toContainText(/Crew/);
  await expect(page.getByRole('button', { name: /^The Nexus,/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^The Generator,/ })).toBeVisible();
  await shootEveryViewport(page, 'base');

  /*
   * The one place `POST /api/base/build` is exercised end to end: real route, real ledger, real
   * §I1 award. Every other build test stubs the response, so this is what would catch a spend the
   * server refuses for a reason the client mirrored wrongly: the district says it can afford the
   * Quarters, so the server must agree.
   */
  const quarters = page.getByRole('button', { name: /^The Quarters,/ });
  await expect(quarters).toHaveAttribute('aria-label', /vacant plot/);
  await quarters.click();
  const plotDialog = page.getByRole('dialog');
  await plotDialog.getByRole('button', { name: 'Queue build' }).click();
  // The order is placed, not finished, which is the whole contract of the queue.
  await expect(quarters).toHaveAttribute('aria-label', /under construction/);
  await plotDialog.getByRole('button', { name: 'Close' }).click();
  // The queue is a report on the district rather than part of it, so it lives in the report window.
  const reports = page.getByTestId('reports-toggle');
  await reports.click();
  await expect(page.getByTestId('build-queue')).toContainText('The Quarters');
  // Shut again before touching the district: it is a modal, and the picture is behind it.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('district-reports')).toHaveCount(0);
  // §D3: the oil left the HUD's ledger *at order time*, not a second counter of the district's
  // own. Matched as a whole chip value, so it cannot pass on some other resource that happens to
  // contain the digits.
  await expect(hud.getByText(String(AFTER_BUILD.oil), { exact: true })).toBeVisible();
  await shootEveryViewport(page, 'district-queued');

  /*
   * And then it lands: the one place the lazy build settle runs against a real clock and a real
   * database rather than a stubbed response. `buildingBuildSeconds` at the bottom of the tree is
   * tens of seconds, and the page polls every five, so the timeout is that plus a wide margin for
   * a loaded CI box rather than a number picked to be comfortable.
   */
  await expect(quarters).toHaveAttribute('aria-label', /level 1/, { timeout: 90_000 });
  await page.getByTestId('reports-toggle').click();
  await expect(page.getByTestId('build-queue')).toHaveCount(0);
  await shootEveryViewport(page, 'district-built');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('district-reports')).toHaveCount(0);

  // --- STEP 5: walk into the city and take a place off the looters (§A4) ---
  await page.getByRole('link', { name: 'City', exact: true }).click();
  await expect(page.getByTestId('city-room')).toBeVisible();

  const scrapfields = findDistrict('rustyard');
  if (!scrapfields) throw new Error('fixture error: the Rustyard is missing from the city');
  await page.getByTestId(`district-tag-${scrapfields.id}`).click();

  /*
   * Fog first: a district nobody has been to says nothing about what is inside it.
   *
   * Both the fog and the scouts are read on the district's own screen now. They used to be in an
   * intel panel floating on the city map, and the map went when the city became a painting: one
   * click on a tag is the whole walk in, so there is no in-between screen left to say it on.
   */
  await expect(page.getByRole('heading', { name: scrapfields.name })).toBeVisible();
  await expect(page.getByTestId('locations')).toHaveCount(0);
  await shootEveryViewport(page, 'city-fog');

  await page.getByRole('button', { name: 'Send scouts' }).click();
  await expect(page.getByTestId('locations')).toBeVisible();
  await shootEveryViewport(page, 'district-locations');

  /*
   * §A4 as it is actually played, against the real backend: **call** a fight, and commit people to
   * it.
   *
   * This step used to press "Take it" and read a victory banner, because a fight resolved the
   * instant it was ordered. It does not any more, and there is no way to fake that here: a
   * declaration is legal only hours out, and the settler runs when the mark passes. So what a live
   * session can prove is the whole of the loop up to the mark, which is the part a player does:
   * the call goes on the board, the squad leaves the roster for it, and pulling them back puts
   * them where they were.
   */
  const firstPlace = scrapfields.locations[0];
  if (!firstPlace) throw new Error('fixture error: the Rustyard has no locations');
  const card = page.getByTestId(`location-${firstPlace.id}`);
  await expect(card).toBeVisible();

  await card.getByRole('button', { name: 'Call a fight' }).click();
  const caller = page.getByRole('dialog');
  await expect(caller.getByRole('heading', { name: firstPlace.name })).toBeVisible();
  // The occupation flag the board asked for, on the real screen.
  await expect(caller.getByTestId('declare-hold')).toBeVisible();
  await caller.getByTestId('declare-hold').click();
  await caller.getByTestId('declare-confirm').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  await shootEveryViewport(page, 'fight-called');

  // It is on the Battles page, with the mark on it, and it is public. Reached from the standing
  // bar rather than from the scenery switcher, which is where the door lives now.
  await page.getByTestId('hud-battles').click();
  await expect(page.getByTestId('coming-battles')).toBeVisible();
  await shootEveryViewport(page, 'battle-board');

  // --- STEP 6: the roster reflects what the city has opened up (§A5) ---
  await page.getByRole('link', { name: 'Units', exact: true }).click();
  await expect(page.getByTestId('unit-catalogue')).toBeVisible();
  await expect(page.getByTestId('supply')).toBeVisible();
  // Razors need nothing at all, so a crew on its first day can always train more.
  await expect(
    page.getByTestId('unit-razors').getByRole('button', { name: 'Train' }),
  ).toBeEnabled();
  await shootEveryViewport(page, 'units');

  expect(pageErrors, `uncaught page errors: ${pageErrors.join(' | ')}`).toEqual([]);
  expect(consoleErrors, `console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
  expect(offOrigin, `the flow fetched third-party assets: ${offOrigin.join(' | ')}`).toEqual([]);
});
