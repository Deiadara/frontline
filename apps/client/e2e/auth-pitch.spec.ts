import { expect, test } from '@playwright/test';

/**
 * The landing pitch (maintainer, 2026-09-30): "make this white text be two lines, symmetrical and
 * lined up, and then the yellow underlined one being a third line with one line gap in between."
 *
 * Measured rather than eyeballed, at every width the pitch is shown at (it drops away below `lg`):
 * each white line is one line tall and none is clipped, both start and end at the same x, and the
 * brass line sits one blank line under them.
 */
const WIDTHS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

for (const viewport of WIDTHS) {
  test(`the pitch is two even lines and a call at ${viewport.width}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/auth');
    await page.evaluate(() => document.fonts.ready);
    const pitch = page.getByTestId('auth-pitch');
    await expect(pitch).toBeVisible();

    const measured = await pitch.evaluate((p) => {
      const lineHeight = parseFloat(getComputedStyle(p).lineHeight);
      const lines = [...p.querySelectorAll<HTMLElement>('[data-testid="auth-pitch-line"]')].map(
        (line) => {
          const box = line.getBoundingClientRect();
          // The text's own extent: a nowrap line that did not fit runs past its box.
          const range = document.createRange();
          range.selectNodeContents(line);
          const text = range.getBoundingClientRect();
          return {
            left: box.left,
            right: box.right,
            height: box.height,
            textLeft: text.left,
            textRight: text.right,
            bottom: box.bottom,
          };
        },
      );
      const call = p.querySelector<HTMLElement>('[data-testid="auth-pitch-call"]')!;
      const column = p.parentElement!.getBoundingClientRect();
      return {
        lineHeight,
        lines,
        call: call.getBoundingClientRect().toJSON() as DOMRect,
        column: { left: column.left, right: column.right },
      };
    });

    expect(measured.lines).toHaveLength(2);
    const [first, second] = measured.lines;
    if (!first || !second) throw new Error('two lines expected');
    for (const line of measured.lines) {
      // One line tall: two would be a wrap inside the line.
      expect(line.height).toBeLessThan(measured.lineHeight * 1.5);
      // The words fill the line edge to edge (justified) and do not run past it.
      expect(Math.abs(line.textLeft - line.left)).toBeLessThanOrEqual(1);
      expect(Math.abs(line.textRight - line.right)).toBeLessThanOrEqual(1);
      // ...and the line is inside the pitch's own column.
      expect(line.left).toBeGreaterThanOrEqual(measured.column.left - 0.5);
      expect(line.right).toBeLessThanOrEqual(measured.column.right + 0.5);
    }
    // Symmetrical: both lines start and end together.
    expect(Math.abs(first.left - second.left)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(first.right - second.right)).toBeLessThanOrEqual(0.5);
    // The call is its own line, one blank line below the second.
    const gap = measured.call.top - second.bottom;
    expect(gap).toBeGreaterThan(measured.lineHeight * 0.8);
    expect(gap).toBeLessThan(measured.lineHeight * 1.3);
    expect(measured.call.left).toBeCloseTo(first.left, 0);

    // The last promise wears the Combine's emblem, the winged cross (maintainer, 2026-09-30): a
    // round head and two rosettes, where the spire it replaced had no circle in it at all.
    const promise = page.locator('li', { hasText: 'Defeat the Combine' });
    await expect(promise.locator('svg circle')).toHaveCount(3);

    await page.screenshot({ path: `screenshots/auth-pitch/${viewport.width}.png` });
  });
}
