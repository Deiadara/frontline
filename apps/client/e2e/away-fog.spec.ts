import { TERMINUS_CITY_ID, findDistrict } from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import {
  AWAY_SCOUTED_DISTRICT_ID,
  AWAY_UNSCOUTED_DISTRICT_ID,
  awayCity,
  lateGame,
} from './fixtures';
import { installApi } from './harness';

/**
 * Unscouted ground opens the scout sheet, in any city, without a page flashing past.
 *
 * The complaint: "when you click on an unscouted area it tries to go into the location then gets
 * denied and goes back with the menu". The map already decided at click time, off the summary the
 * city read carries for each district, and fell through to the district page when it had none.
 * Away from home it never had one: `GET /city` answered for the crew's own city whatever was
 * being painted, so every tag on a Terminus map took the unknown branch, opened the page, and was
 * bounced back by `DistrictView` with `?scout=`. One navigation out and one back, for every tag.
 *
 * What is asserted here is the **navigation**, not the sheet. The sheet was already on screen at
 * the end of the old, broken flow, so a test that only looked for it passed before the fix and
 * proves nothing: `history.pushState` is what the player sees as the flicker.
 */

const AWAY_UNSCOUTED = findDistrict(AWAY_UNSCOUTED_DISTRICT_ID)!;

/** Every route the app pushes or replaces, recorded from before the first render. */
async function recordRoutes(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const pushed: string[] = [];
    (window as unknown as { __routes: string[] }).__routes = pushed;
    for (const name of ['pushState', 'replaceState'] as const) {
      const original = history[name].bind(history);
      history[name] = (data: unknown, unused: string, url?: string | URL | null) => {
        if (url !== undefined && url !== null) pushed.push(String(url));
        return original(data, unused, url);
      };
    }
  });
  return () => page.evaluate(() => (window as unknown as { __routes: string[] }).__routes);
}

/** Out to the world screen and into the city this crew does not live in. */
async function lookAtTheAwayCity(page: Page): Promise<void> {
  await page.getByTestId('all-cities').click();
  await expect(page.getByTestId('cities-view')).toBeVisible();
  await page.getByTestId(`city-card-${TERMINUS_CITY_ID}`).click();
  await expect(page.getByTestId('cities-view')).toHaveCount(0);
  await expect(page.getByTestId(`district-tag-${AWAY_UNSCOUTED_DISTRICT_ID}`)).toBeVisible();
}

test('the fixture the two tests below split on says what it is', () => {
  // Both branches are measured, so the fixture has to hold one of each. Without this, a map that
  // drifted to all-scouted or all-fogged would take both tests with it and neither would say why.
  const fog = new Map(awayCity.districts.map((row) => [row.district.id, row.scouted]));
  expect(fog.get(AWAY_UNSCOUTED_DISTRICT_ID)).toBe(false);
  expect(fog.get(AWAY_SCOUTED_DISTRICT_ID)).toBe(true);
});

test('a tag clicked before the map has read itself still opens the sheet, not a page', async ({
  page,
}) => {
  /*
   * The last of the flicker, and the one that survived the away-map fix.
   *
   * The handler used to open the page for anything it did not positively know was scouted, and
   * "the read has not landed yet" is exactly that. It is a narrow window and a real one: a tag is
   * clickable from the first paint, and the read has to land once per city. Held open here by
   * stalling `/api/city` so the click lands inside it, which is the only way to test a race
   * without waiting on one.
   */
  const routes = await recordRoutes(page);
  await installApi(page, lateGame);

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
  await page.getByTestId('all-cities').click();
  await expect(page.getByTestId('cities-view')).toBeVisible();
  await page.getByTestId(`city-card-${TERMINUS_CITY_ID}`).click();

  // The painting and its tags are drawn from the catalogue, so the tag is here before the fog is.
  const tag = page.getByTestId(`district-tag-${AWAY_UNSCOUTED_DISTRICT_ID}`);
  await expect(tag).toBeVisible();
  const before = await routes();
  await tag.click();

  // The sheet, over the map, with no page in between.
  await expect(page.getByTestId('scout-menu')).toBeVisible();
  expect(await routes()).toEqual(before);
  await expect(page).toHaveURL(/\/game$/);

  release();
  await expect(page.getByTestId('scout-menu-title')).toHaveText(AWAY_UNSCOUTED.name);
});

test('an unscouted tag in another city opens the sheet without leaving the map', async ({
  page,
}) => {
  const routes = await recordRoutes(page);
  await installApi(page, lateGame);
  await page.goto('/game');
  await lookAtTheAwayCity(page);

  const before = await routes();
  await page.getByTestId(`district-tag-${AWAY_UNSCOUTED_DISTRICT_ID}`).click();

  // The sheet, over the map, naming the ground that was clicked.
  await expect(page.getByTestId('scout-menu')).toBeVisible();
  await expect(page.getByTestId('scout-menu-title')).toHaveText(AWAY_UNSCOUTED.name);

  // And nothing moved: no district page opened, and no bounce came back from one.
  expect(await routes()).toEqual(before);
  await expect(page).toHaveURL(/\/game$/);
});

/**
 * The other half of the same decision, and the control on the test above.
 *
 * A screen that had simply stopped opening districts would pass the first test perfectly. Ground
 * this crew has walked into still opens as a page, in the away city as at home.
 */
test('a tag on ground the crew has walked into still opens the district', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game');
  await lookAtTheAwayCity(page);

  await page.getByTestId(`district-tag-${AWAY_SCOUTED_DISTRICT_ID}`).click();
  await expect(page).toHaveURL(new RegExp(`/game/city/${AWAY_SCOUTED_DISTRICT_ID}$`));
  await expect(page.getByTestId('scout-menu')).toHaveCount(0);
});
