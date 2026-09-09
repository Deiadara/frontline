import { expect, test, type Page } from '@playwright/test';
import { lateGame } from './fixtures';
import { expectNothingOverflowsTheScreen, installApi, settleFonts } from './harness';

/**
 * The board, on its own page: what other crews are offering, and what this one has standing.
 *
 * The market fixture pins two public listings and one of ours, which is the state the page is for:
 * a half with somebody else's goods in it and a half with our own, so a card that reads the wrong
 * side of the trade shows up as a card in the wrong column rather than as a subtle badge.
 *
 * Every write is asserted on the request that leaves the browser rather than on what the screen
 * does afterwards. The harness answers every `/api/market` write with the same board, so a button
 * wired to the wrong offer, or to the wrong endpoint, would leave the screen looking exactly right.
 */

const VIEWPORTS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1024x768', width: 1024, height: 768 },
] as const;

async function openBoard(page: Page, width = 1280, height = 720): Promise<void> {
  await page.setViewportSize({ width, height });
  await installApi(page, lateGame);
  await page.goto('/game/market/offers');
  await expect(page.getByTestId('market-board')).toBeVisible();
  await settleFonts(page);
}

/**
 * Type an amount into one pile's stepper.
 *
 * Not `fill`: it empties the field first, and an empty field is a zero. A pile drops a material
 * the moment its count reaches zero, taking the stepper with it, so filling would leave the test
 * typing into an input that had already gone. Selecting what is there and typing over it never
 * passes through zero.
 */
async function setAmount(page: Page, testId: string, amount: number): Promise<void> {
  const field = page.getByTestId(testId);
  await field.click();
  await page.keyboard.press('ControlOrMeta+A');
  await field.pressSequentially(String(amount));
  await expect(field).toHaveValue(String(amount));
}

for (const { name, width, height } of VIEWPORTS) {
  test(`sets their listings against ours at ${name}`, async ({ page }) => {
    await openBoard(page, width, height);

    // The tab strip says which of the three rooms this is, and the page has no heading of its own.
    await expect(page.getByTestId('market-tab-offers')).toHaveAttribute('aria-current', 'page');

    const theirs = page.getByTestId('market-board').locator('> li');
    await expect(theirs).toHaveCount(2);
    await expect(page.getByTestId('offer-offer-1')).toContainText('The Kettle Row Combine');
    await expect(page.getByTestId('offer-offer-1')).toContainText('They hand over');
    await expect(page.getByTestId('offer-offer-2')).toContainText('Sisters of the Undergrid');

    const ours = page.getByTestId('my-offers').locator('> li');
    await expect(ours).toHaveCount(1);
    const mine = page.getByTestId('offer-offer-mine');
    await expect(mine).toContainText('Your listing');
    await expect(mine).toContainText('You hand over');
    // Our own card carries the one control the other half does not, and none of the two it does.
    await expect(mine.getByRole('button', { name: 'Withdraw' })).toBeVisible();
    await expect(mine.getByRole('button', { name: 'Accept' })).toHaveCount(0);

    /*
     * What is standing is on screen, and above the form for putting up another.
     *
     * The composer is 370px of empty pickers and it used to sit on top, which pushed the one
     * listing this panel's header counts off the bottom of a 1440x900 frame: the player was shown
     * a blank form where the answer to "has anybody taken it" should have been.
     */
    const composerBox = await page.getByTestId('offer-composer').boundingBox();
    const mineBox = await mine.boundingBox();
    expect(mineBox, 'our own listing has no box').not.toBeNull();
    expect(composerBox, 'the composer has no box').not.toBeNull();
    expect(mineBox!.y, 'the composer is above our own standing listing').toBeLessThan(
      composerBox!.y,
    );
    /*
     * On screen without scrolling, and only asserted where the two halves are side by side.
     * Stacked, at 1024x768, everything of ours sits under the whole of theirs by construction and
     * no ordering inside our own panel can change that.
     */
    const theirsBox = (await page.getByTestId('market-board').boundingBox())!;
    if (mineBox!.x > theirsBox.x + theirsBox.width - 1) {
      await expect(mine, 'our own standing listing starts below the fold').toBeInViewport();
    }

    await expectNothingOverflowsTheScreen(page);
  });
}

test('takes a listing as it stands', async ({ page }) => {
  await openBoard(page);

  const accepted = page.waitForRequest(
    (request) => request.url().includes('/api/market/accept') && request.method() === 'POST',
  );
  await page.getByTestId('offer-offer-1').getByRole('button', { name: 'Accept' }).click();
  expect((await accepted).postDataJSON()).toEqual({ offerId: 'offer-1' });
});

test('takes our own listing back off the board', async ({ page }) => {
  await openBoard(page);

  const withdrawn = page.waitForRequest(
    (request) => request.url().includes('/api/market/withdraw') && request.method() === 'POST',
  );
  await page.getByTestId('offer-offer-mine').getByRole('button', { name: 'Withdraw' }).click();
  expect((await withdrawn).postDataJSON()).toEqual({ offerId: 'offer-mine' });
});

test('posts the two piles it was built out of', async ({ page }) => {
  await openBoard(page);

  await page.getByTestId('offer-give-scrap').click();
  await setAmount(page, 'offer-give-amount-scrap', 500);
  await page.getByTestId('offer-want-oil').click();
  await setAmount(page, 'offer-want-amount-oil', 300);

  const posted = page.waitForRequest(
    (request) => request.url().endsWith('/api/market/offer') && request.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Post it' }).click();
  expect((await posted).postDataJSON()).toEqual({
    give: { resources: { scrap: 500 }, items: {} },
    want: { resources: { oil: 300 }, items: {} },
  });
});

/**
 * A counter is a listing that knows who it is aimed at, and says so.
 *
 * The composer is in the other half of the page from the card that was clicked, so the name on its
 * heading is the only thing tying the form to the listing it is answering. `counterTo` is the same
 * fact on the wire, and the two have to be the same offer.
 */
test('names the crew it is countering and sends the counter to that listing', async ({ page }) => {
  await openBoard(page);

  const composer = page.getByTestId('offer-composer');
  await expect(composer).toContainText('Put something up');

  await page.getByTestId('offer-offer-2').getByRole('button', { name: 'Counter' }).click();
  await expect(composer).toContainText('Countering Sisters of the Undergrid');

  await page.getByTestId('offer-give-caps').click();
  await setAmount(page, 'offer-give-amount-caps', 2500);
  await page.getByTestId('offer-want-scrap').click();
  await setAmount(page, 'offer-want-amount-scrap', 4000);

  const posted = page.waitForRequest(
    (request) => request.url().endsWith('/api/market/offer') && request.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Send the counter' }).click();
  expect((await posted).postDataJSON()).toEqual({
    give: { resources: { caps: 2500 }, items: {} },
    want: { resources: { scrap: 4000 }, items: {} },
    counterTo: 'offer-2',
  });

  // The form goes back to being a public listing once the counter is away, empty, so the next
  // press cannot escrow a second copy of the same pile against a listing that is already answered.
  await expect(composer).toContainText('Put something up');
  await expect(page.getByRole('button', { name: 'Post it' })).toBeDisabled();
});
