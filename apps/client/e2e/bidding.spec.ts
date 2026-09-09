import { expect, test, type Page } from '@playwright/test';
import { adminGame, bar, me } from './fixtures';
import {
  expectNoImagesClipped,
  expectNothingClippedVertically,
  expectNothingOverflowsTheScreen,
  expectSheetNotWashedOut,
  installApi,
  settleFonts,
} from './harness';

/**
 * The three things this half added that a player can walk into and get stuck on: the bidding, the
 * screens behind a level, and the painted picker that replaced every `<select>`.
 *
 * All three are *interaction*, which is why they are here rather than in the layout sweeps. A
 * window that renders beautifully and cannot be typed into is a worse defect than one that is
 * three pixels out, and no geometry gate can see it.
 */

/** The table this crew is in and losing: the open phase, with the controls live. */
const OUTBID = 'bar-6';
/** The table four minutes off its close: sealed, so the only control on it is the lock. */
const SEALED = 'bar-7';
/** A table nobody has opened and this crew has no room for: the cap refusal. */
const UNTOUCHED = 'bar-1';

const auctionFor = (recruitId: string) => {
  const table = bar.auctions.find((one) => one.recruitId === recruitId);
  if (!table) throw new Error(`the fixture has no table on ${recruitId}`);
  return table;
};

/**
 * Into the Bar, onto the stool, and along to the person these tests are about.
 *
 * The Bar is a room: the recruits are behind the Sit Down control on the empty seat, one at a
 * time, with an arrow either side. So getting to somebody is two steps, and both belong in the
 * helper rather than in seven copies.
 *
 * Stepping until the right card is on screen rather than stepping a fixed number of times: the
 * roster's order is the fixture's business, and a test that hard-coded an index would break the
 * day somebody added a ninth drinker.
 */
async function openBar(page: Page, recruitId: string = OUTBID): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await installApi(page, adminGame);
  await page.goto('/game/bar');
  await settleFonts(page);
  await page.getByTestId('sit-down').click();
  await expect(page.getByTestId('bar-file')).toBeVisible();

  const card = page.getByTestId(`recruit-${recruitId}`);
  for (let step = 0; step < bar.recruits.length; step += 1) {
    if ((await card.count()) > 0) return;
    // The roster stops at its far end rather than wrapping, so the walk stops with it.
    if (await page.getByTestId('seat-on').isDisabled()) break;
    await page.getByTestId('seat-on').click();
  }
  throw new Error(`${recruitId} is not at the bar tonight`);
}

/** Onto the stool, along to somebody, and into their bidding screen. */
async function openTable(page: Page, recruitId: string): Promise<void> {
  await openBar(page, recruitId);
  await page.getByTestId(`bid-${recruitId}`).click();
  await expect(page.getByTestId('auction-window')).toBeVisible();
}

