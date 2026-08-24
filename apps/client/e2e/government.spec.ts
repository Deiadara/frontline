import {
  CITY_DISTRICTS,
  MISSION_STANCE_SPECS,
  garrisonOf,
  isSeatOfGovernmentPower,
} from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import { lateGame, me, missionsResponse } from './fixtures';
import { installApi, settleFonts } from './harness';

/**
 * W10 (GDD §A3) — the Combine is on screen in two locations: the intel panel names who holds a
 * district, and the mission board badges which way a job points at the state.
 *
 * Both additions are *extra text in a row that was already full*, which is the one way this change
 * can break the zero-visual-bugs bar. So every check here is a measurement at three widths, not a
 * "is it visible": the mission card header now carries two tags beside a wrapping heading, and the
 * intel panel gains a badge plus a sentence inside a fixed-width column.
 */

/**
 * The widths this project actually gates on — `live.spec.ts`'s `VIEWPORTS` plus the narrowest
 * desktop above them, which is the tightest case the two-tag header has to survive. Deliberately
 * not a phone width: the shell does not reflow below ~1000px today (the whole right-hand column
 * clips), so a 390px assertion would be measuring a pre-existing gap rather than this change.
 */
const WIDTHS = [
  { name: '1024', width: 1024, height: 768 },
  { name: '1280', width: 1280, height: 720 },
  { name: '1920', width: 1920, height: 1080 },
];

/** Anything whose own content is wider than the box it was given, i.e. cut off. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('h3, p, span, dd, dt')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent?.slice(0, 60) ?? ''),
  );
}

/**
 * Headings whose column is narrower than one of their own words, so `break-words` has to cut the
 * word in half to fit ("COURIE / R / CONTRA / CT").
 *
 * `overflowing` above cannot see this: a mid-word break is not overflow, `scrollWidth` matches
 * `clientWidth` and the text is technically all on screen — it is just unreadable. This is the
 * exact regression the Combine badge caused, because the tag group cannot shrink and squeezed the
 * heading beside it, so it is measured rather than eyeballed.
 */
async function cutMidWord(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('article h3')]
      .filter((heading) => {
        const style = getComputedStyle(heading);
        const context = document.createElement('canvas').getContext('2d');
        if (!context) return false;
        context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
        // Letter-spacing is applied per character and `measureText` does not know about it.
        const tracking = parseFloat(style.letterSpacing) || 0;
        const widest = Math.max(
          ...(heading.textContent ?? '')
            .split(/\s+/)
            .filter(Boolean)
            .map((word) => context.measureText(word).width + tracking * word.length),
        );
        return widest > heading.clientWidth + 1;
      })
      .map((heading) => heading.textContent?.slice(0, 60) ?? ''),
  );
}

/** Anything sticking out of the element that is supposed to contain it. */
async function escaping(page: Page, container: string): Promise<string[]> {
  return page.evaluate((selector) => {
    return [...document.querySelectorAll(selector)].flatMap((root) => {
      const box = root.getBoundingClientRect();
      return [...root.querySelectorAll('span, h3, p')]
        .filter((el) => {
          const at = el.getBoundingClientRect();
          if (at.width === 0 && at.height === 0) return false;
          return at.left < box.left - 0.5 || at.right > box.right + 0.5;
        })
        .map((el) => el.textContent?.slice(0, 60) ?? '');
    });
  }, container);
}

/**
 * Where a district actually sits on screen.
 *
 * `position` is a fraction of the map's **layout** width, not of the canvas: the canvas is
 * full-bleed but the intel panel floats over its right-hand side, so `CityMap` lays the districts
 * out into the frame less whatever chrome is covering it and publishes that inset as
 * `data-safe-right`. Multiplying by the raw canvas width instead puts every click to the right of
 * the district it was aimed at — and the further right the district, the worse the miss.
 */
async function districtPoint(
  page: Page,
  position: { x: number; y: number },
): Promise<{ x: number; y: number }> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('canvas has no bounding box');
  const map = page.getByTestId('city-map');
  const inset = async (name: string) =>
    Number((await map.getAttribute(`data-safe-${name}`)) ?? '0');
  const [right, top, bottom] = [await inset('right'), await inset('top'), await inset('bottom')];
  const layoutWidth = Math.max(1, box.width - right);
  const layoutHeight = Math.max(1, box.height - top - bottom);
  return {
    x: box.x + position.x * layoutWidth,
    y: box.y + top + position.y * layoutHeight,
  };
}

