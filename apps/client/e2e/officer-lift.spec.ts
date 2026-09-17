import { expect, test } from '@playwright/test';
import { installApi } from './harness';
import { lateGame } from './fixtures';

/**
 * §B7: the officer window shows what the crew actually fields, and says whose it is.
 *
 * Taken as a picture as well as an assertion, because the whole of this change is visual: a bar
 * that runs past the person's own figure, a hairline where they end, and a hover that names the
 * teacher. A DOM assertion cannot see a seam drawn at the wrong end of the track.
 */
test('an officer card draws the lift and names where it came from', async ({ page }, info) => {
  await installApi(page, lateGame);
  await page.goto('/game/crew');
  await page.getByTestId('crew-books').waitFor();

  // Open the one the fixture lifts. The window is the roomy sheet, which is the one with bars.
  await page.locator('[data-testid^="seat-"]').filter({ hasText: 'The Ghost' }).first().click();
  const sheet = page.getByTestId('attribute-sheet');
  await expect(sheet).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const row = sheet.getByTestId('attr-leadership');
  await expect(row).toBeVisible();
  // The fixture's officer is taught three points of leadership by another officer.
  await expect(row).toHaveAttribute('data-lifted', '3');
  await expect(row).toHaveAttribute('data-tip', /32 base, \+3 from /);

  const mark = row.locator('[data-testid="attr-base-mark-leadership"]');
  await expect(mark).toBeVisible();

  // The seam sits inside the bar it marks, which is the half a class name could get wrong.
  const track = await mark.evaluate((node) => {
    const parent = node.parentElement;
    if (!parent) return null;
    const own = node.getBoundingClientRect();
    const box = parent.getBoundingClientRect();
    return { left: own.left, right: own.right, boxLeft: box.left, boxRight: box.right };
  });
  expect(track).not.toBeNull();
  if (track) {
    expect(track.left).toBeGreaterThanOrEqual(track.boxLeft - 1);
    expect(track.right).toBeLessThanOrEqual(track.boxRight + 1);
    // ...and not at either end: a mark flush against the edge is a mark nobody can read.
    expect(track.left - track.boxLeft).toBeGreaterThan(1);
    expect(track.boxRight - track.right).toBeGreaterThan(1);
  }

  await page.screenshot({ path: `e2e-out/officer-lift-${info.project.name}.png` });
});
