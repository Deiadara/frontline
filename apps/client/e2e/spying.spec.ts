import { expect, test, type Page } from '@playwright/test';
import {
  SPY_TIER_SPECS,
  findDistrict,
  type DistrictDetailResponse,
  type SpyRequest,
} from '@frontline/shared';
import {
  actionsResponse,
  battles,
  districtDetail,
  districtDetailFor,
  lateGame,
  me,
} from './fixtures';
import { expectNothingOverflowsTheScreen, installApi, settleFonts } from './harness';

/**
 * Spying (maintainer ruling, 2026-09-22): the panel on a location sheet, the dialog on a
 * player's door, the Monitor's row and the report filed on the battle board.
 */

const RUSTYARD = findDistrict('steelbelt');
if (!RUSTYARD) throw new Error('fixture error: the Rustyard is missing from the city map');
/** The one the rival holds in the fixture: the sheet with a last report on it. */
const THEIRS = RUSTYARD.locations[2];
/** Looters' ground: nothing known, a job to price. */
const LOOTERS = RUSTYARD.locations[1];
if (!THEIRS || !LOOTERS) throw new Error('fixture error: the Rustyard is short of locations');

async function openSheet(page: Page, locationId: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await installApi(page, me);
  await page.goto('/game/city/steelbelt');
  await page.getByTestId(`site-${locationId}`).click();
  await expect(page.getByTestId('location-window')).toBeVisible();
  await settleFonts(page);
}

test('a rival holding says nothing about its count, and quotes the last report instead', async ({
  page,
}) => {
  await openSheet(page, THEIRS.id);
  const sheet = page.getByTestId(`location-${THEIRS.id}`);
  // The figure is the report's, not a live count, and the defence is the ground's alone.
  await expect(sheet).toContainText('23 seen');
  await expect(sheet).toContainText('Ground defence');
  await page.screenshot({ path: 'screenshots/spy-sheet-rival.png', fullPage: false });
  await expectNothingOverflowsTheScreen(page);
  // The door on the sheet opens the picker, which quotes the last look at the top.
  await page.getByTestId(`spy-open-${THEIRS.id}`).click();
  const window = page.getByTestId(`spy-${THEIRS.id}-window`);
  await expect(window).toBeVisible();
  await expect(window.getByTestId('spy-last-report')).toContainText('23 seen');
  await expect(window.getByTestId('spy-last-report')).toContainText('Read the report');
  await page.screenshot({ path: 'screenshots/spy-window-rival.png', fullPage: false });
  await expectNothingOverflowsTheScreen(page);
});

