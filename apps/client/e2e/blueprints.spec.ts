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
 * The Blueprints tab of the research page (§D4 to §D11, §I1d), looked at rather than asserted
 * about.
 *
 * The unit tests say the right rows are on the screen. This says the screen holds them: one
 * document per line, its cover and words in a fixed column, its pages across the middle as sheets,
 * and the control on the right. That is the shape most likely to break the maintainer's zero-cut-text
 * bar, because the widest document in the game has eight pages and they have to sit on one line at
 * 1280 without the row growing or the sheets shrinking to specks.
 *
 * The inventory here is hand-built rather than taken off `market.inventory`: the interesting states
 * are one page in, most of the way there, complete, and unlocked, and a fixture that happened to
 * hold none of them would take a screenshot of an empty page and pass.
 */

test.use({ viewport: { width: 1280, height: 800 } });

/** One of each state, across all three categories. Shared with the research page's sweep. */
const INVENTORY = pagesHeld;

test('the blueprints page holds its rows without cutting any of them', async ({ page }) => {
  // Tall enough for the whole cabinet with the unlocked row shown: the sheet scrolls, and a
  // vertical-clip sweep at a shorter window would report the fold cutting through whichever row
  // it happened to land on, which is what a scroller does and not a defect.
  await page.setViewportSize({ width: 1280, height: 1500 });
  await installApi(page, lateGame);
  // Registered after `installApi`, so it wins: Playwright matches the most recent handler first.
  await page.route('**/api/market', async (route) => {
    await route.fulfill({ json: { ...market, inventory: INVENTORY } });
  });

  await page.goto('/game/research/blueprints');
  await expect(page.getByText('Colossus Blueprint')).toBeVisible();
  await settleFonts(page);

  // Every state the drawer can be in is on screen, so the screenshot is worth looking at.
  await expect(page.getByTestId('blueprint-bp_the_colossus')).toHaveAttribute(
    'data-status',
    'partial',
  );
  const snipers = page.getByTestId('blueprint-bp_snipers');
  await expect(snipers).toHaveAttribute('data-status', 'complete');
  await expect(snipers.getByRole('button', { name: 'Unlock' })).toBeEnabled();
  // ...and the one that is short of a page keeps the control, dead.
  await expect(
    page.getByTestId('blueprint-bp_the_colossus').getByRole('button', { name: 'Unlock' }),
  ).toBeDisabled();

  await growPastTheFold(page);
  await expectNothingOverflowsTheScreen(page);
  await expectNothingClippedVertically(page);
  await expectNoImagesClipped(page);
  await page.screenshot({ path: 'e2e-out/blueprints-collecting.png', fullPage: true });

  await page.getByTestId('show-unlocked').click();
  const unlocked = page.getByTestId('blueprint-bp_motorcycle');
  await expect(unlocked).toHaveAttribute('data-status', 'unlocked');
  await expect(unlocked.getByRole('button', { name: 'Unlock' })).toHaveCount(0);
  await expect(unlocked.getByText('Unlocked')).toBeVisible();
  await settleFonts(page);
  await expectNothingOverflowsTheScreen(page);
  await expectNothingClippedVertically(page);
  await page.screenshot({ path: 'e2e-out/blueprints-unlocked.png', fullPage: true });
});

/**
 * The eight-page row, which is the whole reason this screen was relaid out.
 *
 * Measured as tops rather than counted: a strip that wrapped would still have eight tiles and
 * still pass every count, and the row would silently be twice as tall as the rest of the list.
 * The sheets are measured too, because "fits on one line" is trivially true if each one is 12px.
 */
test('puts the widest document on one line at 1280', async ({ page }) => {
  await installApi(page, lateGame);
  await page.route('**/api/market', async (route) => {
    await route.fulfill({ json: { ...market, inventory: INVENTORY } });
  });

  await page.goto('/game/research/blueprints');
  const strip = page.getByTestId('pages-bp_the_colossus');
  await expect(strip).toBeVisible();
  await settleFonts(page);

  const tiles = strip.locator('li');
  await expect(tiles).toHaveCount(8);
  const boxes = await tiles.evaluateAll((nodes) =>
    nodes.map((node) => {
      const rect = node.getBoundingClientRect();
      return { top: Math.round(rect.top), width: Math.round(rect.width) };
    }),
  );
  const tops = [...new Set(boxes.map((box) => box.top))];
  expect(tops, `the eight Colossus sheets wrapped onto ${tops.length} lines`).toHaveLength(1);
  for (const box of boxes) expect(box.width).toBeGreaterThanOrEqual(80);

  // And every row on the list is the same height, which is what `auto-rows-fr` is there for.
  const heights = await page
    .locator('[data-testid^="blueprint-bp"]')
    .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().height)));
  expect(heights.length).toBeGreaterThan(1);
  expect([...new Set(heights)], `rows came out at ${heights.join(', ')}px`).toHaveLength(1);
});

/** §D5, from the outside: a crew with an empty inventory is told nothing about what exists. */
test('shows a crew with no pages nothing at all', async ({ page }) => {
  await installApi(page, lateGame);
  await page.route('**/api/market', async (route) => {
    await route.fulfill({ json: { ...market, inventory: { scrap_servo: 4 } } });
  });

  await page.goto('/game/research/blueprints');
  // Printed on the page, not folded into a hover chip: collapsed, that chip was the whole of this
  // screen for a crew with nothing in the inventory, and a blank sheet is indistinguishable from a
  // read that failed.
  await expect(page.getByTestId('blueprints-empty')).toContainText(
    'A blueprint is a set of named pages, and you have none of them',
  );
  await expect(page.locator('[data-testid^="blueprint-bp"]')).toHaveCount(0);
  await settleFonts(page);
  await expectNothingClippedVertically(page);
  await page.screenshot({ path: 'e2e-out/blueprints-empty.png', fullPage: true });
});

/** One drawer at a time, and the counts on the other two say what is waiting in them. */
test('opens one drawer at a time and counts the other two', async ({ page }) => {
  await installApi(page, lateGame);
  await page.route('**/api/market', async (route) => {
    await route.fulfill({ json: { ...market, inventory: INVENTORY } });
  });

  await page.goto('/game/research/blueprints');
  await expect(page.getByTestId('blueprints-unit')).toBeVisible();
  await expect(page.getByTestId('blueprints-upgrade')).toHaveCount(0);

  await page.getByTestId('blueprint-category-upgrade').click();
  await expect(page.getByTestId('blueprints-upgrade')).toBeVisible();
  await expect(page.getByTestId('blueprints-unit')).toHaveCount(0);
  await expect(page.getByText('Colossus Blueprint')).toHaveCount(0);
  await settleFonts(page);
  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'e2e-out/blueprints-upgrades.png', fullPage: true });
});

/** The Inventory page's old address still resolves: it is in bookmarks and in old notifications. */
test('redirects the old inventory address to the new one', async ({ page }) => {
  await installApi(page, lateGame);
  await page.route('**/api/market', async (route) => {
    await route.fulfill({ json: { ...market, inventory: INVENTORY } });
  });

  await page.goto('/game/inventory/blueprints');
  await expect(page).toHaveURL(/\/game\/research\/blueprints$/);
  await expect(page.getByTestId('blueprint-bp_snipers')).toBeVisible();
});
