import { CITIES } from '@frontline/shared';
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
 * The world, as a wall of portraits (maintainer request, 2026-09-24).
 *
 * Five tall pictures in a staggered row, each carrying a name, a nickname and what the place is.
 * The things worth a browser here are the ones a unit test cannot see: that five procedural
 * skylines actually render, that the row fills the frame and is cut nowhere, that the shell's
 * corner junk really is off this screen, and that the only pressable card is the one with a server
 * behind it.
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
    expect(CITIES.length).toBe(5);
    for (const city of CITIES) {
      const card = page.getByTestId(`city-card-${city.id}`);
      await expect(card).toBeVisible();
      await expect(card).toContainText(city.name);
      await expect(card).toContainText(city.nickname);
      // The blurb, whole. The card clips its own overflow to keep its rounded corners, so a blurb
      // that outgrew the space it was given would vanish silently rather than spill.
      await expect(card).toContainText(city.blurb);
    }

    await expectNothingOverflowsTheScreen(page);
    /*
     * Grown past the fold before the image sweep, and this is the difference between a gate and a
     * knife edge. The bottom of the window is not a clipping bug: the picture is either drawn
     * whole or it is not, and that is the question worth asking.
     */
    await growPastTheFold(page);
    await expectNoImagesClipped(page);
    await page.screenshot({ path: `e2e-out/cities-${tag}.png`, fullPage: true });
  });
}

/**
 * The row rises and falls, and it fills the frame.
 *
 * Both halves of the shape the maintainer asked for, and both are invisible to a unit test. The
 * stagger is measured off the cards' own tops rather than off a class name, so a Tailwind
 * breakpoint that stopped applying would fail this rather than pass it.
 */
test('the five cities are staggered and fill the frame', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await installApi(page, lateGame);
  await page.goto('/game');
  await page.getByTestId('all-cities').click();
  await expect(page.getByTestId('cities-view')).toBeVisible();
  await settleFonts(page);

  const boxes = await Promise.all(
    CITIES.map(async (city) => {
      const box = await page.getByTestId(`city-card-${city.id}`).boundingBox();
      expect(box, city.id).not.toBeNull();
      return box!;
    }),
  );

  // One row: every card starts within a card's height of every other.
  const tops = boxes.map((box) => box.y);
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(boxes[0]!.height);

  // Alternating: odd cards sit lower than both of their neighbours, by a real amount.
  for (const at of [1, 3]) {
    expect(tops[at]!, `card ${at}`).toBeGreaterThan(tops[at - 1]! + 8);
    expect(tops[at]!, `card ${at}`).toBeGreaterThan(tops[at + 1]! + 8);
  }
  // Symmetric: the three high ones share a top, and so do the two low ones.
  expect(Math.abs(tops[0]! - tops[2]!)).toBeLessThan(2);
  expect(Math.abs(tops[2]! - tops[4]!)).toBeLessThan(2);
  expect(Math.abs(tops[1]! - tops[3]!)).toBeLessThan(2);

  // Filling most of the screen rather than sitting as a strip of thumbnails in the middle of it.
  const band = Math.max(...boxes.map((box) => box.y + box.height)) - Math.min(...tops);
  expect(band).toBeGreaterThan(900 * 0.7);
});

/** The shell's corner junk is off here, and the district backdrop behind it is not. */
test('the world screen has bare corners and keeps its backdrop', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game');
  // A guard on the fixture: the sprites have to be there to begin with, or this proves nothing.
  await expect(page.getByTestId('ambience')).toBeVisible();

  await page.getByTestId('all-cities').click();
  await expect(page.getByTestId('cities-view')).toBeVisible();
  await expect(page.getByTestId('ambience')).toHaveCount(0);
  await expect(page.locator('[data-scenery]').first()).toBeVisible();

  // And back, so the suppression is scoped to this screen rather than to the session.
  await page.getByTestId(`city-card-${CITIES[0]!.id}`).click();
  await expect(page.getByTestId('cities-view')).toHaveCount(0);
  await expect(page.getByTestId('ambience')).toBeVisible();
});

test('only the city with a server behind it can be pressed', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game');
  await page.getByTestId('all-cities').click();

  const open = CITIES.filter((city) => city.open);
  const shut = CITIES.filter((city) => !city.open);
  // A guard on the fixture: with every city open or every city shut this test proves nothing.
  expect(open.length).toBe(1);
  expect(shut.length).toBe(4);

  for (const city of shut) {
    const card = page.getByTestId(`city-card-${city.id}`);
    await expect(card).toHaveAttribute('aria-disabled', 'true');
    // Pressing one does nothing at all, which is the whole of the behaviour: no door, no notice.
    await card.click();
    await expect(page.getByTestId('cities-view')).toBeVisible();
  }

  // The open one goes back into the city, which is what the card promises.
  const home = open[0]!;
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