test('looters ground is unknown until somebody pays: five tiers, a clock, and the send', async ({
  page,
}) => {
  await openSheet(page, LOOTERS.id);
  const sheet = page.getByTestId(`location-${LOOTERS.id}`);
  await expect(sheet).toContainText('Unknown');
  await page.getByTestId(`spy-open-${LOOTERS.id}`).click();
  const panel = page.getByTestId(`spy-${LOOTERS.id}`);
  await expect(panel).toBeVisible();
  /*
   * Ground nobody has looked at says nothing at all (maintainer, 2026-09-22).
   *
   * There used to be a `spy-no-report` line here reading "Nobody of yours has had a look at it.
   * What is standing here is theirs to know until you pay to find out", which is two sentences to
   * announce that a line is absent. The absence says it, and the tiers under it are what the
   * player is here for.
   */
  await expect(panel.getByTestId('spy-no-report')).toHaveCount(0);
  await expect(panel.getByTestId('spy-last-report')).toHaveCount(0);
  for (const tier of Object.keys(SPY_TIER_SPECS)) {
    await expect(panel.getByTestId(`spy-${LOOTERS.id}-tier-${tier}`)).toBeVisible();
  }
  /*
   * The tiers the track has not opened are drawn shut, naming the rung (maintainer, 2026-09-28).
   * The fixture's crew has Paid Informants and nothing past it.
   */
  for (const [tier, rung] of [
    ['network_compromise', 'Sleeper Lists'],
    ['total_intelligence', 'The Whole Wire'],
  ] as const) {
    const card = panel.getByTestId(`spy-${LOOTERS.id}-tier-${tier}`);
    await expect(card).toBeDisabled();
    await expect(card).toContainText(`Opens with ${rung}`);
  }
  await expect(panel.getByTestId(`spy-${LOOTERS.id}-tier-paid_whisper`)).toBeEnabled();
  await page.screenshot({ path: 'screenshots/spy-tiers-shut.png', fullPage: false });
  await expectNothingOverflowsTheScreen(page);
  // The quote off the district read, and the caps said in the picker.
  await expect(panel).toContainText('would be gone');
  await expect(panel).toContainText('1h 36m');
  await panel.getByTestId(`spy-${LOOTERS.id}-tier-bought_eyes`).click();
  await expect(panel.getByTestId(`spy-${LOOTERS.id}-blurb`)).toContainText(
    SPY_TIER_SPECS.bought_eyes.blurb,
  );
  // A tier the purse cannot cover is drawn, not offered: the send is dead under it.
  await expect(panel.getByTestId(`spy-${LOOTERS.id}-send`)).toBeDisabled();
  await panel.getByTestId(`spy-${LOOTERS.id}-tier-loose_ears`).click();
  await expect(panel.getByTestId(`spy-${LOOTERS.id}-send`)).toBeEnabled();

  /*
   * The write invalidates the district read, so the run has to come back on the read as well as
   * on the write's own answer: routed here, on a variable the send flips.
   */
  const sent: SpyRequest[] = [];
  let runs: DistrictDetailResponse['spyRuns'] = [];
  const detail = () => ({ ...districtDetail, spyRuns: runs });
  await page.route('**/api/city/steelbelt', (route) => route.fulfill({ json: detail() }));
  await page.route('**/api/city/spy', (route) => {
    sent.push(route.request().postDataJSON() as SpyRequest);
    runs = [
      {
        ...actionsResponse.spyRuns[0]!,
        target: { kind: 'location', locationId: LOOTERS.id },
        placeName: LOOTERS.name,
        tier: 'loose_ears',
        capsPaid: 100,
        departedAt: new Date().toISOString(),
        returnsAt: new Date(Date.now() + 96 * 60_000).toISOString(),
      },
    ];
    return route.fulfill({ json: { district: detail(), base: me.base } });
  });
  await panel.getByTestId(`spy-${LOOTERS.id}-send`).click();
  await expect(panel.getByTestId(`spy-${LOOTERS.id}-underway`)).toBeVisible();
  expect(sent).toEqual([
    { target: { kind: 'location', locationId: LOOTERS.id }, tier: 'loose_ears' },
  ]);
  await expect(panel).toContainText('Your runners are here');
  await expect(panel.getByTestId(`spy-${LOOTERS.id}-recall`)).toBeVisible();
  // One party and it is out: no picker until they are home.
  await expect(panel.getByTestId(`spy-${LOOTERS.id}-send`)).toHaveCount(0);
  await page.screenshot({ path: 'screenshots/spy-sheet-underway.png', fullPage: false });
});

test('Two Sets of Eyes: one party out and the second still free to send', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await installApi(page, me);
  // After `installApi`, so it wins: Playwright matches the most recent handler first.
  await page.route('**/api/city/steelbelt', (route) =>
    route.fulfill({
      json: { ...districtDetail, spyParties: 2, spyRuns: actionsResponse.spyRuns },
    }),
  );
  await page.goto('/game/city/steelbelt');
  await page.getByTestId(`site-${LOOTERS.id}`).click();
  await settleFonts(page);
  await page.getByTestId(`spy-open-${LOOTERS.id}`).click();
  const panel = page.getByTestId(`spy-${LOOTERS.id}`);
  await expect(panel.getByTestId(`spy-${LOOTERS.id}-underway`)).toContainText(
    actionsResponse.spyRuns[0]!.placeName,
  );
  await expect(panel.getByTestId(`spy-${LOOTERS.id}-send`)).toBeVisible();
  await page.screenshot({ path: 'screenshots/spy-second-party.png', fullPage: false });
  await expectNothingOverflowsTheScreen(page);
});

test("the panel says why nothing can be sent, in the route's own words", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await installApi(page, me);
  await page.route('**/api/city/steelbelt', (route) =>
    route.fulfill({ json: { ...districtDetail, spyBlocker: 'no_whispers', spyQuote: null } }),
  );
  await page.goto('/game/city/steelbelt');
  await page.getByTestId(`site-${LOOTERS.id}`).click();
  await page.getByTestId(`spy-open-${LOOTERS.id}`).click();
  await expect(page.getByTestId(`spy-${LOOTERS.id}-blocked`)).toContainText(
    'Master of Whispers chair',
  );
  await expect(page.getByTestId(`spy-${LOOTERS.id}-send`)).toHaveCount(0);
});

test("a player's district is read at its gate, from a window over the plot", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await installApi(page, lateGame);
  const lived = districtDetailFor('kettle-row');
  if (lived.district.kind !== 'residential') throw new Error('fixture: not a plot');
  await page.goto('/game/city/kettle-row');
  await expect(page.getByTestId('visited-district-name')).toBeVisible();
  await settleFonts(page);
  await page.getByTestId('spy-gate').click();
  const dialog = page.getByTestId('spy-gate-panel-window');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Spy on the gate');
  await expect(dialog.getByTestId('spy-gate-panel-send')).toBeVisible();
  await page.screenshot({ path: 'screenshots/spy-gate.png', fullPage: false });
  await expectNothingOverflowsTheScreen(page);
});

