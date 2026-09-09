import { VEHICLES } from '@frontline/shared';
import { expect, test } from '@playwright/test';
import { garage, lateGame } from './fixtures';
import { expectNothingOverflowsTheScreen, installApi, settleFonts } from './harness';

/**
 * The Garage is a door and the machines are on the roster (board request, 2026-09-08).
 *
 * The yard's page says what the building is and what stands in it, and one button leads to the
 * roster's Vehicles tab, where every machine is listed beside the units it carries. Both halves
 * are checked here: the door leads somewhere, and the tab is a real list with a working Build.
 */

test('the Garage page leads to the machines on the roster', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/garage');
  await expect(page.getByText(`${garage.capacity} seats`)).toBeVisible();
  await expect(page.getByText(`Garage at level ${garage.garageLevel}`)).toBeVisible();
  // The catalogue is not on this page any more: no card, no Build.
  await expect(page.locator('[data-testid^="vehicle-"]')).toHaveCount(0);

  await page.getByTestId('garage-machines').click();
  await expect(page).toHaveURL(/\/game\/units\?tab=vehicles$/);
  await expect(page.getByTestId('tier-vehicles')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('vehicle-catalogue')).toBeVisible();
});

test('the Vehicles tab lists every machine and builds one', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/units?tab=vehicles');
  await settleFonts(page);

  // Every machine in the catalogue, always, locked ones included, in the Garage's own order.
  const catalogue = page.getByTestId('vehicle-catalogue');
  await expect(catalogue).toBeVisible();
  const ids = await catalogue
    .locator('article[data-testid^="vehicle-"]')
    .evaluateAll((cards) => cards.map((card) => (card as HTMLElement).dataset.testid));
  expect(ids).toEqual(VEHICLES.map((spec) => `vehicle-${spec.id}`));
  // And no unit card under the machines: the tab swaps the list, it does not stack them.
  await expect(page.getByTestId('unit-catalogue')).toHaveCount(0);

  // The one this crew can build today. The fixture holds the Scrappy's plans and a Garage at 5.
  const bike = page.getByTestId('vehicle-motorcycle');
  await expect(bike.getByTestId('vehicle-count-motorcycle')).toHaveText('2 in the yard · 1 out');
  const posted = page.waitForRequest(
    (request) => request.url().includes('/api/garage/build') && request.method() === 'POST',
  );
  await bike.getByRole('button', { name: 'Build it' }).click();
  expect((await posted).postDataJSON()).toEqual({ vehicleId: 'motorcycle' });

  await expectNothingOverflowsTheScreen(page);
});

test('the tier tabs still open the roster, and Back leaves it in one press', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/units?tab=vehicles');
  await page.getByTestId('tier-heavy').click();
  await expect(page).toHaveURL(/\/game\/units\?tab=heavy$/);
  await expect(page.getByTestId('unit-catalogue')).toBeVisible();
  await expect(page.getByTestId('vehicle-catalogue')).toHaveCount(0);

  // Carriers is the tab the page opens on, so it is the bare URL rather than `?tab=carrier`.
  await page.getByTestId('tier-carrier').click();
  await expect(page).toHaveURL(/\/game\/units$/);
  await expect(page.getByTestId('tier-carrier')).toHaveAttribute('aria-pressed', 'true');

  // Three tabs on, one press of Back: the tabs replace the entry rather than pushing one each.
  await page.goBack();
  await expect(page).not.toHaveURL(/\/game\/units/);
});
