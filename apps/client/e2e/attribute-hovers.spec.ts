import { attributeUse } from '@frontline/shared';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { lateGame } from './fixtures';
import { installApi, settleFonts } from './harness';

/**
 * What an attribute is good for, on hover (maintainer, 2026-10-01): one shared line per attribute
 * (`attributeUse`). Since 2026-10-04 it is the Training tab's alone: the officer, Overseer and Bar
 * sheets dropped it, and a sheet row's tip is the chair's tag line and the lift receipt, or nothing.
 */

test.use({ viewport: { width: 1280, height: 800 } });

// Read off the shared line, so a copy edit in `attributeUse` does not strand this spec.
const SPY = attributeUse('signals');

/** The sheet row for one attribute, found by its label, wherever the sheet is drawn. */
const rowOf = (scope: Locator, label: string): Locator =>
  scope.locator('li[data-tip]').filter({ has: scope.page().getByText(label, { exact: true }) });

async function tipFor(page: Page, row: Locator): Promise<Locator> {
  await row.hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  return tip;
}

test("the officer window's tip is the chair's tag, not what the skill is for", async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/crew');
  await page.getByTestId('seat-field_commander').click();
  const detail = page.getByTestId('crew-detail');
  await expect(detail).toBeVisible();
  await settleFonts(page);
  // Signals rather than Cryptography: the last row sits under the window's fold at this height,
  // and the scroll that brings it up shuts a tip by design (`TooltipLayer`).
  const tip = await tipFor(page, detail.getByTestId('attr-signals'));
  await expect(tip).not.toContainText(SPY);
  await expect(tip).toContainText(/this chair's grade|Counts for a little/);
  await expect(tip).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: 'e2e-out/hover-crew-signals.png' });
});

test("the Bar's recruit sheet carries no line on what a skill is for", async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/bar');
  await page.getByTestId('sit-down').click();
  await expect(page.getByTestId('recruit-name')).toBeVisible();
  await settleFonts(page);
  // A recruit has no chair and no lift yet, so no row of their sheet has a tip at all.
  await expect(page.getByText('Chemistry', { exact: true }).first()).toBeVisible();
  await expect(rowOf(page.locator('body'), 'Chemistry')).toHaveCount(0);
  await page.screenshot({ path: 'e2e-out/hover-bar-chemistry.png' });
});

test('the Training tab says what each skill is for', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/training');
  await expect(page.getByTestId('training-sheet')).toBeVisible();
  await settleFonts(page);
  await page.getByTestId('drill-signals').hover();
  const use = page.getByTestId('drill-use-signals');
  await expect(use).toHaveText(SPY);
  await expect(use).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: 'e2e-out/hover-training-signals.png' });
});
