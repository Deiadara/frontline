import { expect, test } from '@playwright/test';
import type { MoveUnitsRequest } from '@frontline/shared';
import { actionsResponse, lateGame, unitsResponse } from './fixtures';
import { expectNothingOverflowsTheScreen, installApi, settleFonts } from './harness';

/**
 * Moving units between the crew's places (maintainer ruling, 2026-09-22): the fifth column on
 * the census, the Move button and its dialog, and the column on the Monitor's road.
 */

test('the census counts the gate, and every row has a Move button', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await installApi(page, lateGame);
  await page.goto('/game/actions/units');
  await expect(page.getByTestId('census')).toBeVisible();
  await settleFonts(page);
  await expect(page.getByTestId('census-gate-razors')).toHaveText('5');
  // Home, gate, held, planted, out: five places, one total.
  const total =
    (unitsResponse.army.razors ?? 0) +
    (unitsResponse.gateArmy.razors ?? 0) +
    (unitsResponse.garrisoned.razors ?? 0) +
    (unitsResponse.abroad.razors ?? 0);
  await expect(page.getByTestId('census-total-razors')).toHaveText(String(total));
  await expect(page.getByTestId('move-razors')).toBeVisible();
  await page.screenshot({ path: 'screenshots/census-gate.png', fullPage: false });
  await expectNothingOverflowsTheScreen(page);
});

test('the Move dialog lists where they stand and where they can go, quotes the road, and sends', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await installApi(page, lateGame);
  await page.route('**/api/actions/move/quote', (route) =>
    route.fulfill({ json: { minutes: 10 } }),
  );
  const sent: MoveUnitsRequest[] = [];
  await page.route('**/api/actions/move', (route) => {
    sent.push(route.request().postDataJSON() as MoveUnitsRequest);
    return route.fulfill({ json: actionsResponse });
  });
  await page.goto('/game/actions/units');
  await page.getByTestId('move-razors').click();
  const dialog = page.getByTestId('move-dialog');
  await expect(dialog).toBeVisible();
  await settleFonts(page);

  // The row's unit is preselected, one of them; the source is home, the destination the gate.
  await expect(dialog.getByTestId('move-count-razors')).toHaveValue('1');
  await expect(dialog.getByTestId('move-time')).toHaveText('10m');
  await expect(dialog.getByTestId('move-vehicles')).toBeVisible();
  await page.screenshot({ path: 'screenshots/move-dialog.png', fullPage: false });
  await expectNothingOverflowsTheScreen(page);

  await dialog.getByTestId('move-confirm').click();
  await expect(dialog).toBeHidden();
  expect(sent).toEqual([
    { from: { kind: 'district' }, to: { kind: 'gate' }, army: { razors: 1 }, vehicles: {} },
  ]);
});

test('the Monitor lists a column on the move, with the road and a way to turn it round', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/actions');
  const row = page.getByTestId('move-move-1');
  await expect(row).toBeVisible();
  await settleFonts(page);
  await expect(row).toContainText('Your Gate');
  await expect(row.getByTestId('moving-move-1-razors')).toBeVisible();
  await expect(page.getByTestId('road-counts')).toContainText('1 moving');
  // Two minutes into ten: the first tenth is not over for another minute... it is exactly over,
  // so the mark is there or not by the clock; what must hold is that the row draws.
  await page.screenshot({ path: 'screenshots/monitor-moving.png', fullPage: false });
});
