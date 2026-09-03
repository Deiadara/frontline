/**
 * The two painted contested districts, and the signs standing on them.
 *
 * A sign is positioned in fractions of the painting, so every failure this file exists to catch is
 * a *geometry* failure that a rendering test cannot see and a unit test cannot reach: a sign off
 * the picture, two signs on top of each other, or a name cut in half by the plate it sits in.
 *
 * Checked at every viewport in the matrix, because the box the fractions are measured in is sized
 * from the window: a placement that holds at 1920 and collides at 1024 is the normal way this
 * breaks.
 */
import { expect, test, type Page } from '@playwright/test';
import { CITY_DISTRICTS, LOCATION_CATALOG } from '@frontline/shared';
import { districtDetailFor, me } from './fixtures';
import { installApi, settleFonts } from './harness';

const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

/** The districts with a delivered painting. Named here so a third one fails loudly rather than silently. */
const PAINTED = ['neon-docks', 'rustyard'] as const;

interface Box {
  readonly id: string;
  readonly text: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly cut: boolean;
}

async function open(page: Page, id: string, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await installApi(page, me);
  await page.goto(`/game/city/${id}`);
  await expect(page.getByTestId(`district-painting-${id}`)).toBeVisible();
  await settleFonts(page);
}

async function signsOn(page: Page, id: string): Promise<{ plate: Box; signs: Box[] }> {
  return page.evaluate((districtId) => {
    const box = (el: Element, cut: boolean): Box => {
      const r = el.getBoundingClientRect();
      return {
        id: (el as HTMLElement).dataset.testid ?? '',
        text: el.textContent?.trim() ?? '',
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        cut,
      };
    };
    interface Box {
      id: string;
      text: string;
      left: number;
      right: number;
      top: number;
      bottom: number;
      cut: boolean;
    }
    const plate = document.querySelector(`[data-testid="district-painting-${districtId}"]`)!;
    const signs = [...plate.querySelectorAll('[data-testid^="site-"]')].map((el) =>
      // A name wider than the plate it sits in: `max-w` wraps it, and a wrap that still does not
      // fit is a cut name. Measured on the text span, not on the button, because the button grows.
      box(
        el,
        [...el.querySelectorAll('span')].some((s) => s.scrollWidth > s.clientWidth + 1),
      ),
    );
    return { plate: box(plate, false), signs };
  }, id);
}

/**
 * Fog first (board request): the painting is what the district *looks like*, and a district nobody
 * has walked into does not look like anything yet.
 *
 * The fog has to be put over a district that **has** a painting, which is why this stubs the route
 * rather than using the fixture's own unscouted district. That one is `datavault-sigma`, which has
 * no painting under any conditions, so asserting the painting is absent there passes against a
 * build that never draws a painting at all: the first version of this test did exactly that, and
 * survived deleting the scouted check.
 */
test('shows the painting only once the ground has been scouted', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installApi(page, me);

  // Same district, same painting, one field different.
  await page.route('**/api/city/neon-docks', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...districtDetailFor('neon-docks'),
        scouted: false,
        locations: [],
        scoutPlan: { officerId: 'off-3', officerName: 'Vela', minutes: 90 },
      }),
    }),
  );
  await page.goto('/game/city/neon-docks');
  await expect(page.getByText('Unscouted')).toBeVisible();
  await expect(page.getByTestId('district-painting-neon-docks')).toHaveCount(0);

  // Fog lifted, nothing else changed: the picture is there.
  await page.unroute('**/api/city/neon-docks');
  await page.goto('/game/city/neon-docks');
  await expect(page.getByTestId('district-painting-neon-docks')).toBeVisible();
});

/**
 * A plate delivered before its signs are placed still reaches every location.
 *
 * The art policy is that a correctly named file dropped into `assets/` flips a district from
 * procedural to painted with **no TypeScript edit**. That guarantees a window where a plate exists
 * and its marks do not, and the district screen is now only the painting: the card column that used
 * to sit under it is gone. Filtering unmarked locations out therefore made all of them unreachable,
 * on a screen that looked perfectly fine. `marks.ts` had promised this row existed for months
 * before anything rendered it.
 *
 * Simulated by removing the marks rather than by inventing a district, so it measures the real
 * component against the real payload.
 */
test('reaches locations the painting has no mark for', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  await installApi(page, me);
  await page.goto('/game/city/rustyard');
  await expect(page.getByTestId('district-painting-rustyard')).toBeVisible();
  await settleFonts(page);

  // With marks, they are signs on the picture and there is no fallback row.
  await expect(page.getByTestId('unplaced-locations')).toHaveCount(0);
  const district = CITY_DISTRICTS.find((entry) => entry.id === 'rustyard')!;
  for (const location of district.locations) {
    await expect(page.getByTestId(`site-${location.id}`)).toBeVisible();
  }
});

