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
import {
  CITY_DISTRICTS,
  DEFAULT_BADGE,
  LOCATION_CATALOG,
  cityOf,
  findDistrict,
  type DistrictDetailResponse,
  type LocationHolder,
} from '@frontline/shared';
import { HELD_BY_ON_THE_RIGHT } from '../src/features/city/marks';
import { districtDetailFor, me } from './fixtures';
import { installApi, settleFonts } from './harness';

const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

/**
 * The districts with a delivered painting.
 *
 * Named here rather than derived, so a new plate is a line in this list rather than a district
 * that quietly ships with none of these sweeps run over it. That is not hypothetical: Chrome Row
 * landed while this said `['neon-docks', 'steelbelt']` and went unswept, and the Undergrid and the
 * Annexes joined it on 2026-09-11, Glasshouse Fields and the Blacksite on 2026-09-15.
 */
const PAINTED = [
  'neon-docks',
  'steelbelt',
  'chrome-row',
  'undergrid',
  'annexes',
  'glasshouse-fields',
  'blacksite',
  // Terminus's first painted district (2026-09-24), and the first entry here that is not in
  // Ashfall. See `serveTerminusGround`: the shared fixture only knows Ashfall, so this district's
  // detail is stubbed in `open` rather than in `fixtures.ts`, which another lane owns.
  'coldwater-halt',
  'ironmouth',
  // The Yards and the Bond (2026-09-25). Neither painting shows a district gate, so neither has a
  // `GATE_MARK`: the way in stays on the buttons beside the painting, which is where it already
  // was, and these sweeps only ever read the location signs.
  'marshalling-yards',
  'bonded-row',
  // The four Combine districts (2026-09-29). Telemetry Hill, the Last Platform and the Blockhouse
  // carry a `GATE_MARK`; the Viaduct's painting shows no gate.
  'telemetry-hill',
  'viaduct',
  'last-platform',
  'blockhouse',
] as const;

interface Box {
  readonly id: string;
  readonly text: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly cut: boolean;
  /** How many lines of text the name takes. One, always: a sign is a plate and a plate does not wrap. */
  readonly lines: number;
}

/**
 * District detail for ground the shared fixture has never heard of.
 *
 * `districtDetailFor` walks `CITY_DISTRICTS`, which is Ashfall, and answers with the Steelbelt for
 * anything else: the page would then draw the Steelbelt's painting under a Terminus URL and every
 * assertion below would be measuring the wrong picture. This re-labels one Steelbelt payload with
 * the real district and its real locations, which is all this file's sweeps read, and it lives
 * here because `e2e/fixtures.ts` belongs to another lane.
 */
async function serveTerminusGround(page: Page, id: string) {
  if (findDistrict(id) === undefined || cityOf(id) === 'ashfall') return;
  await serveDetail(page, id, terminusDetail(id));
}

/** A Terminus district's detail: one Steelbelt payload re-labelled. See `serveTerminusGround`. */
function terminusDetail(id: string): DistrictDetailResponse {
  const district = findDistrict(id)!;
  const standIn = districtDetailFor('steelbelt');
  return {
    ...standIn,
    district,
    unified: null,
    locations: district.locations.map((location, index) => ({
      ...standIn.locations[index % standIn.locations.length]!,
      location,
    })),
  };
}

/** Whichever detail this file serves for `id`, Ashfall's fixture or Terminus's stand-in. */
function detailOf(id: string): DistrictDetailResponse {
  return cityOf(id) === 'ashfall' ? districtDetailFor(id) : terminusDetail(id);
}

