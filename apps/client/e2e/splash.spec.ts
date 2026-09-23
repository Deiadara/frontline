import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

test('auth screen renders the access terminal', async ({ page }) => {
  await page.goto('/auth');
  await expect(page.getByRole('heading', { name: 'FRONTLINE' })).toBeVisible();
  // Two handles first (maintainer, 2026-09-23), and the form behind the one that is pressed.
  await expect(page.getByTestId('auth-choose-register')).toBeVisible();
  await page.getByTestId('auth-choose-login').click();
  await expect(page.getByRole('button', { name: 'Jack In' })).toBeVisible();
  await page.screenshot({ path: 'screenshots/auth.png', fullPage: false });
});
