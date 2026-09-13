import { expect, test, type Page } from '@playwright/test';
import { findDistrict } from '@frontline/shared';
import { RIVAL_HOLD, districtDetail, me, ownProfile, rivalProfile } from './fixtures';
import {
  expectNoImagesClipped,
  expectNothingClippedVertically,
  growPastTheFold,
  installApi,
  settleFonts,
} from './harness';

/**
 * Who holds what, and the file behind a name (maintainer request, 2026-09-11).
 *
 * Three things the maintainer asked for on one afternoon and they are one feature: a location's window
 * is one template for every location and says plainly who holds it; a holder that is a player is
 * a door to their file; the file is the same page for you and for them. The fourth thing, the
 * ground toggle sitting over the box it opens, is a layout fact and is measured as one.
 */

const RUSTYARD = findDistrict('rustyard');
if (!RUSTYARD) throw new Error('fixture error: the Rustyard is missing from the city map');
const [MINE, LOOTED, RIVALS] = RUSTYARD.locations;
if (!MINE || !LOOTED || !RIVALS)
  throw new Error('fixture error: the Rustyard needs three locations');

async function openRustyard(page: Page, width = 1280, height = 900): Promise<void> {
  await page.setViewportSize({ width, height });
  await installApi(page, me);
  await page.goto('/game/city/rustyard');
  await expect(page.getByTestId('district-painting-rustyard')).toBeVisible();
  await settleFonts(page);
}

async function openLocation(page: Page, locationId: string): Promise<void> {
  const open = page.getByTestId('location-window');
  if ((await open.count()) > 0) {
    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);
  }
  await page.getByTestId(`site-${locationId}`).click();
  await expect(open).toBeVisible();
}

test.describe("a location's window", () => {
  test('is the same template for every location, in the same order', async ({ page }) => {
    await openRustyard(page);
    const shapes = new Set<string>();
    for (const location of RUSTYARD.locations) {
      await openLocation(page, location.id);
      const card = page.getByTestId(`location-${location.id}`);
      await expect(card.getByTestId(`vignette-${location.id}`)).toBeVisible();
      await expect(card.getByTestId(`holder-${location.id}`)).toBeVisible();
      // Section names are set in small caps, so `innerText` hands them back upper-cased.
      const labels = (await card.getByTestId('sheet-label').allInnerTexts()).map((label) =>
        label.toUpperCase(),
      );
      // The last section is the one thing that depends on the reader: your options on your own
      // ground, the way to take it on anybody else's. Everything before it is the template.
      const fixed = labels.filter((label) => label !== 'YOUR OPTIONS' && label !== 'TAKING IT');
      shapes.add(fixed.join('|'));
      expect(labels.at(-1), location.id).toMatch(/^(YOUR OPTIONS|TAKING IT)$/);
    }
    expect([...shapes], 'two locations laid their sheets out differently').toHaveLength(1);
    expect([...shapes][0]).toBe('WHAT IT IS|WHAT HOLDING IT PAYS|ON THE GROUND');
  });

  test('says who holds it: you, the looters, or a player with a file', async ({ page }) => {
    await openRustyard(page);

    await openLocation(page, MINE.id);
    const yours = page.getByTestId(`holder-${MINE.id}`);
    await expect(yours).toHaveAttribute('data-holder', 'you');
    await expect(yours).toContainText('You');
    await expect(yours).toContainText('Yours');
    await expect(yours.getByTestId(`holder-link-${MINE.id}`)).toHaveAttribute(
      'href',
      `/game/crews/${me.base?.id ?? ''}`,
    );

    await openLocation(page, LOOTED.id);
    const looted = page.getByTestId(`holder-${LOOTED.id}`);
    await expect(looted).toHaveAttribute('data-holder', 'looters');
    await expect(looted).toContainText('Looters');
    await expect(looted.getByRole('link')).toHaveCount(0);

    await openLocation(page, RIVALS.id);
    const theirs = page.getByTestId(`holder-${RIVALS.id}`);
    await expect(theirs).toHaveAttribute('data-holder', 'crew');
    await expect(theirs).toContainText(RIVAL_HOLD.crewName);
    await expect(theirs).toContainText(RIVAL_HOLD.player);
    await page.screenshot({ path: 'e2e-out/location-window-rival.png' });

    await theirs.getByTestId(`holder-link-${RIVALS.id}`).click();
    await expect(page).toHaveURL(new RegExp(`/game/crews/${RIVAL_HOLD.baseId}$`));
    await expect(page.getByTestId('crew-profile')).toHaveAttribute('data-you', 'false');
    await expect(page.getByRole('heading', { name: RIVAL_HOLD.crewName })).toBeVisible();
  });

  test("the sign's card names the holder too", async ({ page }) => {
    await openRustyard(page);
    const tip = page.getByRole('tooltip');
    await page.getByTestId(`site-${RIVALS.id}`).focus();
    await expect(tip).toContainText('Held by');
    await expect(tip).toContainText(RIVAL_HOLD.crewName);
    await expect(tip).toContainText(RIVAL_HOLD.player);
  });

  for (const size of [
    { width: 1024, height: 768 },
    { width: 1920, height: 1080 },
  ]) {
    test(`lays the window out cleanly at ${size.width}x${size.height}`, async ({ page }) => {
      await openRustyard(page, size.width, size.height);
      for (const id of [MINE.id, RIVALS.id]) {
        await openLocation(page, id);
        await expectNothingClippedVertically(page, '[data-testid="location-window"]');
        await expectNoImagesClipped(page, '[data-testid="location-window"]');
      }
      await page.screenshot({ path: `e2e-out/location-window-${size.width}.png` });
    });
  }
});

