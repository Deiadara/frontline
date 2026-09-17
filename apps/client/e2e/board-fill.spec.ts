import { expect, test } from '@playwright/test';
import { me, missionsResponse } from './fixtures';
import { installApi } from './harness';

/**
 * The board finishes on the same line as the column beside it (maintainer, 2026-09-16).
 *
 * The cards used to be sized by their own content and stopped wherever that ran out, leaving a
 * band of empty sheet between the last card and the bottom of "Recently returned" next to it. The
 * two columns are one row of the page and they have to end together, at every width the board is
 * drawn side by side.
 *
 * Measured against the panel rather than the viewport: the page is a document scroller and the
 * fold is not the thing under test. What is under test is that the two columns agree.
 */
test.describe('the mission board fills its column', () => {
  for (const [tag, width] of [
    ['1440', 1440],
    ['1600', 1600],
    ['1920', 1920],
  ] as const) {
    test(`ends level with the crews beside it at ${tag}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await installApi(page, me);
      await page.route('**/api/missions', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(missionsResponse()),
        }),
      );
      await page.goto('/game/missions');
      await page.waitForSelector('[data-testid="mission-board"]');
      // Fonts first: a board measured before they land is measured against fallback metrics.
      await page.evaluate(() => document.fonts.ready);

      const board = await page.locator('[data-testid="mission-board"]').boundingBox();
      /*
       * The panel by its own name, rather than by walking up from its heading to `div.painted`.
       *
       * The left rail is drawn on the feats board's paper now (maintainer, 2026-09-17), so the
       * `painted` class the walk used to land on is not on it any more and the walk would have
       * found whichever ancestor still carried it. Same box, named directly.
       */
      const returned = await page.locator('[data-testid="crews-returned-panel"]').boundingBox();

      expect(board, 'the board did not render').not.toBeNull();
      expect(returned, 'the returned panel did not render').not.toBeNull();
      // One pixel of tolerance for subpixel layout, and no more: this is two boxes on one row.
      expect(
        Math.abs(board!.y + board!.height - (returned!.y + returned!.height)),
      ).toBeLessThanOrEqual(1);

      // And the cards grew into it rather than the panel growing around a short stack of them.
      const card = await page.locator('[data-testid^="offer-"]').first().boundingBox();
      expect(card!.height, 'the cards did not stretch into the board').toBeGreaterThan(
        board!.height * 0.7,
      );
    });
  }
});