test('the Monitor lists the runners out, with the tier, the caps and a way to turn them round', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/actions');
  await expect(page.getByTestId('spy-run')).toBeVisible();
  await settleFonts(page);
  const row = page.getByTestId('spy-run');
  await expect(row).toContainText('Paid Whisper');
  await expect(row).toContainText('500 caps');
  await expect(row).toContainText('No. 4 Press House');
  await expect(page.getByTestId('road-counts')).toContainText('runners on a job');
  // Fifteen minutes into a forty-minute walk out: the window shut eleven minutes ago.
  await expect(page.getByTestId('recall-spy')).toHaveCount(0);
});

test('the board files every report, and opens one on its own window', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await installApi(page, lateGame);
  await page.goto('/game/battles');
  await page.getByTestId('battles-tab-spies').click();
  await expect(page.getByTestId('battles-tab-spies')).toHaveAttribute('aria-selected', 'true');
  await settleFonts(page);
  // The tab strip fades between colours; a capture inside the fade shows the old tab lit.
  await page.waitForTimeout(250);
  const list = page.getByTestId('spy-reports');
  await expect(list.locator('li')).toHaveCount(battles.spyReports.length);
  await expect(list).toContainText('23 seen');
  await expect(list).toContainText('Nothing');
  await expect(list).toContainText('The Ashen Sons');
  // Before Written Reports a report counts slots; the courier's is headed with his rung.
  await expect(page.getByTestId('read-spy-spy-report-3')).toContainText('18 slots');
  await expect(page.getByTestId('read-spy-spy-report-4')).toContainText('Turned Runners');
  await page.screenshot({ path: 'screenshots/spy-reports.png', fullPage: false });

  await page.getByTestId('read-spy-spy-report-1').click();
  const report = page.getByTestId('spy-report');
  await expect(report).toBeVisible();
  await expect(report).toContainText('Your spies were able to uncover');
  await expect(report.getByTestId('spy-report-head')).toContainText('The Ashen Compact');
  await expect(report.getByTestId('spy-report-head')).toContainText('2,000 caps');
  // Every exposed unit is a card, the way a battle report's are.
  await expect(report.getByTestId('spy-unit-razors')).toBeVisible();
  await expect(report.getByTestId('spy-unit-ghosts')).toBeVisible();
  await expect(report.getByTestId('spy-readouts')).toContainText('About 80%');
  await expect(report.getByTestId('spy-readouts')).toContainText('Roughly 5');
  await expect(report.getByTestId('spy-readouts')).toContainText('Nobody saw them');
  await page.screenshot({ path: 'screenshots/spy-report.png', fullPage: false });
  await expectNothingOverflowsTheScreen(page);
});

test('a report from before Written Reports counts unit slots and names nobody', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await installApi(page, lateGame);
  await page.goto('/game/battles?spy=spy-report-3');
  const report = page.getByTestId('spy-report');
  await expect(report).toBeVisible();
  await settleFonts(page);
  await expect(report.getByTestId('spy-slots-only')).toContainText('18');
  await expect(report.getByTestId('spy-slots-only')).toContainText('Written Reports');
  await expect(report.getByTestId('spy-exposed')).toHaveCount(0);
  await page.screenshot({ path: 'screenshots/spy-report-slots.png', fullPage: false });
  await expectNothingOverflowsTheScreen(page);
});

test("the courier's report: nobody paid, everything read, the exact slots printed", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await installApi(page, lateGame);
  await page.goto('/game/battles?spy=spy-report-4');
  const report = page.getByTestId('spy-report');
  await expect(report).toBeVisible();
  await settleFonts(page);
  await expect(report).toContainText('Turned Runners');
  await expect(report).toContainText('The courier carried word of');
  await expect(report.getByTestId('spy-report-head')).toContainText('Nothing: the courier');
  await expect(report.getByTestId('spy-readouts')).toContainText('Standing there');
  await expect(report.getByTestId('spy-readouts')).toContainText('100%');
  // The courier is never seen, so the line that says so is not drawn.
  await expect(report.getByTestId('spy-readouts')).not.toContainText('Noticed');
  await page.screenshot({ path: 'screenshots/spy-report-courier.png', fullPage: false });
  await expectNothingOverflowsTheScreen(page);
});

test('a failed report says so, and a receipt link opens the report it names', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/battles?spy=spy-report-2');
  const report = page.getByTestId('spy-report');
  await expect(report).toBeVisible();
  await expect(report.getByTestId('spy-failed')).toContainText(
    'nothing they would put their name to',
  );
  await expect(report).toContainText(findDistrict('ccs')?.name ?? 'the Spire');
  await expect(report.getByTestId('spy-readouts')).toHaveCount(0);
});

