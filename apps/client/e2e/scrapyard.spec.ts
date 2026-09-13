import { expect, test } from '@playwright/test';
import { BUILDING_CATALOG, type BuildingKind } from '@frontline/shared';
import { lateGame, scrapyard } from './fixtures';
import { expectNothingOverflowsTheScreen, installApi, settleFonts } from './harness';

/**
 * The Scrapyard as a screen (§E1 to §E4, reworked 2026-09-10), looked at rather than asserted about.
 *
 * The unit gates say the right rows exist. This says the screen holds them: three benches under a
 * strip of tabs, a rail of structures beside the open bench, and every row fitting inside it
 * without cutting a name or pushing a Build control off the sheet.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const NEXUS = 'scrapyard-nexus';
const doorOf = (kind: BuildingKind) =>
  `scrapyard-bench-${BUILDING_CATALOG[kind].name.toLowerCase().replace(/[^a-z]+/g, '-')}`;

/**
 * A structure the fixture holds a document-locked row for. The row itself is off the board
 * (maintainer request, 2026-09-11: only what the crew has the drawings for is drawn); what is on the
 * bench is the count of what the blueprints are keeping back.
 */
const LOCKED = scrapyard.entries.find(
  (entry) => entry.kind === 'modification' && !entry.documentHeld,
)!;
const HIDDEN_ON_BENCH = scrapyard.entries.filter(
  (entry) =>
    entry.kind === 'modification' && entry.building === LOCKED.building && !entry.documentHeld,
).length;

test("the yard opens on the structures, with the yard's own plate beside the tabs", async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/scrapyard');
  await expect(page.getByTestId('scrapyard-menu')).toBeVisible();
  await settleFonts(page);

  // One door per structure, all eleven, standing or not.
  const doors = page.getByTestId('scrapyard-menu').getByRole('button');
  expect(await doors.count()).toBe(11);
  await expect(page.getByTestId('scrapyard-view-modifications')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId(NEXUS)).toBeVisible();
  await expect(page.getByTestId('scrapyard-info')).toBeVisible();
  await expect(page.getByTestId('scrapyard-level')).toContainText(
    `Level ${scrapyard.scrapyardLevel}`,
  );

  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'e2e-out/scrapyard-everything.png' });
});

test("a structure's door narrows the bench to it, and the tabs swap the bench", async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/scrapyard');
  await expect(page.getByTestId(NEXUS)).toBeVisible();
  await settleFonts(page);

  await page.getByTestId(doorOf(LOCKED.building!)).click();
  await expect(page.getByTestId(`scrapyard-${LOCKED.building}`)).toBeVisible();
  await expect(page.getByTestId(NEXUS)).toHaveCount(0);
  // The row behind a document the crew has not assembled is not drawn, and the bench says so.
  await expect(page.getByTestId(`addon-${LOCKED.id}`)).toHaveCount(0);
  await expect(page.getByTestId(`scrapyard-hidden-${LOCKED.building}`)).toContainText(
    HIDDEN_ON_BENCH === 1 ? 'One more' : `${HIDDEN_ON_BENCH} more`,
  );

  await page.getByTestId('scrapyard-view-refits').click();
  await expect(page.getByTestId('scrapyard-refits')).toBeVisible();
  await expect(page.getByTestId('scrapyard-menu')).toHaveCount(0);
  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'e2e-out/scrapyard-refits.png' });

  /*
   * ...and coming back lands on the bench that was open, not on the first door in the rail.
   *
   * This asserted the Nexus until 2026-09-11, which was asserting a bug: `setParams` replaces the
   * whole query string, so writing `{ view }` dropped `?bench=<kind>` and a player who had the
   * Gauntlet open came back to the Nexus. A rail of eleven doors is exactly the place not to lose
   * which one was open.
   */
  await page.getByTestId('scrapyard-view-modifications').click();
  await expect(page.getByTestId(`scrapyard-${LOCKED.building}`)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`bench=${LOCKED.building}`));
  await expect(page.getByTestId(NEXUS)).toHaveCount(0);

  // The Nexus is the default, not the memory: a yard opened with no bench named still starts there.
  await page.goto('/game/scrapyard');
  await expect(page.getByTestId(NEXUS)).toBeVisible();
});

/**
 * §E3: "everything you can build, based on the blueprints you hold and what you have researched".
 *
 * Measured as a difference rather than as a count. The filter is only worth having if the board it
 * leaves is *smaller* than the one it started from and still not empty, and the two assertions
 * either side of the click are what make a filter that does nothing fail.
 */
test('the ready filter leaves exactly the rows the yard could cut today', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/scrapyard?view=refits');
  await expect(page.getByTestId('scrapyard-refits')).toBeVisible();
  await settleFonts(page);

  const rows = page.locator('li[data-testid^="addon-"]');
  const before = await rows.count();
  const buildable = await page.locator('[data-testid^="addon-build-"]').count();
  expect(buildable).toBeGreaterThan(0);
  expect(buildable).toBeLessThan(before);

  await page.getByTestId('scrapyard-ready-only').click();
  await expect(page.locator('[data-testid^="addon-blocker-"]')).toHaveCount(0);
  expect(await page.locator('[data-testid^="addon-build-"]').count()).toBe(buildable);

  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'e2e-out/scrapyard-ready.png' });
});

/** A row the yard is too low for says which level, before it says anything about documents. */
test('a rung the yard cannot reach names the level it opens at', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/scrapyard?view=refits');
  await expect(page.getByTestId('addon-armour_3')).toBeVisible();
  await expect(page.getByTestId('addon-blocker-armour_3')).toContainText(
    /Needs the Scrapyard at level \d+/,
  );
});
