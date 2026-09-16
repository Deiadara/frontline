import { expect, test, type Locator } from '@playwright/test';
import { FEATS, findFeat } from '@frontline/shared';
import { featsBoard, featsMe, lateGame } from './fixtures';
import {
  expectNoImagesClipped,
  expectNothingClippedVertically,
  expectNothingOverflowsTheScreen,
  growPastTheFold,
  installApi,
  settleFonts,
} from './harness';

/**
 * The feats screen, looked at rather than asserted about (maintainer request, 2026-09-13).
 *
 * The unit gates in `src/features/feats` say the right rungs exist in the right cards. This says
 * the screen *holds* them: two hundred of them in a sheet that scrolls, the four states of
 * a ladder legible in one card, the button reachable, and the two marks in the corner of the
 * bottom bar not drawn on top of each other.
 *
 * Every one of those is a failure that passes every unit test in the repository.
 */

test.use({ viewport: { width: 1280, height: 720 } });

/** The fixture's one four-rung ladder: collected, ready, part way along, and shut. */
const CLAIMED = 'runs_1';
const READY = 'runs_2';
const OPEN = 'runs_3';
const LOCKED = 'runs_4';

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  expect(box, 'the element has no box: is it drawn at all?').not.toBeNull();
  return box!;
};

test('the board opens on every feat, grouped into ladders', async ({ page }) => {
  await installApi(page, featsMe);
  await page.goto('/game/feats');
  await expect(page.getByTestId('feats-board')).toBeVisible();
  await settleFonts(page);

  await expect(page.getByTestId('feats-shown')).toHaveText(
    `${FEATS.length} of ${FEATS.length} feats`,
  );
  await expect(page.getByTestId('feats-ledger-claimed')).toHaveText(String(featsBoard.claimed));
  await expect(page.getByTestId('feats-count-ready')).toHaveText(String(featsBoard.ready));
  // The waiting count reads in exactly two places now: the ledger row above, and the face of the
  // button that acts on it. The red `N to collect` plate that used to sit beside the button was a
  // third printing of the same number and went with the visibility pass.
  await expect(page.getByTestId('feats-claim-all')).toContainText(
    `Collect all ${featsBoard.ready}`,
  );

  await expectNothingOverflowsTheScreen(page);
  /*
   * Scoped to the ledger, not swept over the whole page.
   *
   * The gate walks up from each drawing to the scope looking for a clipping edge, so an unscoped
   * sweep of a sheet holding two hundred feats reports whichever rung mark happens to
   * straddle the fold: measured, and it is the claimed mark on the fourth card at 1280x720. That
   * is the scroller doing its job. The board is swept properly in the filtered test below, where
   * `growPastTheFold` has grown the window until there is no fold to straddle.
   */
  await expectNoImagesClipped(page, '[data-testid="feats-ledger"]');
  await page.screenshot({ path: 'e2e-out/feats-board.png' });
});

test('one card carries all four states, and the shut rung has no numbers on it', async ({
  page,
}) => {
  await installApi(page, featsMe);
  await page.goto('/game/feats');
  const ladder = page.getByTestId('feat-block-runs');
  await expect(ladder).toBeVisible();
  await settleFonts(page);

  await expect(page.getByTestId(`feat-${CLAIMED}`)).toHaveAttribute('data-state', 'claimed');
  await expect(page.getByTestId(`feat-${READY}`)).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId(`feat-${OPEN}`)).toHaveAttribute('data-state', 'open');
  await expect(page.getByTestId(`feat-${LOCKED}`)).toHaveAttribute('data-state', 'locked');

  // The upright runs between the marks, so the four read as one ladder.
  await expect(page.getByTestId('feat-spine-runs')).toBeVisible();
  // The one thing the server withheld stays withheld: no bar, no figure, and not a digit anywhere
  // on the row.
  await expect(page.getByTestId(`feat-count-${LOCKED}`)).toHaveCount(0);
  await expect(page.getByTestId(`feat-bar-${LOCKED}`)).toHaveCount(0);
  expect(await page.getByTestId(`feat-${LOCKED}`).innerText()).not.toMatch(/[0-9]/);

  // The open rung says where the crew stands, in the measure's own word.
  const standing = featsBoard.progress.find((one) => one.id === OPEN);
  await expect(page.getByTestId(`feat-count-${OPEN}`)).toContainText(
    `${standing?.value} / ${standing?.target} missions`,
  );

  // Nothing in the card runs out of the card: a rung with a six-token reward is the widest row on
  // this screen and the one most likely to push a name or a button through the frame.
  const frame = await boxOf(ladder);
  const claim = await boxOf(page.getByTestId(`feat-claim-${READY}`));
  expect(claim.x + claim.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
  expect(claim.y + claim.height).toBeLessThanOrEqual(frame.y + frame.height + 1);

  // Scrolled so the shut rung at the foot of the ladder is in the frame: a screenshot of a card
  // taller than the sheet otherwise files the three rungs above it and none of the one this test
  // is about.
  await page.getByTestId(`feat-${LOCKED}`).scrollIntoViewIfNeeded();
  await settleFonts(page);
  await page.screenshot({ path: 'e2e-out/feats-ladder.png' });
});

