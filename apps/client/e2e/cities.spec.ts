import {
  CITIES,
  DEFAULT_CITY_ID,
  DISTRICT_NAME_MAX,
  districtsOfCity,
  type CityResponse,
} from '@frontline/shared';
import { expect, test } from '@playwright/test';
import { cityFor, lateGame, lateGameBase } from './fixtures';
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
 * A district tag is one line, always (maintainer, 2026-09-25, and again 2026-10-05).
 *
 * The first pass measured authored names on a fixture where nobody held a district outright, so
 * no tag carried the Combine's mark, and the mark is twenty pixels: a Combine-held Marshalling
 * Yards wrapped on the real map while this stayed green. So every district here is held, every tag
 * wears the mark, and the crew's own plot carries a 28-character name (`DISTRICT_NAME_MAX`), the
 * longest label the map can be asked to print. Each one has to be a single line and lie wholly
 * inside the painting's window on screen.
 */
test('no district tag wraps, leaves the map or touches another, in any city', async ({ page }) => {
  const longest = 'The Brotherhood of the Rails';
  expect(longest).toHaveLength(DISTRICT_NAME_MAX);
  const held = (map: CityResponse): CityResponse => ({
    ...map,
    // Whole as well as held (maintainer, 2026-10-07): a tag wears a party's mark only where that
    // party holds every plot, and the mark is what makes the tag its widest. Without `wholeBy`
    // this fixture measured the narrow tag and the guard below caught it.
    districts: map.districts.map((one) => ({
      ...one,
      holder: { kind: 'government' as const },
      wholeBy: 'enemy' as const,
    })),
  });

  for (const [width, height] of [
    [1024, 768],
    [1280, 720],
  ] as const) {
    await page.setViewportSize({ width, height });
    await installApi(page, { ...lateGame, base: { ...lateGameBase, name: longest } });
    // After the harness, so it is matched first.
    await page.route(
      (url) => url.pathname.endsWith('/api/city'),
      (route) =>
        route.fulfill({
          json: held(cityFor(new URL(route.request().url()).searchParams.get('city') ?? '')),
        }),
    );

    for (const city of CITIES.filter((one) => one.open)) {
      await page.goto('/game/city');
      await expect(page.getByTestId('cities-view')).toBeVisible();
      await page.getByTestId(`city-card-${city.id}`).click();
      await expect(page.getByTestId('cities-view')).toHaveCount(0);
      await settleFonts(page);
      const tags = page.locator('[data-testid^="district-tag-"]');
      await expect(tags).toHaveCount(districtsOfCity(city.id).length);

      const found = await page.evaluate(() => {
        const room = document.querySelector('[data-testid="city-room"]')!.getBoundingClientRect();
        const left = Math.max(0, room.left);
        const right = Math.min(window.innerWidth, room.right);
        const top = Math.max(0, room.top);
        const bottom = Math.min(window.innerHeight, room.bottom);
        const tall: string[] = [];
        const outside: string[] = [];
        const boxes: { text: string; box: DOMRect }[] = [];
        let marked = 0;
        for (const tag of document.querySelectorAll('[data-testid^="district-tag-"]')) {
          // The plate is the one child with the name in it; the other is the hover glow.
          const plate = [...tag.querySelectorAll(':scope > span')].find((one) =>
            one.textContent?.trim(),
          ) as HTMLElement | undefined;
          if (!plate) continue;
          if (plate.querySelector('svg')) marked += 1;
          const text = plate.textContent?.trim() ?? '';
          const line = parseFloat(getComputedStyle(plate).lineHeight);
          const box = plate.getBoundingClientRect();
          if (box.height > line * 1.6) tall.push(`${text} at ${box.height}px`);
          if (box.left < left || box.right > right || box.top < top || box.bottom > bottom) {
            outside.push(`${text} at ${Math.round(box.left)}..${Math.round(box.right)}`);
          }
          boxes.push({ text, box });
        }
        /*
         * No two tags touch (2026-10-07). Arca's Saint's Rest and Bloodstone sat a few pixels
         * into each other at 1024x768 with every other check here green.
         */
        const touching: string[] = [];
        for (const [index, one] of boxes.entries()) {
          for (const other of boxes.slice(index + 1)) {
            const apart =
              one.box.right <= other.box.left ||
              other.box.right <= one.box.left ||
              one.box.bottom <= other.box.top ||
              other.box.bottom <= one.box.top;
            if (!apart) touching.push(`${one.text} / ${other.text}`);
          }
        }
        return { tall, outside, touching, marked };
      });
      const where = `${city.name} at ${width}x${height}`;
      expect(found.tall, `${where}: tags on more than one line`).toEqual([]);
      expect(found.outside, `${where}: tags off the painting`).toEqual([]);
      expect(found.touching, `${where}: tags on top of each other`).toEqual([]);
      // A guard on the sweep: the mark is what wrapped, so every tag has to be wearing it.
      expect(found.marked, `${where}: tags without the mark`).toBe(districtsOfCity(city.id).length);
    }
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
