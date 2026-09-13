/**
 * The returned list, and the report behind a row (maintainer, 2026-09-12).
 *
 * The row used to print four lines per crew and six crews of it filled the left column. It now
 * carries three things and opens a window for the rest, which puts two new failure modes in a
 * place only a browser can see them: a row that is a real control and still reads as one line of
 * text, and a document in a `max-w-[52rem]` box that has to hold a six-resource haul, a crew line
 * and a list of drops without cutting any of them.
 *
 * jsdom lays nothing out, so the unit tests beside this file can only prove the words are present.
 * What is measured here is that they are on screen and whole.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { lateGame } from './fixtures';
import {
  expectNothingClippedVertically,
  expectNothingOverflowsTheScreen,
  installApi,
  settleFonts,
} from './harness';

test.use({ viewport: { width: 1280, height: 800 } });

/** The crews-returned panel, which is where every row in this file lives. */
const returnedList = (page: Page): Locator => page.getByRole('list', { name: 'Crews returned' });

/** Text that has been ellipsised or cut inside `root`, by its own measurement. */
async function cutText(root: Locator): Promise<string[]> {
  return root.evaluate((node) =>
    [...node.querySelectorAll<HTMLElement>('*')]
      .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim().length > 0)
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .map((el) => `"${el.textContent?.trim().slice(0, 40)}" (${el.scrollWidth}>${el.clientWidth})`)
      .slice(0, 5),
  );
}

test('a returned row is three facts, and the window behind it is the rest', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/missions');
  await expect(page.getByTestId('board-area')).toBeVisible();
  await settleFonts(page);

  // The fat row on the fixture: an under-carried expedition that paid all six resources.
  const row = page.getByTestId('mission-open-m-5');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Deep Expedition');
  await expect(row).toContainText('Success');
  await expect(row).toContainText('268');

  // And nothing else. The leader, the losses and the page all moved off the row, and an assertion
  // on the window alone would pass on a row that still printed them underneath.
  await expect(page.getByTestId('mission-leader-m-5')).toHaveCount(0);
  await expect(page.getByTestId('mission-losses-m-5')).toHaveCount(0);
  await expect(page.getByTestId('mission-page-m-5')).toHaveCount(0);
  expect(await cutText(returnedList(page)), 'cut text on a collapsed row').toEqual([]);

  await page.screenshot({ path: 'screenshots/mission-returned-rows.png', fullPage: false });

  await row.click();
  const report = page.getByTestId('mission-report-m-5');
  await expect(report).toBeVisible();

  // Outcome and ground at the top, then the facts that are one number each.
  await expect(page.getByTestId('mission-outcome-m-5')).toHaveText('Success · Odd jobs');
  await expect(page.getByTestId('mission-leader-m-5')).toBeVisible();
  await expect(report).toContainText('240 XP');
  await expect(report).toContainText('Round trip');

  // Who went and who walked back in. Nobody died on this one, which is the answer a player opens
  // a report looking for.
  await expect(page.getByTestId('mission-losses-m-5')).toHaveText('Everybody came home');
  await expect(report).toContainText('Razors 3, Scavengers 4');

  /*
   * The haul, carried against earned.
   *
   * This is the only place in the game that says a crew was under-carried, and the fixture is the
   * under-carried case on purpose: `268 of 402` is the sentence, and the shortfall note under it
   * is what makes it actionable.
   */
  await expect(page.getByTestId('haul-caps')).toContainText('268');
  await expect(page.getByTestId('haul-caps')).toContainText('of 402');
  await expect(page.getByTestId('mission-carry-m-5')).toContainText('could not carry everything');

  // The drops, by name, with the won page named once rather than twice.
  const drops = page.getByTestId('mission-drops-m-5');
  await expect(drops.getByTestId('mission-page-m-5')).toContainText('Barrel Liners');
  await expect(drops).toContainText('Rotor Hub');
  await expect(drops).toContainText('Ceramic Plate');
  await expect(drops.getByRole('listitem')).toHaveCount(3);

  await settleFonts(page);
  await expect(report).toHaveAttribute('aria-modal', 'true');
  // The window is labelled by its own heading, not by the row that opened it.
  const labelledBy = await report.getAttribute('aria-labelledby');
  await expect(page.locator(`#${labelledBy}`)).toHaveText('Deep Expedition');

  expect(await cutText(report), 'cut text inside the report').toEqual([]);
  await expectNothingOverflowsTheScreen(page);

  // The window fits the frame it is drawn in. It is allowed to scroll inside itself; it is not
  // allowed to hang off the top or the bottom of the browser, which is how a dialog ends up with
  // a Close button nobody can reach.
  const fit = await report.evaluate((box) => {
    const at = box.getBoundingClientRect();
    return { top: Math.round(at.top), bottom: Math.round(at.bottom), height: window.innerHeight };
  });
  expect(fit.top, `the window starts at ${fit.top}px`).toBeGreaterThanOrEqual(0);
  expect(fit.bottom, `the window ends at ${fit.bottom}px of ${fit.height}`).toBeLessThanOrEqual(
    fit.height,
  );

  await page.screenshot({ path: 'screenshots/mission-report-window.png', fullPage: false });

  /*
   * And now the sweep, on a viewport tall enough to hold the whole document.
   *
   * `expectNothingClippedVertically` reports anything an overflow ancestor cuts, and the window's
   * body is a scroller by design: at 800px tall it legitimately cuts whatever is below the fold,
   * so running the sweep there measures the scroller rather than the layout. Grown past the fold
   * the report fits in one piece, and anything still sliced is sliced by a real bug.
   */
  await page.setViewportSize({ width: 1280, height: 1400 });
  await settleFonts(page);
  await expectNothingClippedVertically(page, '[data-testid="mission-report-m-5"]');
  expect(await cutText(report), 'cut text in the report, unfolded').toEqual([]);

  // And it shuts, by the key every other window in the game shuts on.
  await page.keyboard.press('Escape');
  await expect(report).toHaveCount(0);
});

