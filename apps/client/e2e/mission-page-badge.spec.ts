/**
 * §F1b: the page badge is a fourth line inside a fixed-height box.
 *
 * `MissionBoard`'s haul band is `h-28 overflow-hidden`, and the height is fixed on purpose: three
 * cards sit side by side and the deploy button under them has to land on the same line, which it
 * cannot do if one card's rewards push it down. The badge was added as a fourth line inside that
 * box without anybody checking what happens when the rewards above it already take two.
 *
 * `overflow-hidden` is what makes this invisible to every other gate. Nothing spills, so the
 * overflow sweep sees nothing; the text is simply not drawn. So this measures the badge's own
 * rectangle against the box that clips it, on the worst card the game can deal: every resource in
 * the haul and a page on top.
 */
import type { MissionsResponse } from '@frontline/shared';
import { expect, test } from '@playwright/test';
import { lateGame, missionsResponse } from './fixtures';
import { installApi, settleFonts } from './harness';

test.use({ viewport: { width: 1280, height: 800 } });

test('the page badge is not clipped by the haul band, even under a full haul', async ({ page }) => {
  await installApi(page, lateGame);

  const board = missionsResponse();
  const fat: MissionsResponse = {
    ...board,
    areas: board.areas.map((area) => ({
      ...area,
      offers: area.offers.map((offer) => ({
        ...offer,
        // Every resource the game has, so `RewardLine` wraps to its tallest, plus a page.
        rewards: {
          caps: 354,
          supplies: 354,
          oil: 260,
          scrap: 425,
          planks: 354,
          highQualityMetal: 47,
        },
        pagePrize: 'consumable' as const,
      })),
    })),
  };
  await page.route('**/api/missions', async (route) => {
    await route.fulfill({ json: fat });
  });

  await page.goto('/game/missions');
  await expect(page.getByTestId('board-area')).toBeVisible();
  await settleFonts(page);

  const badges = page.locator('[data-testid^="page-prize-"]');
  await expect(badges.first()).toBeAttached();
  const count = await badges.count();
  expect(count, 'no badge on the board, so nothing was measured').toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const clipped = await badges.nth(index).evaluate((badge) => {
      const box = badge.getBoundingClientRect();
      // The nearest ancestor that actually clips, which is the fixed-height haul band.
      let clipper: Element | null = badge.parentElement;
      while (clipper && getComputedStyle(clipper).overflow === 'visible') {
        clipper = clipper.parentElement;
      }
      if (!clipper) return null;
      const bounds = clipper.getBoundingClientRect();
      return {
        cut: Math.round(box.bottom - bounds.bottom),
        text: (badge.textContent ?? '').trim(),
      };
    });
    expect(
      clipped,
      'the badge has no clipping ancestor, so this test proves nothing',
    ).not.toBeNull();
    expect(clipped?.cut, `"${clipped?.text}" is cut off by ${clipped?.cut}px`).toBeLessThanOrEqual(
      0,
    );
  }
});
