import {
  CITY_DISTRICTS,
  ATTRIBUTE_LABELS,
  MISSION_LEANING_LABELS,
  MISSION_LEANING_REASONS,
  garrisonOf,
  isSeatOfGovernmentPower,
} from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import { lateGame, me, missionsResponse } from './fixtures';
import { installApi, settleFonts, walkBoards } from './harness';

/**
 * W10 (GDD §A3): the Combine is on screen in two locations: the intel panel names who holds a
 * district, and the mission board badges which way a job points at the state.
 *
 * Both additions are *extra text in a row that was already full*, which is the one way this change
 * can break the zero-visual-bugs bar. So every check here is a measurement at three widths, not a
 * "is it visible": the mission card header now carries two tags beside a wrapping heading, and the
 * intel panel gains a badge plus a sentence inside a fixed-width column.
 */

/**
 * The widths this project actually gates on: `live.spec.ts`'s `VIEWPORTS` plus the narrowest
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
 * `clientWidth` and the text is technically all on screen. It is just unreadable. This is the
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
 * Reveals the garrison line, wherever this district keeps it.
 *
 * A painted district is a screen rather than a column now, and what is true of the *whole* place
 * sits behind a toggle: floated open over the painting it covered a location's sign, and a panel
 * over a sign stops that sign being clickable. Districts without a painting still print the line
 * straight onto the page, so this is a no-op there rather than a failure.
 */
async function showGarrison(page: Page): Promise<void> {
  const toggle = page.getByTestId('district-standing-toggle');
  /*
   * Waited for, not counted.
   *
   * `count()` is a one-shot read with no auto-waiting, so on the painted districts it was taken
   * before React had rendered the strip, reported zero, and this returned having done nothing: the
   * assertion that followed then failed on a panel that was merely still shut. The short wait is
   * the difference between "there is no toggle here" and "there is not one *yet*".
   */
  await toggle
    .waitFor({ state: 'visible', timeout: 2_000 })
    .then(() => toggle.click())
    .catch(() => undefined);
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

      /*
       * Whichever card the board is offering, rather than a named one.
       *
       * Which three jobs an area offers is `missionOffers`' business and it is stable per area,
       * not per template: naming `Convoy Ambush` pinned content this test is not about, and the
       * card stopped existing the day the board became per-district.
       *
       * The tag being measured is the **kind** keyword. It used to be the anti-Combine stance
       * badge, which shared that row and no longer exists (2026-09-12). The leaning chips are not
       * a substitute: they sit in their own fixed-height row that clips a four-leaning job on
       * purpose, so a chip below the fold there is the design working rather than a tag pushed
       * out of place, and asserting it is in the viewport fails at 1024 for the right reason.
       */
      const tag = 'Standard';
      const badged = page.locator('[data-testid^="offer-"]').filter({ hasText: tag }).first();
      await badged.scrollIntoViewIfNeeded();
      await expect(badged).toBeVisible();
      // The tag has to be *in the viewport*, not merely in the DOM: one pushed out of its row
      // renders off-panel and reads as missing.
      await expect(badged.getByText(tag, { exact: true }).first()).toBeInViewport();

      await settleFonts(page);

      expect(await overflowing(page), `text is cut off at ${name}`).toEqual([]);
      expect(await escaping(page, 'article'), `a tag escapes its card at ${name}`).toEqual([]);
      expect(await cutMidWord(page), `a mission name is broken mid-word at ${name}`).toEqual([]);

      await page.screenshot({ path: `screenshots/w10-missions-${name}.png`, fullPage: false });
    });
  }

  /*
   * What a job leans on, and why (maintainer request, 2026-09-12).
   *
   * This used to assert the badging rule for `Combine Contract` versus `Anti-Combine`. Both words
   * are gone: nothing in the game read the field they came from, so the maintainer deleted it. What
   * replaced them on the card is the leaning chips, and the rule now being asserted is that a chip
   * explains itself: it names the attributes the job reads, in the game's own window.
   */
  test('explains on hover which attributes a leaning wants', async ({ page }) => {
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

    /*
     * `A haul`, not `Quiet work`.
     *
     * Quiet work is authored on four templates and the board turns over daily, so a run on the
     * wrong day finds none of them and the test fails saying nothing about the hover. Every
     * standard job leans on a haul by default (`leaningsFor`), so there is always one to point at.
     */
    const leaning = MISSION_LEANING_LABELS.haul;
    const found = await walkBoards(page, async () => {
      const chip = page.getByText(leaning, { exact: true }).first();
      if ((await chip.count()) === 0) return false;
      await chip.scrollIntoViewIfNeeded();
      await chip.hover();
      const tip = page.getByRole('tooltip');
      await expect(tip).toContainText(MISSION_LEANING_REASONS.haul);
      // The attribute the leaning actually reads is named, not just described in the abstract.
      await expect(tip).toContainText(ATTRIBUTE_LABELS.logistics, { ignoreCase: true });
      return true;
    });
    if (!found) throw new Error('no job leaning on a haul on any board today');

    // And the words the stance badge used to put here are nowhere on the screen.
    await expect(page.getByText(/Anti-Combine|Combine Contract/)).toHaveCount(0);
  });
});

test.describe('the intel panel names who holds a district (§A3)', () => {
  const seat = CITY_DISTRICTS.find(isSeatOfGovernmentPower);
  const outpost = CITY_DISTRICTS.find(
    (d) => d.allegiance === 'government' && !isSeatOfGovernmentPower(d),
  );
  const street = CITY_DISTRICTS.find(
    (d) => d.kind === 'contested' && d.allegiance !== 'government' && d.id !== 'chrome-row',
  );
  if (!seat || !outpost || !street)
    throw new Error('fixture error: city map is missing an allegiance case');

  /**
   * Walks into a district the way a player does: one click on its tag on the city painting.
   *
   * The §A3 readouts these tests are about used to be in an intel panel floating on the Pixi map.
   * The city is a painting now and the panel went with the map, so the badge and the garrison line
   * are read on the district's own screen, which is the one screen that is about this district.
   */
  async function select(page: Page, id: string): Promise<void> {
    await expect(page.getByTestId('city-room')).toBeVisible();
    await page.getByTestId(`district-tag-${id}`).click();
  }

  for (const { name, width, height } of WIDTHS) {
    test(`fits the Combine badge and holding line at ${name}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await installApi(page, me);
      await page.goto('/game');
      await select(page, seat.id);

      await expect(page.getByRole('heading', { name: seat.name, exact: true })).toBeVisible();
      // §A3: a seat of the Combine's power says so, and names what is standing on it. The seat is
      // a painting now (2026-09-15), so the badge is in the strip and the garrison is behind the
      // same toggle the outpost test opens.
      await expect(page.getByText('Seat of power')).toBeInViewport();
      await showGarrison(page);
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

    await select(page, outpost.id);
    await showGarrison(page);
    await expect(page.getByText(new RegExp(garrisonOf(outpost)))).toBeInViewport();
    // An outpost is Combine ground but not a seat of its power: the two must read apart.
    await expect(page.getByText('Seat of power')).toHaveCount(0);

    await page.goBack();
    await select(page, street.id);
    await showGarrison(page);
    await expect(page.getByRole('heading', { name: street.name, exact: true })).toBeVisible();
    await expect(page.getByText(new RegExp(garrisonOf(street)))).toBeInViewport();
    await expect(page.getByText('Seat of power')).toHaveCount(0);
  });
});