test.describe('bidding (§H7)', () => {
  test('opens on the next legal number, and taking it puts the reader in front', async ({
    page,
  }) => {
    await openTable(page, OUTBID);
    const table = auctionFor(OUTBID);

    // The field is prefilled with the smallest bid that can win, which is the number a player
    // presses the button on nine times in ten. It has to be the *minimum*, not the leader's own
    // figure: prefilling a bid that cannot clear the increment is a button that always fails.
    await expect(page.getByTestId('bid-amount')).toHaveValue(String(table.nextBid));
    await expect(page.getByTestId('auction-standing')).toContainText('You have been outbid');

    await page.getByTestId('place-bid').click();

    // The lead changed hands, and the reader's own row is on the table under their own name.
    await expect(page.getByTestId('auction-standing')).toContainText('You are leading');
    await expect(page.getByTestId('leading-bid')).toHaveText(table.nextBid.toLocaleString());
    const newest = page.getByTestId('bid-history').locator('li').first();
    await expect(newest).toContainText('You');
    await expect(newest).toContainText(String(table.nextBid));
  });

  /**
   * The number on screen is up to ten seconds old, so the server is the authority on whether a bid
   * cleared the leader, and the field is floored at the person's reserve rather than at a minimum
   * that has already moved. Two claims, and both matter: the screen warns with the figure it knows
   * *before* the press, and the server's own refusal is printed after it.
   */
  test('an under-bid is warned about before it is sent and refused in words after', async ({
    page,
  }) => {
    await openTable(page, OUTBID);
    const table = auctionFor(OUTBID);
    const leader = table.leading?.amount ?? 0;
    expect(leader, 'the fixture table must already have a leader').toBeGreaterThan(0);

    await page.getByTestId('bid-amount').fill(String(table.reserve));
    await expect(page.getByTestId('bid-under')).toContainText(String(leader));
    await expect(page.getByTestId('bid-under')).toContainText(String(table.nextBid));

    await page.getByTestId('place-bid').click();
    await expect(page.getByRole('alert')).toContainText(`Somebody is at ${leader}`);
    // ...and the table did not move under a refusal.
    await expect(page.getByTestId('auction-standing')).toContainText('You have been outbid');
  });

  /**
   * The last half hour is a different screen, not the same one with the numbers greyed.
   *
   * The open controls are gone entirely: a sealed value is one irreversible number nobody else
   * sees, and drawing it as a variation on "place a bid" is the way a player locks one by reflex.
   */
  test('a sealed table takes one final value, and asks before it takes it', async ({ page }) => {
    await openTable(page, SEALED);
    const table = auctionFor(SEALED);

    // Scoped to the window: the card behind it carries the same badge, and the roster card is not
    // what this test is about.
    const window = page.getByTestId('auction-window');
    await expect(window.getByTestId('auction-phase')).toHaveAttribute('data-phase', 'sealed');
    await expect(page.getByTestId('place-bid')).toHaveCount(0);
    await expect(page.getByTestId('lock-panel')).toBeVisible();

    // Floored at the highest number already on the table, because a value that cannot win is not a
    // value. Here that is the reader's own leading bid.
    const floor = Math.max(table.reserve, table.yourBid ?? 0, table.leading?.amount ?? 0);
    await expect(page.getByTestId('seal-amount')).toHaveValue(String(floor));

    await page.getByTestId('seal-amount').fill(String(floor + 40));
    await page.getByTestId('lock-final').click();

    // It asks, because it cannot be undone.
    await expect(page.getByTestId('confirm-seal')).toBeVisible();
    await expect(page.getByTestId('confirm-seal')).toContainText('cannot be changed');
    await page.getByTestId('confirm-seal-yes').click();

    // And afterwards the value is a sealed card rather than a field somebody can edit again.
    await expect(page.getByTestId('sealed-card')).toContainText(String(floor + 40));
    await expect(page.getByTestId('sealed-card')).toContainText('Revealed at midnight');
    await expect(page.getByTestId('lock-final')).toHaveCount(0);

    await settleFonts(page);
    await page.screenshot({ path: 'screenshots/bar-auction-locked.png' });
  });

  /**
   * The clock runs on the *server's* time and it has to actually run.
   *
   * Every deadline here belongs to the server, and the response carries `serverNow` precisely so a
   * skewed browser clock, or one a player nudged forward, is corrected rather than believed. What
   * this pins is the second hand: read a second apart, the same table must show less time left. A
   * countdown evaluated once per render sits still on a page nobody is touching, which is what the
   * Bar's own walkout timer used to do for six hours at a stretch.
   */
  test('the countdown ticks down against the server’s clock', async ({ page }) => {
    await openTable(page, SEALED);
    const clock = page.getByTestId('auction-clock');

    const seconds = async () => {
      const text = (await clock.innerText()).match(/(\d+):(\d\d)/);
      if (!text) throw new Error(`no mm:ss in the clock: ${await clock.innerText()}`);
      return Number(text[1]) * 60 + Number(text[2]);
    };

    const before = await seconds();
    await expect.poll(seconds, { timeout: 5_000 }).toBeLessThan(before);
    // Inside the last five minutes the clock changes colour, which is the whole reason it is a
    // component rather than a string: the fixture's sealed table is four minutes off its close.
    expect(before).toBeLessThanOrEqual(5 * 60);
  });

  /**
   * §H7: two tables at once, three past level 40, and a bid is a commitment until the table closes.
   *
   * Refused on the screen rather than by a round trip, because the client already knows both
   * numbers: sending a bid that is certain to come back refused would spend a request to tell a
   * player something the button could have said before they pressed it.
   */
  test('a third table is refused, in the number of tables the crew is allowed', async ({
    page,
  }) => {
    await openTable(page, UNTOUCHED);

    await expect(page.getByTestId('bid-refusal')).toContainText(
      `You are at ${bar.auctionsAllowed} tables already`,
    );
    // The whole control is out, field and all: a live field over a dead button invites somebody to
    // type a figure and then find out it was never going anywhere.
    await expect(page.getByTestId('place-bid')).toBeDisabled();
    await expect(page.getByTestId('bid-amount')).toBeDisabled();

    // The table is still readable, which is the point of leaving the window openable at all: a
    // player at their cap still wants to know what this person is going for.
    await expect(page.getByTestId('auction-standing')).toContainText('Nobody has bid');
    await expect(page.getByTestId('leading-bid')).toHaveText(
      auctionFor(UNTOUCHED).reserve.toLocaleString(),
    );
  });

  /**
   * The room behind this window goes deaf while it is open.
   *
   * The Bar's arrows are bound to Left and Right on `window`, and the bid field is a number input
   * where those keys move the caret. Both were live at once for the negotiation window this
   * replaced: nudging the caret paged the roster behind, so a player bidding on one person was
   * reading somebody else's record while they did it, with the bid still aimed at the first.
   */
  test('the arrows behind this window are deaf while it is open', async ({ page }) => {
    await openBar(page, OUTBID);
    const behind = await page.getByTestId('recruit-name').textContent();
    await page.getByTestId(`bid-${OUTBID}`).click();
    await expect(page.getByTestId('auction-window')).toBeVisible();

    await page.getByTestId('bid-amount').fill('120');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await expect(
      page.getByTestId('recruit-name'),
      'a caret key in the bid field walked the roster behind the auction',
    ).toHaveText(behind ?? '');

    // And they wake up again once the window is closed, or the screen is stuck.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('auction-window')).toHaveCount(0);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId('recruit-name')).not.toHaveText(behind ?? '');
  });

  /**
   * The window is a portrait, a thirty-three row sheet and a bid panel side by side, which is the
   * densest thing this screen draws. Measured at the two viewports the board reads it at, in both
   * phases, because the sealed phase swaps the whole right-hand column for a different one.
   */
  for (const [tag, size] of [
    ['1024x768', { width: 1024, height: 768 }],
    ['1440x900', { width: 1440, height: 900 }],
  ] as const) {
    test(`the bidding screen is legible at ${tag}`, async ({ page }) => {
      await installApi(page, adminGame);
      await page.setViewportSize(size);
      await page.goto('/game/bar');
      await settleFonts(page);

      for (const recruitId of [OUTBID, SEALED]) {
        await page.getByTestId('sit-down').click();
        await expect(page.getByTestId('bar-file')).toBeVisible();
        for (let step = 0; step < bar.recruits.length; step += 1) {
          if ((await page.getByTestId(`recruit-${recruitId}`).count()) > 0) break;
          await page.getByTestId('seat-on').click();
        }
        await page.getByTestId(`bid-${recruitId}`).click();
        await expect(page.getByTestId('auction-window')).toBeVisible();
        await settleFonts(page);

        // Fixed copy that ellipsises is invisible to a document-overflow gate, so the authored
        // labels are measured directly: this is the defect class that shipped `ROUND TRI…`.
        const cut = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('[role="dialog"] span, [role="dialog"] p')]
            .filter((el) => el.childElementCount === 0 && el.scrollWidth > el.clientWidth + 1)
            .map((el) => `"${el.textContent?.trim()}" (${el.scrollWidth}>${el.clientWidth}px)`),
        );
        expect(cut, `cut text on the ${recruitId} table at ${tag}: ${cut.join(' | ')}`).toEqual([]);
        await expectNoImagesClipped(page, '[role="dialog"]');
        await expectNothingOverflowsTheScreen(page);

        /*
         * The window is inside the frame, and the control it was opened for is above the fold.
         *
         * Not `expectNothingClippedVertically`: the record down the left is thirty-three rows
         * under a portrait, so at 1024x768 the window scrolls by design, exactly as the seat
         * screen behind it does, and a sweep that calls a scroller's own fold a defect would fail
         * on every viewport short enough to need one. What must never scroll out of reach is the
         * bid, so that is what is measured.
         */
        const frame = await page.getByTestId('auction-window').boundingBox();
        if (!frame) throw new Error('the bidding window must have a box');
        expect(frame.y, `the window is off the top at ${tag}`).toBeGreaterThanOrEqual(0);
        expect(
          frame.y + frame.height,
          `the window runs past the bottom at ${tag}`,
        ).toBeLessThanOrEqual(size.height + 1);
        await expect(
          page.getByTestId(recruitId === SEALED ? 'lock-final' : 'place-bid'),
        ).toBeInViewport({ ratio: 1 });

        // ...and the bottom of the record is legible too, which the fold hides on the way in.
        await page
          .getByTestId('auction-window')
          .getByTestId('attribute-sheet')
          .scrollIntoViewIfNeeded();
        await settleFonts(page);
        const cutBelow = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('[role="dialog"] span, [role="dialog"] p')]
            .filter((el) => el.childElementCount === 0 && el.scrollWidth > el.clientWidth + 1)
            .map((el) => `"${el.textContent?.trim()}"`),
        );
        expect(cutBelow, `cut text below the fold at ${tag}: ${cutBelow.join(' | ')}`).toEqual([]);
        await page.screenshot({ path: `screenshots/bar-auction-${recruitId}-${tag}.png` });

        // Out of the window and off the stool, so the next pass starts from the room again.
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
      }
    });
  }
});

