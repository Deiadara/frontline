import { expect, test, type Page } from '@playwright/test';
import { MAX_LOCATION_LEVEL, findDistrict } from '@frontline/shared';
import { districtDetail, me } from './fixtures';
import {
  expectNoImagesClipped,
  expectNothingClippedVertically,
  installApi,
  settleFonts,
} from './harness';

/**
 * The city as a board (GDD §A4): locations, what the ground is like, and working one up.
 *
 * Three things a player has to be able to *see*, and none of them are visible to a unit test:
 * the environment labels with their tiers, the level a location has been worked up to, and the
 * upgrade offer with the authored sentence saying what it buys. All three arrive on the same card,
 * so they are measured on the same card.
 */

const RUSTYARD = findDistrict('rustyard');
if (!RUSTYARD) throw new Error('fixture error: the Rustyard is missing from the city map');

/** The one the fixture hands the crew, so it is the one with an upgrade button on it. */
const MINE = RUSTYARD.locations[0];
if (!MINE) throw new Error('fixture error: the Rustyard has no locations');

async function openDistrict(page: Page, serverNow?: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await installApi(page, me);
  if (serverNow !== undefined) {
    await page.route('**/api/city/rustyard', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...districtDetail, serverNow }),
      }),
    );
  }
  await page.goto('/game/city/rustyard');
  await settleFonts(page);
}

test.describe('a district full of locations', () => {
  test('calls them locations, and lists every one', async ({ page }) => {
    await openDistrict(page);
    await expect(page.getByText(`${RUSTYARD.locations.length} locations`)).toBeVisible();
    for (const location of RUSTYARD.locations) {
      await expect(page.getByTestId(`location-${location.id}`)).toBeVisible();
    }
  });

  /**
   * The labels are the whole reason one location is a different problem from another.
   *
   * Asserted as *distinct sets across cards* rather than against a hard-coded list: what has to
   * hold is that the ground is characterised at all and that two different kinds of ground do not
   * read identically, which is the failure a per-card snapshot would not catch.
   */
  test('says what each piece of ground is like, with a tier on every keyword', async ({ page }) => {
    await openDistrict(page);

    const signatures = new Set<string>();
    for (const location of RUSTYARD.locations) {
      const card = page.getByTestId(`location-${location.id}`);
      const chips = card.getByTestId('labels').locator('[data-tier]');
      // `expect(...).not.toHaveCount(0)` before `count()`, and the order matters: `count()` is a
      // one-shot read with no auto-waiting, so on a busy run it can be taken before React has put
      // the first card's chips in the DOM and report an empty row that is merely not there *yet*.
      await expect(chips, location.id).not.toHaveCount(0);
      const count = await chips.count();

      const texts: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const text = (await chips.nth(i).innerText()).trim();
        // `Crammed II`, never a bare `Crammed`: the tier is what makes it a scale.
        expect(text, location.id).toMatch(/\s(I|II|III|IV)$/);
        texts.push(text);
      }
      signatures.add(texts.sort().join('|'));
    }
    expect(signatures.size, 'every location reads the same').toBeGreaterThan(1);
  });

  test('shows how far each location has been worked up', async ({ page }) => {
    await openDistrict(page);
    const pips = page.getByTestId(`level-${MINE.id}`);
    await expect(pips).toHaveAttribute('data-level', '2');
    await expect(pips).toHaveAccessibleName(`Level 2 of ${MAX_LOCATION_LEVEL}`);
  });

  /**
   * The board asked for the upgrade to *say what it is*.
   *
   * So the assertion is on the sentence, not on a percentage: the card has to carry the authored
   * line about what changes on the ground, and the button has to send the write.
   */
  test('offers the next level, says what it buys, and sends the order', async ({ page }) => {
    await openDistrict(page);
    const card = page.getByTestId(`location-${MINE.id}`);
    await expect(card.getByText(/^Level 3 · /)).toBeVisible();

    const note = districtDetail.locations[0]?.upgrade?.note ?? '';
    expect(note.length).toBeGreaterThan(20);
    await expect(card.getByText(note)).toBeVisible();

    const sent: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/city/upgrade') && request.method() === 'POST') {
        sent.push(request.postData() ?? '');
      }
    });
    await card.getByTestId(`upgrade-${MINE.id}`).click();
    await expect.poll(() => sent.length).toBeGreaterThan(0);
    expect(sent[0]).toContain(MINE.id);
  });

  /** Somebody else's ground is not something you can pour resources into. */
  test('offers nothing to work up on ground the crew does not hold', async ({ page }) => {
    await openDistrict(page);
    const theirs = RUSTYARD.locations[1];
    if (!theirs) throw new Error('fixture error: only one location in the Rustyard');
    await expect(page.getByTestId(`upgrade-${theirs.id}`)).toHaveCount(0);
  });
});

test.describe('the weather over the city', () => {
  /** Seven days in ten. A strip that is always there is a strip nobody reads. */
  test('says nothing at all on an ordinary day', async ({ page }) => {
    await openDistrict(page, '2026-08-17T12:00:00.000Z');
    await expect(page.getByTestId('weather')).toHaveCount(0);
  });

  test('names the storm and spells out what it puts on the ground', async ({ page }) => {
    await openDistrict(page, '2026-12-04T23:30:00.000Z');
    const banner = page.getByTestId('weather');
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute('data-weather', 'stormy');
    await expect(banner).toContainText('Storm');
    // Wet, and worse than it would be in plain rain: a storm is three tiers of it plus wind.
    await expect(banner.getByTestId('label-wet')).toHaveAttribute('data-tier', '3');
    await expect(banner.getByTestId('label-windy')).toBeVisible();
    /*
     * And nothing about the hour. The banner used to carry `Dark II` after 21:00 UTC and a tier of
     * Cold on top, which made the same yard a different fight at 20:59 and 21:01 with nothing on
     * screen counting down to it. The whole day/night cycle is gone: darkness is a property of the
     * ground now (`DARK_GROUND_TIER`), so the sky never puts it on.
     *
     * Asserted at 23:30, deliberately: this is the hour that used to produce it.
     */
    await expect(banner.getByTestId('label-dark')).toHaveCount(0);
  });

  /** The same storm, twelve hours earlier, reads exactly the same. */
  test('puts the same labels on the ground at noon as at midnight', async ({ page }) => {
    await openDistrict(page, '2026-12-04T23:30:00.000Z');
    const atNight = await page.getByTestId('weather').innerText();

    await openDistrict(page, '2026-12-04T11:30:00.000Z');
    expect(await page.getByTestId('weather').innerText()).toBe(atNight);
  });

  /*
   * The layout sweep, run with the fold taken out of the way.
   *
   * A district page scrolls, and the fold of a scroller cuts its last row *by design*: seven
   * location cards do not fit a laptop and are not meant to. Growing the viewport to the height of
   * the content removes the fold without changing a single width, so what is measured is the
   * layout rather than how far down the page happened to be. This is the same argument, and the
   * same fix, the market's own sweep makes.
   */
  test('lays out cleanly with a full sky over a full district', async ({ page }) => {
    await openDistrict(page, '2026-12-04T23:30:00.000Z');
    await page.setViewportSize({ width: 1280, height: 2600 });
    await expectNothingClippedVertically(page);
    await expectNoImagesClipped(page);
  });
});
