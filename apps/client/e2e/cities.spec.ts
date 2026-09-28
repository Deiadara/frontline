import { CITIES, DEFAULT_CITY_ID, districtsOfCity } from '@frontline/shared';
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

/**
 * The district backdrop is the room these paintings are hung in, and it survives the trip.
 *
 * This used to be half a test about the shell's corner sprites, which this screen suppressed while
 * it was mounted. The sprites came off the game on 2026-09-25 and there is nothing left to
 * suppress; the backdrop half was always the other claim and it still holds. Asserted on the way
 * in *and* on the way back, because the failure it guards is a screen that tears the room down
 * behind it and never puts it back.
 */
test('the world screen keeps the district backdrop, going in and coming back', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game');
  await expect(page.locator('[data-scenery]').first()).toBeVisible();

  await page.getByTestId('all-cities').click();
  await expect(page.getByTestId('cities-view')).toBeVisible();
  await expect(page.locator('[data-scenery]').first()).toBeVisible();

  await page.getByTestId(`city-card-${CITIES[0]!.id}`).click();
  await expect(page.getByTestId('cities-view')).toHaveCount(0);
  await expect(page.locator('[data-scenery]').first()).toBeVisible();
});

test('only the city with a server behind it can be pressed', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game');
  await page.getByTestId('all-cities').click();

  const open = CITIES.filter((city) => city.open);
  const shut = CITIES.filter((city) => !city.open);
  /*
   * A guard on the fixture rather than a pin on the count.
   *
   * It pinned one open and four shut, and went red the day Terminus opened: the number of playable
   * cities is the thing this suite is downstream of, not the thing it is testing. What has to hold
   * is that there is at least one of each, or the two halves below prove nothing.
   */
  expect(open.length).toBeGreaterThan(0);
  expect(shut.length).toBeGreaterThan(0);

  for (const city of shut) {
    const card = page.getByTestId(`city-card-${city.id}`);
    await expect(card).toHaveAttribute('aria-disabled', 'true');
    // Pressing one does nothing at all, which is the whole of the behaviour: no door, no notice.
    await card.click();
    await expect(page.getByTestId('cities-view')).toBeVisible();
  }

  // Every open one is a door onto that city's map, which is what the card promises.
  for (const city of open) {
    await expect(page.getByTestId(`city-card-${city.id}`)).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
  }
  await page.getByTestId(`city-card-${open[0]!.id}`).click();
  await expect(page.getByTestId('cities-view')).toHaveCount(0);
});

/**
 * Picking a city you do not live in draws that city's map.
 *
 * The half that was missing: every card closed the world screen and dropped the player back on
 * their own painting, so the two playable cities were one screen apart and indistinguishable.
 */
test('a city you pick is the city you end up looking at', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game');
  await page.getByTestId('all-cities').click();
  await expect(page.getByTestId('cities-view')).toBeVisible();

  const away = CITIES.find((city) => city.open && city.id !== DEFAULT_CITY_ID);
  // A guard: with one open city there is nowhere else to go and this proves nothing.
  expect(away, 'fixture: needs a second open city').toBeDefined();

  await page.getByTestId(`city-card-${away!.id}`).click();
  await expect(page.getByTestId('cities-view')).toHaveCount(0);

  // The map now carries that city's districts, and none of the home city's.
  const theirs = districtsOfCity(away!.id)[0]!;
  const mine = districtsOfCity(DEFAULT_CITY_ID)[0]!;
  await expect(page.getByTestId(`district-tag-${theirs.id}`)).toBeVisible();
  await expect(page.getByTestId(`district-tag-${mine.id}`)).toHaveCount(0);
});

/**
 * A district tag is a scrap of paper with a name on it, and a name is one line.
 *
 * The tag carried a width cap and `break-words`, which every Ashfall name happened to fit inside.
 * Terminus's Marshalling Yards is twenty-one characters and wrapped, so one tag on that map was
 * two lines tall and read as a different kind of object from the eleven beside it (maintainer,
 * 2026-09-25). Measured on the rendered box rather than on the class, because a cap removed
 * somewhere else in the cascade would put it back without touching this component.
 */
test('no district tag wraps, in either city', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installApi(page, lateGame);

  for (const city of CITIES.filter((one) => one.open)) {
    await page.goto('/game/city');
    await expect(page.getByTestId('cities-view')).toBeVisible();
    await page.getByTestId(`city-card-${city.id}`).click();
    await expect(page.getByTestId('cities-view')).toHaveCount(0);
    await settleFonts(page);

    /*
     * Authored names only, and that is the point of the cap rather than a hole in the test.
     *
     * A crew names its own ground, and `DistrictNameSchema` allows far longer than anything in the
     * catalogue, so a player-named tag wrapping is the cap doing its job. What must never wrap is
     * a name the game itself wrote, because that is a fixed string somebody could have measured.
     */
    const authored = districtsOfCity(city.id).map((one) => one.name.toUpperCase());
    const wrapped = await page.evaluate((names: string[]) => {
      const tall: string[] = [];
      for (const tag of document.querySelectorAll('[data-testid^="district-tag-"]')) {
        // The plate is the one child with the name in it; the other is the hover glow.
        const plate = [...tag.querySelectorAll('span')].find((one) => one.textContent?.trim());
        if (!plate) continue;
        const text = plate.textContent?.trim() ?? '';
        if (!names.includes(text.toUpperCase())) continue;
        const line = parseFloat(getComputedStyle(plate).lineHeight);
        const box = plate.getBoundingClientRect();
        if (box.height > line * 1.6) tall.push(`${text} at ${box.height}px`);
      }
      return tall;
    }, authored);
    expect(wrapped, `${city.name}: tags on more than one line`).toEqual([]);

    // A guard on the sweep: no tags at all would pass the assertion above having measured nothing.
    const drawn = await page.locator('[data-testid^="district-tag-"]').count();
    expect(drawn, `${city.name}: no tags on the map`).toBe(districtsOfCity(city.id).length);
  }
});

/**
 * Every card shows a different place, whether it is painted or generated.
 *
 * Two kinds of card now. A city with a painting on the manifest draws it (Ashfall and Terminus
 * do); a city without one draws a procedural skyline seeded off its id. What has to hold for both
 * is that no two cards show the same thing: two painted cards sharing a file, or two generated
 * ones sharing a seed, are the same bug wearing different clothes.
 */
test('every city card shows a place of its own', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game');
  await page.getByTestId('all-cities').click();
  await expect(page.getByTestId('cities-view')).toBeVisible();

  const pictures = await Promise.all(
    CITIES.map(async (city) => {
      const card = page.getByTestId(`city-card-${city.id}`);
      const painted = card.locator('img').first();
      if ((await painted.count()) > 0) {
        // A real painting: the file it points at is its identity.
        return painted.evaluate((el) => `painted:${(el as HTMLImageElement).currentSrc}`);
      }
      const svg = card.locator('svg').first();
      return svg.evaluate(
        (el) =>
          `drawn:${[...el.querySelectorAll('path')].map((path) => path.getAttribute('d') ?? '').join('|')}`,
      );
    }),
  );

  // A guard on the fixture: with every card painted the skyline half of this proves nothing, and
  // with none painted the other half does.
  expect(pictures.filter((one) => one.startsWith('painted:')).length).toBeGreaterThan(0);
  expect(pictures.filter((one) => one.startsWith('drawn:')).length).toBeGreaterThan(0);

  for (const picture of pictures) expect(picture.length).toBeGreaterThan(20);
  expect(new Set(pictures).size).toBe(CITIES.length);
});
