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

/** The fixture's ladder carrying every state: collected, ready, part way along, and shut. */
const CLAIMED = 'runs_1';
const READY = 'runs_2';
const OPEN = 'runs_3';
const LOCKED = 'runs_4';
/** A rung well up the same ladder, which the pane draws along with the rest of it. */
const DEEP = 'runs_8';
/** How long that ladder is, and how many rows the index holds. Off the catalogue, not typed. */
const RUNS_STEPS = FEATS.filter((feat) => feat.chain === 'runs').length;
const LADDERS = new Set(FEATS.map((feat) => feat.chain ?? feat.id)).size;

const boxOf = async (locator: Locator) => {
  const box = await locator.boundingBox();
  expect(box, 'the element has no box: is it drawn at all?').not.toBeNull();
  return box!;
};

test('the board opens on the index and one whole ladder', async ({ page }) => {
  await installApi(page, featsMe);
  await page.goto('/game/feats');
  await expect(page.getByTestId('feats-board')).toBeVisible();
  await settleFonts(page);

  // The index down the left, one row per ladder, and the first of them open on the right.
  const rows = page.getByTestId('feats-sidebar').getByRole('button');
  await expect(rows.first()).toBeVisible();
  expect(await rows.count()).toBe(LADDERS);
  await expect(page.getByTestId('feat-block-runs')).toBeVisible();
  await expect(page.getByTestId('feat-block-done-runs')).toContainText(`/${RUNS_STEPS}`);

  await expect(page.getByTestId('feats-ledger-claimed')).toHaveText(String(featsBoard.claimed));
  await expect(page.getByTestId('feats-count-ready')).toHaveText(String(featsBoard.ready));
  // The standing, the filters and the button that pays are one box now, not three panels.
  const summary = page.getByTestId('feats-summary');
  for (const id of ['feats-ledger', 'feats-filters', 'feats-claim-all']) {
    await expect(summary.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId('feats-claim-all')).toContainText(
    `Collect all ${featsBoard.ready}`,
  );

  // No heading over the quotation, and not a word about eras anywhere on the sheet.
  await expect(page.getByRole('heading', { name: 'Feats', exact: true })).toHaveCount(0);
  const sheet = (await page.getByTestId('page-sheet').innerText()).toLowerCase();
  for (const era of ['early', 'mid game', 'late game']) expect(sheet).not.toContain(era);

  await expectNothingOverflowsTheScreen(page);
  await expectNoImagesClipped(page, '[data-testid="feats-summary"]');
  await page.screenshot({ path: 'e2e-out/feats-board.png' });
});

/**
 * The row of controls at the top is one hand and one height (maintainer, 2026-09-17).
 *
 * The filters were struck-metal tabs beside a hand-inked button, which is a control bar bolted onto
 * a document. They are drawn now, and drawn things are easy to get subtly wrong: a different type
 * size or a different padding leaves a row of five controls sitting at two heights, which reads as
 * damage rather than as a distinction. Measured rather than eyeballed, because a two-pixel
 * difference is exactly the kind that survives a screenshot.
 */
test('the filters and the collect button are one row at one height', async ({ page }) => {
  await installApi(page, featsMe);
  await page.goto('/game/feats');
  await expect(page.getByTestId('feats-summary')).toBeVisible();
  await settleFonts(page);

  const heights: number[] = [];
  for (const id of [
    'feats-show-all',
    'feats-show-claimed',
    'feats-show-unclaimed',
    'feats-show-shut',
    'feats-claim-all',
  ]) {
    heights.push((await boxOf(page.getByTestId(id))).height);
  }
  expect(Math.max(...heights) - Math.min(...heights), heights.join(', ')).toBeLessThanOrEqual(1);
  /*
   * And they are the taller ones (maintainer, 2026-09-17: a fifth more height, same type size).
   *
   * Pinned as a floor with the type size beside it, because the obvious way to make a control
   * taller is to make its label bigger, and that is the one thing that was ruled out: the row has
   * to grow in its padding.
   */
  expect(Math.min(...heights), 'the controls have lost their height').toBeGreaterThanOrEqual(31);
  const type = await page
    .getByTestId('feats-show-all')
    .evaluate((el) => getComputedStyle(el).fontSize);
  expect(type, 'the label grew instead of the box').toBe('15px');

  // Every one of them is drawn rather than struck: the filter row and the button share one path.
  for (const id of ['feats-show-all', 'feats-claim-all']) {
    expect(await page.getByTestId(id).locator('svg path').count()).toBeGreaterThan(2);
  }

  // The gap between the filters is the doubled one, not a tab row's.
  const first = await boxOf(page.getByTestId('feats-show-all'));
  const second = await boxOf(page.getByTestId('feats-show-claimed'));
  expect(second.x - (first.x + first.width)).toBeGreaterThanOrEqual(12);

  /*
   * And the box stays the height it was trimmed to (maintainer, 2026-09-17: ten per cent off).
   *
   * It is the one thing standing between the quotation and the board, so every pixel of it is a
   * pixel the open ladder does not get. Pinned as a ceiling rather than an equality: the row is
   * allowed to get shorter, and a font that loads late or a fifth control added to it is exactly
   * the change that would quietly put the tenth back.
   */
  const summary = await boxOf(page.getByTestId('feats-summary'));
  expect(summary.height, 'the summary box has grown back').toBeLessThanOrEqual(127);
});

test('a ladder opens whole, with every tier on it and the shut ones bare', async ({ page }) => {
  await installApi(page, featsMe);
  await page.goto('/game/feats');
  const ladder = page.getByTestId('feat-block-runs');
  await expect(ladder).toBeVisible();
  await settleFonts(page);

  // All four states on the one card, and the ladder runs the whole way to tier X.
  await expect(page.getByTestId(`feat-${CLAIMED}`)).toHaveAttribute('data-state', 'claimed');
  await expect(page.getByTestId(`feat-${READY}`)).toHaveAttribute('data-state', 'ready');
  await expect(page.getByTestId(`feat-${OPEN}`)).toHaveAttribute('data-state', 'open');
  await expect(page.getByTestId(`feat-${LOCKED}`)).toHaveAttribute('data-state', 'locked');
  await expect(page.getByTestId(`feat-${DEEP}`)).toHaveAttribute('data-state', 'locked');

  // The upright runs between the marks, so the ten read as one ladder.
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

  /*
   * Nothing in the card runs out of the card.
   *
   * A rung with a six-token reward is the widest row on this screen and the one most likely to
   * push a name or a button through the frame. Scrolled into the pane first, because the rungs
   * scroll inside the card now: a rung below the fold is a scroller doing its job, and measuring
   * one there would fail on a ladder of ten at any viewport.
   */
  await page.getByTestId(`feat-claim-${READY}`).scrollIntoViewIfNeeded();
  const frame = await boxOf(ladder);
  const claim = await boxOf(page.getByTestId(`feat-claim-${READY}`));
  expect(claim.x + claim.width).toBeLessThanOrEqual(frame.x + frame.width + 1);
  expect(claim.y + claim.height).toBeLessThanOrEqual(frame.y + frame.height + 1);

  await page.screenshot({ path: 'e2e-out/feats-ladder.png' });
});

test('pressing a row in the index opens that ladder', async ({ page }) => {
  await installApi(page, featsMe);
  await page.goto('/game/feats');
  await expect(page.getByTestId('feat-block-runs')).toBeVisible();
  await settleFonts(page);

  await page.getByTestId('feats-tab-kills').click();
  await expect(page.getByTestId('feat-block-kills')).toBeVisible();
  await expect(page.getByTestId('feat-block-runs')).toHaveCount(0);
  await expect(page.getByTestId('feats-tab-kills')).toHaveAttribute('aria-current', 'true');

  // The index scrolls on its own, inside its frame, rather than taking the sheet with it.
  const scrolled = await page.evaluate(() => {
    const list = document.querySelector('[data-testid="feats-sidebar"] ul');
    if (!list) return null;
    list.scrollTop = list.scrollHeight;
    return { top: list.scrollTop, room: list.scrollHeight - list.clientHeight };
  });
  expect(scrolled?.room, 'the index does not scroll: is it drawing every ladder?').toBeGreaterThan(
    0,
  );
  expect(scrolled?.top).toBeGreaterThan(0);

  await settleFonts(page);
  await page.screenshot({ path: 'e2e-out/feats-ladder-open.png' });
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

  await settleFonts(page);
  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'e2e-out/feats-claimed.png' });
});

