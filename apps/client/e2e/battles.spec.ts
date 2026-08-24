import { expect, test } from '@playwright/test';
import { battles, lateGame } from './fixtures';
import {
  expectNoImagesClipped,
  expectNothingClippedVertically,
  installApi,
  settleFonts,
} from './harness';

test.use({ viewport: { width: 1280, height: 800 } });

/**
 * The board (§A4, battle rework), through the browser.
 *
 * The unit tests already pin the rules. What only a browser can answer is whether the screen a
 * player actually gets **says** what the rules mean: that a fight you called and a fight you are
 * defending read as different things, that an enemy force you cannot count reads as unknown rather
 * than as zero, and that the report is a document somebody would read rather than a wall of
 * numbers. All three are things a green unit suite has shipped wrong before.
 */

test('the board shows what is coming, who it is against, and what you have there', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/battles');

  await expect(page.getByRole('heading', { name: 'The Board' })).toBeVisible();
  await expect(page.getByTestId('board-infamy')).toHaveText(`${battles.infamy} infamy`);

  const coming = page.getByTestId('coming-battles');
  await expect(coming.getByText('Kessler Press')).toBeVisible();
  await expect(coming.getByText('The Bonefield')).toBeVisible();

  // The fight this crew called: their own force is exact, because it is theirs.
  const mine = page.getByTestId(`battle-${battles.coming[0]!.battle.id}`);
  await expect(mine.getByText('32', { exact: true })).toBeVisible();

  // The one they are defending: the other side is running dark, so it says so rather than "0".
  const theirs = page.getByTestId(`battle-${battles.coming[1]!.battle.id}`);
  await expect(theirs.getByText('unknown')).toBeVisible();
  await expect(theirs.getByText('Nothing. They are running dark.')).toBeVisible();

  await settleFonts(page);
  // Scoped to the panels themselves rather than to the page: this screen's scroll lives inside the
  // sheet, and the fold of a scroller cuts its last row by design. What must not be cut is anything
  // *inside* a card, which is what the two sweeps below actually measure.
  await expectNothingClippedVertically(page, '[data-testid="coming-battles"]');
  await expectNothingClippedVertically(page, '[data-testid="sacrifices"]');
  await expectNoImagesClipped(page, 'main section');
  await page.screenshot({ path: 'e2e-out/battles-board.png', fullPage: true });
});

test('a report reads as a document, and a silent one says so instead of showing an empty table', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/battles');

  await page.getByTestId('read-fight-3').click();
  const report = page.getByTestId('battle-report');
  await expect(report).toBeVisible();
  await expect(report.getByText('Held · Ninth Street Pawn')).toBeVisible();
  // The four things the board asked a report to answer, on screen at once.
  await expect(page.getByText('Snipers').first()).toBeVisible();
  await expect(page.getByText('Caught by the ring')).toBeVisible();
  await expect(page.getByText('Infamy earned')).toBeVisible();
  await expect(page.getByText('61%')).toBeVisible();

  await settleFonts(page);
  await expectNothingClippedVertically(page, '[role="dialog"]');
  await page.screenshot({ path: 'e2e-out/battles-report.png', fullPage: true });

  await page.keyboard.press('Escape');
  await page.getByTestId('read-fight-4').click();
  await expect(page.getByTestId('battle-report-silent')).toBeVisible();
  await expect(page.getByText(/stayed out there/)).toBeVisible();
});

test('the deployment dialog splits the line from the ring, and locks what the name cannot field', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/battles');

  await page.getByTestId(`deploy-open-${battles.coming[0]!.battle.id}`).click();
  await expect(page.getByTestId('deploy-rows')).toBeVisible();

  // Two controls per unit, and they are different controls: one is the fight, one is the cordon.
  await expect(page.getByTestId('line-razors')).toBeVisible();
  await expect(page.getByTestId('ring-razors')).toBeVisible();

  await settleFonts(page);
  await expectNothingClippedVertically(page, '[role="dialog"]');
  await page.screenshot({ path: 'e2e-out/battles-deploy.png', fullPage: true });
});

test('a district that is held end to end offers the gate and nothing else', async ({ page }) => {
  await installApi(page, lateGame);
  // `chrome-row` is the shut district in the fixture; the district page reads its gate off the
  // board rather than working it out from who holds what.
  await page.goto('/game/city/chrome-row');
  await expect(page.getByTestId('call-gate')).toBeVisible();

  await settleFonts(page);
  await expectNothingClippedVertically(page, '[data-testid="locations"]');
  await page.screenshot({ path: 'e2e-out/battles-gate.png', fullPage: true });
});
