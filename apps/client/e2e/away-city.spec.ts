import { TERMINUS_CITY_ID } from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import { AWAY_HELD_DISTRICT_ID, awayCity, lateGame } from './fixtures';
import { installApi } from './harness';

/**
 * Every district of a city this crew does not live in opens as its page (maintainer, 2026-09-29:
 * "whole city visible").
 *
 * The tag used to decide at click time, off the summary the city read carries, between the
 * district page and a scouting sheet over the map, and "the read has not landed yet" sent it to the
 * sheet. There is no second branch now, so a tag is a link to the district whatever the read says
 * and whenever it lands.
 */

/** A district abroad this crew holds nothing in: the case the old fog kept shut. */
const NOT_HELD = awayCity.districts.find(
  (row) => row.district.id !== AWAY_HELD_DISTRICT_ID && row.held.mine === 0,
)!.district.id;

/** Out to the world screen and into the city this crew does not live in. */
async function lookAtTheAwayCity(page: Page): Promise<void> {
  await page.getByTestId('all-cities').click();
  await expect(page.getByTestId('cities-view')).toBeVisible();
  await page.getByTestId(`city-card-${TERMINUS_CITY_ID}`).click();
  await expect(page.getByTestId('cities-view')).toHaveCount(0);
  await expect(page.getByTestId(`district-tag-${NOT_HELD}`)).toBeVisible();
}

test('the fixture holds one district abroad and not the other', () => {
  const held = new Map(awayCity.districts.map((row) => [row.district.id, row.held.mine]));
  expect(held.get(AWAY_HELD_DISTRICT_ID)).toBe(1);
  expect(held.get(NOT_HELD)).toBe(0);
});

test('a district abroad the crew holds nothing in opens as its page', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game');
  await lookAtTheAwayCity(page);

  await page.getByTestId(`district-tag-${NOT_HELD}`).click();
  await expect(page).toHaveURL(new RegExp(`/game/city/${NOT_HELD}$`));
});

test('a tag clicked before the map has read itself still opens the district', async ({ page }) => {
  await installApi(page, lateGame);
  // The first read of the away map is held open, so the click lands before it does.
  let release = (): void => {};
  const stalled = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route('**/api/city?*', async (route) => {
    if (first) {
      first = false;
      await stalled;
    }
    await route.fallback();
  });

  await page.goto('/game');
  await lookAtTheAwayCity(page);
  await page.getByTestId(`district-tag-${AWAY_HELD_DISTRICT_ID}`).click();
  await expect(page).toHaveURL(new RegExp(`/game/city/${AWAY_HELD_DISTRICT_ID}$`));
  release();
});
