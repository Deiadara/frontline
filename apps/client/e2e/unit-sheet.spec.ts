import { expect, test } from '@playwright/test';
import { ENV_LABEL_CATALOG, UNIT_MODIFIERS, findUnit } from '@frontline/shared';
import { lateGame } from './fixtures';
import { installApi, settleFonts } from './harness';

/**
 * The card a unit chip opens (`features/units/UnitWindow.tsx`).
 *
 * The unit tests pin what the card says. What only a browser can answer is whether a player can
 * read it: the hover is portalled and positioned in viewport coordinates, so the two ways it fails
 * are being cut off by the frame and being laid across the chip it was opened from. Both happened
 * before this spec, and neither is visible to a green unit suite.
 *
 * Since 2026-09-20 the card is the **roster's own** rather than a narrow sheet of its own, which
 * makes the geometry the sharper half of this file: the window is 45rem wide against the 26rem
 * the sheet used to take, so at 1024 it is most of the screen and there is far less room for
 * `HoverCard` to place it in.
 *
 * Two viewports because the failure is a function of height: the card is taller than the room
 * under a chip halfway down a 768px screen, which is where `HoverCard` has to place it sideways.
 */
const SIZES = [
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

for (const size of SIZES) {
  test(`a unit chip opens a readable card at ${size.width}x${size.height}`, async ({ page }) => {
    await page.setViewportSize(size);
    await installApi(page, lateGame);
    await page.goto('/game/actions');
    await expect(page.getByTestId('movements')).toBeVisible();
    await settleFonts(page);

    const sheet = findUnit('snipers')!;
    const chip = page.getByTestId('walking-snipers');
    await chip.scrollIntoViewIfNeeded();
    await chip.hover();

    const card = page.locator('[role="tooltip"]').filter({ hasText: sheet.name });
    await expect(card).toBeVisible();
    await expect(card).toContainText(UNIT_MODIFIERS[sheet.modifiers[0]!].label);

    /*
     * The ground this unit cares about, by name.
     *
     * The rate moved when the template did: on the roster's card a characteristic is a chip and
     * its `+7% per tier` is on the chip's own hover, which is where the roster has always kept
     * it. What has to be on the face of the card is *which* labels matter, because that is the
     * reason a player opens it: to learn which weather to pick a fight in.
     */
    const marks = card.getByTestId('marks-snipers');
    await expect(marks).toContainText(ENV_LABEL_CATALOG.elevated.name, { ignoreCase: true });
    await expect(marks).toContainText(ENV_LABEL_CATALOG.foggy.name, { ignoreCase: true });

    // Whole, and not on top of the chip that opened it.
    const box = (await card.boundingBox())!;
    const at = (await chip.boundingBox())!;
    expect(box.x, 'inside the left edge').toBeGreaterThanOrEqual(0);
    expect(box.y, 'inside the top edge').toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, 'inside the right edge').toBeLessThanOrEqual(size.width);
    expect(box.y + box.height, 'inside the bottom edge').toBeLessThanOrEqual(size.height);
    const overlaps =
      box.x < at.x + at.width &&
      box.x + box.width > at.x &&
      box.y < at.y + at.height &&
      box.y + box.height > at.y;
    expect(overlaps, 'the card must not cover the chip it describes').toBe(false);

    /*
     * And the press, which is what the hover cannot do.
     *
     * A hover card is portalled `pointer-events-none`, so the chips on it are words nothing can
     * reach. The window is the same card somewhere a pointer can go, with a cross to leave by and
     * the page behind it untouched: "so it doesn't change page, it's a pop up".
     */
    const before = page.url();
    await chip.click();
    const window_ = page.getByTestId('unit-window');
    await expect(window_).toBeVisible();
    await expect(window_.getByTestId('unit-snipers')).toBeVisible();
    expect(page.url(), 'opening a card navigated away').toBe(before);

    /*
     * And **one** card, not two (maintainer, 2026-09-20).
     *
     * The pointer is still on the chip, so the hover that opened this window never had a leave to
     * close it, and a hover portal is `z-[200]` against the dialog's `z-[100]`: the card drew
     * itself over the window it had just opened. Measured here before the fix, 720x230 of a
     * 960x392 dialog at 1280x720, and the same at every width. `Modal` now says when a window goes
     * up and `HoverCard` puts its card away, in a layout effect so that it happens in the frame
     * the window appears in rather than a paint later.
     */
    expect(
      await page.locator('[role="tooltip"]').count(),
      'a card is stranded over the window',
    ).toBe(0);

    /*
     * The card fills the window it is in.
     *
     * `UnitCard` caps at 52rem below 1440, so a `broad` (60rem) window left a 112px column of
     * empty plate down its right-hand side at 1024 and at 1280 and was only square at 1440 and up.
     * Asserted as symmetry rather than as a number, since what is wrong with it is that the card
     * sits at one end of a box sized for something else.
     */
    const frame = (await window_.boundingBox())!;
    const drawn = (await window_.getByTestId('unit-snipers').boundingBox())!;
    const left = drawn.x - frame.x;
    const right = frame.x + frame.width - (drawn.x + drawn.width);
    expect(Math.abs(left - right), 'the card is not centred in its window').toBeLessThanOrEqual(1);
    expect(right, 'the window is wider than the card it holds').toBeLessThanOrEqual(24);

    const tag = window_.getByTestId('marks-snipers').getByRole('button').first();
    await tag.hover();
    // ...and a card whose trigger is *inside* the window still opens, which is the whole reason
    // the window exists. One rule, not "no cards while a dialog is open".
    await expect(page.getByRole('tooltip')).toBeVisible();

    await window_.getByTestId('modal-close').click();
    await expect(window_).toHaveCount(0);
    expect(page.url(), 'closing a card navigated away').toBe(before);
  });
}

/**
 * The same window, opened without a mouse.
 *
 * The keyboard path is the one where nothing ever closes a stranded card by accident: a pointer
 * eventually moves and fires the leave, whereas focus stays on the trigger until something takes
 * it away, so the card sat over the window for as long as the window was open.
 */
test('a unit window opens and closes from the keyboard with one card on screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await installApi(page, lateGame);
  await page.goto('/game/actions');
  await expect(page.getByTestId('movements')).toBeVisible();
  await settleFonts(page);

  const chip = page.getByTestId('walking-snipers');
  await chip.scrollIntoViewIfNeeded();
  await chip.evaluate((el) => (el.closest('button') as HTMLButtonElement).focus());
  // Focus alone opens the card: a tooltip a keyboard cannot reach is one half its readers never
  // see, and it is also what makes the assertion after the press mean something.
  await expect(page.locator('[role="tooltip"]')).toBeVisible();

  await page.keyboard.press('Enter');
  const window_ = page.getByTestId('unit-window');
  await expect(window_).toBeVisible();
  expect(await page.locator('[role="tooltip"]').count(), 'a card is stranded over the window').toBe(
    0,
  );

  await page.keyboard.press('Escape');
  await expect(window_).toHaveCount(0);
});
