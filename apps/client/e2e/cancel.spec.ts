import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  RESOURCE_ORDER,
  cancelRefund,
  scoutRecalledReturnsAt,
  type PartialResources,
  type ResourceKey,
  type ScoutingRunView,
} from '@frontline/shared';
import {
  BOARD_NOW,
  UNSCOUTED_DISTRICT_ID,
  city,
  districtDetail,
  districtDetailFor,
  lateGame,
  lateGameBase,
  missionsResponse,
  research,
  trainingResponse,
} from './fixtures';
import { installApi, settleFonts } from './harness';

test.use({ viewport: { width: 1600, height: 1000 } });

/**
 * Changing your mind (maintainer request, 2026-09-12).
 *
 * One rule for everything that takes time: an X in the first tenth of the thing's own clock, the
 * time left to decide beside it, ninety percent of a spend back. The rule itself is unit-tested
 * in the shared package. What only a browser answers is whether each screen draws the X off the
 * right clock, hides it once the window is shut, sends the right unit when it is pressed, takes
 * the thing off the board on the read that follows, and lands the refund's figure under the X
 * rather than on a chip a screen away.
 */

const LEFT_TO_DECIDE = /^\d+(h( \d+m)?|m( \d+s)?|s) left to decide$/;

/** The stockpiles a refund moves, in the order the HUD draws them. */
function refunded(paid: PartialResources): [ResourceKey, number][] {
  const back = cancelRefund(paid);
  return RESOURCE_ORDER.flatMap((kind) =>
    (back[kind] ?? 0) > 0 ? [[kind, back[kind] ?? 0] as [ResourceKey, number]] : [],
  );
}

/**
 * The green figures for a refund, and where they hang: under the X that asked for it.
 *
 * `box` is the X's box *before* the press, because the X is gone by the time the figure is up.
 * The column's `left` is the button's centre line, clamped 44px in from the frame's edge, so a
 * plate on the left edge of the screen lands its receipt a few pixels right of the X.
 */
async function expectReceiptUnder(page: Page, box: Locator, paid: PartialResources): Promise<void> {
  const at = await box.boundingBox();
  if (!at) throw new Error('the X has no box');
  const back = refunded(paid);
  expect(back.length, 'the fixture must refund something').toBeGreaterThan(0);

  await box.click();

  for (const [kind, amount] of back) {
    const column = page
      .getByTestId(`delta-${kind}`)
      .filter({ has: page.getByTestId('delta-gain') });
    await expect(column).toHaveAttribute('data-anchored', 'press');
    const figure = column.getByTestId('delta-gain');
    await expect(figure, `${kind} must say what came back`).toHaveAttribute(
      'data-amount',
      String(amount),
    );
    const where = await column.boundingBox();
    if (!where) throw new Error(`${kind}'s column has no box`);
    expect(Math.abs(where.x - (at.x + at.width / 2))).toBeLessThanOrEqual(44);
  }
}

test('a build waiting behind the one being worked wears the X; one past its tenth does not', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/base');
  await expect(page.getByTestId('build-rail-greenhouse')).toBeVisible();
  await settleFonts(page);

  // `bq-1` is five minutes into twenty: past the tenth, and its plate carries no X. `bq-2` has
  // not started yet, so there is nothing to be too late for.
  await expect(page.getByTestId('cancel-build-bq-1')).toHaveCount(0);
  const x = page.getByTestId('cancel-build-bq-2');
  await expect(x).toBeVisible();
  await expect(x).toHaveAccessibleName(/call off the greenhouse level 3/i);
  await expect(page.getByTestId('cancel-build-bq-2-window')).toHaveText(LEFT_TO_DECIDE);

  const order = lateGameBase.buildQueue.find((entry) => entry.id === 'bq-2');
  if (!order) throw new Error('the late-game fixture has no bq-2');
  const sent = page.waitForRequest((request) => request.url().endsWith('/api/base/cancel'));
  await expectReceiptUnder(page, x, order.paid);
  expect((await sent).postDataJSON()).toEqual({ orderId: 'bq-2' });
  await expect(page.getByTestId('build-rail-greenhouse')).toHaveCount(0);
  await expect(page.getByTestId('build-rail-quarters')).toBeVisible();
});

test('the In progress page wears the X on a build still inside its tenth, and not on one past it', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/actions/progress');
  await expect(page.getByTestId('in-progress')).toBeVisible();
  await settleFonts(page);

  // The one being worked is past its tenth: no X on it. The one behind it is not.
  await expect(page.getByTestId('progress-build-bq-1')).toBeVisible();
  await expect(page.getByTestId('cancel-build-bq-1')).toHaveCount(0);
  const x = page.getByTestId('cancel-build-bq-2');
  await expect(x).toBeVisible();
  await expect(page.getByTestId('cancel-build-bq-2-window')).toHaveText(LEFT_TO_DECIDE);
  await page.screenshot({ path: 'e2e-out/cancel-progress.png' });

  const sent = page.waitForRequest((request) => request.url().endsWith('/api/base/cancel'));
  await x.click();
  expect((await sent).postDataJSON()).toEqual({ orderId: 'bq-2' });
  await expect(page.getByTestId('progress-build-bq-2')).toHaveCount(0);
  await expect(page.getByTestId('progress-build-bq-1')).toBeVisible();
});

