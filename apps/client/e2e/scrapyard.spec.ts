import { expect, test } from '@playwright/test';
import { lateGame } from './fixtures';
import { expectNothingOverflowsTheScreen, installApi, settleFonts } from './harness';

/**
 * The Scrapyard as a screen (§E1 to §E4), looked at rather than asserted about.
 *
 * The unit gates say the right rows exist. This says the screen holds them: a rail of benches on
 * the left, one workspace on the right, and sixty-four rows that have to fit inside it without
 * cutting a name or pushing a Build control off the sheet. That is the shape most likely to break
 * the board's zero-cut-text bar, because a bench label, a blurb and a `ready/total` count share
 * one 17rem column.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const NEXUS = 'scrapyard-nexus';

test('the yard opens on a menu, and every bench is reachable from it', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/scrapyard');
  await expect(page.getByTestId('scrapyard-menu')).toBeVisible();
  await settleFonts(page);

  // §E2: a door per bench, refits first and then one per structure that has add-ons.
  const doors = page.getByTestId('scrapyard-menu').getByRole('button');
  expect(await doors.count()).toBeGreaterThan(3);
  await expect(page.getByTestId('scrapyard-bench-everything')).toBeVisible();
  await expect(page.getByTestId('scrapyard-bench-refits')).toBeVisible();

  // §E1/§E3: everything is on the board to begin with, in the three states the page draws.
  await expect(page.getByTestId(NEXUS)).toBeVisible();
  await expect(page.getByTestId('scrapyard-refits')).toBeVisible();
  expect(await page.locator('[data-testid^="addon-build-"]').count()).toBeGreaterThan(0);
  expect(await page.locator('[data-testid^="addon-blocker-"]').count()).toBeGreaterThan(0);

  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'e2e-out/scrapyard-everything.png' });
});

test('a bench narrows the workspace to itself', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/scrapyard');
  await expect(page.getByTestId(NEXUS)).toBeVisible();
  await settleFonts(page);

  await page.getByTestId('scrapyard-bench-refits').click();
  await expect(page.getByTestId('scrapyard-refits')).toBeVisible();
  // The structures are gone, which is the whole point of a menu: this screen used to be all
  // twelve headings in one scrolling grid whatever a player came here to do.
  await expect(page.getByTestId(NEXUS)).toHaveCount(0);

  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'e2e-out/scrapyard-refits.png' });

  await page.getByTestId('scrapyard-bench-everything').click();
  await expect(page.getByTestId(NEXUS)).toBeVisible();
});

/**
 * §E3: "everything you can build, based on the blueprints you hold and what you have researched".
 *
 * Measured as a difference rather than as a count. The filter is only worth having if the board it
 * leaves is *smaller* than the one it started from and still not empty, and the two assertions
 * either side of the click are what make a filter that does nothing fail: a stuck filter leaves
 * the same rows on screen, and one that hides everything leaves none.
 */
test('the ready filter leaves exactly the rows the yard could cut today', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/scrapyard');
  await expect(page.getByTestId(NEXUS)).toBeVisible();
  await settleFonts(page);

  const rows = page.locator('[data-testid^="addon-"]:not([data-testid*="build"])');
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

/**
 * §D12f/§D12h: a locked row names the document, not "a blueprint".
 *
 * The fixture words its blockers out of `blueprints/catalog.ts`, the same lookup the server
 * projects with, so this asserts the contract rather than a string somebody typed twice.
 */
test('a locked add-on says which blueprint it is waiting on', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/scrapyard');
  await expect(page.getByTestId(NEXUS)).toBeVisible();
  await settleFonts(page);

  const blocker = page.locator('[data-testid^="addon-blocker-"]').first();
  await expect(blocker).toContainText(/Needs the .+ Blueprint/);
});