test('CLAIM is on the finished rung alone, and collecting says what was paid', async ({ page }) => {
  await installApi(page, featsMe);
  await page.goto('/game/feats');
  await expect(page.getByTestId('feats-board')).toBeVisible();
  await settleFonts(page);

  await expect(page.getByTestId(`feat-claim-${READY}`)).toBeVisible();
  for (const id of [CLAIMED, OPEN, LOCKED]) {
    await expect(page.getByTestId(`feat-claim-${id}`)).toHaveCount(0);
  }

  await page.getByTestId(`feat-claim-${READY}`).click();
  await expect(page.getByTestId('feats-receipt')).toBeVisible();
  await expect(page.getByTestId('feats-receipt')).toContainText(
    `Collected: ${findFeat(READY)?.name}`,
  );
  // The rung it was pressed on has restyled itself, and the button is gone from it.
  await expect(page.getByTestId(`feat-${READY}`)).toHaveAttribute('data-state', 'claimed');
  await expect(page.getByTestId(`feat-claim-${READY}`)).toHaveCount(0);
  // And the red mark on the bar has come down by one, because `/me` was refetched.
  await expect(page.getByTestId('nav-feats-badge')).toHaveText(String(featsBoard.ready - 1));

  // Back to the top before the picture: the press scrolled the button into view, so the receipt
  // the test just asserted on is above the fold and would not be in the frame.
  await page.getByTestId('feats-receipt').scrollIntoViewIfNeeded();
  await settleFonts(page);
  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'e2e-out/feats-claimed.png' });
});

test('the two filters narrow the board, together', async ({ page }) => {
  await installApi(page, featsMe);
  await page.goto('/game/feats');
  await expect(page.getByTestId('feats-board')).toBeVisible();
  await settleFonts(page);

  await page.getByTestId('feats-era-early').click();
  await page.getByTestId('feats-show-done').click();
  await expect(page.getByTestId('feats-era-early')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('feats-show-done')).toHaveAttribute('aria-pressed', 'true');

  // Early and finished: the two early rungs of that ladder stay, the mid and late ones go.
  await expect(page.getByTestId(`feat-${CLAIMED}`)).toBeVisible();
  await expect(page.getByTestId(`feat-${READY}`)).toBeVisible();
  await expect(page.getByTestId(`feat-${OPEN}`)).toHaveCount(0);
  await expect(page.getByTestId(`feat-${LOCKED}`)).toHaveCount(0);
  await expect(page.getByTestId('feats-shown')).not.toHaveText(
    `${FEATS.length} of ${FEATS.length} feats`,
  );

  // The pointer off the chip it last pressed, or the hover card for that chip is drawn over the
  // note under it and the filed picture shows a tooltip rather than the screen.
  await page.mouse.move(0, 0);
  await settleFonts(page);
  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'e2e-out/feats-filtered.png' });

  /*
   * The whole narrowed board, swept for a cut line.
   *
   * The sweep grows the window until nothing is over its own fold, which is why it runs here and
   * not on the unfiltered page: two hundred feats is a scroller several times taller than
   * the harness is willing to grow to, and the guard would refuse rather than measure. Nine rungs
   * is the same markup at a height the sweep can see all of at once.
   */
  await growPastTheFold(page);
  await expectNothingClippedVertically(page, '[data-testid="feats-board"]');
  await expectNoImagesClipped(page, '[data-testid="feats-board"]');
});

test('a board with nothing on it says so', async ({ page }) => {
  await installApi(page, featsMe);
  await page.goto('/game/feats');
  await expect(page.getByTestId('feats-board')).toBeVisible();

  await page.getByTestId('feats-era-late').click();
  await page.getByTestId('feats-show-done').click();
  await expect(page.getByTestId('feats-empty')).toBeVisible();
  await expect(page.getByTestId('feats-board')).toHaveCount(0);
});

test('the sheet scrolls the whole way down, and the last card is whole', async ({ page }) => {
  await installApi(page, featsMe);
  await page.goto('/game/feats');
  await expect(page.getByTestId('feats-board')).toBeVisible();
  await settleFonts(page);

  const board = page.getByTestId('feats-board');
  const blocks = await board.locator('> article').count();
  const last = board.locator('> article').nth(blocks - 1);
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeVisible();

  // Whole, rather than merely present: the foot of the last card has to be inside the sheet's own
  // scrolling unit, or the bottom bar is drawn over it.
  const card = await boxOf(last);
  const sheet = await boxOf(page.getByTestId('page-sheet'));
  expect(card.y + card.height).toBeLessThanOrEqual(sheet.y + sheet.height + 1);

  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'e2e-out/feats-bottom.png' });
});

