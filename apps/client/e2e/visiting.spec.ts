/**
 * Standing in somebody else's district (board request).
 *
 * It used to be a thumbnail in a column: a picture of a place rather than a place, with nothing to
 * do with the roofs you could see. It is a screen now, the same screen your own district is, with
 * the same name plate under each building.
 *
 * §A4, board 2026-09-09: **one call, and it is about the district.** A home is shut by the crew
 * living on it, so while their Gate stands the only thing to hit is the gate, and inside the day a
 * breach lasts the only thing to hit is the whole place at once. The plates are information now;
 * they used to each offer a fight, which meant turning a district over cost thirteen declarations
 * against a cap of three.
 */
import { expect, test, type Page } from '@playwright/test';
import { me } from './fixtures';
import { expectNothingClippedVertically, installApi, settleFonts } from './harness';

/** A residential district somebody else lives on, with its gate still standing. */
const THEIRS = 'ashen-terraces';

/** ...and one whose gate is down, so the raid behind it is the call on offer. */
const BREACHED = 'south-quay';

/** The crew on both plots, in the `NEIGHBOUR` fixture. The sign over the painting prints it. */
const NEIGHBOUR_NAME = 'The Ashen Sons';

const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
] as const;

type Size = (typeof VIEWPORTS)[number];

async function visit(page: Page, size: Size = VIEWPORTS[2], districtId = THEIRS): Promise<void> {
  await page.setViewportSize(size);
  await installApi(page, me);
  await page.goto(`/game/city/${districtId}`);
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

test('says whose plot it is, on the plate the standing bar uses for your own', async ({ page }) => {
  await visit(page);

  // The crew's name, not the map's number for the plot. The map numbers them because there the
  // reader is a stranger to nine of the ten; here they have walked in.
  const sign = page.getByTestId('visited-district-name');
  await expect(sign).toBeVisible();
  await expect(sign).toHaveText(NEIGHBOUR_NAME);
  await expect(sign).not.toContainText('Player District');
});

test('a building opens what it is, and offers no fight of its own', async ({ page }) => {
  await visit(page);

  // Shut first, in the same test: an absence check that only ever runs before the click passes
  // just as happily against a page where the plate does nothing at all.
  await expect(page.getByTestId('visited-building')).toHaveCount(0);

  await page.getByTestId('plot-scrapyard').click();
  const dialog = page.getByTestId('visited-building');
  await expect(dialog).toBeVisible();

  // What it is and how far along it is, and that is the whole of it.
  await expect(dialog).toContainText('The Scrapyard');
  await expect(dialog).toContainText('Standing at level');
  // The per-roof fight is gone: one raid on the district replaced thirteen of these.
  await expect(page.getByTestId('call-building')).toHaveCount(0);

  // And nothing that belongs to your own ground: there is nothing here for you to build.
  await expect(dialog).not.toContainText('Upgrade');
  await expect(dialog).not.toContainText('Build it');
});

test('offers the gate while it stands, and the raid only once it is down', async ({ page }) => {
  await visit(page);

  await expect(page.getByTestId('call-gate')).toBeEnabled();
  // The two are exclusive: while the door is on, nothing behind it can be reached.
  await expect(page.getByTestId('call-district')).toHaveCount(0);

  // The sign, the way back and the one call all sit in one row over the painting, so the row is
  // what has to be looked at: filed for the board and swept for clipping in the same breath.
  await expectNothingClippedVertically(page);
  await page.screenshot({ path: 'e2e-out/visiting-gate.png', fullPage: true });
});

test('calls the raid inside a breach, with the time the breach has left', async ({ page }) => {
  await visit(page, VIEWPORTS[2], BREACHED);

  await expect(page.getByTestId('call-gate')).toHaveCount(0);
  const raid = page.getByTestId('call-district');
  await expect(raid).toBeEnabled();
  // The clock, so a player can tell a window that is closing from one that has just opened. Nine
  // hours in the fixture, and the countdown is drawn rather than the raw timestamp.
  await expect(raid).toContainText('left');
  await expect(raid).toContainText('8h');

  // And the call goes through: the declare dialog opens on the district, and the harness answers
  // the write. A control that opened nothing would pass every assertion above.
  await raid.click();
  const dialog = page.getByTestId('declare-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(`a raid on ${NEIGHBOUR_NAME}`);
  await page.screenshot({ path: 'e2e-out/visiting-raid-dialog.png', fullPage: true });
  await page.getByTestId('declare-confirm').click();
  await expect(dialog).toHaveCount(0);

  await expectNothingClippedVertically(page);
  await page.screenshot({ path: 'e2e-out/visiting-raid.png', fullPage: true });
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
