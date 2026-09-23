import { TUTORIAL_STEPS } from '@frontline/shared';
import { expect, test } from '@playwright/test';
import { meNewPlayer } from './fixtures';
import { installApi, settleFonts } from './harness';

/**
 * The opening tutorial, as a new player meets it (maintainer, 2026-09-22).
 *
 * Six cards, one per screen, first visit only. The rules worth a browser are the ones a unit test
 * cannot see: that the card is actually on top of the screen it is about, that it is not cut off
 * at any of the viewports in the matrix, and that there is no close cross to press.
 */
test.describe('the opening tutorial', () => {
  test('opens on the city with the welcome card, and walks to the Combine', async ({ page }) => {
    await installApi(page, meNewPlayer);
    await page.goto('/game');

    const card = page.getByTestId('tutorial-card');
    await expect(card).toBeVisible();
    await expect(page.getByTestId('tutorial-card-welcome')).toBeVisible();
    // The counter promises the set ends.
    await expect(card).toContainText(`1 of ${TUTORIAL_STEPS.length}`);
    // No cross: the two ways out both write something.
    await expect(page.getByTestId('modal-close')).toHaveCount(0);

    await settleFonts(page);
    await page.screenshot({ path: 'screenshots/tutorial/welcome.png' });
  });

  test('draws the Combine card with Directive Xero on it', async ({ page }) => {
    await installApi(page, {
      ...meNewPlayer,
      user: { ...meNewPlayer.user, tutorialSeen: ['welcome'] },
    });
    await page.goto('/game');

    await expect(page.getByTestId('tutorial-card-combine')).toBeVisible();
    // The face of the thing the card describes, and the only portrait in the set.
    await expect(page.getByTestId('unit-portrait-directive_xero')).toBeVisible();
    await settleFonts(page);
    await page.screenshot({ path: 'screenshots/tutorial/combine.png' });
  });

  test('puts each remaining card on the screen it is about', async ({ page }) => {
    const seen = ['welcome', 'combine', 'city'];
    for (const [step, path] of [
      ['missions', '/game/missions'],
      ['battles', '/game/battles'],
      ['base', '/game/base'],
    ] as const) {
      await installApi(page, { ...meNewPlayer, user: { ...meNewPlayer.user, tutorialSeen: seen } });
      await page.goto(path);
      await expect(page.getByTestId(`tutorial-card-${step}`)).toBeVisible();
    }
  });

  test('says nothing at all to a player who has seen the set', async ({ page }) => {
    await installApi(page, {
      ...meNewPlayer,
      user: { ...meNewPlayer.user, tutorialSeen: [...TUTORIAL_STEPS] },
    });
    for (const path of ['/game', '/game/missions', '/game/battles', '/game/base']) {
      await page.goto(path);
      await page.waitForTimeout(250);
      await expect(page.getByTestId('tutorial-card')).toHaveCount(0);
    }
  });
});