/**
 * The corner of the bottom bar, where two pinned marks now live.
 *
 * At 1500px and up both the feats door and the fight mark come out of the row and pin to the left
 * edge, so this is the width at which they can be drawn on top of each other. A fixture with only
 * one of them would pass whatever the two are positioned at, which is why `featsMe` carries both.
 */
test('the corner carries the feats door and the fight mark, side by side', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installApi(page, featsMe);
  await page.goto('/game/feats');
  await expect(page.getByTestId('feats-board')).toBeVisible();
  await settleFonts(page);

  const door = await boxOf(page.getByTestId('nav-feats'));
  const fight = await boxOf(page.getByTestId('nav-fights'));
  expect(door.x, 'the feats door is not in the corner').toBeLessThan(fight.x);
  expect(door.x + door.width, 'the two marks overlap').toBeLessThanOrEqual(fight.x);
  // And neither has run into the walk of doors.
  const firstDoor = await boxOf(page.getByTestId('nav-city'));
  expect(fight.x + fight.width).toBeLessThanOrEqual(firstDoor.x);

  await expect(page.getByTestId('nav-feats-badge')).toHaveText(String(featsBoard.ready));

  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'e2e-out/feats-corner-1920x1080.png' });
});

test('the board holds at 1920x1080 as well as at 1280x720', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installApi(page, featsMe);
  await page.goto('/game/feats');
  await expect(page.getByTestId('feats-board')).toBeVisible();
  await settleFonts(page);

  // Two columns of cards past 1280, so seventy-two of them are half as far to scroll.
  const board = await boxOf(page.getByTestId('feats-board'));
  const first = await boxOf(page.getByTestId('feats-board').locator('> article').first());
  expect(first.width).toBeLessThan(board.width * 0.6);

  await expectNothingOverflowsTheScreen(page);
  // Scoped for the reason the first test's is. See the note there.
  await expectNoImagesClipped(page, '[data-testid="feats-ledger"]');
  await page.screenshot({ path: 'e2e-out/feats-board-1920x1080.png' });
});

/**
 * The quiet day: no feats waiting, so no mark at all.
 *
 * `lateGame` carries no `unread` block, which is the response a build without the field sends and
 * the state the badge has to draw nothing for. An empty dot in the corner of the door would say
 * "no news" in the same shape "three waiting" is said in.
 */
test('a crew with nothing waiting gets no red mark', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/feats');
  await expect(page.getByTestId('nav-feats')).toBeVisible();
  await expect(page.getByTestId('nav-feats-badge')).toHaveCount(0);
});

/**
 * The level-up card, which is new art and therefore has to be looked at.
 *
 * The old banner was latched over the middle of the page with a `Noted` text link for an exit and
 * no timer, so it read as stuck. This is the replacement: a drawn card in the corner with a real X
 * and a five second clock. Two things are worth a browser rather than jsdom, and both are about
 * the drawing: the `feTurbulence` frame has to render as a wobbled box rather than as nothing, and
 * nothing in it may be cut at either viewport.
 */
for (const [tag, width, height] of [
  ['1280x720', 1280, 720],
  ['1920x1080', 1920, 1080],
] as const) {
  test(`the level-up card is drawn whole and can be dismissed at ${tag}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await installApi(page, {
      ...featsMe,
      levelUp: {
        level: 24,
        levelsGained: 2,
        grants: { recruitSlots: 25 },
        unlocks: [{ id: 'research', name: 'Research', description: 'The Lab opens.', level: 24 }],
      },
    });
    await page.goto('/game/feats');

    const card = page.getByTestId('level-up-toast');
    await expect(card).toBeVisible();
    await settleFonts(page);
    await expect(card).toContainText('Level 24');
    await expect(card).toContainText('+2 levels');
    // What the level is worth, which is the half the old banner buried under a divider.
    await expect(card).toContainText('25');

    const clipped = await page.evaluate<string[]>(() =>
      [...document.querySelectorAll<HTMLElement>('[data-testid="level-up-toast"] *')]
        .filter((el) => el.children.length === 0 && el.scrollWidth > el.clientWidth + 1)
        .map((el) => `"${el.textContent?.trim()}" (${el.scrollWidth}>${el.clientWidth}px)`),
    );
    expect(clipped, `cut text in the level-up card: ${clipped.join(' | ')}`).toEqual([]);
    await expectNothingOverflowsTheScreen(page);
    await page.screenshot({ path: `e2e-out/level-up-card-${tag}.png` });

    // The X, which is the exit the old one did not really have.
    await page.getByTestId('level-up-dismiss').click();
    await expect(page.getByTestId('shell-level-up')).toHaveCount(0);
  });
}
