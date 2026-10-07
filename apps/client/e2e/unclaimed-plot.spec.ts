import { districtDisplayName, findDistrict, type DistrictDetailResponse } from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import { base, districtDetailFor, me } from './fixtures';
import {
  expectNothingClippedHorizontally,
  expectNothingClippedVertically,
  installApi,
  settleFonts,
} from './harness';

/**
 * A plot nobody lives on opens as a window over the city map (maintainer, 2026-09-30), and closes
 * on a click anywhere outside it, the way a location window closes over a district painting.
 *
 * The route stays: `/game/city/<plot>` is the map with the window open, so a pasted link and the
 * browser's Back land where a click on the tag does. A claimed plot still opens its crew's street,
 * which `visiting.spec.ts` covers.
 */
const PLOT = 'ashen-terraces';

/** The plot as the server answers for it when nobody has moved in: no crew, nothing standing. */
async function unclaimed(page: Page): Promise<void> {
  const detail: DistrictDetailResponse = {
    ...districtDetailFor(PLOT),
    base: null,
    residentBuildings: [],
    raidable: false,
    closed: true,
  };
  await page.route(`**/api/city/${PLOT}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) }),
  );
}

/** What the map calls an empty plot. */
function plotName(): string {
  const district = findDistrict(PLOT);
  if (!district) throw new Error(`fixture error: no district ${PLOT}`);
  return districtDisplayName(district, { ownDistrictId: base.districtId, ownName: base.name });
}

const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
] as const;

for (const viewport of VIEWPORTS) {
  test(`an unclaimed plot opens over the map and closes on a click outside at ${viewport.width}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await installApi(page, me);
    await unclaimed(page);
    await page.goto('/game');
    await expect(page.getByTestId('city-room')).toBeVisible();

    await page.getByTestId(`district-tag-${PLOT}`).click();
    await expect(page).toHaveURL(new RegExp(`/game/city/${PLOT}$`));
    const sheet = page.getByTestId('unclaimed-plot');
    await expect(sheet).toBeVisible();
    await expect(page.getByRole('dialog', { name: plotName() })).toBeVisible();
    // The map is still the screen behind it, not a page of its own.
    await expect(page.getByTestId('city-room')).toBeVisible();
    await expect(page.getByTestId('plot-plan')).toBeVisible();
    await expect(page.getByTestId('unclaimed-stamp')).toBeVisible();
    // No difficulty and no garrison on a player's plot (maintainer, 2026-09-30).
    await expect(sheet).not.toContainText(/difficulty/i);
    await expect(sheet).not.toContainText(/garrison/i);
    await expect(page.getByText('// RESIDENTIAL //')).toHaveCount(0);

    await settleFonts(page);
    await expectNothingClippedHorizontally(page);
    await expectNothingClippedVertically(page, '[data-testid="unclaimed-plot"]');
    // The whole sheet is on screen: nothing to scroll to at either size.
    const box = await sheet.boundingBox();
    if (!box) throw new Error('the window has no box');
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: `screenshots/unclaimed-plot/open-${viewport.width}.png` });

    // A click on the sheet itself leaves it open.
    await page.getByTestId('plot-plan').click();
    await expect(sheet).toBeVisible();

    // A click anywhere outside it closes it and leaves the player on the map.
    await page.mouse.click(12, viewport.height / 2);
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/game$/);
    await expect(page.getByTestId('city-room')).toBeVisible();
  });
}

test('a link to an unclaimed plot lands on the map with its window open, and Escape shuts it', async ({
  page,
}) => {
  await installApi(page, me);
  await unclaimed(page);
  await page.goto(`/game/city/${PLOT}`);

  const sheet = page.getByTestId('unclaimed-plot');
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId('city-room')).toBeVisible();
  await expect(page.getByTestId(`district-tag-${PLOT}`)).toBeAttached();

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/\/game$/);
});

/*
 * A plot somebody lives on but has built nothing on yet still has the paper screen, and it is the
 * one screen left that could print a plot's difficulty or garrison: it prints neither.
 */
test('a lived-in plot with nothing built prints no difficulty and no garrison', async ({
  page,
}) => {
  await installApi(page, me);
  const detail: DistrictDetailResponse = { ...districtDetailFor(PLOT), residentBuildings: [] };
  await page.route(`**/api/city/${PLOT}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) }),
  );
  await page.goto(`/game/city/${PLOT}`);

  await expect(page.getByText('A crew lives here')).toBeVisible();
  await expect(page.getByTestId('unclaimed-plot')).toHaveCount(0);
  await expect(page.getByText(/difficulty/i)).toHaveCount(0);
  await expect(page.getByText(/Garrison:/)).toHaveCount(0);
});