/**
 * The caller at a shut gate carries a third button (maintainer, 2026-09-29): Spy, beside Call it,
 * with Cancel on the far left. Pressing it swaps the caller for the gate's spy window.
 */
test('the caller at a shut gate offers Spy, and Spy opens the gate’s window', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await installApi(page, lateGame);
  // The Annexes as the game opens them: the Syndic holds every plot, so the gate is armed. The
  // fixture's board lists no gate there, so this case says which it wants. Registered after
  // `installApi`, so it wins: Playwright matches the most recent handler first.
  await page.route('**/api/battles', (route) =>
    route.fulfill({
      json: {
        ...battles,
        gates: [
          ...battles.gates.filter((gate) => gate.districtId !== 'annexes'),
          { districtId: 'annexes', name: 'The Annexes', shut: true, brokenUntil: null },
        ],
      },
    }),
  );
  await page.goto('/game/city/annexes');
  const gate = page.getByTestId('site-gate-annexes');
  await expect(gate).toBeVisible();
  await settleFonts(page);
  await gate.click();

  const caller = page.getByTestId('declare-dialog');
  await expect(caller).toBeVisible();
  await expect(caller.getByTestId('declare-spy')).toBeVisible();
  const cancel = await caller.getByTestId('declare-cancel').boundingBox();
  const spy = await caller.getByTestId('declare-spy').boundingBox();
  const call = await caller.getByTestId('declare-confirm').boundingBox();
  expect(cancel!.x).toBeLessThan(spy!.x);
  expect(spy!.x).toBeLessThan(call!.x);
  await expectNothingOverflowsTheScreen(page);
  await caller.screenshot({ path: 'e2e-out/gate-caller-with-spy.png' });

  await caller.getByTestId('declare-spy').click();
  await expect(caller).toHaveCount(0);
  const window = page.getByTestId('spy-gate-panel-window');
  await expect(window).toBeVisible();
  await expect(window).toContainText('Spy on the gate');
});

/**
 * Every state a report can be in, at both widths the game is built for (bug pass, 2026-10-01),
 * with counts a late crew actually reaches. The board's badge is a fixed box, so a three-figure
 * count is the case that has to fit, and a failed report from The Whole Wire is the one report
 * whose readouts are drawn under a body that says nothing.
 */
const SPY_STATES = [
  {
    ...battles.spyReports[0]!,
    id: 'spy-state-wide',
    exposed: { razors: 118, scrapers: 40, ghosts: 26 },
    exposedSlots: 212,
    totalSlots: 236,
    unseen: null,
  },
  {
    ...battles.spyReports[2]!,
    id: 'spy-state-slots',
    exposedSlots: 188,
  },
  {
    ...battles.spyReports[1]!,
    id: 'spy-state-wired',
    holder: battles.spyReports[0]!.holder,
    totalSlots: 144,
  },
  ...battles.spyReports,
];

for (const width of [1024, 1280] as const) {
  test(`every report state reads whole at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 });
    await installApi(page, lateGame);
    await page.route('**/api/battles', (route) =>
      route.fulfill({ json: { ...battles, spyReports: SPY_STATES } }),
    );
    await page.goto('/game/battles');
    await page.getByTestId('battles-tab-spies').click();
    await settleFonts(page);
    await page.waitForTimeout(250);
    const list = page.getByTestId('spy-reports');
    await expect(list.locator('li')).toHaveCount(SPY_STATES.length);
    await expect(page.getByTestId('read-spy-spy-state-slots')).toContainText('188 slots');
    // The badge is a fixed box: whatever it says has to fit inside it.
    const cramped = await list.evaluate((ul) =>
      [...ul.querySelectorAll('button > span:first-child')]
        .filter((badge) => badge.scrollWidth > badge.clientWidth)
        .map((badge) => badge.textContent),
    );
    expect(cramped, 'a badge wider than its box').toEqual([]);
    await expectNothingOverflowsTheScreen(page);
    await page.screenshot({ path: `screenshots/spy-states-${width}.png`, fullPage: false });

    for (const report of SPY_STATES) {
      await page.getByTestId(`read-spy-${report.id}`).click();
      const window = page.getByTestId('spy-report');
      await expect(window).toBeVisible();
      if (report.id === 'spy-state-wired') {
        await expect(window.getByTestId('spy-failed')).toBeVisible();
        await expect(window.getByTestId('spy-readouts')).toContainText('144 unit slots');
      }
      await expectNothingOverflowsTheScreen(page);
      await page.screenshot({ path: `screenshots/spy-state-${report.id}-${width}.png` });
      await window.getByRole('button', { name: 'Close' }).click();
      await expect(window).toHaveCount(0);
    }
  });
}
