import { expect, test, type Page } from '@playwright/test';
import { lateGame, market } from './fixtures';
import { expectNothingOverflowsTheScreen, installApi, settleFonts } from './harness';

/**
 * Bidding at the barrow (market extension, maintainer 2026-09-08).
 *
 * Every line the Runner carries is a lot, and the lot's screen is where a crew says a number.
 * These walk the four lots the fixture draws: one somebody else leads, one we lead, one nobody
 * has touched, and one the city has cleared.
 */

/** The lot the Combine leads and we are losing: the open controls, live. */
const OUTBID = 'l1';
/** The lot we lead: nothing to do but watch. */
const LEADING = 'l2';
/** A lot nobody has opened. */
const UNTOUCHED = 'l3';
/** A line with nothing left on it: no lot at all. */
const GONE = 'l4';

const lotFor = (lineId: string) => {
  const lot = market.vendor.stock.find((offer) => offer.line.id === lineId)?.auction;
  if (!lot) throw new Error(`the fixture has no lot on ${lineId}`);
  return lot;
};

async function openMarket(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installApi(page, lateGame);
  await page.goto('/game/market');
  await expect(page.getByTestId('vendor-stock')).toBeVisible();
  await settleFonts(page);
}

async function openLot(page: Page, lineId: string): Promise<void> {
  await openMarket(page);
  await page.getByTestId(`bid-${lineId}`).click();
  await expect(page.getByTestId('lot-window')).toBeVisible();
}

test.describe('the barrow is an auction', () => {
  test('the market fits its frame, with the hours on the tab row and no buy button anywhere', async ({
    page,
  }) => {
    await openMarket(page);
    // The quote the maintainer asked for, and the hours where the doors are.
    await expect(page.getByTestId('page-sheet')).toContainText('Nobody owns the market');
    await expect(page.getByTestId('info-note')).toContainText('The Runner: in');
    await expect(page.getByRole('button', { name: /^Buy$/ })).toHaveCount(0);
    // The four states a lot can be in, read off the cards.
    await expect(page.getByTestId(`bid-${OUTBID}`)).toHaveText('Raise');
    await expect(page.getByTestId(`bid-${LEADING}`)).toHaveText('Your table');
    await expect(page.getByTestId(`bid-${UNTOUCHED}`)).toHaveText('Bid');
    await expect(page.getByTestId(`bid-${GONE}`)).toBeDisabled();
    await expectNothingOverflowsTheScreen(page);
  });

  test('opens on the next legal number, and taking it puts the reader in front', async ({
    page,
  }) => {
    await openLot(page, OUTBID);
    const lot = lotFor(OUTBID);

    // Prefilled with the smallest bid that can win: the number a player presses on nine times in
    // ten, and it has to clear the step or the button always fails.
    await expect(page.getByTestId('lot-amount')).toHaveValue(String(lot.nextBid));
    await expect(page.getByTestId('lot-standing')).toContainText('You have been outbid');

    await page.getByTestId('lot-place').click();

    await expect(page.getByTestId('lot-standing')).toContainText('You are leading');
    await expect(page.getByTestId('lot-leading')).toHaveText(lot.nextBid.toLocaleString());
    const newest = page.getByTestId('lot-history').locator('li').first();
    await expect(newest).toContainText('You');
    await expect(newest).toContainText(lot.nextBid.toLocaleString());
    // ...and the card behind the window says so too.
    await expect(page.getByTestId(`bid-${OUTBID}`)).toHaveText('Your table');
  });

  // Guarded before the press (maintainer, 2026-10-06): Place bid greys, and its hover says why.
  test('an under-bid is greyed before it is sent, with the reason on hover', async ({ page }) => {
    await openLot(page, OUTBID);
    const lot = lotFor(OUTBID);
    const leader = lot.leading?.amount ?? 0;
    expect(leader, 'the fixture lot must already have a leader').toBeGreaterThan(0);

    await page.getByTestId('lot-amount').fill(String(lot.reserve));
    const place = page.getByTestId('lot-place');
    await expect(place).toBeDisabled();
    await expect(place).toHaveAttribute('data-tip', new RegExp(leader.toLocaleString('en-US')));
    await expect(place).toHaveAttribute(
      'data-tip',
      new RegExp(lot.nextBid.toLocaleString('en-US')),
    );
    await expect(page.getByTestId('lot-standing')).toContainText('You have been outbid');
  });

  test('a lot the reader leads has nothing to press', async ({ page }) => {
    await openLot(page, LEADING);
    await expect(page.getByTestId('lot-standing')).toContainText('You are leading');
    await expect(page.getByTestId('lot-place')).toBeDisabled();
    await expect(page.getByTestId('lot-refusal')).toContainText('already leading');
  });

  /*
   * §H7a: the fixture's crew has money on two lots already (the one it leads and the one it was
   * outbid on), which is `MAX_OPEN_LOTS`. This test used to place a first bid here, which the real
   * Runner refuses with `too_many_lots`; the window now says so before the press.
   */
  test('an untouched lot opens at its price, and is shut to a crew already on two', async ({
    page,
  }) => {
    await openLot(page, UNTOUCHED);
    const lot = lotFor(UNTOUCHED);
    await expect(page.getByTestId('lot-standing')).toContainText('Nobody has bid');
    await expect(page.getByTestId('lot-leading')).toHaveText(lot.reserve.toLocaleString());
    await expect(page.getByTestId('lot-amount')).toHaveValue(String(lot.reserve));
    await expect(page.getByTestId('lot-place')).toBeDisabled();
    await expect(page.getByTestId('lot-refusal')).toContainText('every lot you can hold');
    await expectNothingOverflowsTheScreen(page);
  });
});

