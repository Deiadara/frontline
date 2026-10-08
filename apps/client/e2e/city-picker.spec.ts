/**
 * The city picker opens as a popup over the sheet (maintainer, 2026-09-28).
 *
 * The list is drawn on paper (`card-paper washed`), and both classes set `position: relative` later
 * in the cascade than `absolute`. On the list itself they won, so opening it dropped the list into
 * the flow and pushed everything under the heading down by its height.
 *
 * Measured on the market sheet, where the picker sits at the end of the tab row with the rule
 * running into it. It was the missions sheet until 2026-10-07, when the board became the crew's
 * own city's and the picker left that screen: the Bar, the market and the back room still carry
 * one, and this is about the popup rather than about any one of them.
 */
import { expect, test } from '@playwright/test';
import { lateGame, market } from './fixtures';
import { installApi, settleFonts } from './harness';

test.use({ viewport: { width: 1440, height: 900 } });

test('opening the city picker moves nothing on the sheet', async ({ page }) => {
  await installApi(page, lateGame);
  await page.route('**/api/market', (route) =>
    route.fulfill({ json: { ...market, cities: ['ashfall', 'terminus'] } }),
  );
  await page.goto('/game/market');
  await expect(page.getByTestId('city-picker-open')).toBeVisible();
  await settleFonts(page);

  const rules = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.ink-rule')].map((rule) =>
        Math.round(rule.getBoundingClientRect().top),
      ),
    );
  const before = await rules();
  expect(before.length, 'no rules on the sheet, so nothing was measured').toBeGreaterThan(0);

  await page.getByTestId('city-picker-open').click();
  const list = page.getByTestId('city-picker-list');
  await expect(list).toBeVisible();
  expect(await rules(), 'opening the list moved the sheet under it').toEqual(before);

  // Each city is one line: the popup is as wide as its names, not as the button that opened it.
  for (const id of ['ashfall', 'terminus']) {
    const box = await page.getByTestId(`city-choose-${id}`).boundingBox();
    expect(box?.height ?? 0, `${id} wrapped onto a second line`).toBeLessThan(40);
  }
});