test('the filter narrows the index, and opens something that survived it', async ({ page }) => {
  await installApi(page, featsMe);
  await page.goto('/game/feats');
  await expect(page.getByTestId('feats-board')).toBeVisible();
  await settleFonts(page);

  await page.getByTestId('feats-show-unclaimed').click();
  await expect(page.getByTestId('feats-show-unclaimed')).toHaveAttribute('aria-pressed', 'true');
  // Every row left is a ladder with something to collect, and `seats` (finished and collected) is
  // not one of them.
  await expect(page.getByTestId('feats-tab-seats')).toHaveCount(0);
  await expect(page.getByTestId('feats-tab-runs')).toBeVisible();

  await page.getByTestId('feats-show-claimed').click();
  // The open ladder was filtered away, so the board opened one that was not.
  await expect(page.getByTestId('feat-block-runs')).toHaveCount(0);
  await expect(page.getByTestId('feat-block-seats')).toBeVisible();

  // The pointer off the chip it last pressed, or the hover card for that chip is drawn over the
  // panel under it and the filed picture shows a tooltip rather than the screen.
  await page.mouse.move(0, 0);
  await settleFonts(page);
  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'e2e-out/feats-filtered.png' });

  await growPastTheFold(page);
  await expectNothingClippedVertically(page, '[data-testid="feats-board"]');
  await expectNoImagesClipped(page, '[data-testid="feats-board"]');
});

test('the board holds at 1920x1080 as well as at 1280x720', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await installApi(page, featsMe);
  await page.goto('/game/feats');
  await expect(page.getByTestId('feats-board')).toBeVisible();
  await settleFonts(page);

  // The index keeps its measure and the open ladder takes the rest of the sheet.
  const board = await boxOf(page.getByTestId('feats-board'));
  const index = await boxOf(page.getByTestId('feats-sidebar'));
  const ladder = await boxOf(page.getByTestId('feat-block-runs'));
  expect(index.width).toBeLessThan(board.width * 0.4);
  expect(ladder.width).toBeGreaterThan(board.width * 0.5);
  // Both of them reach the foot of the sheet rather than stopping at their content.
  const sheet = await boxOf(page.getByTestId('page-sheet'));
  expect(index.y + index.height).toBeLessThanOrEqual(sheet.y + sheet.height + 1);
  expect(ladder.y + ladder.height).toBeLessThanOrEqual(sheet.y + sheet.height + 1);
  expect(ladder.height).toBeGreaterThan(board.height * 0.8);

  await expectNothingOverflowsTheScreen(page);
  await expectNoImagesClipped(page, '[data-testid="feats-summary"]');
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
