/**
 * The Bid button on a recruit's card, and the terms written on it (maintainer, 2026-09-28).
 *
 * The recruit's demands used to be a block of lines under the auction box, which made the card as
 * tall as its longest set of demands. They are on the button now: a crew that clears every door
 * gets a live Bid whose hover says what the recruit asks and that the crew passes, and one that
 * does not gets the same button locked, with the note ruled in red naming the door that is shut.
 * The auction box ends level with the bottom of the attribute sheet beside it, and Bid sits under
 * both.
 */
import { expect, test, type Page } from '@playwright/test';
import { adminGame, bar } from './fixtures';
import { installApi, settleFonts } from './harness';

/** Somebody who will sit down with anybody, and somebody who wants a name first. */
const OPEN = 'bar-1';
const SHUT = 'bar-3';

async function openCard(
  page: Page,
  recruitId: string,
  // After the harness's own routes, which Playwright would otherwise match first.
  overrides?: (page: Page) => Promise<void>,
): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installApi(page, adminGame);
  await overrides?.(page);
  await page.goto('/game/bar');
  await settleFonts(page);
  await page.getByTestId('sit-down').click();
  await expect(page.getByTestId('bar-file')).toBeVisible();
  const card = page.getByTestId(`recruit-${recruitId}`);
  for (let step = 0; step < bar.recruits.length; step += 1) {
    if ((await card.count()) > 0) return;
    if (await page.getByTestId('seat-on').isDisabled()) break;
    await page.getByTestId('seat-on').click();
  }
  throw new Error(`${recruitId} is not at the bar tonight`);
}

test('a crew that clears the door gets a live Bid, and the note says it passes', async ({
  page,
}) => {
  await openCard(page, OPEN);
  const bid = page.getByTestId(`bid-${OPEN}`);
  await expect(bid).not.toHaveAttribute('aria-disabled', 'true');
  await bid.hover();
  const note = page.getByRole('tooltip');
  await expect(note).toContainText('You pass');
  await expect(note).toContainText(/Will sit down with/i);
  // Ruled in the ordinary ink, not the red one.
  await expect(note).not.toHaveClass(/scrap-danger/);

  await bid.click();
  await expect(page.getByTestId('auction-window')).toBeVisible();
});

test('a crew that does not gets the Bid locked, and the red note says which door', async ({
  page,
}) => {
  await openCard(page, SHUT);
  const bid = page.getByTestId(`bid-${SHUT}`);
  await expect(bid).toHaveAttribute('aria-disabled', 'true');
  await bid.hover();
  const note = page.getByRole('tooltip');
  await expect(note).toContainText('Your name is not big enough');
  await expect(note).toContainText(/the street calls .+ or higher/i);
  await expect(note).not.toContainText('You pass');
  await expect(note).toHaveClass(/scrap-danger/);
  // No level door anywhere any more.
  await expect(note).not.toContainText(/level/i);

  // A press on a locked door opens nothing.
  await bid.click({ force: true });
  await expect(page.getByTestId('auction-window')).toHaveCount(0);
  // And the terms are no longer printed on the card itself.
  await expect(page.getByTestId(`recruit-${SHUT}`)).not.toContainText(/Will sit down with/i);
});

/**
 * A shut door keeps a crew from bidding, not from reading how the table ended (bug pass,
 * 2026-09-28): once the table has closed, See the table opens for everybody.
 */
test('a locked crew can still see how a closed table ended', async ({ page }) => {
  const closedAt = new Date(Date.parse(bar.serverNow) - 3_600_000).toISOString();
  await openCard(page, SHUT, async (page) => {
    // By path, so a `?city=` on the read still lands here.
    await page.route(
      (url) => url.pathname.endsWith('/api/bar'),
      async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const body = structuredClone(bar);
        for (const auction of body.auctions) {
          if (auction.recruitId !== SHUT) continue;
          auction.sealedFrom = closedAt;
          auction.closesAt = closedAt;
        }
        return route.fulfill({ json: body });
      },
    );
  });
  const bid = page.getByTestId(`bid-${SHUT}`);
  await expect(bid).toContainText('See the table');
  await expect(bid).not.toHaveAttribute('aria-disabled', 'true');
  await bid.click();
  await expect(page.getByTestId('auction-window')).toBeVisible();
});

test('the auction box ends level with the attribute sheet, and Bid sits under it', async ({
  page,
}) => {
  await openCard(page, OPEN);
  const card = page.getByTestId(`recruit-${OPEN}`);
  const edges = await card.evaluate((element) => {
    const box = element.querySelector('[data-testid^="auction-"]')?.firstElementChild;
    const sheet = element.querySelector('[data-testid="attribute-sheet"]');
    const bid = element.querySelector('[data-testid^="bid-"]');
    if (!box || !sheet || !bid) return null;
    return {
      box: box.getBoundingClientRect().bottom,
      sheet: sheet.getBoundingClientRect().bottom,
      bidTop: bid.getBoundingClientRect().top,
      bidHeight: bid.getBoundingClientRect().height,
    };
  });
  expect(edges, 'the card is missing its box, its sheet or its button').not.toBeNull();
  expect(
    Math.abs(edges!.box - edges!.sheet),
    'the box and the sheet end apart',
  ).toBeLessThanOrEqual(2);
  expect(edges!.bidTop, 'Bid is not under the box').toBeGreaterThan(edges!.box);
  expect(edges!.bidHeight, 'Bid is taller than the slimmer button').toBeLessThanOrEqual(40);
});