/**
 * Every plate on the barrow keeps its price and its door whole, at every frame (bug pass,
 * 2026-09-29).
 *
 * Two failures, one on each board. On the one-row board a plate is about 80px inside, and the
 * fixture's leading lot is "Sniper Blueprint: Barrel Liners", whose name took two lines and whose
 * door said "Your table" on two more: the plate's column gave the difference out of the price tag,
 * which drew as a 4px sliver under the name at 1280x720. On the three by two board, chosen by the
 * window's height, a row at 1280x900 and 1440x900 was 133px against the 155 a plate needs, and
 * every door hung off its plate onto the one below. Nothing overflowed the screen in either, so no
 * overflow gate saw them. What is measured is that each tag and each door is at least as tall as
 * the words in it, sits wholly inside its plate, and that the door's word stays on one line.
 */
for (const [width, height] of [
  [1100, 720],
  [1280, 720],
  [1440, 800],
  [1440, 900],
  [1100, 900],
  [1280, 900],
  [1920, 1080],
] as const) {
  test(`every lot shows its price and its door whole at ${width}x${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await installApi(page, lateGame);
    await page.goto('/game/market');
    await expect(page.getByTestId(`bid-${LEADING}`)).toHaveText(/your table/i);
    await settleFonts(page);

    const faults = await page.evaluate(() => {
      const bad: string[] = [];
      for (const plate of document.querySelectorAll<HTMLElement>('[data-testid^="vendor-line-"]')) {
        const lot = plate.dataset.testid!.replace('vendor-line-', '');
        const box = plate.getBoundingClientRect();
        for (const part of [
          plate.querySelector<HTMLElement>(`[data-testid="lot-tag-${lot}"]`),
          plate.querySelector<HTMLElement>(`[data-testid="bid-${lot}"]`),
        ]) {
          if (!part) continue;
          const at = part.getBoundingClientRect();
          const name = `${part.dataset.testid}`;
          // Its own words are the floor: a squeezed tag was 4px tall around an 18px figure.
          const words = part.querySelector<HTMLElement>(':scope > span:last-child');
          const need = words?.getBoundingClientRect().height ?? 0;
          if (at.height + 1 < need) bad.push(`${name} squeezed to ${at.height}px of ${need}`);
          if (at.top < box.top - 1 || at.bottom > box.bottom + 1)
            bad.push(`${name} leaves its plate`);
        }
        const word = plate.querySelector<HTMLElement>(
          `[data-testid="bid-${lot}"] > span:last-child`,
        );
        if (word && word.getClientRects().length > 1) bad.push(`bid-${lot} wraps its word`);
        if (word && word.getBoundingClientRect().height > 16) bad.push(`bid-${lot} wraps its word`);
      }
      return bad;
    });
    expect(faults, 'a lot on the barrow is not drawn whole').toEqual([]);
    await page.screenshot({ path: `screenshots/runner-lots-${width}x${height}.png` });
  });
}
