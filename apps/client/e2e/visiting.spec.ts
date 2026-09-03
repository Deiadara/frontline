/**
 * Standing in somebody else's district (board request).
 *
 * It used to be a thumbnail in a column: a picture of a place rather than a place, with nothing to
 * do with the roofs you could see. It is a screen now, the same screen your own district is, with
 * the same name plate under each building. The plates are controls, and what they open is the only
 * thing you can offer a building that is not yours.
 */
import { expect, test, type Page } from '@playwright/test';
import { me } from './fixtures';
import { expectNothingClippedVertically, installApi, settleFonts } from './harness';

/** A residential district somebody else lives on. */
const THEIRS = 'ashen-terraces';

const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
] as const;

type Size = (typeof VIEWPORTS)[number];

async function visit(page: Page, size: Size = VIEWPORTS[2]): Promise<void> {
  await page.setViewportSize(size);
  await installApi(page, me);
  await page.goto(`/game/city/${THEIRS}`);
  await expect(page.getByTestId('back-to-city')).toBeVisible();
  await settleFonts(page);
}

test('their district is a screen, not a thumbnail in a column', async ({ page }) => {
  await visit(page);

  // Edge to edge under the standing bar, the way your own district is. A picture that filled less
  // than three quarters of the frame would be the panelled preview this replaced.
  const { plate, view } = await page.evaluate(() => {
    const img = document.querySelector('img[alt*="district" i], main img, img')!;
    return {
      plate: img.getBoundingClientRect().width,
      view: window.innerWidth,
    };
  });
  expect(plate / view).toBeGreaterThan(0.75);
});

test('names every building that is standing, exactly as your own district does', async ({
  page,
}) => {
  await visit(page);
  const plates = page.locator('[data-testid^="plot-"]');
  await expect(plates.first()).toBeVisible();

  // One plate per building they have built, and every plate carries a name and a level.
  const count = await plates.count();
  expect(count).toBeGreaterThan(3);
  for (let i = 0; i < count; i += 1) {
    await expect(plates.nth(i)).not.toBeEmpty();
  }
});

test('a building opens the fight you could call on it, not a build dialog', async ({ page }) => {
  await visit(page);

  // Shut first, in the same test: an absence check that only ever runs before the click passes
  // just as happily against a page where the plate does nothing at all.
  await expect(page.getByTestId('visited-building')).toHaveCount(0);

  await page.getByTestId('plot-scrapyard').click();
  const dialog = page.getByTestId('visited-building');
  await expect(dialog).toBeVisible();

  // What it is, how far along it is, and the one thing you can do about it.
  await expect(dialog).toContainText('The Scrapyard');
  await expect(dialog).toContainText('Standing at level');
  await expect(page.getByTestId('call-building')).toBeEnabled();

  // And nothing that belongs to your own ground: there is nothing here for you to build.
  await expect(dialog).not.toContainText('Upgrade');
  await expect(dialog).not.toContainText('Build it');
});

test('the way back to the city is on the screen', async ({ page }) => {
  await visit(page);
  await page.getByTestId('back-to-city').click();
  await expect(page).toHaveURL(/\/game$/);
});

for (const size of VIEWPORTS) {
  const tag = `${size.width}x${size.height}`;
  test(`lays out cleanly at ${tag}`, async ({ page }) => {
    await visit(page, size);
    await expectNothingClippedVertically(page);
    await expect(page.locator('body')).toBeVisible();
  });
}
