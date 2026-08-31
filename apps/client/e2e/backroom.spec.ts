import { BUILDING_KINDS } from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import { adminGame, lateGame } from './fixtures';
import {
  expectNoImagesClipped,
  expectNothingClippedVertically,
  expectSheetNotWashedOut,
  installApi,
  settleFonts,
} from './harness';

/**
 * The three screens half B added, the Black Market, Settings and the bench, plus the ambience layer
 * that now runs over all of them.
 *
 * Every screen is measured at 1024 as well as at 1280. 1024 is where the chrome runs out of room:
 * the scenery switcher grew two doors with these features, and a row that overflows instead of
 * wrapping puts a destination off the side of the screen where nothing will ever find it.
 *
 * The pale-share gate matters more here than anywhere else in the suite. This work added a
 * full-frame `patina` layer over the chrome *and* `rusted` panels inside the sheets, on top of the
 * `painted`/`washed` blends that already caused one washed-out page. If any of the four compound,
 * this is the check that says so.
 */

const WIDTHS = [
  { name: '1024', width: 1024, height: 768 },
  { name: '1280', width: 1280, height: 720 },
] as const;

async function open(page: Page, path: string, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await installApi(page, adminGame);
  await page.goto(path);
  await settleFonts(page);
}

/**
 * The layout sweeps, run with the fold taken out of the way.
 *
 * A document sheet scrolls, and the fold of a scroller cuts its last row *by design*, which the
 * clipped-text gate reports as a defect if it is pointed at a screen that is mid-scroll. Growing the
 * viewport to the full height of the content removes the fold without changing a single width, so
 * what is measured is the layout rather than how far down the page happened to be. The narrow-height
 * assertions (does it overflow sideways, is a door off the bar) stay at the real size, above.
 *
 * The images are scoped to the sheet on purpose: `SceneBackdrop` is deliberately over-scaled so a
 * blur has something to sample past its own edges, so it spills its box everywhere in the game and
 * every spec that measures images narrows around it.
 */
/**
 * Tall enough that the whole page is laid out at once.
 *
 * Not a viewport anybody plays at: it is a measuring device. The guards below look for text cut by
 * a clipping edge, and in a viewport the page actually scrolls in, the fold *is* a clipping edge,
 * so every long page would report its last visible row as a defect. Giving the page all the room it
 * wants turns "is this clipped" back into a question about the layout.
 *
 * It has to be raised when the page grows, and it was: adding one row to the notification
 * preferences (§A4's scouting receipts) pushed the last control on the settings sheet past 2200 and
 * this went red. Measured before raising it, a real player at 1280x800 can still scroll to that
 * control and see all of it, so the page was fine and the ruler was short.
 */
const LAYOUT_PROBE_HEIGHT = 2600;

async function expectLaidOutWhole(page: Page, width: number, name: string): Promise<void> {
  await page.setViewportSize({ width, height: LAYOUT_PROBE_HEIGHT });
  await settleFonts(page);
  await expectNothingClippedVertically(page, 'main section');
  await expectNoImagesClipped(page, 'main section');
  expect(await overflowing(page), `something is cut off at ${name}`).toEqual([]);
}

/**
 * Text whose own content is wider than the box it was given, i.e. cut off sideways.
 *
 * Text-carrying elements only, which is the same shape the mission-board gate uses and for a
 * reason that took a red run to remember: the scenery layer is a box holding a deliberately
 * over-scaled backdrop, so *every* screen in the game has one element whose content is wider than
 * itself, on purpose. Sweeping every element reports the game's own art direction as a defect.
 */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('h1, h2, h3, p, span, label, li, option, button')]
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent?.slice(0, 60) ?? '')
      .slice(0, 6),
  );
}

