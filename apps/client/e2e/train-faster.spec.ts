import { expect, test, type Page } from '@playwright/test';
import { lateGame } from './fixtures';
import { expectNothingClippedVertically, installApi, settleFonts } from './harness';

/**
 * The Train Faster note on the Training tab (maintainer, 2026-10-01).
 *
 * "An info box on the top right that says Train Faster that is hand drawn and when you hover over
 * it it says: Speed, Resolve and Organization all reduce the time it takes for an officer to
 * train." It rides the quotation's line, the one row with room to its right, and the rule for a
 * box added to a working screen is that nothing else on it moves. So each viewport is measured
 * twice: as drawn, and with the note taken out and the line put back the way it was before the
 * note existed. Every other box on the sheet has to land on the same pixel both times.
 */

const SENTENCE =
  'Speed, Resolve and Organization all reduce the time it takes for an officer to train.';

const SIZES = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

interface Layout {
  note: { left: number; right: number; top: number; bottom: number } | null;
  quote: { left: number; right: number; top: number; bottom: number };
  /** The content box of the sheet the note should be pinned to the right edge of. */
  contentRight: number;
  /** Every box under the quotation that has to stay put. */
  below: Record<string, { x: number; y: number; width: number; height: number }>;
}

function measure(page: Page): Promise<Layout> {
  return page.evaluate(() => {
    const rect = (el: Element) => {
      const box = el.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    };
    const quote = document.querySelector('[data-testid="page-sheet"] figure');
    if (!quote) throw new Error('the quotation is not on the page');
    const body = quote.closest('.px-5');
    if (!body) throw new Error('the sheet body is not on the page');
    const padding = parseFloat(getComputedStyle(body).paddingRight);
    const note = document.querySelector('[data-testid="info-note"]');
    const below: Layout['below'] = {};
    for (const id of [
      'training-floor-line',
      'training-subjects',
      'training-sheet',
      'training-fold',
    ]) {
      const el = document.querySelector(`[data-testid="${id}"]`);
      if (!el) continue;
      const box = el.getBoundingClientRect();
      below[id] = { x: box.x, y: box.y, width: box.width, height: box.height };
    }
    return {
      note: note ? rect(note) : null,
      quote: rect(quote),
      contentRight: body.getBoundingClientRect().right - padding,
      below,
    };
  });
}

/** Takes the note out and puts the quotation's line back to the plain span it was. */
async function withoutTheNote(page: Page): Promise<void> {
  await page.evaluate(() => {
    const quote = document.querySelector('[data-testid="page-sheet"] figure');
    const line = quote?.parentElement;
    if (!quote || !line) throw new Error('the quotation is not on the page');
    for (const child of [...line.children]) if (child !== quote) child.remove();
    // Before the note the line had no action, so PageShell drew it as a bare `shrink-0` span.
    line.className = 'shrink-0';
  });
}

test('the Train Faster note sits top right, says the sentence, and moves nothing', async ({
  page,
}) => {
  for (const size of SIZES) {
    await page.setViewportSize(size);
    await installApi(page, lateGame);
    await page.goto('/game/training');
    await expect(page.getByTestId('training-sheet')).toBeVisible();
    await settleFonts(page);

    const note = page.getByTestId('info-note');
    await expect(note).toHaveText('Train Faster');
    const drawn = await measure(page);
    const box = drawn.note!;

    // Top right: on the quotation's line, against the right edge of the sheet's content.
    expect(
      Math.abs(box.right - drawn.contentRight),
      `${size.width}: not on the right edge`,
    ).toBeLessThan(1);
    expect(box.top, `${size.width}: above the quotation's line`).toBeGreaterThanOrEqual(
      drawn.quote.top - 0.5,
    );
    expect(box.bottom, `${size.width}: below the quotation's line`).toBeLessThanOrEqual(
      drawn.quote.bottom + 0.5,
    );
    // ...and clear of the quotation itself.
    expect(box.left, `${size.width}: over the quotation`).toBeGreaterThanOrEqual(drawn.quote.right);

    await page.screenshot({
      path: `${process.env.TRAIN_FASTER_SHOTS ?? 'test-results'}/training-${size.width}.png`,
    });

    await note.hover();
    const card = page.getByRole('tooltip').first();
    await expect(card).toContainText(SENTENCE);
    if (size.width === 1440) {
      await page.screenshot({
        path: `${process.env.TRAIN_FASTER_SHOTS ?? 'test-results'}/training-hover-${size.width}.png`,
      });
    }
    await page.mouse.move(0, 0);
    await expect(card).toBeHidden();

    await withoutTheNote(page);
    const plain = await measure(page);
    expect(plain.note).toBeNull();
    expect(
      Object.keys(plain.below).length,
      'the sweep found nothing to hold still',
    ).toBeGreaterThan(2);
    expect(drawn.below, `${size.width}: the note moved something`).toEqual(plain.below);
    expect(drawn.quote.top).toBe(plain.quote.top);
    expect(drawn.quote.bottom).toBe(plain.quote.bottom);
  }
});

/**
 * A spy skill's drill dialog (maintainer, 2026-10-01): Cryptography feeds no channel since the
 * Master of Whispers' grade became the officer side of spying, and guards the crew against spies
 * on every other officer, so the dialog says that where it printed the points the rating paid,
 * and the field row keeps its shape.
 */
test("a spy skill's drill dialog names what it guards and prints no figure", async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/training');
  await expect(page.getByTestId('training-sheet')).toBeVisible();
  await page.getByTestId('drill-cryptography').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await settleFonts(page);
  // The Overseer is the first subject: their own grade at the skill's tag, the lift it pays, and
  // the guard against spies anybody in the room gives (2026-10-04).
  await expect(dialog.getByTestId('drill-feeds-grade')).toHaveText(
    /^Your grade \(\w+\), and the lift it puts on every seated officer, and your guard against spies$/,
  );
  await expect(dialog.getByTestId('drill-feeds-grade')).toBeInViewport({ ratio: 1 });
  await expect(dialog).not.toContainText('from this rating');
  await expectNothingClippedVertically(page, '[role="dialog"]');
  await page.screenshot({ path: 'e2e-out/drill-cryptography.png' });
});
