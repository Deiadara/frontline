/**
 * The mission card's brief and haul, measured on the worst card the game can deal.
 *
 * Two things on the card sit inside fixed-height boxes that hide their overflow, so a spill is
 * invisible to the overflow sweep: nothing spills, the text is simply not drawn.
 *
 * - The difficulty stamp floats in the brief's bottom right corner and the brief runs round it
 *   (maintainer, 2026-09-28). A float that failed to reach the bottom, or a brief that wrapped a
 *   line deeper round it, would put the last words under the band's edge or under the stamp.
 * - The haul band holds every resource the game has. Whether a job pays a blueprint page is no
 *   longer on the card at all (§F1b, maintainer 2026-09-28), so the badge that used to share the
 *   band is checked absent here.
 */
import { MISSION_TEMPLATES, type MissionsResponse } from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import { lateGame, missionsResponse } from './fixtures';
import { installApi, settleFonts } from './harness';

/** The longest brief the catalogue deals, on every card, so each one is measured at its worst. */
async function fatBoard(page: Page): Promise<void> {
  const board = missionsResponse();
  // The whole catalogue's longest, not the fixture board's: the board deals a handful of jobs and
  // the longest of those is well short of the 154 characters the layout has to hold.
  const longest = MISSION_TEMPLATES.map((template) => template.brief).reduce((a, b) =>
    b.length > a.length ? b : a,
  );
  const fat: MissionsResponse = {
    ...board,
    areas: board.areas.map((area) => ({
      ...area,
      offers: area.offers.map((offer) => ({
        ...offer,
        brief: longest,
        rewards: {
          caps: 354,
          supplies: 354,
          oil: 260,
          scrap: 425,
          planks: 354,
          highQualityMetal: 47,
        },
      })),
    })),
  };
  await installApi(page, lateGame);
  await page.route('**/api/missions', async (route) => {
    await route.fulfill({ json: fat });
  });
  await page.goto('/game/missions');
  await expect(page.getByTestId('board-area')).toBeVisible();
  await settleFonts(page);
}

for (const viewport of [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`the stamp and the brief share the corner at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await fatBoard(page);

    const briefs = page.locator('[data-testid^="brief-"]');
    const count = await briefs.count();
    expect(count, 'no brief on the board, so nothing was measured').toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const reading = await briefs.nth(index).evaluate((brief) => {
        const band = brief.getBoundingClientRect();
        const stamp = brief.querySelector('[data-testid="difficulty-stamp"]');
        const text = brief.querySelector('p');
        if (!stamp || !text) return null;
        // The stamp as drawn, tilt and all: a corner the tilt swings out is still ink.
        const box = stamp.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(text);
        const glyphs = [...range.getClientRects()].filter((r) => r.width > 0);
        const under = glyphs.filter(
          (r) =>
            r.right > box.left + 2 &&
            r.left < box.right - 2 &&
            r.bottom > box.top + 2 &&
            r.top < box.bottom - 2,
        ).length;
        return {
          textCut: Math.round(Math.max(...glyphs.map((r) => r.bottom)) - band.bottom),
          stampOut: Math.round(
            Math.max(box.bottom - band.bottom, box.right - band.right, band.top - box.top),
          ),
          stampGap: Math.round(band.bottom - box.bottom),
          under,
        };
      });
      expect(reading, 'a brief without its stamp or its text').not.toBeNull();
      expect(reading!.textCut, 'the last line of the brief is cut off').toBeLessThanOrEqual(0);
      expect(reading!.under, 'brief text is drawn under the stamp').toBe(0);
      expect(reading!.stampOut, 'the stamp runs out of the brief').toBeLessThanOrEqual(3);
      // Pressed into the corner, not floating half way up the brief.
      expect(reading!.stampGap, 'the stamp is not at the bottom of the brief').toBeLessThanOrEqual(
        6,
      );
    }
  });
}

test('the full haul is not clipped and no card says whether it pays a page', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await fatBoard(page);

  await expect(page.locator('[data-testid^="page-prize-"]')).toHaveCount(0);
  const cards = page.locator('[data-testid^="offer-"]');
  const count = await cards.count();
  expect(count, 'no card on the board').toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    await expect(cards.nth(index)).not.toContainText(/blueprint/i);
    const cut = await cards.nth(index).evaluate((card) => {
      const chips = [...card.querySelectorAll('[data-testid="reward-line"] > *')];
      let worst = -Infinity;
      for (const chip of chips) {
        let clipper: Element | null = chip.parentElement;
        while (clipper && getComputedStyle(clipper).overflow === 'visible') {
          clipper = clipper.parentElement;
        }
        if (!clipper) continue;
        worst = Math.max(
          worst,
          chip.getBoundingClientRect().bottom - clipper.getBoundingClientRect().bottom,
        );
      }
      return chips.length === 0 ? null : Math.round(worst);
    });
    expect(cut, 'the haul drew no reward chips, so nothing was measured').not.toBeNull();
    expect(cut, 'a reward chip is cut off by the haul band').toBeLessThanOrEqual(0);
  }
});
