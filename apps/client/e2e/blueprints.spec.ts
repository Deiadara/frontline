import type { Inventory } from '@frontline/shared';
import { expect, test } from '@playwright/test';
import { lateGame, market } from './fixtures';
import {
  expectNoImagesClipped,
  expectNothingClippedVertically,
  expectNothingOverflowsTheScreen,
  growPastTheFold,
  installApi,
  settleFonts,
} from './harness';

/**
 * The Blueprints page (§D4 to §D11), looked at rather than asserted about.
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

/** One of each state, across all three categories. */
const SATCHEL: Inventory = {
  // Partial: two of the Colossus' eight, which is the longest row on the page.
  pg_colossus_hull_sections: 1,
  pg_colossus_reactor_housing: 1,
  // Partial, with a spare copy: the square that carries a count.
  pg_juggernauts_slab_armour: 3,
  pg_juggernauts_power_spine: 1,
  // Complete and waiting to be unlocked: the Unlock control.
  pg_snipers_barrel_liners: 1,
  pg_snipers_range_cards: 1,
  pg_snipers_ghillie_patterns: 1,
  // Upgrades and consumables, so all three panels have something in them.
  pg_munitions_load_tables: 1,
  pg_garage_pit_layout: 1,
  pg_garage_hoist_rating: 1,
  pg_shaped_charges_cone_geometry: 1,
  pg_overnight_plating_cut_list: 1,
  pg_overnight_plating_weld_sequence: 1,
  // Already unlocked: the second view.
  bp_motorcycle: 1,
  scrap_servo: 4,
};

test('the blueprints page holds its rows without cutting any of them', async ({ page }) => {
  await installApi(page, lateGame);
  // Registered after `installApi`, so it wins: Playwright matches the most recent handler first.
  await page.route('**/api/market', async (route) => {
    await route.fulfill({ json: { ...market, inventory: SATCHEL } });
  });

  await page.goto('/game/inventory/blueprints');
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

  await page.goto('/game/inventory/blueprints');
  await expect(page.getByText('How a blueprint is put together')).toBeVisible();
  await expect(page.locator('[data-testid^="blueprint-"]')).toHaveCount(0);
  await settleFonts(page);
  await expectNothingClippedVertically(page);
  await page.screenshot({ path: 'e2e-out/blueprints-empty.png', fullPage: true });
});

/** §D4: the way in. The Blueprints page lives inside the Satchel, so the Satchel has a door to it. */
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

  await page.goto('/game/inventory/blueprints');
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
