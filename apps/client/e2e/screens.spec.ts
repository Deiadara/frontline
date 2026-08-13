import { CITY_DISTRICTS, STARTING_RESOURCES } from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import {
  battle,
  lateGame,
  me,
  meNoOverseer,
  overseer,
  paidBase,
  missionsResponse,
  paidMe,
  settlingMissions,
  settlingResearch,
} from './fixtures';
import {
  expectNoImagesClipped,
  expectNothingClippedVertically,
  installApi,
  settleFonts,
} from './harness';

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

  // The same question for the pictures on this screen: the painted portraits and the radar rings
  // are `<svg>`/`<img>`, so the text guard above steps straight over both.
  await expectNoImagesClipped(page);

  await page.screenshot({ path: 'screenshots/character-select.png', fullPage: false });
});

/**
 * The §G placement screen, at the widest state it can reach (level 24: a twelve-pip cap, the 50%
 * ceiling, a decimal bonus and the longest name/role pair on the board).
 */
test('assignee placement renders at the §G7 ceiling without clipping', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/assignees');

  await expect(page.getByRole('heading', { name: 'ASSIGNEES' })).toBeVisible();
  // §G7's twelfth row and its `at cap` state, and a decimal bonus rendered without a stray `.0`.
  await expect(page.getByText('50%', { exact: true })).toBeVisible();
  await expect(page.getByText('at cap')).toBeVisible();
  await expect(page.getByText('14.5%', { exact: true })).toBeVisible();
  // §C4 — a Professor is on the books, so reskilling is offered rather than explained away.
  await expect(page.getByRole('button', { name: 'Reskill' })).toBeEnabled();

  await settleFonts(page);

  // Officer names and role labels are the long strings on this row; nothing may ellipsise or spill.
  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll('p, span')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent?.slice(0, 40) ?? ''),
  );
  expect(overflowing, 'officer names and §G7 figures must not overflow their column').toEqual([]);
  await expectNothingClippedVertically(page);

  await page.screenshot({ path: 'screenshots/assignees.png', fullPage: false });
});

test('assignee placement explains the empty state before any officer is hired', async ({
  page,
}) => {
  await installApi(page, me);
  await page.goto('/game/assignees');

  await expect(page.getByText('hire an officer at the Bar first')).toBeVisible();
  // §G8 — the pool is already 2 at level 1, so the page must not read as "you have nothing".
  await expect(page.getByText('Unplaced')).toBeVisible();
  await settleFonts(page);
  await expectNothingClippedVertically(page);
  await page.screenshot({ path: 'screenshots/assignees-empty.png', fullPage: false });
});

test('game shell renders the city map', async ({ page }) => {
  await installApi(page, me);
  await page.goto('/game');

  await expect(page.getByText(overseer.name)).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();
  await page.waitForTimeout(700);

  await page.screenshot({ path: 'screenshots/game.png', fullPage: false });
});

test('the hideout stands its structures on clickable plots', async ({ page }) => {
  await installApi(page, me);
  await page.goto('/game/base');

  await expect(page.getByRole('heading', { name: "Operator's Foothold" })).toBeVisible();
  // §A1 — the structures are plots in a place now, not rows in a list, so they are found by the
  // control you click rather than by a name printed somewhere on the page.
  await expect(page.getByRole('button', { name: /^Command Center —/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Fusion Reactor —/ })).toBeVisible();

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

/**
 * MOU-227 — §I1 pays XP for the raid win or lose, and the battle response is the only place a
 * level it bought is ever reported. The report modal is therefore where the player finds out.
 */
test('battle result modal announces a level-up the raid paid for', async ({ page }) => {
  await installApi(page, me);
  // Registered after `installApi`, so Playwright's reverse-order matching gives it priority.
  await page.route('**/api/battle', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...battle,
        levelUp: {
          level: 4,
          levelsGained: 1,
          grants: { assigneePool: 5, assigneeCapPerOfficer: 2, recruitSlots: 5 },
        },
      }),
    }),
  );
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
  const banner = page.getByRole('region', { name: 'Level up' });
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('LEVEL 4');
  await settleFonts(page);

  // The modal is a bounded scroller, so the banner has to be *reachable*, not merely rendered.
  await expect(banner).toBeInViewport();
  await page.screenshot({ path: 'screenshots/battle-levelup.png', fullPage: false });
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