for (const id of PAINTED) {
  const district = CITY_DISTRICTS.find((entry) => entry.id === id)!;

  test.describe(`${district.name}: the painting and its signs`, () => {
    test('hangs a sign on every location the district has', async ({ page }) => {
      await open(page, id, VIEWPORTS[3]);
      const { signs } = await signsOn(page, id);
      for (const location of district.locations) {
        expect(
          signs.map((sign) => sign.id),
          `${location.name} has no sign on the painting`,
        ).toContain(`site-${location.id}`);
      }
    });

    test('says what a location is and what holding it pays', async ({ page }) => {
      await open(page, id, VIEWPORTS[3]);
      const location = district.locations[0]!;
      const spec = LOCATION_CATALOG[location.kind];

      // Scoped to the tooltip, because the card below the painting says the same two sentences.
      // Asserted shut first, in the same test: an assertion that only runs after the focus passes
      // just as happily against a sign that opens nothing, since the words are on the page either
      // way.
      const tip = page.getByRole('tooltip');
      await expect(tip, 'a card was already open before anything was focused').toHaveCount(0);

      // Opened by keyboard rather than by hover: the card has to be reachable without a pointer,
      // and a `focus` that works proves the `hover` does. Clicking is the other half and is
      // covered by the scroll test below.
      await page.getByTestId(`site-${location.id}`).focus();
      await expect(tip).toContainText(location.name);
      await expect(tip, 'the card does not say what the place is').toContainText(spec.blurb);
      await expect(tip, 'the card does not say what holding it pays').toContainText(spec.reward);
    });

    test("clicking a sign opens that location's card", async ({ page }) => {
      await open(page, id, VIEWPORTS[3]);
      const location = district.locations[district.locations.length - 1]!;

      // Shut before the click, in the same test: an absence check that only runs afterwards passes
      // just as well against a sign that opens nothing at all.
      await expect(page.getByTestId('location-window')).toHaveCount(0);

      await page.getByTestId(`site-${location.id}`).click();
      await expect(page.getByTestId('location-window')).toBeVisible();
      // The card for *that* location, rather than whichever one happened to be first.
      await expect(page.getByTestId(`location-${location.id}`)).toBeVisible();
    });

    for (const size of VIEWPORTS) {
      const tag = `${size.width}x${size.height}`;

      test(`keeps every sign on the picture and legible at ${tag}`, async ({ page }) => {
        await open(page, id, size);
        const { plate, signs } = await signsOn(page, id);
        expect(signs.length, 'no signs to check').toBeGreaterThan(0);

        const off = signs.filter(
          (sign) =>
            sign.left < plate.left - 1 ||
            sign.right > plate.right + 1 ||
            sign.top < plate.top - 1 ||
            sign.bottom > plate.bottom + 1,
        );
        expect(
          off.map((sign) => sign.text),
          `signs hanging off the painting at ${tag}`,
        ).toEqual([]);
        expect(
          signs.filter((sign) => sign.cut).map((sign) => sign.text),
          `sign names cut off at ${tag}`,
        ).toEqual([]);
      });

      /*
       * The other thing on this screen that can leave the frame: the card, not the sign.
       *
       * A sign is a small plate placed in the painting's own coordinates, and the sweep above keeps
       * it inside the picture. Its card is much larger, opens on hover and focus, and is positioned
       * against the *window*, so the two are clipped by different boxes and only one of them was
       * ever checked. The Chandlery sits at x=0.918 of the Docks and the Bone Market at x=0.849 of
       * the Steelbelt: both open a card wider than the gap between them and the right edge.
       */
      test(`keeps every sign's card on the screen at ${tag}`, async ({ page }) => {
        await open(page, id, size);
        const signs = page.locator('[data-testid^="site-"]');
        const count = await signs.count();
        expect(count, 'no signs to open').toBeGreaterThan(0);

        const escaped: string[] = [];
        for (let i = 0; i < count; i += 1) {
          const sign = signs.nth(i);
          await sign.focus();
          const tip = page.getByRole('tooltip');
          await expect(tip).toBeVisible();
          const box = await tip.boundingBox();
          if (!box) continue;
          const name = (await sign.textContent())?.trim() ?? `sign ${i}`;
          if (
            box.x < -1 ||
            box.y < -1 ||
            box.x + box.width > size.width + 1 ||
            box.y + box.height > size.height + 1
          ) {
            escaped.push(`${name} at ${Math.round(box.x)},${Math.round(box.y)}`);
          }
        }
        expect(escaped, `cards opening off the screen at ${tag}`).toEqual([]);
      });

      test(`keeps the signs off each other at ${tag}`, async ({ page }) => {
        await open(page, id, size);
        const { signs } = await signsOn(page, id);

        const collisions: string[] = [];
        for (let i = 0; i < signs.length; i += 1) {
          for (let j = i + 1; j < signs.length; j += 1) {
            const a = signs[i]!;
            const b = signs[j]!;
            const overlaps =
              a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
            if (overlaps) collisions.push(`"${a.text}" over "${b.text}"`);
          }
        }
        expect(collisions, `signs overlapping at ${tag}`).toEqual([]);
      });
    }
  });
}