test.describe('the mission board badges the Combine (§A3, §D8)', () => {
  for (const { name, width, height } of WIDTHS) {
    test(`keeps both card tags inside the card at ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await installApi(page, lateGame);
      await page.route('**/api/missions', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(missionsResponse()),
        }),
      );
      await page.goto('/game/missions');

      const ambush = page
        .locator('article')
        .filter({ has: page.getByRole('heading', { name: 'Convoy Ambush' }) });
      // The board is a scroller — the existing suite skips the vertical-clip guard here for the
      // same reason — so a card is scrolled to before anything is asserted about being on screen.
      await ambush.scrollIntoViewIfNeeded();
      await expect(ambush).toBeVisible();
      // The badge has to be *in the viewport*, not merely in the DOM: a tag pushed out of its row
      // renders off-panel and reads as missing.
      await expect(
        ambush.getByText(MISSION_STANCE_SPECS.against_government.label),
      ).toBeInViewport();
      await expect(ambush.getByText('Battle')).toBeInViewport();

      await settleFonts(page);

      expect(await overflowing(page), `text is cut off at ${name}`).toEqual([]);
      expect(await escaping(page, 'article'), `a tag escapes its card at ${name}`).toEqual([]);
      expect(await cutMidWord(page), `a mission name is broken mid-word at ${name}`).toEqual([]);

      await page.screenshot({ path: `screenshots/w10-missions-${name}.png`, fullPage: false });
    });
  }

  test('badges a Combine contract differently from a blow against it', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installApi(page, lateGame);
    await page.route('**/api/missions', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(missionsResponse()),
      }),
    );
    await page.goto('/game/missions');

    const card = (heading: string) =>
      page.locator('article').filter({ has: page.getByRole('heading', { name: heading }) });

    await card('Courier Contract').scrollIntoViewIfNeeded();
    await expect(
      card('Courier Contract').getByText(MISSION_STANCE_SPECS.for_government.label),
    ).toBeInViewport();
    // Unaligned scavenging carries no stance badge at all — the badge is a warning, not a label.
    await card('Scrap Run').scrollIntoViewIfNeeded();
    for (const spec of Object.values(MISSION_STANCE_SPECS)) {
      await expect(card('Scrap Run').getByText(spec.label)).toHaveCount(0);
    }
  });
});

test.describe('the intel panel names who holds a district (§A3)', () => {
  const seat = CITY_DISTRICTS.find(isSeatOfGovernmentPower);
  const outpost = CITY_DISTRICTS.find(
    (d) => d.faction === 'government' && !isSeatOfGovernmentPower(d),
  );
  const street = CITY_DISTRICTS.find(
    (d) => d.kind === 'contested' && d.faction !== 'government' && d.id !== 'chrome-row',
  );
  if (!seat || !outpost || !street)
    throw new Error('fixture error: city map is missing a faction case');

  /** Clicks a district on the Pixi canvas the way a player does. */
  async function select(page: Page, position: { x: number; y: number }): Promise<void> {
    await expect(page.locator('canvas')).toBeVisible();
    await page.waitForTimeout(700);
    const at = await districtPoint(page, position);
    await page.mouse.click(at.x, at.y);
  }

  for (const { name, width, height } of WIDTHS) {
    test(`fits the Combine badge and holding line at ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await installApi(page, me);
      await page.goto('/game');
      await select(page, seat.position);

      await expect(page.getByRole('heading', { name: seat.name })).toBeVisible();
      // §A3 — a seat of the Combine's power says so, and names what is standing on it.
      await expect(page.getByText('Seat of power')).toBeInViewport();
      await expect(page.getByText(new RegExp(garrisonOf(seat)))).toBeInViewport();

      await settleFonts(page);

      expect(await overflowing(page), `intel text is cut off at ${name}`).toEqual([]);

      await page.screenshot({ path: `screenshots/w10-intel-${name}.png`, fullPage: false });
    });
  }

  test('names a Combine garrison on state ground, and nobody in particular elsewhere', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installApi(page, me);
    await page.goto('/game');

    await select(page, outpost.position);
    await expect(page.getByText(new RegExp(garrisonOf(outpost)))).toBeInViewport();
    // An outpost is Combine ground but not a seat of its power — the two must read apart.
    await expect(page.getByText('Seat of power')).toHaveCount(0);

    await select(page, street.position);
    await expect(page.getByRole('heading', { name: street.name })).toBeVisible();
    await expect(page.getByText(new RegExp(garrisonOf(street)))).toBeInViewport();
    await expect(page.getByText('Seat of power')).toHaveCount(0);
  });
});
