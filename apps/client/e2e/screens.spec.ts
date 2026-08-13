import { CITY_DISTRICTS, STARTING_RESOURCES } from '@frontline/shared';
import { expect, test } from '@playwright/test';
import {
  lateGame,
  me,
  meNoOverseer,
  overseer,
  paidBase,
  paidMe,
  settlingMissions,
  settlingResearch,
} from './fixtures';
import { expectNothingClippedVertically, installApi, settleFonts } from './harness';

test.use({ viewport: { width: 1280, height: 800 } });

test('character select renders all presets', async ({ page }) => {
  await installApi(page, meNoOverseer);
  await page.goto('/overseer');

  await expect(page.getByRole('heading', { name: 'CHOOSE YOUR OVERSEER' })).toBeVisible();
  await page.getByText(overseer.name).click();
  await expect(page.getByRole('button', { name: 'Confirm Overseer' })).toBeEnabled();

  // Both assertions below are geometry, so they are only meaningful once Orbitron has swapped
  // in — the fallback is narrower and would hide exactly the clipping they exist to catch.
  await settleFonts(page);

  // The radar's axis labels sit outside the plotted rings, so a viewBox that is too tight
  // silently clips them mid-word ("TEC" renders as "C"). Assert each label's rendered box is
  // fully inside its svg rather than trusting the geometry constants to stay in agreement.
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('svg[aria-label="Attribute radar"]')].flatMap((svg) => {
      const box = svg.getBoundingClientRect();
      return [...svg.querySelectorAll('text')]
        .filter((label) => {
          const at = label.getBoundingClientRect();
          return (
            at.left < box.left - 0.5 ||
            at.right > box.right + 0.5 ||
            at.top < box.top - 0.5 ||
            at.bottom > box.bottom + 0.5
          );
        })
        .map((label) => label.textContent ?? '');
    }),
  );
  expect(clipped, 'radar axis labels must not be clipped by the viewBox').toEqual([]);

  // Nothing in a card may be cut off horizontally either.
  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll('h3, p, span')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent?.slice(0, 40) ?? ''),
  );
  expect(overflowing, 'card text must not overflow its column').toEqual([]);

  // ...nor may the roster's scroll viewport end part-way down a card, slicing the attribute
  // rows through the digits. Every card the player can see must be whole.
  await expectNothingClippedVertically(page);

  await page.screenshot({ path: 'screenshots/character-select.png', fullPage: false });
});

test('game shell renders the city map', async ({ page }) => {
  await installApi(page, me);
  await page.goto('/game');

  await expect(page.getByText(overseer.name)).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(700);

  await page.screenshot({ path: 'screenshots/game.png', fullPage: false });
});

test('base panel lists structures', async ({ page }) => {
  await installApi(page, me);
  await page.goto('/game/base');

  await expect(page.getByRole('heading', { name: "Operator's Foothold" })).toBeVisible();
  await expect(page.getByText('Command Center')).toBeVisible();
  await expect(page.getByText('Fusion Reactor')).toBeVisible();

  await page.screenshot({ path: 'screenshots/base.png', fullPage: false });
});

/**
 * The Bar (GDD §H). The roster sits inside the page's own scroller, so `fullPage` would not reach
 * the cards below the fold — they are scrolled to and re-checked instead (MOU-162).
 *
 * Installed against `lateGame`, not `me`: the `bar` fixture is a level-12 crew with 13 slots, a
 * `Feared` street and six figures of caps, and serving it over a starting session put "STREET
 * READS FEARED" directly under a HUD reading `Cautious` / infamy 0 — the half-fixture MOU-207 was
 * filed about, visible only in the screenshot. The two now describe the same save.
 */
test('the bar lists tonight’s roster and the crew already signed', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/bar');

  await expect(page.getByRole('heading', { name: 'The Bar' })).toBeVisible();
  await expect(page.getByText('The Ghost of Sector Nine')).toBeVisible();
  await expect(page.getByText('Dorotea "The Undergrid Ghost"')).toBeVisible();
  // §H5's two ends both render: a walkout warning and an earned skill bonus.
  await expect(page.getByText('Says they are done unless something changes.')).toBeVisible();
  await expect(page.getByText(/^\+5 to /)).toBeVisible();
  // §H3/§H4 refusals say which gate is shut rather than just greying the card out.
  await expect(page.getByText('Not infamous enough').first()).toBeVisible();
  await expect(page.getByText('Wants no part of you')).toBeVisible();

  await settleFonts(page);

  // Fixed copy that ellipsises is invisible to a document-overflow gate, so authored text is
  // measured directly — this is the defect class that shipped `ROUND TRI…` on the missions page.
  const truncated = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('h1, h2, h3, p, span, li, option')]
      .filter((el) => el.childElementCount === 0 && el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent?.slice(0, 40) ?? ''),
  );
  expect(truncated, 'no authored label on the Bar may be cut off').toEqual([]);

  /*
   * No vertical-clip guard, deliberately, and for the same reason the base and missions pages
   * skip it: this is a scroller whose content is arbitrarily long, so the fold cuts the first
   * roster card at every viewport exactly as an ordinary scrolling page cuts its last row. That
   * is a different question from a *bounded* viewport ending mid-card, which is what the guard on
   * character select exists for.
   */
  await page.screenshot({ path: 'screenshots/bar.png', fullPage: false });

  // ...and again at the bottom of the roster, which no viewport-sized screenshot can reach.
  await page.getByText('Juno Petrosyan').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'screenshots/bar-scrolled.png', fullPage: false });
});