test.describe('the black market', () => {
  for (const { name, width, height } of WIDTHS) {
    test(`lays the shelf out whole at ${name}`, async ({ page }) => {
      await open(page, '/game/market/black', width, height);

      // The screen no longer prints its own name: the bottom bar and the lit tab say where you
      // are, so the tab's own `aria-current` is what identifies the page.
      await expect(page.getByTestId('market-tab-black')).toHaveAttribute('aria-current', 'page');
      // Five slots, always. The refill rule is the reason this number never drops.
      // Five, written as a number. Reading the count off the shared constant would make this
      // assertion agree with whatever the code currently does, which is not an assertion.
      await expect(page.getByTestId('black-market-shelf').locator('> li')).toHaveCount(5);
      // Priced in infamy, and the balance is on the header where it can be read before shopping.
      await expect(page.getByTestId('black-infamy')).toBeVisible();
      await expect(page.getByTestId('black-allowance')).toContainText('1 left today');

      expect(await overflowing(page), `something is cut off at ${name}`).toEqual([]);
      await expectSheetNotWashedOut(page);
      await expectLaidOutWhole(page, width, name);
    });
  }

  test('is reached from the market by a tab, and goes back the same way', async ({ page }) => {
    await open(page, '/game/market', 1280, 720);

    await expect(page.getByTestId('market-tabs')).toBeVisible();
    await page.getByTestId('market-tab-black').click();
    await expect(page.getByTestId('black-market-shelf')).toBeVisible();
    await expect(page.getByTestId('market-tab-black')).toHaveAttribute('aria-current', 'page');

    await page.getByTestId('market-tab-market').click();
    await expect(page.getByTestId('market-board')).toBeVisible();
  });

  test('counts down to the refresh and says what time it lands', async ({ page }) => {
    await open(page, '/game/market/black', 1280, 720);
    // The countdown is a duration, not a wall clock, so it reads the same wherever the player is.
    // When it lands is in the note beside it, which is a hover now: the clock is live and stays on
    // the page, the rule is reference and does not.
    //
    // The note quotes a time and does *not* name a zone. Naming one is Settings' job: everywhere
    // else the numbers are already drawn in whatever clock the player picked, so a zone in the
    // sentence is either redundant or, for a player who has moved theirs, wrong.
    await expect(page.getByTestId('black-refresh')).toContainText(/\d/);
    await page.getByTestId('info-note').hover();
    await expect(page.getByText(/turns over once a day, at \d{2}:\d{2}/)).toBeVisible();
  });

  /**
   * The bag is not on this screen any more, and this is both halves of that.
   *
   * Contraband used to sit here and apply itself to whichever battle resolved next, on both sides.
   * It is applied on a fight's own screen now, so what a crew is carrying belongs there: a test
   * that only checked it had left the shelf would pass just as happily if it had gone nowhere.
   */
  test('keeps no bag here: contraband is applied on the fight it is for', async ({ page }) => {
    await open(page, '/game/market/black', 1280, 720);
    await expect(page.getByTestId('boost-stash')).toHaveCount(0);
    await expect(page.getByText(/Together:/)).toHaveCount(0);

    await open(page, '/game/battles', 1280, 720);
    await page.getByTestId('boost-picker').click();
    const crate = page.getByRole('option', { name: /Adrenaline Syringes/ });
    await expect(crate).toBeVisible();
    // Already paid for at the shelf, so the line quotes the bag rather than a price in infamy.
    await expect(crate).toContainText(/in the bag/i);
  });
});