test('a rung just put on the bench can be taken off it, for ninety percent back', async ({
  page,
}) => {
  const rung = research.technologies.find((one) => !one.known && one.blocker === null);
  if (!rung) throw new Error('the research fixture must offer a startable rung');

  await installApi(page, lateGame);
  await page.goto('/game/research');
  await page.getByTestId(`research-track-${rung.track}`).click();
  const card = page.getByTestId(`tech-${rung.id}`);
  await card.scrollIntoViewIfNeeded();
  await settleFonts(page);
  await card.getByRole('button', { name: 'Put them on it' }).click();
  await expect(card).toContainText('On the bench');

  const x = page.getByTestId('cancel-research');
  await expect(x).toBeVisible();
  await expect(page.getByTestId('cancel-research-window')).toHaveText(LEFT_TO_DECIDE);
  // The start threw its own red figures; let them go so the receipt below is unambiguous.
  await expect(page.getByTestId('delta-spend')).toHaveCount(0);

  const sent = page.waitForRequest((request) => request.url().endsWith('/api/research/cancel'));
  await expectReceiptUnder(page, x, rung.cost);
  expect((await sent).postDataJSON()).toEqual({});
  await expect(page.getByTestId('research-progress')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Put them on it' })).toBeVisible();
});

test('a crew a minute out wears the X with the time left; pressing it turns them round', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/missions');
  await expect(page.getByTestId('crews-in-flight')).toBeVisible();
  await settleFonts(page);

  /*
   * A minute into a Deep Expedition, whose window is a tenth of the **whole run**.
   *
   * The rule changed on 2026-09-22: it used to be a tenth of the road out, so this crew had five
   * minutes of a fifty-minute walk. The run is a day on the ground plus two legs of travel, so
   * the window is now hours. Asserted as the shape rather than the figure, because the figure is
   * a property of the template's travel band and would redden on any retune of it.
   */
  const x = page.getByTestId('recall-mission-m-1');
  await expect(x).toBeVisible();
  await expect(page.getByTestId('recall-mission-m-1-window')).toHaveText(LEFT_TO_DECIDE);
  await page.screenshot({ path: 'e2e-out/cancel-missions.png' });

  const sent = page.waitForRequest((request) => request.url().endsWith('/api/missions/recall'));
  await x.click();
  expect((await sent).postDataJSON()).toEqual({ missionId: 'm-1' });
  await expect(x).toHaveCount(0);
});

/**
 * The board, on the road's clock.
 *
 * The Actions page ticks off `/api/actions`'s `serverNow`, which is the fixed `BOARD_NOW`, while
 * `missionsResponse()` stamps its crews against the live clock: read together, a crew "a minute
 * out" is weeks in the future and every window on it reads open. Building the board on the same
 * clock is what makes the two pages agree about which crew is still inside its tenth. Routed
 * statefully, so a recall marks the crew on the read that follows, the way the harness's own
 * handler does for the live board.
 */
async function routeBoardClock(page: Page, startedMinutesAgo: number): Promise<void> {
  const clock = new Date(BOARD_NOW);
  const fresh = missionsResponse(clock);
  let board = {
    ...fresh,
    missions: fresh.missions.map((mission) =>
      mission.status === 'active'
        ? {
            ...mission,
            startedAt: new Date(clock.getTime() - startedMinutesAgo * 60_000).toISOString(),
          }
        : mission,
    ),
  };
  await page.route('**/api/missions', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: board }) : route.fallback(),
  );
  await page.route('**/api/missions/recall', (route) => {
    const { missionId } = route.request().postDataJSON() as { missionId: string };
    board = {
      ...board,
      missions: board.missions.map((mission) =>
        mission.id === missionId ? { ...mission, recalledAt: clock.toISOString() } : mission,
      ),
    };
    return route.fulfill({ json: board });
  });
}