test('battle result modal opens after an attack', async ({ page }) => {
  await installApi(page, me);
  await page.goto('/game');
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(700);

  const undergrid = CITY_DISTRICTS.find((d) => d.id === 'undergrid');
  if (!undergrid) throw new Error('missing undergrid district');
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  await page.mouse.click(
    box.x + undergrid.position.x * box.width,
    box.y + undergrid.position.y * box.height,
  );

  await page.getByRole('button', { name: 'Launch Attack' }).click();
  await expect(page.getByRole('heading', { name: 'VICTORY' })).toBeVisible();

  await page.screenshot({ path: 'screenshots/battle.png', fullPage: false });
});

/*
 * MOU-162 §E5 — a crew lands while the player is watching it, and the payout reaches the HUD.
 *
 * This is the one path on which a stockpile moves with no player action behind it: missions settle
 * on the poll, and the missions page mounts no `me` observer of its own, so nothing refetches
 * unless the settling poll asks it to. The static board fixture cannot reach it — every mission
 * there is born active or born resolved — which is how a payout that never reached the HUD passed
 * 726 unit tests and 43 e2e ones.
 *
 * The wait is real: `MISSION_POLL_MS` is 15s, and the poll is the event under test.
 */
test('a crew that lands while the page is open pays the HUD', async ({ page }) => {
  const { pending, settled } = settlingMissions();
  const AFTER_POLL = 30_000;
  let landed = false;

  await installApi(page, me);
  // Registered after `installApi`, so these take precedence — Playwright tries the most recently
  // added handler first. Both flip on the same flag, the way one server answers both routes.
  const json = (data: unknown) => ({ contentType: 'application/json', body: JSON.stringify(data) });
  await page.route('**/api/missions', (route) => route.fulfill(json(landed ? settled : pending)));
  await page.route('**/api/me', (route) => route.fulfill(json(landed ? paidMe : me)));

  await page.goto('/game/missions');
  const hud = page.locator('header');
  const inFlight = page.getByRole('list', { name: 'Crews in flight' }).getByRole('listitem');
  const returned = page.getByRole('list', { name: 'Crews returned' }).getByRole('listitem');

  // One crew out, one already home — which is also the proof these routes, not the catch-all,
  // are the ones answering.
  await expect(inFlight).toHaveText([/Deep Expedition/]);
  await expect(returned).toHaveText([/Scrap Run/]);
  await expect(hud.getByText(String(STARTING_RESOURCES.caps), { exact: true })).toBeVisible();

  // The server banks the expedition on the next read.
  landed = true;

  // The crew that just landed is at the top, even though the scrap run launched a day after it.
  await expect(returned).toHaveText([/Deep Expedition/, /Scrap Run/], { timeout: AFTER_POLL });
  await expect(inFlight).toHaveCount(0);

  await expect(hud.getByText(String(paidBase.resources.caps), { exact: true })).toBeVisible({
    timeout: AFTER_POLL,
  });
  await expect(hud.getByText(String(paidBase.resources.scrap), { exact: true })).toBeVisible();

  await page.screenshot({ path: 'screenshots/missions-settled.png', fullPage: false });
});

/**
 * MOU-166 §B9 — a project that lands while the page is open puts its facts on the page.
 *
 * The same trap the missions settlement was filed under: a research project settles lazily on the
 * `GET /api/research` read, so nothing turns a finished clock into a discovered fact unless the
 * poll asks. Every static research fixture is born either running or already idle, so the settle
 * path — the one moment the whole feature turns on — is reachable from no other test.
 *
 * The wait is real: `RESEARCH_POLL_MS` is 15s, and the poll is the event under test.
 */
test('a project that lands while the page is open shows what it found', async ({ page }) => {
  const { pending, settled } = settlingResearch();
  const AFTER_POLL = 30_000;
  let landed = false;

  await installApi(page, lateGame);
  // Registered after `installApi`, so this takes precedence — Playwright tries the most recently
  // added handler first.
  await page.route('**/api/research', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(landed ? settled : pending),
    }),
  );

  await page.goto('/game/research');

  // Running, with §F4's cross-reference showing — also the proof this route, not the catch-all,
  // is the one answering.
  await expect(page.getByText('Investigating the Instructor of the Young')).toBeVisible();
  await expect(page.getByText('Raid Boss')).toHaveCount(0);

  // The server banks it on the next read.
  landed = true;

  // The facts land on the page, the "just in" flag names how many, and the slot frees up.
  await expect(page.getByText('+3 just in')).toBeVisible({ timeout: AFTER_POLL });
  const raidBossFacts = page.getByRole('listitem').filter({ hasText: 'Raid Boss' }).first();
  await expect(raidBossFacts).toBeVisible();
  await expect(raidBossFacts).toContainText('Intimidation');
  await expect(raidBossFacts).toContainText('Demolition');
  await expect(raidBossFacts, 'both facts count against the §B9 cap').toContainText('2 / 3 leads');
  await expect(page.getByRole('heading', { name: 'Put someone on it' })).toBeVisible();

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/research-settled.png', fullPage: false });
});
