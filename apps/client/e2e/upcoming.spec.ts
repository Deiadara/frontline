/**
 * The Upcoming tab, rebuilt in the Training tab's shape (board request).
 *
 * A rail of called fights down the left, one of them open, and the whole of the rest of the screen
 * given to that one fight. The rail is the only region that moves: picking the fourth fight out of
 * a list of twenty must not scroll the fight you were reading off the top of the frame.
 *
 * What only a browser can answer is the geometry. Three things are asserted here that a unit test
 * cannot see: the rail really is to the left of the detail and not stacked above it, the frame
 * itself does not scroll while the rail does, and the open entry is marked in **colour** at the
 * same stroke weight as the rest, which is the whole reason `.ink-frame-brass` matches
 * `.ink-frame`.
 */
import { expect, test, type Page } from '@playwright/test';
import { battles, lateGame } from './fixtures';
import {
  expectNoImagesClipped,
  expectNothingClippedVertically,
  expectNothingOverflowsTheScreen,
  growPastTheFold,
  installApi,
  settleFonts,
} from './harness';

const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
] as const;

type Size = (typeof VIEWPORTS)[number];

const FIRST = battles.coming[0]!;
const SECOND = battles.coming[1]!;

async function openBoard(page: Page, size: Size = VIEWPORTS[4]): Promise<void> {
  await page.setViewportSize(size);
  await installApi(page, lateGame);
  await page.goto('/game/battles');
  await expect(page.getByTestId('coming-battles')).toBeVisible();
  await settleFonts(page);
}

const box = async (page: Page, testId: string) => {
  const at = await page.getByTestId(testId).boundingBox();
  if (!at) throw new Error(`${testId} has no box`);
  return at;
};

test('the rail lists every called fight, down the left of the detail', async ({ page }) => {
  await openBoard(page);

  const rail = page.getByTestId('coming-battles');
  for (const view of battles.coming) {
    await expect(rail.getByTestId(`battle-${view.battle.id}`)).toBeVisible();
  }

  // Beside it, not above it: a rail stacked over the detail is the two-panel page this replaced.
  const railBox = await box(page, 'coming-battles');
  const detailBox = await box(page, 'battle-detail-pane');
  expect(railBox.x + railBox.width).toBeLessThanOrEqual(detailBox.x + 1);
  // And the detail gets the rest of the screen rather than a column of the same width.
  expect(detailBox.width).toBeGreaterThan(railBox.width);
});

test('the rail is the only region that scrolls', async ({ page }) => {
  // Short enough that a rail of two fights plus a four-panel detail cannot possibly all fit.
  await openBoard(page, VIEWPORTS[0]);

  const scrollers = await page.evaluate(() => {
    const screen = document.querySelector('#root')?.firstElementChild;
    return {
      // The frame itself: fixed, whatever is inside it.
      screenOverflow: screen ? screen.scrollHeight - screen.clientHeight : -1,
      rail: getComputedStyle(document.querySelector('[data-testid="coming-battles"]')!).overflowY,
    };
  });
  expect(scrollers.rail).toBe('auto');
  expect(scrollers.screenOverflow).toBeLessThanOrEqual(1);
});

test('clicking a fight fills the rest of the screen with that fight', async ({ page }) => {
  await openBoard(page);

  // The first is open on arrival, so the page never lands on an empty column.
  await expect(page.getByTestId(`battle-detail-${FIRST.battle.id}`)).toBeVisible();
  await expect(page.getByTestId(`battle-detail-${SECOND.battle.id}`)).toHaveCount(0);

  await page.getByTestId(`battle-${SECOND.battle.id}`).click();

  // The detail is about the other fight now, and about only that one.
  await expect(page.getByTestId(`battle-detail-${SECOND.battle.id}`)).toBeVisible();
  await expect(page.getByTestId(`battle-detail-${FIRST.battle.id}`)).toHaveCount(0);
  await expect(page.getByTestId('battle-detail-pane')).toContainText(SECOND.targetName);
});

test('the open fight is marked in colour, not in weight', async ({ page }) => {
  await openBoard(page);

  /*
   * Polled rather than read once: the row's colour is a 150ms transition, so a read taken in the
   * frame after the click gets the value it is animating *away* from. That is not a flake to sleep
   * through, it is the reason a colour assertion on this rail has to settle first.
   */
  const edgeOf = (id: string) =>
    page.evaluate((testId: string) => {
      const style = getComputedStyle(document.querySelector(`[data-testid="${testId}"]`)!);
      return { width: style.borderLeftWidth, colour: style.borderLeftColor };
    }, `battle-${id}`);

  // The first fight is the one open on arrival: lit in brass, at the same stroke as the rest.
  // Read directly, because nothing has been clicked yet and no transition is in flight.
  const lit = await edgeOf(FIRST.battle.id);
  const unlit = await edgeOf(SECOND.battle.id);
  expect(lit.width).toBe(unlit.width);
  expect(lit.colour).not.toBe(unlit.colour);

  // And the mark moves with the selection rather than being painted on the first row for good.
  await page.getByTestId(`battle-${SECOND.battle.id}`).click();
  await expect(page.getByTestId(`battle-detail-${SECOND.battle.id}`)).toBeVisible();
  await expect
    .poll(async () => (await edgeOf(SECOND.battle.id)).colour, {
      message: 'the fight just picked never took the brass edge',
    })
    .toBe(lit.colour);
  await expect
    .poll(async () => (await edgeOf(FIRST.battle.id)).colour, {
      message: 'the fight that was open never gave the brass edge up',
    })
    .toBe(unlit.colour);
  expect((await edgeOf(SECOND.battle.id)).width).toBe(lit.width);
});

for (const size of VIEWPORTS) {
  const tag = `${size.width}x${size.height}`;
  test(`lays out cleanly at ${tag}`, async ({ page }) => {
    await openBoard(page, size);

    // Nothing larger than the frame that clips it, measured at the real size.
    await expectNothingOverflowsTheScreen(page);

    /*
     * And both columns inside the window, measured where they actually are.
     *
     * The screen-root gate cannot see this on its own: both columns are `overflow-y: auto`, and a
     * box with one axis clipped computes the other to `auto` too, so a column that refuses to
     * shrink grows its own horizontal scrollbar and the frame around it never notices. A box that
     * runs off the right of the window is the thing a player sees, so that is what is measured.
     */
    const sideways = await page.evaluate(() =>
      ['coming-battles', 'battle-detail-pane']
        .map((id) => ({ id, el: document.querySelector(`[data-testid="${id}"]`) }))
        .filter((entry): entry is { id: string; el: Element } => entry.el !== null)
        .map((entry) => ({ id: entry.id, at: entry.el.getBoundingClientRect() }))
        .filter((entry) => entry.at.right > window.innerWidth + 1 || entry.at.left < -1)
        .map((entry) => `${entry.id}: ${entry.at.left.toFixed(0)}..${entry.at.right.toFixed(0)}px`),
    );
    expect(sideways, 'a column runs off the side of the window').toEqual([]);

    /*
     * Then the fold taken out of the way before the clip sweeps.
     *
     * A scroller cuts its last row by design, and both the rail and the detail are scrollers at
     * these heights. Growing the window until every scroller fits is what makes the sweep measure
     * the *layout* rather than how far down the page happened to be.
     */
    await growPastTheFold(page, size.width);
    await expectNothingClippedVertically(page, '[data-testid="coming-battles"]');
    await expectNothingClippedVertically(page, '[data-testid="battle-detail-pane"]');
    await expectNoImagesClipped(page, 'main section');
  });
}
