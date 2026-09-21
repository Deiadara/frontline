import { expect, test, type Page } from '@playwright/test';
import { MAX_LOCATION_LEVEL, findDistrict } from '@frontline/shared';
import { districtDetail, districtDetailFor, me } from './fixtures';
import {
  growPastTheFold,
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

/**
 * Opens one location's window from the painting.
 *
 * The district is a screen rather than a column of cards (maintainer request), so a location's card is
 * behind the sign that names it. One is open at a time, which is why the sweeps below open each in
 * turn instead of iterating a grid.
 */
async function openLocation(page: Page, locationId: string): Promise<void> {
  const open = page.getByTestId('location-window');
  if ((await open.count()) > 0) {
    await page.keyboard.press('Escape');
    await expect(open).toHaveCount(0);
  }
  await page.getByTestId(`site-${locationId}`).click();
  await expect(open).toBeVisible();
  // Named by the card inside it. The window shipped with `role="dialog" aria-modal="true"` and no
  // label, so a reader opening any of seven signs on the painting heard the same nothing; the
  // card's own heading is the place's name and is the only thing that needs saying.
  await expect(open).not.toHaveAccessibleName('');
}

/**
 * Opens the district's standing panel, which is where the sky lives.
 *
 * Shut by default: the painting is covered in signs and a panel floating over one stops it being
 * clickable, so nothing sits on the picture unless the player asks. The weather is still a fact
 * about this ground rather than about one thing on it, which is why it is here and not in a card.
 */
async function openStanding(page: Page): Promise<void> {
  await page.getByTestId('district-standing-toggle').click();
  await expect(page.getByTestId('district-standing')).toBeVisible();
}

test.describe('a district full of locations', () => {
  test('puts every location on the painting, and opens each one', async ({ page }) => {
    await openDistrict(page);
    for (const location of RUSTYARD.locations) {
      await expect(page.getByTestId(`site-${location.id}`), location.id).toBeVisible();
    }
    // And a sign is a door: opening one shows that location's card, not somebody else's.
    for (const location of RUSTYARD.locations.slice(0, 3)) {
      await openLocation(page, location.id);
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
      await openLocation(page, location.id);
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

  /**
   * What the ground *counts as*, beside what it is like (maintainer, 2026-09-18).
   *
   * "Have the tag/label of that location also say urban." A `CombatContext` is, in
   * `battlefield.ts`'s own words, a promise that a modifier on a unit sheet will fire, and the
   * promise was kept nowhere a player could read it: the only way to learn that a market is
   * Urban was to send somebody and read the report. The Characteristics row above says what the
   * place is like; this one says what it counts as, which is the half that decides who to bring.
   */
  test('says what each piece of ground counts as in a fight', async ({ page }) => {
    await openDistrict(page);

    const seen = new Set<string>();
    for (const location of RUSTYARD.locations) {
      await openLocation(page, location.id);
      const row = page.getByTestId(`fights-as-${location.id}`);
      await expect(row, location.id).toBeVisible();
      const tags = row.locator('li');
      await expect(tags, location.id).not.toHaveCount(0);
      for (const tag of await tags.all()) {
        const text = (await tag.innerText()).trim();
        seen.add(text);
        // Every tag says what it turns on, because a word on its own is not a promise.
        await expect(tag, `${location.id}: ${text}`).toHaveAttribute(
          'data-tip',
          /This ground counts/,
        );
      }
    }

    // The word the maintainer asked for, in the tag rather than in a sentence about built-up
    // ground. Five of the Rustyard's seven are urban ground (the press, the pawn shop, the
    // pumps, the kennels and the bone market), so it has to appear. Compared on `innerText`,
    // which is what a player reads: the chip is `uppercase` in CSS, so the string on the screen
    // is URBAN and the one in the table is Urban.
    expect([...seen], 'no ground in the Rustyard counts as Urban').toContain('URBAN');
    expect([...seen].join(' '), 'the old wording is still on the screen').not.toMatch(/built/i);
    expect(seen.size, 'every location counts as the same thing').toBeGreaterThan(1);
  });

  test('shows how far each location has been worked up', async ({ page }) => {
    await openDistrict(page);
    await openLocation(page, MINE.id);
    const pips = page.getByTestId(`level-${MINE.id}`);
    await expect(pips).toHaveAttribute('data-level', '2');
    await expect(pips).toHaveAccessibleName(`Level 2 of ${MAX_LOCATION_LEVEL}`);
  });

  /**
   * The maintainer asked for the upgrade to *say what it is*.
   *
   * So the assertion is on the sentence, not on a percentage: the card has to carry the authored
   * line about what changes on the ground, and the button has to send the write.
   */
  test('offers the next level, says what it buys, and sends the order', async ({ page }) => {
    await openDistrict(page);
    await openLocation(page, MINE.id);
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
    await openStanding(page);
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
    await openStanding(page);
    const atNight = await page.getByTestId('weather').innerText();

    await openDistrict(page, '2026-12-04T11:30:00.000Z');
    await openStanding(page);
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
    // Everything the screen can show at once, which is the state worth sweeping: the painting, the
    // standing panel over it, and a location's card open on top.
    await openStanding(page);
    await openLocation(page, MINE.id);
    await growPastTheFold(page, 1280);
    await expectNothingClippedVertically(page);
    await expectNoImagesClipped(page);
  });
});

/**
 * Who holds a plot, as a colour on the sign (maintainer, 2026-09-20).
 *
 * "Make it more obvious who is holding something: if it's occupied by Looters make the tag be
 * yellow, if it's Combine make it be orange and if it's another player make it be red."
 *
 * The signs used to answer one question, *is this mine*, in two colours. So a player scanning a
 * district could not tell the looters' pawn shop from the Combine's armoury from a rival crew's
 * yard, which is the one thing that decides whether a fight is worth calling and what it costs.
 *
 * Asserted on `data-holder` **and** on the computed colour. The attribute alone would pass on a
 * board where every sign is the same colour; the colour alone would be a gate that breaks the day
 * somebody retunes the palette, and the claim here is that the five differ, not what they are.
 */
test('a sign says who holds it, in its own colour', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installApi(page, me);
  await page.route('**/api/city/datavault-sigma', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(districtDetailFor('datavault-sigma')),
    }),
  );
  /*
   * The Spire, scouted and Combine-held end to end.
   *
   * `districtDetailFor` returns it in the fog with no locations at all, which is the fixture
   * working as intended: the CCS is the city's unscouted district. It is also the only ground the
   * Combine holds, so it is the only place the orange can be seen, and a scouted copy has to be
   * built here rather than the fog fixture bent into one.
   */
  const spire = findDistrict('combine-spire')!;
  const held = districtDetailFor('datavault-sigma').locations[0]!;
  await page.route('**/api/city/combine-spire', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...districtDetailFor('combine-spire'),
        scouted: true,
        locations: spire.locations.map((location) => ({
          ...held,
          location,
          holder: { kind: 'government' },
          holderName: 'The Combine',
          holderPlayer: null,
          level: 1,
        })),
      }),
    }),
  );

  const readSigns = async (districtId: string): Promise<{ tone: string; colour: string }[]> => {
    await page.goto(`/game/city/${districtId}`);
    await expect(page.getByTestId(`district-painting-${districtId}`)).toBeVisible();
    await settleFonts(page);
    return page.evaluate(() =>
      [...document.querySelectorAll('[data-testid^="site-"] span[data-holder]')].map((node) => ({
        tone: node.getAttribute('data-holder') ?? '',
        colour: getComputedStyle(node).color,
      })),
    );
  };

  const seen = new Map<string, string>();
  for (const districtId of ['datavault-sigma', 'combine-spire']) {
    for (const sign of await readSigns(districtId)) seen.set(sign.tone, sign.colour);
  }

  // The Annexes carry a plot of yours, a rival crew's and the looters'; the Spire is the Combine's
  // end to end. Between them that is four of the five, which is every one a painted board draws.
  expect([...seen.keys()].sort(), `only saw ${[...seen.keys()].join(', ')}`).toEqual([
    'crew',
    'government',
    'looters',
    'mine',
  ]);
  // Four holders, four different colours. This is the whole of the request.
  expect(new Set(seen.values()).size, 'two holders share a colour').toBe(seen.size);
});