test.describe('the ground toggle and its box', () => {
  for (const size of [
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    test(`hangs the box directly under the button at ${size.width}x${size.height}`, async ({
      page,
    }) => {
      await openRustyard(page, size.width, size.height);
      const toggle = page.getByTestId('district-standing-toggle');
      await expect(page.getByTestId('district-standing')).toHaveCount(0);
      await toggle.click();
      const box = page.getByTestId('district-standing');
      await expect(box).toBeVisible();

      const [button, panel] = await Promise.all([toggle.boundingBox(), box.boundingBox()]);
      if (!button || !panel) throw new Error('the toggle or the box has no box');
      // Under it, close, and flush with it: the two read as one column.
      expect(panel.y, 'the box opened above its button').toBeGreaterThanOrEqual(
        button.y + button.height,
      );
      expect(
        panel.y - (button.y + button.height),
        'the box is far from its button',
      ).toBeLessThanOrEqual(16);
      expect(Math.abs(panel.x + panel.width - (button.x + button.width))).toBeLessThanOrEqual(2);

      // The bonus's name on a line of its own, the figure starting under it.
      const bonus = box.getByTestId('unified-bonus');
      await expect(bonus).toContainText(districtDetail.unified?.title ?? '');
      const [title, effect] = await Promise.all([
        bonus.locator('p').nth(0).boundingBox(),
        bonus.locator('p').nth(1).boundingBox(),
      ]);
      if (!title || !effect) throw new Error('the bonus lines have no box');
      expect(effect.y, 'the figure shares a line with the name').toBeGreaterThanOrEqual(
        title.y + title.height - 1,
      );

      await expect(toggle).toHaveText(/Hide the ground/i);
      await expectNothingClippedVertically(page, '[data-testid="district-standing-column"]');
      await page.screenshot({ path: `e2e-out/ground-box-${size.width}.png` });
      await toggle.click();
      await expect(box).toHaveCount(0);
    });
  }
});

test.describe("a crew's file", () => {
  const VIEWPORTS = [
    { width: 1024, height: 768 },
    { width: 1280, height: 800 },
    { width: 1920, height: 1080 },
  ] as const;

  test('is yours by either of your ids, and offers your own doors', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await installApi(page, me);
    await page.goto(`/game/crews/${me.user.id}`);
    const file = page.getByTestId('crew-profile');
    await expect(file).toHaveAttribute('data-you', 'true');
    await expect(page.getByTestId('profile-player')).toHaveText(ownProfile.player.name);
    await expect(page.getByTestId('profile-your-sheet')).toHaveAttribute('href', '/game/overseer');
    await expect(page.getByTestId('profile-visit')).toHaveCount(0);
    await expect(page.getByTestId('profile-standing')).toContainText('#3');
    await page.screenshot({ path: 'e2e-out/profile-own.png' });
  });

  test("somebody else's names them, their table and what they hold", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await installApi(page, me);
    await page.goto(`/game/crews/${RIVAL_HOLD.baseId}`);
    const file = page.getByTestId('crew-profile');
    await expect(file).toHaveAttribute('data-you', 'false');
    await expect(page.getByTestId('profile-player')).toHaveText(RIVAL_HOLD.player);
    await expect(page.getByTestId('profile-overseer')).toHaveText(
      rivalProfile.overseer?.name ?? '',
    );
    await expect(page.getByTestId('profile-faction')).toContainText('The Ninth Circle');
    await expect(page.getByTestId('profile-visit')).toHaveAttribute(
      'href',
      `/game/city/${rivalProfile.crew.districtId}`,
    );
    await expect(page.getByTestId('profile-your-sheet')).toHaveCount(0);
    for (const hold of rivalProfile.holdings) {
      await expect(page.getByTestId(`profile-holding-${hold.locationId}`)).toBeVisible();
    }
    await expect(page.getByTestId('profile-hidden-holdings')).toContainText('2 more');
    await expect(page.getByTestId('profile-whole-districts')).toContainText('Chrome Row');
    await expect(page.getByTestId('profile-buildings').getByRole('listitem')).toHaveCount(
      rivalProfile.home.buildings.length,
    );
    await page.screenshot({ path: 'e2e-out/profile-rival.png' });
  });

  test('is a door off the standings', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await installApi(page, me);
    await page.goto('/game/leaderboard');
    await page.getByTestId('standing-link-Vex_Combine').click();
    await expect(page).toHaveURL(/\/game\/crews\/vex-user$/);
    await expect(page.getByTestId('crew-profile')).toBeVisible();
  });

  for (const size of VIEWPORTS) {
    test(`lays out cleanly at ${size.width}x${size.height}`, async ({ page }) => {
      await page.setViewportSize(size);
      await installApi(page, me);
      await page.goto(`/game/crews/${RIVAL_HOLD.baseId}`);
      await expect(page.getByTestId('crew-profile')).toBeVisible();
      await growPastTheFold(page, size.width);
      await expectNothingClippedVertically(page, '[data-testid="page-sheet"]');
      await expectNoImagesClipped(page, '[data-testid="page-sheet"]');
    });
  }
});