/*
 * MOU-250 §G6 — the launch path crosses the client/server seam, so it is asserted on the wire.
 *
 * The server refuses a `difficulty: 'hard'` template unless the launch names an officer, and the
 * client shipped with no way to name one: all four hard templates — both battles and the day-long
 * expedition — posted `{ templateId }`, took a 409, and returned the board to normal with no crew
 * out and nothing on screen. Every gate stayed green because the mocked handler answered any method
 * on `/api/missions` with the *board*, so no test ever reached the gate. These two cross it.
 */

/**
 * The board with a crew slot free.
 *
 * The standard fixture is deliberately the *fat* case — every one of the four slots filled — which
 * disables every Deploy button on the page under §E3's capacity rule. A launch test run against it
 * fails on a disabled control long before it reaches the §G6 gate it exists to exercise.
 */
const boardWithARoom = () => {
  const board = missionsResponse();
  return { ...board, missions: board.missions.filter((mission) => mission.status === 'resolved') };
};

/** Serve the board with a free slot, leaving whoever registered earlier to answer the launch. */
const routeBoard = (page: Page) =>
  page.route('**/api/missions', (route) => {
    if (route.request().method() === 'POST') return route.fallback();
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(boardWithARoom()),
    });
  });

test('a hard mission goes out with an officer leading it', async ({ page }) => {
  await installApi(page, lateGame);
  await routeBoard(page);
  await page.goto('/game/missions');

  const card = (name: string) =>
    page.locator('article').filter({ has: page.getByRole('heading', { name }) });
  const ambush = card('Convoy Ambush');

  // The §G3 roster is what makes the gate satisfiable: the first officer leads until the player
  // says otherwise, so a hard card is never offering a button the server is certain to refuse.
  await expect(ambush.getByRole('combobox')).toHaveValue('off-1');

  const launch = page.waitForRequest(
    (request) => request.url().includes('/api/missions') && request.method() === 'POST',
  );
  await ambush.getByRole('button', { name: 'Deploy' }).click();
  expect((await launch).postDataJSON()).toEqual({
    templateId: 'convoy-ambush',
    officerId: 'off-1',
  });

  // Accepted, so the board says nothing — the alert below is specific to a refusal.
  await expect(page.getByRole('alert')).toHaveCount(0);

  await settleFonts(page);

  /*
   * No vertical-clip guard: the missions board is a scroller, so the fold bisects whatever row it
   * lands on by design — the same reason the Bar and base screens skip it. What *is* asserted is
   * the new control, and it needs its own measurement.
   *
   * A native `select` clips its own text with no ellipsis and no overflow to measure: `scrollWidth`
   * matches `clientWidth` whatever the label says, and a closed select's `option` elements have no
   * box at all. Both existing guards are therefore blind to it, and the first draft of this picker
   * shipped "Instructor of the Yo" cut mid-word. So the label is measured directly against the
   * space the control actually gives it.
   */
  const cut = await page.evaluate(() => {
    const ARROW_PX = 20; // the disclosure triangle, which the text may not run under
    return [...document.querySelectorAll<HTMLSelectElement>('select')]
      .filter((select) => {
        const style = getComputedStyle(select);
        const context = document.createElement('canvas').getContext('2d');
        if (!context) return false;
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        const room =
          select.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight) -
          ARROW_PX;
        return [...select.options].some((option) => context.measureText(option.text).width > room);
      })
      .map((select) => select.options[select.selectedIndex]?.text ?? '');
  });
  expect(cut, 'no officer name may be cut off by the picker').toEqual([]);

  await page.screenshot({ path: 'screenshots/missions-officer.png', fullPage: false });
});

test('a refused launch tells the player why', async ({ page }) => {
  await installApi(page, lateGame);
  await routeBoard(page);
  // Registered last, so this is what answers the launch; the board still comes from `routeBoard`.
  await page.route('**/api/missions', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'MISSION_NEEDS_OFFICER',
          message: 'That job is too hard to run without an officer leading it',
        },
      }),
    });
  });

  await page.goto('/game/missions');
  const scrapRun = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Scrap Run' }) });
  await scrapRun.getByRole('button', { name: 'Deploy' }).click();

  /*
   * In the card the player clicked, and *in the viewport*. The first draft put one message at the
   * foot of the board: `toHaveText` passed on it while it sat below eight cards of scrolling grid,
   * off-screen — a DOM assertion cannot tell "explained" from "invisible".
   */
  const refusal = scrapRun.getByRole('alert');
  await expect(refusal).toHaveText('That job is too hard to run without an officer leading it');
  await expect(refusal).toBeInViewport();
  // ...and only on that card, so the board does not read as eight simultaneous failures.
  await expect(page.getByRole('alert')).toHaveCount(1);

  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/missions-refused.png', fullPage: false });
});
