import { expect, test, type Page } from '@playwright/test';
import { lateGame, market } from './fixtures';
import { expectNothingOverflowsTheScreen, installApi, settleFonts } from './harness';

/**
 * Bidding at the barrow (market extension, board 2026-09-08).
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
    // The quote the board asked for, and the hours where the doors are.
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

  test('an under-bid is warned about before it is sent and refused in words after', async ({
    page,
  }) => {
    await openLot(page, OUTBID);
    const lot = lotFor(OUTBID);
    const leader = lot.leading?.amount ?? 0;
    expect(leader, 'the fixture lot must already have a leader').toBeGreaterThan(0);

    await page.getByTestId('lot-amount').fill(String(lot.reserve));
    await expect(page.getByTestId('lot-under')).toContainText(leader.toLocaleString());
    await expect(page.getByTestId('lot-under')).toContainText(lot.nextBid.toLocaleString());

    await page.getByTestId('lot-place').click();
    await expect(page.getByRole('alert')).toContainText(`Somebody is at ${leader}`);
    await expect(page.getByTestId('lot-standing')).toContainText('You have been outbid');
  });

  test('a lot the reader leads has nothing to press', async ({ page }) => {
    await openLot(page, LEADING);
    await expect(page.getByTestId('lot-standing')).toContainText('You are leading');
    await expect(page.getByTestId('lot-place')).toBeDisabled();
    await expect(page.getByTestId('lot-refusal')).toContainText('already leading');
  });

  test('an untouched lot opens at its price and takes the first bid', async ({ page }) => {
    await openLot(page, UNTOUCHED);
    const lot = lotFor(UNTOUCHED);
    await expect(page.getByTestId('lot-standing')).toContainText('Nobody has bid');
    await expect(page.getByTestId('lot-leading')).toHaveText(lot.reserve.toLocaleString());
    await expect(page.getByTestId('lot-amount')).toHaveValue(String(lot.reserve));
    await page.getByTestId('lot-place').click();
    await expect(page.getByTestId('lot-standing')).toContainText('You are leading');
    await expect(page.getByTestId('lot-history').locator('li')).toHaveCount(1);
  });
});
