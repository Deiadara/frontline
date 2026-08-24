import { expect, test } from '@playwright/test';
import { notorietyTier, notorietyUpgradeCost } from '@frontline/shared';
import { lateGame, notorious } from './fixtures';
import { expectNothingClippedVertically, installApi, settleFonts } from './harness';

test.use({ viewport: { width: 1600, height: 900 } });

/**
 * §D7 — the wallet, the rank, and the ladder between them.
 *
 * The unit suite pins the arithmetic. What only a browser answers is whether a player can *find*
 * the ladder: it lives behind a hover on a chip in the standing bar, the card carries the only copy
 * of the price, and the button inside it is the only way to buy a rank. A card the pointer cannot
 * reach would make the whole mechanic unreachable while every unit test stayed green.
 */

test('the standing bar names the rank beside the points', async ({ page }) => {
  await installApi(page, notorious);
  await page.goto('/game');

  const chip = page.getByTestId('infamy-chip');
  await expect(chip).toBeVisible();
  await expect(page.getByTestId('notoriety-tier')).toHaveText(
    notorietyTier(notorious.base!.economy.notoriety),
  );
  await expect(chip).toContainText(String(notorious.base!.economy.infamy));
});

test('hovering the chip opens the ladder, and the button buys the next rung', async ({ page }) => {
  await installApi(page, notorious);
  await page.goto('/game');

  const at = notorious.base!.economy.notoriety;
  await page.getByTestId('infamy-hover').hover();

  const next = page.getByTestId('notoriety-next');
  await expect(next).toBeVisible();
  await expect(next).toContainText(notorietyTier(at + 1));
  await expect(next).toContainText(notorietyUpgradeCost(at)!.toLocaleString());

  await settleFonts(page);
  await expectNothingClippedVertically(page, '[role="tooltip"]');
  await page.screenshot({ path: 'e2e-out/standing-ladder.png' });

  // The card has to survive the pointer crossing the gap to reach the button inside it.
  const buy = page.getByTestId('upgrade-tier');
  await expect(buy).toBeEnabled();
  await buy.click();

  await expect(page.getByTestId('notoriety-tier')).toHaveText(notorietyTier(at + 1));
});

test('a crew short of the price is told how far short, and cannot buy', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game');

  await page.getByTestId('infamy-hover').hover();
  const next = page.getByTestId('notoriety-next');
  const short = notorietyUpgradeCost(0)! - lateGame.base!.economy.infamy;
  await expect(next).toContainText(`${short.toLocaleString()} short`);
  await expect(page.getByTestId('upgrade-tier')).toBeDisabled();
});
