import { GARAGE_TIME_DISCOUNT_PER_LEVEL, VEHICLES, vehicleBuildSeconds } from '@frontline/shared';
import { expect, test } from '@playwright/test';
import { formatDuration } from '../src/features/base/format';
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
  // Three held, one of them at a fight: the roster's own chip, stamped on the corner of the
  // picture (maintainer, 2026-09-18, "make the vehicle boxes be more similar to the unit boxes").
  // The total leads and the slice after the slash is what is away, which is how `UnitCard` writes
  // the same pair. The sentence it replaced is on the hover.
  const count = bike.getByTestId('vehicle-count-motorcycle');
  await expect(count).toHaveText('3 / 1');
  await expect(count).toHaveAttribute('data-tip', '2 in the yard, 1 out at a fight');
  const posted = page.waitForRequest(
    (request) => request.url().includes('/api/garage/build') && request.method() === 'POST',
  );
  await bike.getByRole('button', { name: 'Build it' }).click();
  expect((await posted).postDataJSON()).toEqual({ vehicleId: 'motorcycle' });

  await expectNothingOverflowsTheScreen(page);
});

/**
 * The clock on a machine, and the yard's discount on the clock.
 *
 * A vehicle used to be paid for and handed over in the same request, so `buildSeconds` sat on
 * every spec as data nothing read. It goes on a bench now and the Garage's level takes time off
 * it, which is the second reason to raise the yard: without the number on the card that whole
 * discount is invisible, and a player raising the Garage sees nothing move.
 *
 * Asserted against the *discounted* seconds rather than the catalogue's, because the route quotes
 * the discounted number and a card showing the flat one is a price box that lies.
 */
test('the card says how long a machine takes, with the yard taken off', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/units?tab=vehicles');
  await expect(page.getByTestId('vehicle-catalogue')).toBeVisible();

  const spec = VEHICLES.find((vehicle) => vehicle.id === 'motorcycle');
  if (!spec) throw new Error('the catalogue has no Scrappy');
  const discounted = vehicleBuildSeconds(spec, garage.garageLevel);
  // The fixture's Garage is high enough for the discount to be visible at all, or this test would
  // pass on a card that had simply printed the catalogue number.
  expect(discounted).toBeLessThan(spec.buildSeconds);

  // The whole string, so a card printing the catalogue's flat number fails rather than passing on
  // a substring the two share.
  const line = page.getByTestId('vehicle-time-motorcycle');
  await expect(line).toHaveText(`Build time ${formatDuration(discounted)}`);
  expect(formatDuration(discounted)).not.toBe(formatDuration(spec.buildSeconds));
  await expect(line).toHaveAttribute(
    'data-tip',
    new RegExp(`${GARAGE_TIME_DISCOUNT_PER_LEVEL}% off`),
  );
});

/**
 * The price beside the button, not over it (maintainer, 2026-09-18).
 *
 * "For the vehicles put the costs next to Build it in the same line." They were stacked, which
 * cost the card a row and read as two separate things: what it costs, and then, below, a control.
 * They are the two halves of one decision.
 *
 * Geometry rather than a class list, because "on the same line" is a fact about where the boxes
 * land: a `flex-wrap` that wraps at a narrow width satisfies every class check and puts the price
 * back under the button. Asserted at the narrowest viewport the game supports as well as the
 * widest, since wrapping is exactly what narrow does.
 */
for (const width of [1024, 1920]) {
  test(`the price sits on the Build line at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await installApi(page, lateGame);
    await page.goto('/game/units?tab=vehicles');
    await expect(page.getByTestId('vehicle-catalogue')).toBeVisible();
    await settleFonts(page);

    const card = page.getByTestId('vehicle-motorcycle');
    const button = card.getByRole('button', { name: 'Build it' });
    const price = card.getByTestId('cost-line');
    await expect(price).toBeVisible();

    const b = await button.boundingBox();
    const p = await price.boundingBox();
    if (!b || !p) throw new Error('the card is missing its button or its price');

    // Overlapping vertically is what "the same line" means, and it is what a wrap breaks.
    expect(Math.min(b.y + b.height, p.y + p.height) - Math.max(b.y, p.y)).toBeGreaterThan(0);
    // ...and the price is to the right of the button rather than stacked on it.
    expect(p.x).toBeGreaterThan(b.x + b.width);
  });
}

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
