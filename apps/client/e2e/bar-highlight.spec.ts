/**
 * The Bar's recruit file, three rulings from the maintainer on 2026-10-04.
 *
 * "Highlight important attributes for role" is always there, offering every chair, even when the
 * crew has all thirteen filled: it used to offer only the open ones and vanished with the last.
 * The attribute rows no longer carry a hover saying what each skill is good for. A recruit with no
 * perks reads "Nothing special".
 */
import { OFFICER_ROLES } from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import { adminGame, bar } from './fixtures';
import { installApi, settleFonts } from './harness';

/** The fixture's recruit with no perks. */
const PLAIN = 'bar-2';

async function openCard(page: Page, recruitId: string): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installApi(page, adminGame);
  // Every chair taken. Registered after the harness, so it is matched first.
  await page.route(
    (url) => url.pathname.endsWith('/api/bar'),
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: { ...bar, filledRoles: [...OFFICER_ROLES] } })
        : route.fallback(),
  );
  await page.goto('/game/bar');
  await settleFonts(page);
  await page.getByTestId('sit-down').click();
  await expect(page.getByTestId('bar-file')).toBeVisible();
  const card = page.getByTestId(`recruit-${recruitId}`);
  for (let step = 0; step < bar.recruits.length; step += 1) {
    if ((await card.count()) > 0) return;
    if (await page.getByTestId('seat-on').isDisabled()) break;
    await page.getByTestId('seat-on').click();
  }
  throw new Error(`${recruitId} is not at the bar tonight`);
}

test('the role highlight offers every chair, with all thirteen filled', async ({ page }) => {
  await openCard(page, PLAIN);
  const picker = page.getByTestId('highlight-role');
  await expect(picker).toBeVisible();
  await picker.click();
  await expect(page.getByRole('option')).toHaveCount(OFFICER_ROLES.length);
  await page.screenshot({ path: 'screenshots/bar/highlight-all-roles.png' });
});

test('a recruit with no perks reads "Nothing special", and a row has no hover', async ({
  page,
}) => {
  await openCard(page, PLAIN);
  const card = page.getByTestId(`recruit-${PLAIN}`);
  await expect(card).toContainText('Nothing special');
  await card.getByText('Navigation', { exact: true }).hover();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await card.screenshot({ path: 'screenshots/bar/recruit-nothing-special.png' });
});
