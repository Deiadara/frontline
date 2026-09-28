import { DEFAULT_CITY_ID, districtsOfCity } from '@frontline/shared';
import { expect, test, type Page, type Route } from '@playwright/test';
import { bar, blackMarket, lateGame, market, missionsResponse } from './fixtures';
import { installApi, settleFonts } from './harness';

/**
 * The city you are looking at is the city you come back to (maintainer, 2026-09-24).
 *
 * "If you're in a city and then you click on a location, after you click out of that location by
 * clicking anywhere else or clicking the X it should take you back to the city you were viewing,
 * not necessarily your home city."
 *
 * A unit test cannot see any of this. The bug was that six screens each held the city in component
 * state, so it died on every route change, and a route change is the only way to reach the screen
 * that had forgotten. Everything below is a navigation: a back link, a browser button, a tab in the
 * nav, a pasted URL.
 */

const AWAY = 'terminus';
const BOTH = [DEFAULT_CITY_ID, AWAY];

/** A contested district of the away city, which opens as a screen rather than as a scout sheet. */
const awayDistrict = districtsOfCity(AWAY).find((one) => one.kind === 'contested')!;
const homeDistrict = districtsOfCity(DEFAULT_CITY_ID).find((one) => one.kind === 'contested')!;

/**
 * The four rooms, answering for whichever city was asked for.
 *
 * `installApi` serves them off one frozen fixture and ignores the `city` parameter entirely, which
 * is fine for every other spec and useless here: the whole question is whether the client asks for
 * the right city and shows what came back. Registered after `installApi`, so these run first, and
 * anything not a room read is handed back to it with `route.fallback()`.
 *
 * `shut` is the city whose door this crew has been thrown out of, if any. The server answers a room
 * in it with `CITY_SHUT`, which is a 403 and the one refusal the client is expected to absorb.
 */
async function twoCityRooms(page: Page, shut?: string): Promise<void> {
  const open = BOTH.filter((city) => city !== shut);
  await page.route('**/api/**', async (route: Route) => {
    const url = new URL(route.request().url());
    const asked = url.searchParams.get('city') ?? DEFAULT_CITY_ID;
    const room = route.request().method() === 'GET' ? roomOn(url.pathname) : null;
    if (room === null) {
      await route.fallback();
      return;
    }
    if (asked === shut) {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'CITY_SHUT', message: 'You hold no ground in that city.' },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...room(), cityId: asked, cities: open }),
    });
  });
}

function roomOn(pathname: string): (() => object) | null {
  if (pathname.endsWith('/api/bar')) return () => bar;
  if (pathname.endsWith('/api/market')) return () => market;
  if (pathname.endsWith('/api/black-market')) return () => blackMarket;
  if (pathname.endsWith('/api/missions')) return () => missionsResponse();
  return null;
}

/** Walk out to the world screen and into the city this crew does not live in. */
async function lookAtTheAwayCity(page: Page): Promise<void> {
  await page.getByTestId('all-cities').click();
  await expect(page.getByTestId('cities-view')).toBeVisible();
  await page.getByTestId(`city-card-${AWAY}`).click();
  await expect(page.getByTestId('cities-view')).toHaveCount(0);
  await expectLookingAt(page, AWAY);
}

/** The map is this city's: its districts are on it and the other city's are not. */
async function expectLookingAt(page: Page, cityId: string): Promise<void> {
  const here = districtsOfCity(cityId)[0]!;
  const elsewhere = districtsOfCity(cityId === AWAY ? DEFAULT_CITY_ID : AWAY)[0]!;
  await expect(page.getByTestId(`district-tag-${here.id}`)).toBeVisible();
  await expect(page.getByTestId(`district-tag-${elsewhere.id}`)).toHaveCount(0);
}

const backToTheCity = (page: Page) => page.getByRole('button', { name: /back to the city/i });

test('leaving a district comes back to the city you were looking at', async ({ page }) => {
  await installApi(page, lateGame);
  await twoCityRooms(page);
  await page.goto('/game');
  await lookAtTheAwayCity(page);

  // In, by the tag on the painting.
  await page.getByTestId(`district-tag-${awayDistrict.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/game/city/${awayDistrict.id}$`));

  // Out, by the control the screen offers. The home city's map is what this used to show.
  await backToTheCity(page).click();
  await expect(page).toHaveURL(/\/game$/);
  await expectLookingAt(page, AWAY);
});

test('the browser’s own back button comes back to the same city', async ({ page }) => {
  await installApi(page, lateGame);
  await twoCityRooms(page);
  await page.goto('/game');
  await lookAtTheAwayCity(page);

  await page.getByTestId(`district-tag-${awayDistrict.id}`).click();
  await expect(page).toHaveURL(new RegExp(`/game/city/${awayDistrict.id}$`));
  await page.goBack();
  await expect(page).toHaveURL(/\/game$/);
  await expectLookingAt(page, AWAY);
});

/**
 * A link straight into a district of a city the crew does not live in.
 *
 * Nothing on the way in has been through the city screen, so the map has nothing to remember
 * unless the district itself says where it is.
 */