async function serveDetail(page: Page, id: string, detail: DistrictDetailResponse) {
  await page.route(`**/api/city/${id}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detail) }),
  );
}

/**
 * `detail` with every location held by one party, which is what puts the "Held by" plaque on the
 * painting (maintainer, 2026-09-30).
 */
function heldWhole(
  detail: DistrictDetailResponse,
  holder: LocationHolder,
  holderName: string,
  holderFaction: DistrictDetailResponse['holderFaction'] = null,
): DistrictDetailResponse {
  return {
    ...detail,
    holder,
    holderFaction,
    locations: detail.locations.map((view) => ({ ...view, holder, holderName })),
  };
}

async function open(page: Page, id: string, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await installApi(page, me);
  await serveTerminusGround(page, id);
  await page.goto(`/game/city/${id}`);
  await expect(page.getByTestId(`district-painting-${id}`)).toBeVisible();
  await settleFonts(page);
}

async function signsOn(page: Page, id: string): Promise<{ plate: Box; signs: Box[] }> {
  return page.evaluate((districtId) => {
    const box = (el: Element, cut: boolean): Box => {
      const r = el.getBoundingClientRect();
      /*
       * The name is the last span with no element children, which is the same element the `cut`
       * scan above measures. Not `span:last-child`: that is a descendant search and returns the
       * *plate*, which on a shut gate carries a lock icon and stands two lines tall without
       * anything having wrapped. The first version of this scan reported every gate as wrapping.
       */
      const label =
        [...el.querySelectorAll('span')].reverse().find((one) => one.childElementCount === 0) ??
        null;
      const line = label ? parseFloat(getComputedStyle(label).lineHeight) || 13 : 13;
      return {
        id: (el as HTMLElement).dataset.testid ?? '',
        text: el.textContent?.trim() ?? '',
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        cut,
        lines: label ? Math.round((label.getBoundingClientRect().height / line) * 10) / 10 : 1,
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
      lines: number;
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
  await page.goto('/game/city/steelbelt');
  await expect(page.getByTestId('district-painting-steelbelt')).toBeVisible();
  await settleFonts(page);

  // With marks, they are signs on the picture and there is no fallback row.
  await expect(page.getByTestId('unplaced-locations')).toHaveCount(0);
  const district = CITY_DISTRICTS.find((entry) => entry.id === 'steelbelt')!;
  for (const location of district.locations) {
    await expect(page.getByTestId(`site-${location.id}`)).toBeVisible();
  }
});

for (const id of PAINTED) {
  // `findDistrict` rather than `CITY_DISTRICTS`: the list above reaches past Ashfall now.
  const district = findDistrict(id)!;

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
      // A location with its own blurb (the Blacksite's eight, written to the painting) prints
      // that; only a location without one falls back to its kind's. The same rule as the sheet.
      await expect(tip, 'the card does not say what the place is').toContainText(
        location.blurb ?? spec.blurb,
      );
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
        /*
         * And every one of them on a single line (maintainer request, 2026-09-11).
         *
         * The plate used to be `max-w-[9rem]`, so the two longest names in the city wrapped: "The
         * Unfinished Faculty" and "Statue of the Revolutionary" each came out as a two-line block
         * sitting over more of the painting than the thing it names. Measured on the *text* span
         * rather than the plate, because a shut gate's plate carries a lock icon that makes the
         * row taller than its line without anything having wrapped.
         */
        expect(
          signs.filter((sign) => sign.lines > 1.5).map((sign) => `${sign.text} (${sign.lines})`),
          `sign names wrapping onto two lines at ${tag}`,
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

      /*
       * The "Held by" plaque at the painting's foot (maintainer, 2026-09-30) stands clear of every
       * sign, the gate's included, and of the strip and the toggle over the top corners, at the
       * two widths the game is played at. Held by the Combine, which is the case every district
       * can be in.
       */
      if (size.width <= 1280) {
        test(`hangs the "Held by" plaque clear of every sign at ${tag}`, async ({ page }) => {
          await page.setViewportSize(size);
          await installApi(page, me);
          await serveDetail(
            page,
            id,
            heldWhole(detailOf(id), { kind: 'government' }, 'The Combine'),
          );
          await page.goto(`/game/city/${id}`);
          await expect(page.getByTestId(`district-painting-${id}`)).toBeVisible();
          await settleFonts(page);

          const plaque = page.getByTestId('held-by');
          await expect(plaque).toBeVisible();
          await expect(plaque.getByTestId('held-by-mark-government')).toBeVisible();
          const hits = await page.evaluate(() => {
            const rect = (el: Element) => el.getBoundingClientRect();
            const held = rect(document.querySelector('[data-testid="held-by"]')!);
            const band = rect(document.querySelector('[data-testid="district-band"]')!);
            const over = (b: DOMRect) =>
              held.left < b.right &&
              b.left < held.right &&
              held.top < b.bottom &&
              b.top < held.bottom;
            const others = [
              ...document.querySelectorAll(
                '[data-testid^="site-"], [data-testid="back-to-city"], [data-testid="district-standing-column"]',
              ),
            ];
            const inside =
              held.left >= band.left - 1 &&
              held.right <= band.right + 1 &&
              held.top >= band.top - 1 &&
              held.bottom <= band.bottom + 1;
            return {
              inside,
              corner: held.left - band.left < band.right - held.right ? 'left' : 'right',
              covered: others
                .filter((el) => over(rect(el)))
                .map((el) => (el as HTMLElement).dataset.testid ?? '?'),
            };
          });
          expect(hits.inside, 'the plaque stands inside the painting band').toBe(true);
          expect(hits.corner).toBe(HELD_BY_ON_THE_RIGHT.has(id) ? 'right' : 'left');
          expect(hits.covered, `the plaque covers something at ${tag}`).toEqual([]);
          await page.screenshot({ path: `screenshots/held-by/${id}-${tag}.png` });
        });
      }

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

/**
 * The plaque's mark is the holder's (maintainer, 2026-09-30): the Combine's cross, the looters'
 * skull, a crew's faction badge, or the crew mark for a crew at no table. And no plaque at all on
 * ground held in pieces, which is the shared fixture's Steelbelt.
 */
test.describe('the "Held by" plaque', () => {
  const id = 'steelbelt';
  const cases: readonly [string, DistrictDetailResponse, string, string][] = [
    [
      'the Combine',
      heldWhole(detailOf(id), { kind: 'government' }, 'The Combine'),
      'government',
      'The Combine',
    ],
    ['the looters', heldWhole(detailOf(id), { kind: 'looters' }, 'Looters'), 'looters', 'Looters'],
    [
      'a crew at a table',
      heldWhole(detailOf(id), { kind: 'crew', baseId: 'rival-base' }, 'Vex Holdings', {
        name: 'The Vexhold Concern',
        badge: DEFAULT_BADGE,
      }),
      'faction',
      'Vex Holdings',
    ],
    [
      'a crew at no table',
      heldWhole(detailOf(id), { kind: 'crew', baseId: 'rival-base' }, 'Vex Holdings'),
      'crew',
      'Vex Holdings',
    ],
  ];
  for (const [who, detail, mark, name] of cases) {
    test(`wears the mark of ${who}`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 720 });
      await installApi(page, me);
      await serveDetail(page, id, detail);
      await page.goto(`/game/city/${id}`);
      const plaque = page.getByTestId('held-by');
      await expect(plaque).toBeVisible();
      await expect(plaque).toContainText('Held by');
      await expect(plaque.getByTestId('held-by-name')).toHaveText(name);
      await expect(plaque.getByTestId(`held-by-mark-${mark}`)).toBeVisible();
      await settleFonts(page);
      await plaque.screenshot({ path: `screenshots/held-by/mark-${mark}.png` });
    });
  }

  test('is not there on ground held in pieces', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await installApi(page, me);
    await page.goto(`/game/city/${id}`);
    await expect(page.getByTestId(`district-painting-${id}`)).toBeVisible();
    await expect(page.getByTestId('held-by')).toHaveCount(0);
  });
});
