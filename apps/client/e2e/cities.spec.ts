import { CITIES, cityCounts } from '@frontline/shared';
import { expect, test } from '@playwright/test';
import { lateGame } from './fixtures';
import {
  expectNoImagesClipped,
  expectNothingOverflowsTheScreen,
  growPastTheFold,
  installApi,
  settleFonts,
} from './harness';

/**
 * The world, as a wall of portraits (maintainer request, 2026-09-14).
 *
 * This screen used to be one tile and a "coming soon" panel. It is three cities now, drawn as tall
 * pictures the way the crew screen draws people, and the things worth a browser are the ones a unit
 * test cannot see: that three procedural skylines actually render, that a shut city is drawn rather
 * than hidden, and that the only pressable card is the one with a server behind it.
 */
for (const [tag, width, height] of [
  ['1280x720', 1280, 720],
  ['1920x1080', 1920, 1080],
] as const) {
  test(`the cities read whole at ${tag}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await installApi(page, lateGame);
    await page.goto('/game');
    await page.getByTestId('all-cities').click();
    await expect(page.getByTestId('cities-view')).toBeVisible();
    await settleFonts(page);

    // Every city the world has, none hidden. A shut city is still somewhere a player should know
    // about: hiding it would be the old "coming soon" panel with extra steps.
    for (const city of CITIES) {
      const card = page.getByTestId(`city-card-${city.id}`);
      await expect(card).toBeVisible();
      await expect(card).toContainText(city.name);
      await expect(card).toContainText(city.nickname);
      // The counts come off the atlas rather than being typed here, so adding a district to a city
      // moves the card and this assertion together.
      const counts = cityCounts(city.id);
      await expect(page.getByTestId(`city-contested-${city.id}`)).toHaveText(
        String(counts.contested),
      );
      await expect(page.getByTestId(`city-plots-${city.id}`)).toHaveText(String(counts.plots));
    }

    await expectNothingOverflowsTheScreen(page);
    /*
     * Grown past the fold before the image sweep, and this is the difference between a gate and a
     * knife edge. Three 3:4 portraits do not fit a 720px-tall screen, so on the unmodified viewport
     * the sweep reports every card as "sliced by a clipping edge" when the only thing cutting them
     * is the bottom of the window. The picture is either drawn whole or it is not, and that is the
     * question worth asking; whether it fits above the fold is what scrolling is for.
     */
    await growPastTheFold(page);
    await expectNoImagesClipped(page);
    await page.screenshot({ path: `e2e-out/cities-${tag}.png`, fullPage: true });
  });
}

test('only the city with a server behind it can be pressed', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game');
  await page.getByTestId('all-cities').click();

  const open = CITIES.filter((city) => city.open);
  const shut = CITIES.filter((city) => !city.open);
  // A guard on the fixture: with every city open or every city shut this test proves nothing.
  expect(open.length).toBeGreaterThan(0);
  expect(shut.length).toBeGreaterThan(0);

  for (const city of shut) {
    await expect(page.getByTestId(`city-state-${city.id}`)).toHaveText('Shut');
    await expect(page.getByTestId(`city-card-${city.id}`)).toHaveAttribute('aria-disabled', 'true');
  }

  // The open one goes back into the city, which is what the card promises.
  const home = open[0]!;
  await expect(page.getByTestId(`city-state-${home.id}`)).toHaveText('Open');
  await page.getByTestId(`city-card-${home.id}`).click();
  await expect(page.getByTestId('cities-view')).toHaveCount(0);
});

/** Each city draws its own skyline: two cards with the same picture would be a seeding bug. */
test('every city gets a silhouette of its own', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game');
  await page.getByTestId('all-cities').click();
  await expect(page.getByTestId('cities-view')).toBeVisible();

  const shapes = await Promise.all(
    CITIES.map(async (city) => {
      const svg = page.getByTestId(`city-card-${city.id}`).locator('svg').first();
      return svg.evaluate((el) =>
        [...el.querySelectorAll('path')].map((path) => path.getAttribute('d') ?? '').join('|'),
      );
    }),
  );

  for (const shape of shapes) expect(shape.length).toBeGreaterThan(200);
  expect(new Set(shapes).size).toBe(CITIES.length);
});
