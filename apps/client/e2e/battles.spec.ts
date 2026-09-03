import { expect, test } from '@playwright/test';
import { battles, lateGame } from './fixtures';
import {
  growPastTheFold,
  expectNoImagesClipped,
  expectNothingClippedVertically,
  installApi,
  settleFonts,
} from './harness';

test.use({ viewport: { width: 1280, height: 800 } });

/**
 * The Battles page (§A4, battle rework), through the browser.
 *
 * The unit tests already pin the rules. What only a browser can answer is whether the screen a
 * player actually gets **says** what the rules mean: that a fight you called and a fight you are
 * defending read as different things, that an enemy force you cannot count reads as unknown rather
 * than as zero, and that the report is a document somebody would read rather than a wall of
 * numbers. All three are things a green unit suite has shipped wrong before.
 *
 * The page is a list and a detail now, so the browser is also the only place that can say the two
 * halves agree: picking a row has to change what the detail is about.
 */

test('the list scans, and opening a fight says what is on the ground', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/battles');

  await expect(page.getByRole('heading', { name: 'Battles' })).toBeVisible();
  await expect(page.getByTestId('board-infamy')).toHaveText(`${battles.infamy} infamy`);

  const coming = page.getByTestId('coming-battles');
  await expect(coming.getByText('Kessler Press')).toBeVisible();
  await expect(coming.getByText('The Bonefield')).toBeVisible();

  // The first fight opens by default, so the page never lands on an empty column.
  const mine = battles.coming[0]!;
  const detail = page.getByTestId(`battle-detail-${mine.battle.id}`);
  await expect(detail).toBeVisible();

  // The board's own request: what you have there, unit by unit, rather than one body count.
  const forces = page.getByTestId('battle-forces');
  for (const unitId of Object.keys(mine.muster!.army)) {
    await expect(forces.getByTestId(`force-${unitId}`)).toBeVisible();
  }

  /*
   * The forecast, which is the number a player most needs before committing anybody.
   *
   * It runs `battle/forecast.ts` against the ground the fight will actually happen on, which is why
   * `BattleView` carries a battlefield at all. The feature existed and was tested for a long time
   * while being wired only into the garrison picker, where there is never an enemy: computed,
   * correct, and on no screen anybody could reach.
   */
  const odds = detail.getByTestId('battle-odds');
  await expect(odds).toBeVisible();
  await expect(odds).toContainText('runs of the real thing');
  await expect(odds).toContainText('%');

  // The one they are defending: the other side is running dark, so it says so rather than "0".
  const theirs = battles.coming[1]!;
  await page.getByTestId(`battle-${theirs.battle.id}`).click();
  const other = page.getByTestId(`battle-detail-${theirs.battle.id}`);
  await expect(other).toBeVisible();
  await expect(other.getByText('Unknown')).toBeVisible();
  await expect(other.getByText('Nothing. They are running dark.')).toBeVisible();

  // ...and with nothing counted there is no forecast, rather than a confident number built on air.
  await expect(other.getByTestId('odds-none')).toBeVisible();

  await settleFonts(page);
  /*
   * The fold taken out of the way first.
   *
   * This screen's scroll lives inside the sheet, and the fold of a scroller cuts its last row by
   * design: the detail column is taller than a laptop and is meant to be. Growing the viewport to
   * the height of the content is what lets the sweep measure the *layout* rather than how far down
   * the page happened to be, and it is what the market's and the district's sweeps already do.
   */
  await page.setViewportSize({ width: 1280, height: 2000 });
  await settleFonts(page);
  await expectNothingClippedVertically(page, '[data-testid="coming-battles"]');
  await expectNothingClippedVertically(page, '[data-testid="name-buys"]');
  await expectNoImagesClipped(page, 'main section');
  await page.screenshot({ path: 'e2e-out/battles-board.png', fullPage: true });
});

/**
 * §D7: what a name buys, and what it refuses to sell.
 *
 * The fixture's crew has finished no research and has one officer, so most of the shelf is on the
 * table only in the sense of being visible. That is the state worth pinning: a boost you cannot see
 * is a boost you never go and earn.
 */
test('the boost picker prices one fight, and says who has not offered the rest', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/battles');

  const buys = page.getByTestId('name-buys');
  await expect(buys).toBeVisible();
  await expect(page.getByTestId('buy-boost')).toBeDisabled();

  await page.getByTestId('boost-picker').click();
  const open = battles.coming[0]!.boosts.find((option) => option.available)!;
  const shut = battles.coming[0]!.boosts.find((option) => !option.available)!;
  await expect(page.getByRole('option', { name: new RegExp(open.name) })).toBeVisible();
  await expect(page.getByRole('option', { name: new RegExp(shut.name) })).toHaveAttribute(
    'aria-disabled',
    'true',
  );

  await page.getByRole('option', { name: new RegExp(open.name) }).click();
  await expect(buys.getByText(open.effect)).toBeVisible();
  await expect(page.getByTestId('buy-boost')).toBeEnabled();

  await settleFonts(page);
  // Past the fold before sweeping. The Upcoming tab is one fixed frame now, so the detail column
  // is a scroller and the boost panel sits at the bottom of it: a scroller cutting its last row is
  // the fold's doing rather than the layout's, exactly as in the gate test below.
  await growPastTheFold(page);
  await expectNothingClippedVertically(page, '[data-testid="name-buys"]');
  await page.screenshot({ path: 'e2e-out/battles-boost.png', fullPage: true });
});