test.describe('settings', () => {
  for (const { name, width, height } of WIDTHS) {
    test(`lays out the three panels at ${name}`, async ({ page }) => {
      await open(page, '/game/settings', width, height);

      await expect(page.getByTestId('settings-display-name')).toBeVisible();
      await expect(page.getByTestId('settings-username')).toHaveValue('operator');
      // The painted picker shows the *city*, which is the only part a player reads. The IANA name
      // is what it sends; `Athens (house)` is what it says.
      await expect(page.getByTestId('settings-timezone')).toContainText('Athens (house)');
      await expect(page.getByTestId('settings-current-password')).toBeVisible();

      expect(await overflowing(page), `something is cut off at ${name}`).toEqual([]);
      await expectSheetNotWashedOut(page);
      await expectLaidOutWhole(page, width, name);
    });
  }

  test('previews the clock the player is about to pick, before they pick it', async ({ page }) => {
    await open(page, '/game/settings', 1280, 720);
    const preview = page.getByTestId('settings-clock-preview');
    const athens = await preview.textContent();

    await page.getByTestId('settings-timezone').click();
    await page.getByRole('option', { name: /New York/ }).click();
    await expect(preview).not.toHaveText(athens ?? '');
    // Same instant, different wall clock, which is the whole point of the setting.
    await expect(preview).toContainText('GMT-4');
  });

  test('offers a glyph to be recognised by', async ({ page }) => {
    await open(page, '/game/settings', 1280, 720);
    const icons = page.getByTestId('settings-icons').getByRole('button');
    // `count()` does not auto-wait, so it has to be read *after* an assertion that does. Without
    // one it samples whatever the DOM held on the first tick, which on a slow cold Vite start is
    // nothing at all.
    await expect(icons.first()).toBeVisible();
    expect(await icons.count()).toBeGreaterThan(4);
    await icons.nth(1).click();
    await expect(icons.nth(1)).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('the bench', () => {
  for (const { name, width, height } of WIDTHS) {
    test(`lays out the knobs at ${name}`, async ({ page }) => {
      await open(page, '/game/admin', width, height);

      await expect(page.getByRole('heading', { name: 'The Bench' })).toBeVisible();
      // The badge is not decoration: an unmarked free-and-instant build is indistinguishable from
      // a broken economy.
      await expect(page.getByTestId('admin-badge')).toContainText('5s');
      await expect(page.getByTestId('admin-presets').locator('> div')).toHaveCount(3);
      /*
       * One row per structure, whatever the catalogue holds.
       *
       * Was a hard 12 and went red when the Cistern was removed (§A2), which is the count doing
       * its job badly: what the bench promises is a knob for *every* structure, not for twelve of
       * them. Pinned to the catalogue's own length so removing or adding one moves the test with
       * the game, and separately pinned below so the two cannot drift into agreeing about nothing.
       */
      await expect(page.getByTestId('admin-standing').locator('> li')).toHaveCount(
        BUILDING_KINDS.length,
      );
      expect(BUILDING_KINDS, 'the Cistern is gone and nothing replaced it').toHaveLength(11);
      expect(BUILDING_KINDS).not.toContain('cistern');
      await expect(page.getByTestId('admin-backups').locator('> li')).toHaveCount(3);

      expect(await overflowing(page), `something is cut off at ${name}`).toEqual([]);
      await expectSheetNotWashedOut(page);
      await expectLaidOutWhole(page, width, name);
    });
  }

  test('is a door in the scenery switcher when the build has one', async ({ page }) => {
    await open(page, '/game', 1280, 720);
    await expect(page.getByTestId('nav-bench')).toBeVisible();
    await expect(page.getByTestId('nav-settings')).toBeVisible();
  });

  test('is not a door when the server says there is no bench', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    // `/me` is what says whether this build has a bench. It used to be discovered by calling the
    // bench and reading a 404, which worked but made every production session log a failed request
    // on every page, so the answer moved onto a call the shell was already making, and this is the
    // build that answers no.
    await installApi(page, lateGame);
    await page.goto('/game');
    await settleFonts(page);

    await expect(page.getByTestId('nav-settings')).toBeVisible();
    await expect(page.getByTestId('nav-bench')).toHaveCount(0);
  });
});

test.describe('the scenery switcher with two more doors', () => {
  for (const { name, width, height } of WIDTHS) {
    test(`keeps every door on screen at ${name}`, async ({ page }) => {
      await open(page, '/game', width, height);

      const nav = page.getByRole('navigation', { name: 'Places' });
      const bar = (await nav.boundingBox())!;
      for (const door of await nav.locator('[data-testid^="nav-"]').all()) {
        const at = (await door.boundingBox())!;
        // Inside the bar on both axes. A row that overflows instead of wrapping puts the last two
        // destinations off the side of the viewport, where nothing will ever find them.
        expect(at.x, `a door starts left of the bar at ${name}`).toBeGreaterThanOrEqual(bar.x - 1);
        expect(at.x + at.width, `a door runs past the right edge at ${name}`).toBeLessThanOrEqual(
          bar.x + bar.width + 1,
        );
        expect(at.width).toBeGreaterThanOrEqual(44);
        expect(at.height).toBeGreaterThanOrEqual(44);
      }

      // And the names on them still fit the door they are written on.
      //
      // Position alone does not catch the real failure mode, which took a mutation to find: a row
      // that does not wrap does not spill, it *shrinks*. Every door stays politely inside the bar
      // at 65px while "WORKSHOP" runs out past both its edges and collides with the door beside
      // it. The label's own `scrollWidth` is no help either: nothing constrains the span, so it
      // simply grows and overflows its parent. What has to be measured is the label against the
      // door, which is the thing that actually got smaller.
      const spilling = await nav.evaluate((bar) =>
        [...bar.querySelectorAll<HTMLElement>('[data-testid^="nav-"]')]
          .flatMap((door) => {
            const box = door.getBoundingClientRect();
            return [...door.querySelectorAll<HTMLElement>('span')]
              .filter(
                (el) => el.childElementCount === 0 && (el.textContent?.trim().length ?? 0) > 0,
              )
              .filter((el) => {
                const at = el.getBoundingClientRect();
                return at.left < box.left - 1 || at.right > box.right + 1;
              })
              .map((el) => el.textContent?.trim() ?? '');
          })
          .slice(0, 6),
      );
      expect(spilling, `a door's name runs outside the door at ${name}`).toEqual([]);
    });
  }
});

test.describe('the ambience layer', () => {
  test('puts junk in the corners without eating a click', async ({ page }) => {
    await open(page, '/game/settings', 1280, 720);
    /*
     * Waited for, because the assertion below is a raw `evaluate` rather than a locator.
     *
     * `open` waits for `document.fonts.ready`, which resolves happily against a shell React has
     * not mounted into yet. On an idle machine the layer is always there by the time the evaluate
     * runs; under a full-suite load it sometimes is not, and the test then reports "no ambience
     * layer" for a layer that appears a frame later. Locators auto-wait; `page.evaluate` does not.
     */
    await expect(page.getByTestId('ambience')).toBeAttached();

    // Everything in the layer is inert, so the control underneath a sprite is still the thing the
    // pointer finds.
    const swallowed = await page.evaluate(() => {
      const layer = document.querySelector('[aria-hidden][class*="pointer-events-none"]');
      if (!layer) return 'no ambience layer';
      return [...layer.querySelectorAll('*')].some(
        (el) => getComputedStyle(el).pointerEvents !== 'none',
      )
        ? 'something in the ambience layer takes pointer events'
        : null;
    });
    expect(swallowed).toBeNull();
  });

  test('draws every sprite whole, over every screen', async ({ page }) => {
    for (const path of ['/game', '/game/market/black', '/game/settings', '/game/admin']) {
      await open(page, path, 1280, 720);
      // The sprites are `<svg>` in fixed boxes tucked inside the frame; the gate that would catch a
      // corner-bled sprite is the image one, and it is the reason none of them run off the edge.
      // Scoped to the ambience layer itself: the backdrop it sits over is over-scaled by design.
      await expectNoImagesClipped(page, '[data-testid="ambience"]');
    }
  });
});
