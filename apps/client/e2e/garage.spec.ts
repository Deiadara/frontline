import { VEHICLES } from '@frontline/shared';
import { expect, test } from '@playwright/test';
import { garage, lateGame } from './fixtures';
import { expectNothingOverflowsTheScreen, installApi, settleFonts } from './harness';

/**
 * The Garage building is the door, and the machines are on the roster.
 *
 * There used to be a `/game/garage` page in between: a level, a seat count and one button through
 * to the Vehicles tab. It was retired (maintainer request, 2026-09-14) because it was a screen
 * whose whole content was a restatement of the dialog the player had just clicked out of. What is
 * left is checked here: the building's own door lands on the machines, and the tab is a real list
 * with a working Build.
 */

test('the Garage building opens the machines on the roster', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/base');
  await page.getByTestId('plot-garage').click();

  const door = page.getByTestId('garage-open');
  await expect(door).toBeVisible();
  await door.click();

  // Straight there: one hop, no page in between.
  await expect(page).toHaveURL(/\/game\/units\?tab=vehicles$/);
  await expect(page.getByTestId('tier-vehicles')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('vehicle-catalogue')).toBeVisible();
});

/**
 * The yard's level and its seat count, which the retirement nearly lost.
 *
 * Both were on the page that was retired, and nothing moved them: the server went on shipping
 * `garageLevel` and `capacity` and no screen read either. Found by sweeping the wire for fields no
 * client file mentions, which is the only way a dead payload announces itself.
 */
test('the Vehicles tab says what the yard is and how many unit slots are in it', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/units?tab=vehicles');
  await expect(page.getByTestId('vehicle-catalogue')).toBeVisible();

  const standing = page.getByTestId('yard-standing');
  await expect(standing).toBeVisible();
  await expect(standing).toContainText(`Garage at level ${garage.garageLevel}`);
  await expect(page.getByTestId('yard-seats')).toHaveText(`${garage.capacity} unit slots`);
});

/** The retired page stays retired: its URL is not a screen any more. */
test('the old Garage page is gone', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/garage');
  await expect(page.getByTestId('garage-machines')).toHaveCount(0);
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