/**
 * A run nobody came back from keeps its one sentence and opens nothing.
 *
 * There is no report to draw: the whole force was lost, so nobody wrote one. A window that opened
 * on an empty document would be the game answering a question nobody survived to ask.
 */
test('a run nobody came back from opens no window', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/missions');
  await expect(page.getByTestId('mission-silent-m-8')).toBeVisible();

  await expect(page.getByTestId('mission-open-m-8')).toHaveCount(0);
  await expect(page.getByTestId('mission-silent-m-8')).toHaveText('Nobody came back');
});

/**
 * A crew still out is a door to the Actions tab, and the recall X is not part of that door.
 *
 * The X sits beside the link rather than inside it, because an anchor with a button in it is
 * invalid and `stopPropagation` cannot save it: stopping the synthetic event before react-router's
 * handler sees it means `preventDefault` is never called, so the browser follows the href for real
 * and reloads the whole app. Both halves are measured here, because the failure of the second one
 * looks like a working link.
 */
test('an in-flight row goes to the Actions tab, and the recall X does not', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/missions');

  const track = page.getByTestId('mission-track-m-1');
  await expect(track).toBeVisible();
  await expect(track).toHaveAttribute('href', '/game/actions');

  // The X is live on this crew (one minute into a day-long run) and it is outside the link.
  const recall = page.getByTestId('recall-mission-m-1');
  await expect(recall).toBeVisible();
  expect(await track.locator('[data-testid="recall-mission-m-1"]').count()).toBe(0);

  // Pressing it calls the crew back and leaves the player on the missions page.
  const recalled = page.waitForRequest(
    (request) => request.url().includes('/api/missions/recall') && request.method() === 'POST',
  );
  await recall.click();
  await recalled;
  await expect(page).toHaveURL(/\/game\/missions$/);

  // And the row itself still navigates.
  await page.getByTestId('mission-track-m-1').click();
  await expect(page).toHaveURL(/\/game\/actions$/);
});
