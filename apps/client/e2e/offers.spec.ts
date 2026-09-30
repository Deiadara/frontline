import { expect, test, type Page } from '@playwright/test';
import { lateGame, market } from './fixtures';
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
      // Goods waiting to be claimed come first (2026-09-28): they are the answer to "has anybody
      // taken it" now, and the one card on this half with a clock that costs.
      await expect(
        page.getByTestId('market-claim-claim-taken'),
        'the goods waiting start below the fold',
      ).toBeInViewport();
    }
    const claimBox = (await page.getByTestId('my-claims').boundingBox())!;
    expect(claimBox.y, 'the claims are under our standing listings').toBeLessThan(mineBox!.y);

    await expectNothingOverflowsTheScreen(page);
  });
}

/**
 * Each city has its own board (maintainer, 2026-09-29). Our listings stand in every city we hold
 * ground in and are all listed on our half, so Withdraw can reach one pinned elsewhere; that card
 * names its board. A listing goes up on the tab it was posted from.
 */
for (const { name, width, height } of VIEWPORTS) {
  test(`names the board a listing of ours in another city stands on at ${name}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await installApi(page, lateGame);
    await page.route('**/api/market', async (route) => {
      await route.fulfill({
        json: {
          ...market,
          cities: ['ashfall', 'terminus'],
          mine: [...market.mine, { ...market.mine[0]!, id: 'offer-terminus', cityId: 'terminus' }],
        },
      });
    });
    await page.goto('/game/market/offers');
    await expect(page.getByTestId('market-board')).toBeVisible();
    await settleFonts(page);

    await expect(page.getByTestId('offer-city-offer-terminus')).toHaveText('On the Terminus board');
    await expect(page.getByTestId('offer-city-offer-mine')).toHaveCount(0);
    await page.getByTestId('offer-offer-terminus').scrollIntoViewIfNeeded();
    await expectNothingOverflowsTheScreen(page);
    await page.screenshot({ path: `screenshots/offers-city-${name}.png`, fullPage: true });

    await page.getByTestId('offer-give-oil').click();
    await setAmount(page, 'offer-give-amount-oil', 400);
    await page.getByTestId('offer-want-scrap').click();
    await setAmount(page, 'offer-want-amount-scrap', 400);
    const posted = page.waitForRequest(
      (request) => request.url().includes('/api/market/offer') && request.method() === 'POST',
    );
    await page.getByRole('button', { name: 'Post it' }).click();
    expect((await posted).postDataJSON()).toMatchObject({ cityId: market.cityId });
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

/**
 * A taken listing waits with Claim where Withdraw was, and one nobody took says so with one pile
 * (maintainer, 2026-09-28).
 */
test('claims what the board is holding for us', async ({ page }) => {
  await openBoard(page, 1280, 900);

  const taken = page.getByTestId('market-claim-claim-taken');
  await expect(taken).toContainText('Taken by Sisters of the Undergrid');
  await expect(taken).toContainText('You handed over');
  await expect(taken).toContainText('You get');
  await expect(taken).toContainText(/Claim within 19h/);
  const expired = page.getByTestId('market-claim-claim-expired');
  await expect(expired).toContainText('Nobody took it');
  await expect(expired).toContainText('Back to you');
  await expect(expired).not.toContainText('You handed over');
  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'screenshots/market-claims.png', fullPage: false });

  const claimed = page.waitForRequest(
    (request) => request.url().includes('/api/market/claim') && request.method() === 'POST',
  );
  await taken.getByRole('button', { name: 'Claim' }).click();
  expect((await claimed).postDataJSON()).toEqual({ claimId: 'claim-taken' });
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
    // The board on screen (2026-09-29): a listing goes up in the city it was posted from.
    cityId: market.cityId,
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

/**
 * Parts go up for sale (maintainer request, 2026-09-14).
 *
 * The composer was materials-only. `TradeBundle` has always carried `items` and `offerRefusal` has
 * always checked them, so this is the screen catching up with the wire rather than a new mechanic.
 *
 * Three things are worth a browser here and none of them is the happy path. The menu must be
 * **solid**: it floats over the listing panel, and the panel treatments it inherited blend with
 * whatever is behind them, so the first cut was see-through. It must open **under its own door**:
 * the wrapper is a flex item that stretched to 241px, and `top-full` put the give menu down beside
 * the want row. And the parts actually chosen must reach the **request body**, which is the only
 * part of this a screenshot cannot show.
 */
test('puts parts into an offer, and sends them', async ({ page }) => {
  await installApi(page, lateGame);
  await page.route('**/api/market', async (route) => {
    await route.fulfill({
      json: { ...market, inventory: { scrap_servo: 6, ceramic_plate: 2 } },
    });
  });
  await page.goto('/game/market/offers');

  const door = page.getByTestId('offer-give-parts');
  await door.click();
  const menu = page.getByTestId('offer-give-parts-menu');
  await expect(menu).toBeVisible();

  // Only what is in the bin: six parts exist, this crew holds two kinds.
  await expect(menu.locator('[data-testid^="offer-give-parts-row-"]')).toHaveCount(2);

  // Solid, and directly under the door it belongs to. Both were real defects.
  const paint = await menu.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { blend: cs.mixBlendMode, bg: cs.backgroundColor };
  });
  expect(paint.blend).toBe('normal');
  expect(paint.bg).not.toBe('rgba(0, 0, 0, 0)');
  const doorBox = (await door.boundingBox())!;
  const menuBox = (await menu.boundingBox())!;
  expect(menuBox.y - (doorBox.y + doorBox.height)).toBeLessThan(20);

  await page.getByTestId('offer-give-parts-more-scrap_servo').click();
  await page.getByTestId('offer-give-parts-more-scrap_servo').click();
  await expect(page.getByTestId('offer-give-parts-taking-scrap_servo')).toHaveText('2');
  // Never past what the bin holds: the server would refuse it after escrowing the rest.
  await expect(page.getByTestId('offer-give-parts-more-ceramic_plate')).toBeEnabled();
  await page.getByTestId('offer-give-parts-more-ceramic_plate').click();
  await page.getByTestId('offer-give-parts-more-ceramic_plate').click();
  await expect(page.getByTestId('offer-give-parts-more-ceramic_plate')).toBeDisabled();

  // The count rides on the door, so a closed menu still says there is something in the offer.
  await page.getByTestId('offer-give-parts-done').click();
  await expect(menu).toBeHidden();
  await expect(page.getByTestId('offer-give-parts-count')).toHaveText('4');

  await page.getByTestId('offer-want-caps').click();
  const posted = page.waitForRequest(
    (request) => request.url().includes('/api/market/offer') && request.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Post it' }).click();
  // Typed rather than `any`: the assertion is about one field, and reading it off an untyped parse
  // is the thing that makes a green test meaningless if the shape ever moves.
  const body = JSON.parse((await posted).postData() ?? '{}') as {
    give?: { items?: Record<string, number> };
  };
  expect(body.give?.items).toEqual({ scrap_servo: 2, ceramic_plate: 2 });
});

/**
 * The parts menu opens where it can be read (bug pass, 2026-09-29).
 *
 * It opens downward, and at 1024x768 the composer's door is the last thing on the sheet: pressed
 * there, the menu went into the scroller's overflow and under the bottom bar, with only its
 * heading showing. Pressing the door has to bring the whole menu into the sheet's view, and the
 * hit test is what says the bar is not lying over any of it.
 */
test('the parts menu is brought into view when it opens at the foot of the sheet', async ({
  page,
}) => {
  await openBoard(page, 1024, 768);
  const door = page.getByTestId('offer-give-parts');
  // Parked on the fold, the way a player scrolling down to the form finds it.
  await door.evaluate((el) => el.scrollIntoView({ block: 'end' }));
  await door.click();
  const menu = page.getByTestId('offer-give-parts-menu');
  // 0.99 rather than 1: the drawn frame sits a subpixel past the sheet's edge at rest.
  await expect(menu).toBeInViewport({ ratio: 0.99 });
  const covered = await menu.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const probe = (x: number, y: number) => el.contains(document.elementFromPoint(x, y));
    return !(probe(box.left + 8, box.bottom - 4) && probe(box.right - 8, box.bottom - 4));
  });
  expect(covered, 'something is drawn over the foot of the parts menu').toBe(false);
});
