import { expect, test, type Page } from '@playwright/test';
import {
  SPY_TIER_SPECS,
  findDistrict,
  type DistrictDetailResponse,
  type SpyRequest,
} from '@frontline/shared';
import {
  UNSCOUTED_DISTRICT_ID,
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

const RUSTYARD = findDistrict('rustyard');
if (!RUSTYARD) throw new Error('fixture error: the Rustyard is missing from the city map');
/** The one the rival holds in the fixture: the sheet with a last report on it. */
const THEIRS = RUSTYARD.locations[2];
/** Looters' ground: nothing known, a job to price. */
const LOOTERS = RUSTYARD.locations[1];
if (!THEIRS || !LOOTERS) throw new Error('fixture error: the Rustyard is short of locations');

async function openSheet(page: Page, locationId: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await installApi(page, me);
  await page.goto('/game/city/rustyard');
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
   * on the write's own answer: routed here, on a variable the send flips, the way the scout
   * recall spec does it.
   */
  const sent: SpyRequest[] = [];
  let run: DistrictDetailResponse['spyRun'] = null;
  const detail = () => ({ ...districtDetail, spyRun: run });
  await page.route('**/api/city/rustyard', (route) => route.fulfill({ json: detail() }));
  await page.route('**/api/city/spy', (route) => {
    sent.push(route.request().postDataJSON() as SpyRequest);
    run = {
      ...actionsResponse.spyRun!,
      target: { kind: 'location', locationId: LOOTERS.id },
      placeName: LOOTERS.name,
      tier: 'loose_ears',
      capsPaid: 100,
      departedAt: new Date().toISOString(),
      returnsAt: new Date(Date.now() + 96 * 60_000).toISOString(),
    };
    return route.fulfill({ json: { district: detail(), base: me.base } });
  });
  await panel.getByTestId(`spy-${LOOTERS.id}-send`).click();
  await expect(panel.getByTestId(`spy-${LOOTERS.id}-underway`)).toBeVisible();
  expect(sent).toEqual([
    { target: { kind: 'location', locationId: LOOTERS.id }, tier: 'loose_ears' },
  ]);
  await expect(panel).toContainText('Your runners are here');
  await expect(panel.getByTestId(`spy-${LOOTERS.id}-recall`)).toBeVisible();
  await page.screenshot({ path: 'screenshots/spy-sheet-underway.png', fullPage: false });
});

test("the panel says why nothing can be sent, in the route's own words", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await installApi(page, me);
  await page.route('**/api/city/rustyard', (route) =>
    route.fulfill({ json: { ...districtDetail, spyBlocker: 'no_whispers', spyQuote: null } }),
  );
  await page.goto('/game/city/rustyard');
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
  await expect(report.getByTestId('spy-readouts')).toContainText('82%');
  await expect(report.getByTestId('spy-readouts')).toContainText('Roughly 5');
  await page.screenshot({ path: 'screenshots/spy-report.png', fullPage: false });
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
  await expect(report).toContainText(findDistrict(UNSCOUTED_DISTRICT_ID)?.name ?? 'the Spire');
  await expect(report.getByTestId('spy-readouts')).toHaveCount(0);
});