test('a crew past the first tenth of its run has no X anywhere', async ({ page }) => {
  await installApi(page, lateGame);
  /*
   * Far enough in that the window has shut, whatever the run's shape.
   *
   * Ten minutes used to do it, when the window was a tenth of the road out. It is a tenth of the
   * whole run now, and this crew's run is a day on the ground, so the clock has to be pushed past
   * a tenth of *that*: 200 minutes is comfortably past the ~154 the window opens with and still
   * far short of the run itself, so the crew is genuinely mid-job rather than home.
   */
  await routeBoardClock(page, 200);

  await page.goto('/game/missions');
  await expect(page.getByTestId('crews-in-flight')).toBeVisible();
  await expect(page.getByTestId('recall-mission-m-1')).toHaveCount(0);

  await page.goto('/game/actions');
  await expect(page.getByTestId('job-m-1')).toBeVisible();
  await expect(page.getByTestId('recall-job-m-1')).toHaveCount(0);
});

test('the road wears one X on every row that can still be turned round', async ({ page }) => {
  await installApi(page, lateGame);
  await routeBoardClock(page, 1);
  await page.goto('/game/actions');
  await expect(page.getByTestId('road')).toBeVisible();
  await settleFonts(page);

  // A minute into a twenty-minute walk: inside the tenth. Half an hour into forty: not.
  await expect(page.getByTestId('recall-col-1')).toBeVisible();
  await expect(page.getByTestId('recall-col-1-window')).toHaveText(LEFT_TO_DECIDE);
  await expect(page.getByTestId('recall-col-2')).toHaveCount(0);
  // The crew on a job, a minute into a day-long run: hours of window, not minutes.
  await expect(page.getByTestId('recall-job-m-1')).toBeVisible();
  await expect(page.getByTestId('recall-job-m-1-window')).toHaveText(LEFT_TO_DECIDE);
  // The scout is ten minutes in, and its window is a tenth of the whole run.
  await expect(page.getByTestId('scout-run')).toBeVisible();
  await expect(page.getByTestId('recall-scout')).toHaveCount(0);

  const sent = page.waitForRequest((request) => request.url().endsWith('/api/missions/recall'));
  await page.getByTestId('recall-job-m-1').click();
  expect((await sent).postDataJSON()).toEqual({ missionId: 'm-1' });
  await expect(page.getByTestId('job-m-1')).toContainText('Turned around');
});

test('work under way on held ground wears the X beside its clock, and the press clears it', async ({
  page,
}) => {
  const held = districtDetail.locations[0];
  if (!held?.upgrade) throw new Error('the district fixture must hold an upgradable location');
  // The district reads on the fixture's fixed clock, so the work is timed against that clock:
  // a minute into a thirty-minute job, two minutes of the three left to decide.
  const frame = Date.parse(districtDetail.serverNow);
  const since = new Date(frame - 60_000).toISOString();
  const until = new Date(frame + 29 * 60_000).toISOString();
  const paid = held.upgrade.cost;
  await installApi(page, lateGame, {
    underWay: {
      location: {
        districtId: districtDetail.district.id,
        locationId: held.location.id,
        work: 'upgrade',
        since,
        until,
        paid,
      },
    },
  });

  await page.goto(`/game/city/${districtDetail.district.id}`);
  await settleFonts(page);
  await page.getByTestId(`site-${held.location.id}`).click();
  await expect(page.getByTestId('location-window')).toBeVisible();
  await expect(page.getByTestId(`upgrading-${held.location.id}`)).toBeVisible();

  const x = page.getByTestId(`cancel-upgrade-${held.location.id}`);
  await expect(x).toBeVisible();
  await expect(page.getByTestId(`cancel-upgrade-${held.location.id}-window`)).toHaveText(
    /^[12]m( \d+s)? left to decide$/,
  );
  await page.screenshot({ path: 'e2e-out/cancel-location.png' });

  const sent = page.waitForRequest((request) => request.url().endsWith('/api/city/cancel-upgrade'));
  await expectReceiptUnder(page, x, paid);
  expect((await sent).postDataJSON()).toEqual({ locationId: held.location.id });
  await expect(page.getByTestId(`upgrading-${held.location.id}`)).toHaveCount(0);
  await expect(page.getByTestId(`upgrade-${held.location.id}`)).toBeVisible();
});

