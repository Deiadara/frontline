import type { Inventory } from '@frontline/shared';
import { expect, test } from '@playwright/test';
import { lateGame, market, pagesHeld } from './fixtures';
import {
  expectNoImagesClipped,
  expectNothingClippedVertically,
  expectNothingOverflowsTheScreen,
  growPastTheFold,
  installApi,
  settleFonts,
} from './harness';

/**
 * The Blueprints section of the research page (§D4 to §D11, §I1d), looked at rather than asserted
 * about.
 *
 * The unit tests say the right rows are on the screen. This says the screen holds them: three
 * category panels side by side, each with rows carrying a graphic, a row of squares and, on the
 * complete ones, a control. That is the shape most likely to break the board's zero-cut-text bar,
 * because a blueprint name and a page count share a line and the squares wrap.
 *
 * The satchel here is hand-built rather than taken off `market.inventory`: the interesting states
 * are one page in, most of the way there, complete, and unlocked, and a fixture that happened to
 * hold none of them would take a screenshot of an empty page and pass.
 */

test.use({ viewport: { width: 1280, height: 800 } });

/** One of each state, across all three categories. Shared with the research page's sweep. */
const SATCHEL = pagesHeld;

test('the blueprints page holds its rows without cutting any of them', async ({ page }) => {
  await installApi(page, lateGame);
  // Registered after `installApi`, so it wins: Playwright matches the most recent handler first.
  await page.route('**/api/market', async (route) => {
    await route.fulfill({ json: { ...market, inventory: SATCHEL } });
  });

  await page.goto('/game/research/blueprints');
  await expect(page.getByText('Colossus Blueprint')).toBeVisible();
  await settleFonts(page);

  // Every state the page can be in is on screen, so the screenshot is worth looking at.
  await expect(page.getByTestId('blueprint-bp_the_colossus')).toHaveAttribute(
    'data-status',
    'partial',
  );
  const snipers = page.getByTestId('blueprint-bp_snipers');
  await expect(snipers).toHaveAttribute('data-status', 'complete');
  await expect(snipers.getByRole('button', { name: 'Unlock' })).toBeVisible();

  await growPastTheFold(page);
  await expectNothingOverflowsTheScreen(page);
  await expectNothingClippedVertically(page);
  await expectNoImagesClipped(page);
  await page.screenshot({ path: 'e2e-out/blueprints-collecting.png', fullPage: true });

  await page.getByRole('tab', { name: /Unlocked/ }).click();
  const unlocked = page.getByTestId('blueprint-bp_motorcycle');
  await expect(unlocked).toHaveAttribute('data-status', 'unlocked');
  await expect(unlocked.getByRole('button', { name: 'Unlock' })).toHaveCount(0);
  await settleFonts(page);
  await expectNothingOverflowsTheScreen(page);
  await expectNothingClippedVertically(page);
  await page.screenshot({ path: 'e2e-out/blueprints-unlocked.png', fullPage: true });
});

/** §D5, from the outside: a crew with an empty satchel is told nothing about what exists. */
test('shows a crew with no pages nothing at all', async ({ page }) => {
  await installApi(page, lateGame);
  await page.route('**/api/market', async (route) => {
    await route.fulfill({ json: { ...market, inventory: { scrap_servo: 4 } } });
  });

  await page.goto('/game/research/blueprints');
  await expect(page.getByText('How a blueprint is put together')).toBeVisible();
  await expect(page.locator('[data-testid^="blueprint-"]')).toHaveCount(0);
  await settleFonts(page);
  await expectNothingClippedVertically(page);
  await page.screenshot({ path: 'e2e-out/blueprints-empty.png', fullPage: true });
});

/**
 * §I1d: the documents moved out of the Satchel and into research, and the Satchel keeps the door.
 *
 * The pages are still items in the bag, so the Satchel is still where a player notices they have
 * some; what they add up to is a screen, and that screen is now the second door of the archive.
 */
test('opens from the satchel, and says how many pages are in it', async ({ page }) => {
  await installApi(page, lateGame);
  await page.route('**/api/market', async (route) => {
    await route.fulfill({ json: { ...market, inventory: SATCHEL } });
  });

  await page.goto('/game/inventory');
  await expect(page.getByText('13 pages')).toBeVisible();
  await settleFonts(page);
  await expectNothingOverflowsTheScreen(page);
  await expectNothingClippedVertically(page);
  await page.screenshot({ path: 'e2e-out/blueprints-satchel.png', fullPage: true });

  await page.getByRole('link', { name: /Blueprints/ }).click();
  await expect(page).toHaveURL(/\/game\/research\/blueprints$/);
  await expect(page.getByTestId('blueprint-bp_snipers')).toBeVisible();
  // ...and it arrives with the archive's rail beside it rather than as a page of its own.
  await expect(page.getByTestId('research-section-blueprints')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

/** The Satchel's old address still resolves: it is in bookmarks and in old notifications. */
test('redirects the old satchel address to the new one', async ({ page }) => {
  await installApi(page, lateGame);
  await page.route('**/api/market', async (route) => {
    await route.fulfill({ json: { ...market, inventory: SATCHEL } });
  });

  await page.goto('/game/inventory/blueprints');
  await expect(page).toHaveURL(/\/game\/research\/blueprints$/);
  await expect(page.getByTestId('blueprint-bp_snipers')).toBeVisible();
});

/**
 * §G2/§G4: Reimagining, in the state a player can actually press.
 *
 * The panel sat on this page locked and inert for as long as the research did not exist, so it was
 * only ever screenshotted with a padlock on it. This drives the open state: the requirement list is
 * gone, the button trades, and the report names both halves of the swap.
 *
 * The satchel is deliberately fat in spares. `SATCHEL` above holds two, which is one short, and a
 * fixture that could not afford the trade would take a screenshot of a disabled button and pass.
 */
test('reimagining trades three spare pages for one nobody has seen', async ({ page }) => {
  await installApi(page, lateGame);
  const spares: Inventory = { ...SATCHEL, pg_juggernauts_slab_armour: 5 };
  await page.route('**/api/market', async (route) => {
    await route.fulfill({ json: { ...market, inventory: spares } });
  });
  await page.route('**/api/blueprints/reimagine', async (route) => {
    await route.fulfill({
      json: {
        market: {
          ...market,
          inventory: { ...spares, pg_juggernauts_slab_armour: 2, pg_demolishers_charge_moulds: 1 },
        },
        spent: [
          'pg_juggernauts_slab_armour',
          'pg_juggernauts_slab_armour',
          'pg_juggernauts_slab_armour',
        ],
        gained: 'pg_demolishers_charge_moulds',
      },
    });
  });

  await page.goto('/game/research/blueprints');
  const trade = page.getByTestId('reimagine');
  await expect(trade).toBeEnabled();
  // Open, so the requirement list has done its job and got out of the way.
  await expect(page.getByText('A Head of Research on the crew')).toHaveCount(0);
  await settleFonts(page);

  await trade.click();
  const report = page.getByTestId('reimagine-result');
  await expect(report).toContainText('Slab Armour x3');
  await expect(report).toContainText('Charge Moulds came out');

  await settleFonts(page);
  await growPastTheFold(page);
  await expectNothingOverflowsTheScreen(page);
  await expectNothingClippedVertically(page);
  await page.screenshot({ path: 'e2e-out/blueprints-reimagining.png', fullPage: true });
});
