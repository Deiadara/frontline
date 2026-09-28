import { CITIES, DEFAULT_CITY_ID, TERMINUS_CITY_ID } from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import { meNoOverseer, overseer } from './fixtures';
import {
  expectNoImagesClipped,
  expectNothingOverflowsTheScreen,
  growPastTheFold,
  installApi,
  settleFonts,
} from './harness';

/**
 * The opening, both screens of it (maintainer, 2026-09-24).
 *
 * "When you first enter the game after you choose an overseer, you can choose the city to be in
 * (if a city is full it will show it but as locked)." The same wall of paintings the world screen
 * draws, except that a press selects rather than enters, and `Choose this city` is what starts the
 * game.
 *
 * The fixture (`overseerChoices.cities`) has Terminus full and Ashfall with room, so all three
 * states a card can be in are on this screen: one to choose, one that filled up, and three with no
 * map behind them.
 */

/** Through the portraits and the file, which is where the city step begins. */
async function toTheCities(page: Page): Promise<void> {
  await installApi(page, meNoOverseer);
  await page.goto('/overseer');
  await page.getByText(overseer.name).click();
  await page.getByTestId('overseer-confirm').click();
  await expect(page.getByTestId('city-wall')).toBeVisible();
}

test('the opening walks from the overseer to a city and into the game', async ({ page }) => {
  await toTheCities(page);
  await expect(page.getByTestId('overseer-title')).toHaveText('CHOOSE YOUR CITY');

  // Every city is on the wall, the shut ones included: the screen says what the world is.
  for (const city of CITIES) {
    await expect(page.getByTestId(`city-card-${city.id}`)).toBeVisible();
  }

  // Full, and it says so rather than simply refusing to answer.
  const full = page.getByTestId(`city-card-${TERMINUS_CITY_ID}`);
  await expect(full).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByTestId(`city-status-${TERMINUS_CITY_ID}`)).toContainText('Full');
  await full.click();
  await expect(page.getByTestId('city-wall')).toBeVisible();
  await expect(page.getByTestId('city-confirm')).toBeDisabled();

  // No map yet, which reads differently from full.
  const shut = CITIES.find((city) => !city.open)!;
  await expect(page.getByTestId(`city-status-${shut.id}`)).toContainText('No map here yet');

  // A press selects. It does not open that city's map, which is what the same card does on the
  // world screen, and that difference is the whole of this mode.
  await page.getByTestId(`city-card-${DEFAULT_CITY_ID}`).click();
  await expect(page.getByTestId(`city-card-${DEFAULT_CITY_ID}`)).toHaveAttribute(
    'data-chosen',
    'true',
  );
  await expect(page).toHaveURL(/\/overseer$/);

  await page.getByTestId('city-confirm').click();
  await page.waitForURL('**/game');
  await expect(page.getByTestId('city-room')).toBeVisible();
});

for (const [tag, width, height] of [
  ['1280x720', 1280, 720],
  ['1920x1080', 1920, 1080],
] as const) {
  test(`the choose-a-city screen reads whole at ${tag}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await toTheCities(page);
    await settleFonts(page);

    // A locked card is on screen for the shot, which is the state worth looking at.
    await expect(page.getByTestId(`city-status-${TERMINUS_CITY_ID}`)).toContainText('Full');
    for (const city of CITIES) {
      const card = page.getByTestId(`city-card-${city.id}`);
      await expect(card).toContainText(city.name);
      await expect(card).toContainText(city.blurb);
    }
    // Chosen, so the ring is in the picture the maintainer looks at rather than only in a unit
    // test's attribute.
    await page.getByTestId(`city-card-${DEFAULT_CITY_ID}`).click();
    await expect(page.getByTestId(`city-card-${DEFAULT_CITY_ID}`)).toHaveAttribute(
      'data-chosen',
      'true',
    );

    // The two controls are on the screen rather than pushed past the foot of the frame, which is
    // what a wall sized off the viewport gets wrong first.
    await expect(page.getByTestId('city-confirm')).toBeInViewport();
    await expect(page.getByTestId('city-back')).toBeInViewport();

    await expectNothingOverflowsTheScreen(page);
    await growPastTheFold(page);
    await expectNoImagesClipped(page);
    await page.screenshot({ path: `e2e-out/choose-city-${tag}.png`, fullPage: true });
  });
}