test('a scout on the road can be turned round, and the street stays shut', async ({ page }) => {
  await installApi(page, lateGame);
  /*
   * Routed here rather than through the harness's own run, because that run is stamped with the
   * browser's clock while the district it is read from answers on the fixture's fixed one, and
   * the panel's countdown is the difference between the two. A live `serverNow` on this one read
   * is what makes "how long is left to decide" a number a player could see.
   */
  const dark = districtDetailFor(UNSCOUTED_DISTRICT_ID);
  let run: ScoutingRunView = {
    districtId: UNSCOUTED_DISTRICT_ID,
    districtName: dark.district.name,
    officerId: 'off-3',
    officerName: 'Scout Party',
    departedAt: new Date(Date.now() - 60_000).toISOString(),
    /*
     * Thirty minutes' walk each way and an hour on the ground: 120 minutes, so twelve to decide
     * and eleven left after the minute already walked.
     *
     * The window is a tenth of the **whole run** since 2026-09-22. It used to be a tenth of the
     * walk out, which gave three minutes and meant the hour of looking bought none of it: the
     * longer a scout was committed for, the less time there was to change your mind.
     */
    returnsAt: new Date(Date.now() + 119 * 60_000).toISOString(),
    travelMinutes: 30,
    recalledAt: null,
  };
  const detail = () => ({
    ...dark,
    serverNow: new Date().toISOString(),
    scoutPlan: null,
    scoutingRun: run,
  });
  await page.route(`**/api/city/${UNSCOUTED_DISTRICT_ID}`, (route) =>
    route.fulfill({ json: detail() }),
  );
  await page.route('**/api/city/scout/recall', (route) => {
    const now = new Date();
    run = {
      ...run,
      recalledAt: now.toISOString(),
      returnsAt: scoutRecalledReturnsAt(run, now).toISOString(),
    };
    return route.fulfill({ json: { district: detail(), base: lateGameBase } });
  });

  await page.goto(`/game/city/${UNSCOUTED_DISTRICT_ID}`);
  await expect(page.getByTestId('scout-underway')).toBeVisible();
  await settleFonts(page);
  const x = page.getByTestId('recall-scout');
  await expect(x).toBeVisible();
  await expect(x).toHaveAccessibleName('Turn the Scout Party round');
  // Twelve minutes of window on a two-hour run, one minute of it already walked: eleven or so.
  await expect(page.getByTestId('recall-scout-window')).toHaveText(/^1[012]m( \d+s)? left/);

  const sent = page.waitForRequest((request) => request.url().endsWith('/api/city/scout/recall'));
  await x.click();
  expect((await sent).postDataJSON()).toEqual({});
  await expect(x).toHaveCount(0);
  await expect(page.getByTestId('scout-underway')).toContainText('turned round');
  // Home as far off as they had come: about a minute, not the twenty-nine left of the walk out.
  await expect(page.getByTestId('scout-countdown')).toHaveText(/^0?[01]:\d\d$/);
});

test('a gate being raised wears the X on its plate over the city', async ({ page }) => {
  const gate = city.capturedGates[0];
  if (!gate?.nextCost) throw new Error('the city fixture must hold a gate with a next level');
  // The city reads on the fixture's fixed clock; a minute into an hour's raise.
  const frame = Date.parse(city.serverNow);
  const since = new Date(frame - 60_000).toISOString();
  const until = new Date(frame + 59 * 60_000).toISOString();
  const paid = gate.nextCost;
  await installApi(page, lateGame, { underWay: { gate: { since, until, paid } } });

  await page.goto('/game/city');
  const panel = page.getByTestId(`captured-gate-${gate.districtId}`);
  await expect(panel).toBeVisible();
  await settleFonts(page);
  await expect(panel).toContainText('Being raised');
  const x = page.getByTestId(`cancel-gate-${gate.districtId}`);
  await expect(x).toBeVisible();
  await expect(page.getByTestId(`cancel-gate-${gate.districtId}-window`)).toHaveText(
    /^[45]m( \d+s)? left to decide$/,
  );

  const sent = page.waitForRequest((request) => request.url().endsWith('/api/city/gate/cancel'));
  await expectReceiptUnder(page, x, paid);
  expect((await sent).postDataJSON()).toEqual({ districtId: gate.districtId });
  await expect(x).toHaveCount(0);
  await expect(panel.getByTestId(`raise-gate-${gate.districtId}`)).toBeVisible();
});

test('a drill in its first tenth wears the X and comes off the board when it is pressed', async ({
  page,
}) => {
  // The board reads on the fixture's fixed clock; a minute into the hour, five of six left.
  const startedAt = new Date(Date.parse(trainingResponse.serverNow) - 60_000).toISOString();
  await installApi(page, lateGame, { underWay: { drill: { startedAt } } });

  await page.goto('/game/training');
  await expect(page.getByTestId('training-in-flight')).toBeVisible();
  await settleFonts(page);
  const x = page.getByTestId('cancel-drill');
  await expect(x).toBeVisible();
  await expect(page.getByTestId('cancel-drill-window')).toHaveText(
    /^[45]m( \d+s)? left to decide$/,
  );

  const sent = page.waitForRequest((request) => request.url().endsWith('/api/training/cancel'));
  await x.click();
  expect((await sent).postDataJSON()).toEqual({ sessionId: 'drill-1' });
  await expect(page.getByTestId('training-in-flight')).toHaveCount(0);
});

test('the drill twenty minutes into its hour has no X', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/training');
  await expect(page.getByTestId('training-in-flight')).toBeVisible();
  await expect(page.getByTestId('cancel-drill')).toHaveCount(0);
});