/** The reports and your own ground are behind the switch now, so the switch has to work. */
test('the tabs move between what is coming, what came back and what you hold', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/battles');

  await page.getByTestId('battles-tab-reports').click();
  await expect(page.getByTestId('battle-reports')).toBeVisible();

  await page.getByTestId('battles-tab-ground').click();
  await expect(page.getByTestId('structures')).toBeVisible();

  await page.getByTestId('battles-tab-coming').click();
  await expect(page.getByTestId('coming-battles')).toBeVisible();
});

test('a report reads as a document, and a silent one says so instead of showing an empty table', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/battles');

  await page.getByTestId('battles-tab-reports').click();
  await page.getByTestId('read-fight-3').click();
  const report = page.getByTestId('battle-report');
  await expect(report).toBeVisible();
  // The header states the outcome, the ground and how long it took. The round count was on the
  // analysis from the start and drawn nowhere, so a one-round rout and a five-round grind read the
  // same.
  await expect(report.getByText('Held · Ninth Street Pawn · 5 rounds')).toBeVisible();
  // The things the board asked a report to answer, on screen at once.
  await expect(page.getByText('Snipers').first()).toBeVisible();
  await expect(page.getByText('61%')).toBeVisible();

  /*
   * The template: both ledgers carry the same rows, in the same order.
   *
   * Each row used to be written `{side.infamy > 0 && <Row/>}`, one condition per side, so the two
   * columns grew different rows and stopped lining up exactly where a reader wants to compare them.
   * On this fixture only the attacker banked infamy, took anybody on the ring or was cowed, so under
   * the old rule this assertion fails on three separate rows.
   */
  const dialog = page.getByRole('dialog');
  const labelsOf = (tone: 'mine' | 'theirs') =>
    dialog.getByTestId(`report-side-${tone}`).locator('dl dt').allTextContents();
  const mine = await labelsOf('mine');
  expect(mine, 'the ledger lost its rows').toContain('Caught by the ring');
  expect(mine).toContain('Infamy earned');
  // §D3: intimidation is settled before the first shot and was never drawn anywhere at all.
  expect(mine, 'the cowed are still invisible').toContain('Too cowed to fire');
  // A ring is a fight now, so what it paid is a number the report has to carry.
  expect(mine).toContain('Lost holding the ring');
  expect(await labelsOf('theirs'), 'the two ledgers do not line up').toEqual(mine);

  // §D1: who led and what came of them. On the analysis since officers could lead, drawn nowhere.
  await expect(dialog.getByTestId('report-officer-mine')).toContainText('led, and put out 940');
  // The ring held on this fixture, and that is different information from who it caught.
  await expect(dialog.getByText('The ring held, and the withdrawal broke on it.')).toBeVisible();

  await settleFonts(page);
  /*
   * Grown past the fold before the clipping sweep.
   *
   * The sweep treats any ancestor with a non-visible `overflow-y` as a clipping edge, and it is
   * right to: it cannot tell a reader who will scroll from one who will never see the row. The
   * report's body is a scroller, so on a short window its last table row is legitimately under the
   * fold and the sweep calls it cut. That made the gate a knife edge on this screen: the report fit
   * by a few pixels, and adding the round count, the officer line and two ledger rows put it over,
   * which is a red for growing the document rather than for cutting anything.
   */
  await growPastTheFold(page);
  await expectNothingClippedVertically(page, '[role="dialog"]');
  await page.screenshot({ path: 'e2e-out/battles-report.png', fullPage: true });

  await page.keyboard.press('Escape');
  await page.getByTestId('read-fight-4').click();
  await expect(page.getByTestId('battle-report-silent')).toBeVisible();
  await expect(page.getByText(/stayed out there/)).toBeVisible();
});

test('the deployment dialog splits the line from the ring, and locks what the name cannot field', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/battles');

  await page.getByTestId(`deploy-open-${battles.coming[0]!.battle.id}`).click();
  await expect(page.getByTestId('deploy-rows')).toBeVisible();

  // Two controls per unit, and they are different controls: one is the fight, one is the cordon.
  await expect(page.getByTestId('line-razors')).toBeVisible();
  await expect(page.getByTestId('ring-razors')).toBeVisible();

  await settleFonts(page);
  await expectNothingClippedVertically(page, '[role="dialog"]');
  await page.screenshot({ path: 'e2e-out/battles-deploy.png', fullPage: true });
});

test('a district that is held end to end offers the gate and nothing else', async ({ page }) => {
  await installApi(page, lateGame);
  // `chrome-row` is the shut district in the fixture; the district page reads its gate off the
  // board rather than working it out from who holds what.
  await page.goto('/game/city/chrome-row');
  await expect(page.getByTestId('call-gate')).toBeVisible();

  await settleFonts(page);
  // Past the fold before sweeping: seven location cards do not fit a laptop, and the bottom of the
  // window cutting the last row is the window's doing rather than the layout's. This container was
  // empty in the fixture until the district paintings landed, so the sweep had nothing to measure
  // and the fold never came up.
  await growPastTheFold(page);
  await expectNothingClippedVertically(page, '[data-testid="locations"]');
  await page.screenshot({ path: 'e2e-out/battles-gate.png', fullPage: true });
});
