import { expect, test } from '@playwright/test';
import { lateGame, missionsResponse } from './fixtures';
import {
  expectNothingClippedVertically,
  expectNothingOverflowsTheScreen,
  installApi,
  settleFonts,
} from './harness';

/**
 * Two lines the maintainer moved on 2026-09-23.
 *
 * The worked-area notice on the mission board was a line of body text at the top of an empty
 * board; it is the board's whole state now, centred in the pen inside a hand-inked box. And the
 * Actions page's "Out on a job" section no longer explains the recall window under its title: the
 * X on each row is the explanation.
 */
test.use({ viewport: { width: 1440, height: 900 } });

test('a worked area is one centred, boxed sentence in the pen', async ({ page }) => {
  await installApi(page, lateGame);
  await page.route('**/api/missions', (route) => route.fulfill({ json: missionsResponse() }));
  await page.goto('/game/missions');
  await settleFonts(page);

  // The fixture's third board (the Rustyard) has m-1 working it. Step to it.
  const worked = page.getByTestId('area-worked');
  for (let step = 0; step < 6 && !(await worked.isVisible()); step += 1) {
    await page.getByTestId('board-right').click();
  }
  await expect(worked).toBeVisible();
  await expect(worked).toContainText('One of your crews is working this area');
  await expect(worked).toHaveClass(/ink-frame/);
  await expect(worked).toHaveClass(/font-stamp/);

  // Centred in the board: the box's middle sits within a few pixels of the board's.
  const board = await page.getByTestId('mission-board').boundingBox();
  const box = await worked.boundingBox();
  if (!board || !box) throw new Error('board or box not laid out');
  expect(Math.abs(box.x + box.width / 2 - (board.x + board.width / 2))).toBeLessThan(8);

  await expectNothingOverflowsTheScreen(page);
  await expectNothingClippedVertically(page, '[data-testid="mission-board"]');
  await page.screenshot({ path: 'screenshots/missions/area-worked.png' });
});

test('the jobs section on the road carries no recall sentence under its title', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/actions');
  await settleFonts(page);
  await expect(page.getByTestId('jobs')).toBeVisible();
  await expect(page.getByTestId('road')).not.toContainText(/can still be called back/);
});
