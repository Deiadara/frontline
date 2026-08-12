import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

test('auth screen renders the access terminal', async ({ page }) => {
  await page.goto('/auth');
  await expect(page.getByRole('heading', { name: 'FRONTLINE' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jack In' })).toBeVisible();
  await page.screenshot({ path: 'screenshots/auth.png', fullPage: false });
});