test.describe('doors behind a level (§I3)', () => {
  test('a locked screen says which level opens it instead of vanishing', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    // `me` is the starting crew: level 1, so every gated screen is shut.
    await installApi(page, me);
    await page.goto('/game/bar');
    await settleFonts(page);

    // The door is *there*, and it is the screen's own name that is on it.
    await expect(page.getByText('Opens at level 10')).toBeVisible();
    await expect(page.getByText('You are level')).toBeVisible();
    // And the nav still shows the door rather than removing it.
    await expect(page.getByTestId('nav-the-bar')).toBeVisible();
    await expect(page.getByTestId('nav-locked-bar')).toBeVisible();
    await expectNothingClippedVertically(page);
  });

  test('a crew past the level walks straight in', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await installApi(page, adminGame);
    await page.goto('/game/bar');
    await settleFonts(page);

    await expect(page.getByText('Opens at level 10')).toHaveCount(0);
    await expect(page.getByTestId('nav-locked-bar')).toHaveCount(0);
    // The room itself, which is what being through the door means. The payroll book used to stand
    // in for it; it is behind a door on the strip now.
    await expect(page.getByTestId('bar-room')).toBeVisible();
  });
});

test.describe('the painted picker', () => {
  test('opens a drawn list, picks with the keyboard, and closes on escape', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1100 });
    await installApi(page, adminGame);
    // The offers composer lost its item slot (materials only, board 2026-09-09), so the drawn
    // list under test is the Settings clock picker, which sits down a long sheet the same way.
    await page.goto('/game/settings');
    await settleFonts(page);

    const trigger = page.getByTestId('settings-timezone');
    await expect(trigger).toBeVisible();
    await trigger.click();

    // A real listbox, drawn by us, not the operating system's menu, which no test can see at all.
    const list = page.getByRole('listbox', { name: 'Which clock to read the game on' });
    await expect(list).toBeVisible();

    // Positioned against the viewport. This is the bug that shipped first: `.glass-strong` sets
    // `position: relative` and beat the `fixed` class, so on a long page the menu landed a
    // thousand pixels below the fold while every other assertion stayed green.
    const box = await list.boundingBox();
    expect(box, 'the menu must have a box').not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(1100);

    await trigger.press('ArrowDown');
    await trigger.press('Enter');
    await expect(list).toHaveCount(0);

    await trigger.click();
    await trigger.press('Escape');
    await expect(page.getByRole('listbox')).toHaveCount(0);
  });

  test('leaves the market sheet readable', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1100 });
    await installApi(page, adminGame);
    await page.goto('/game/market');
    // The barrow, not just a sheet: the loading state is a sheet too now, and a screenshot that
    // starts on it is of an element the market replaces a frame later.
    await expect(page.getByTestId('vendor-stock')).toBeVisible();
    await settleFonts(page);
    await expectSheetNotWashedOut(page);
  });
});