test('a district opened by its own URL knows which city it is in', async ({ page }) => {
  await installApi(page, lateGame);
  await twoCityRooms(page);
  await page.goto(`/game/city/${awayDistrict.id}`);
  await backToTheCity(page).click();
  await expect(page).toHaveURL(/\/game$/);
  await expectLookingAt(page, AWAY);
});

/** And the same door swings the other way: a home district puts the map back on home. */
test('a district in the home city brings the map home with it', async ({ page }) => {
  await installApi(page, lateGame);
  await twoCityRooms(page);
  await page.goto('/game');
  await lookAtTheAwayCity(page);

  await page.goto(`/game/city/${homeDistrict.id}`);
  await backToTheCity(page).click();
  await expectLookingAt(page, DEFAULT_CITY_ID);
});

test('a room keeps the city it was switched to across a navigation', async ({ page }) => {
  await installApi(page, lateGame);
  await twoCityRooms(page);
  await page.goto('/game/bar');

  // It opens in the crew's own city, which is what a bare read answers with.
  await expect(page.getByTestId('city-picker-open')).toContainText('Ashfall');
  await page.getByTestId('city-picker-open').click();
  await page.getByTestId(`city-choose-${AWAY}`).click();
  await expect(page.getByTestId('city-picker-open')).toContainText('Terminus');

  // Away and back. This is where the `useState` died.
  await page.getByTestId('nav-city').click();
  await expect(page).toHaveURL(/\/game$/);
  await page.getByTestId('nav-the-bar').click();
  await expect(page.getByTestId('city-picker-open')).toContainText('Terminus');
});

/** The point of one store rather than five. */
test('switching city in the Bar is switching it on the map and in the market', async ({ page }) => {
  await installApi(page, lateGame);
  await twoCityRooms(page);
  await page.goto('/game/bar');
  await page.getByTestId('city-picker-open').click();
  await page.getByTestId(`city-choose-${AWAY}`).click();
  await expect(page.getByTestId('city-picker-open')).toContainText('Terminus');

  await page.getByTestId('nav-city').click();
  await expectLookingAt(page, AWAY);

  await page.getByTestId('nav-market').click();
  await expect(page.getByTestId('city-picker-open')).toContainText('Terminus');
});

/**
 * A city the crew can look at but can no longer walk into.
 *
 * Holding ground is what opens a city's rooms (`city/access.ts`), and it can be taken off you. The
 * map still draws the place, which is how a player decides to go and take it back, and the rooms
 * put them back in their own city without printing a refusal at them.
 */
test('a city whose door has shut falls back to the crew’s own room', async ({ page }) => {
  await installApi(page, lateGame);
  await twoCityRooms(page, AWAY);
  await page.goto('/game');
  await lookAtTheAwayCity(page);

  await page.getByTestId('nav-the-bar').click();
  await expect(page.getByTestId('city-picker-open')).toContainText('Ashfall');
  // Not a red line about a failed read: the player did nothing wrong.
  await expect(page.getByText(/could not be read|hold no ground/i)).toHaveCount(0);

  // And the map is still where they left it: a shut bar is not a reason to stop looking.
  await page.getByTestId('nav-city').click();
  await expectLookingAt(page, AWAY);
});

/**
 * The walk, looked at.
 *
 * Map in the away city, into a district, back out, into the Bar, back to the map, at both bands of
 * the matrix. The assertions above prove the navigation; these are for the eye.
 */
for (const [tag, width, height] of [
  ['1280x720', 1280, 720],
  ['1920x1080', 1920, 1080],
] as const) {
  test(`the walk between two cities reads whole at ${tag}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await installApi(page, lateGame);
    await twoCityRooms(page);
    await page.goto('/game');
    await lookAtTheAwayCity(page);
    await settleFonts(page);
    await page.screenshot({ path: `e2e-out/memory-${tag}-1-away-map.png` });

    await page.getByTestId(`district-tag-${awayDistrict.id}`).click();
    await expect(page).toHaveURL(new RegExp(`/game/city/${awayDistrict.id}$`));
    // Waited on rather than assumed: the URL changes before the district has read itself, and a
    // screenshot taken on the URL alone is a picture of the screen the player just left.
    await expect(backToTheCity(page)).toBeVisible();
    await settleFonts(page);
    await page.screenshot({ path: `e2e-out/memory-${tag}-2-district.png` });

    await backToTheCity(page).click();
    await expectLookingAt(page, AWAY);
    await settleFonts(page);
    await page.screenshot({ path: `e2e-out/memory-${tag}-3-back-on-the-map.png` });

    await page.getByTestId('nav-the-bar').click();
    await expect(page.getByTestId('city-picker-open')).toContainText('Terminus');
    await settleFonts(page);
    await page.screenshot({ path: `e2e-out/memory-${tag}-4-bar.png` });

    await page.getByTestId('nav-city').click();
    await expectLookingAt(page, AWAY);
    await settleFonts(page);
    await page.screenshot({ path: `e2e-out/memory-${tag}-5-map-again.png` });
  });
}
