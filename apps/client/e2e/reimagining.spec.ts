import type { Inventory } from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import { lateGame, market } from './fixtures';
import {
  expectNoImagesClipped,
  expectNothingClippedVertically,
  expectNothingOverflowsTheScreen,
  growPastTheFold,
  installApi,
  settleFonts,
} from './harness';

/**
 * §G2 on the third tab of the archive: a tray, three sockets, a machine and one page out.
 *
 * The unit tests drive the state machine against a stubbed fetch. What only a browser answers is
 * whether the thing is *usable*: that the triangle and the outfeed fit beside each other, that a
 * tray of sixteen sheets does not run off the sheet, and that the sequence from a full machine to
 * a page in the outfeed actually plays rather than jumping.
 *
 * The inventory is handed to `installApi` rather than routed here, because the bench is the one
 * screen in the suite whose write *spends* something: the harness takes the three named pages out
 * of the board it also serves the read from, so the tray on screen changes after the press. A spec
 * routing the read itself would be watching a fixture that cannot move.
 */

test.use({ viewport: { width: 1280, height: 800 } });

const RANGE_CARDS = 'pg_snipers_range_cards';
const SLAB_ARMOUR = 'pg_juggernauts_slab_armour';

/** A stack to draw down, a single sheet beside it, and enough else to make the tray a real tray. */
const INVENTORY: Inventory = {
  [SLAB_ARMOUR]: 3,
  [RANGE_CARDS]: 1,
  pg_colossus_hull_sections: 1,
  pg_colossus_reactor_housing: 1,
  pg_garage_pit_layout: 1,
  pg_shaped_charges_cone_geometry: 1,
  scrap_servo: 4,
};

const slot = (page: Page, index: number) => page.getByTestId(`reimagine-slot-${index}`);

/**
 * Brass, which is what the machinery goes when all three sockets are full.
 *
 * Polled as a colour rather than slept on, and it is the reason there is a wait here at all: the
 * gearing fades over 200ms, and a screenshot taken the frame after the third page went in caught
 * it still grey. Every assertion passed and the image the maintainer looked at showed a full machine
 * that had not lit.
 */
const LIT = 'rgb(240, 173, 76)';

/**
 * The lettering a chosen tab settles on, for the same reason: the strip fades over 150ms.
 *
 * The border it used to be went with the drawn tabs (maintainer, 2026-09-17): the box is an inline
 * SVG now and the element itself has none. `brass-100`, which is what an open tab is written in.
 */
const LIT_TAB_INK = 'rgb(255, 228, 174)';

/** Fills the machine: two off the stack and one of the single sheets. */
async function fill(page: Page): Promise<void> {
  await page.getByTestId(`tray-${SLAB_ARMOUR}`).click();
  await page.getByTestId(`tray-${SLAB_ARMOUR}`).click();
  await page.getByTestId(`tray-${RANGE_CARDS}`).click();
}

/** §G4 shut: a lock, one sentence, and nothing a player can press. */
test('draws a locked bench with one sentence saying what is missing', async ({ page }) => {
  await installApi(page, lateGame);
  await page.route('**/api/market', async (route) => {
    await route.fulfill({
      json: {
        ...market,
        inventory: INVENTORY,
        reimagining: { hasHeadOfResearch: false, hasReimaginingResearch: true },
      },
    });
  });

  await page.goto('/game/research/reimagining');
  const locked = page.getByTestId('reimagining-locked');
  await expect(locked).toContainText('Nobody is sitting in the Head of Research chair');
  await expect(page.getByTestId('reimagine-machine')).toHaveCount(0);
  await expect(page.getByTestId('reimagine-tray')).toHaveCount(0);
  // The way out of it, which is the half a sentence cannot do: chairs are filled at the Bar and
  // there is nothing on this screen that would tell a player so.
  await expect(page.getByTestId('reimagining-door')).toContainText(
    'Hire a Head of Research at the Bar',
  );
  await settleFonts(page);
  await expectNothingOverflowsTheScreen(page);
  await expectNothingClippedVertically(page);
  await page.screenshot({ path: 'e2e-out/reimagining-locked.png', fullPage: true });
});

/**
 * The second door, walked through rather than read.
 *
 * A link's text and its href are the cheap half: what a player needs is to arrive at the rung. The
 * Reimagining rung is the sixth on the *Fabricator's* track, which nobody guesses, so the press has
 * to land on that rail with that trade open. Before the URL carried the trade the archive always
 * opened on the first of nineteen, and a door reading "research it on the track" dropped a player
 * on the Master of Whispers with the rung nine rows away and no clue which.
 */
test('walks a crew with the chair but not the rung to the rung own track', async ({ page }) => {
  await installApi(page, lateGame);
  await page.route('**/api/market', async (route) => {
    await route.fulfill({
      json: {
        ...market,
        inventory: INVENTORY,
        reimagining: { hasHeadOfResearch: true, hasReimaginingResearch: false },
      },
    });
  });

  await page.goto('/game/research/reimagining');
  await expect(page.getByTestId('reimagining-locked')).toContainText(
    'The Lab has not worked Reimagining out yet',
  );
  const door = page.getByTestId('reimagining-door');
  await expect(door).toContainText("Research it on the Fabricator's track");
  await settleFonts(page);
  await expectNothingOverflowsTheScreen(page);
  await expectNothingClippedVertically(page);
  await page.screenshot({ path: 'e2e-out/reimagining-door.png', fullPage: true });

  await door.click();
  await expect(page).toHaveURL(/\/game\/research\?track=fabricator$/);
  // The Programmes tab, open on the Fabricator, with its rung on the rail.
  await expect(page.getByTestId('research-tab-programmes')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('tech-track-fabricator')).toBeVisible();
  await expect(page.getByTestId('research-track-fabricator')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByTestId('tech-tech_reimagining')).toBeVisible();
  // The strip has finished fading. `transition-colors` is 150ms, so the shot taken the frame after
  // the press showed Reimagining still wearing the gold it had a moment ago while Programmes was
  // the tab actually open: every assertion passed and the image said the wrong thing.
  // Read off the lettering rather than a border: the archive's tabs are drawn now, so the box is
  // an SVG inside the element and there is no border on it to poll. See `visual.spec.ts`.
  await expect(page.getByTestId('research-tab-programmes')).toHaveCSS('color', LIT_TAB_INK);
  await settleFonts(page);
  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'e2e-out/reimagining-track.png', fullPage: true });
});

/**
 * The two sizes the board looks at.
 *
 * The machine is sized by the plate it is bolted to rather than by the window, and the plate is a
 * different shape at each of these, so the run is done at both: at 1280x720 the bench is short and
 * the machine is height-limited, at 1440x900 it is wide and width-limited, and the failure mode of
 * the sizing (a drawing wider or taller than the plate it sits on) only shows at one of them.
 */
const SIZES = [
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
] as const;

for (const size of SIZES) {
  const tag = `${size.width}x${size.height}`;
  test(`fills three sockets, runs the bench and lands a new page at ${tag}`, async ({ page }) => {
    await page.setViewportSize(size);
    await installApi(page, lateGame, { inventory: INVENTORY });

    await page.goto('/game/research/reimagining');
    const machine = page.getByTestId('reimagine-machine');
    await expect(machine).toBeVisible();
    await settleFonts(page);

    /*
     * The drawing fits the plate it is bolted to.
     *
     * `expectNoImagesClipped` catches an apparatus taller than its plate, because the linkage is an
     * `<svg>`; it cannot see one that is *wider*, because the plate clips it and a clipped box is
     * what a scroller looks like too. Both are measured here against the plate's own content box.
     */
    const fit = await machine.evaluate((plate) => {
      const app = plate.querySelector('.lab-apparatus')!.getBoundingClientRect();
      const style = getComputedStyle(plate);
      const box = plate.getBoundingClientRect();
      return {
        appW: app.width,
        appH: app.height,
        w: box.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        h: box.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom),
      };
    });
    expect(fit.appW, `the machine is ${fit.appW}px wide on a ${fit.w}px plate`).toBeLessThanOrEqual(
      fit.w + 1,
    );
    expect(fit.appH, `the machine is ${fit.appH}px tall on a ${fit.h}px plate`).toBeLessThanOrEqual(
      fit.h + 1,
    );
    // ...and it is not a stamp on a big plate either: the board sent back a machine that was.
    expect(fit.appW).toBeGreaterThan(fit.w * 0.7);

    // Empty, dark, and the button dead: the state a player arrives on.
    await expect(machine).toHaveAttribute('data-lit', 'no');
    await expect(page.getByTestId('reimagine-gears')).not.toHaveCSS('color', LIT);
    await expect(page.getByTestId('reimagine-result')).toHaveAttribute('data-filled', 'no');
    await expect(page.getByTestId('reimagine')).toBeDisabled();
    await expectNothingOverflowsTheScreen(page);
    await expectNoImagesClipped(page, '[data-testid="reimagine-machine"]');
    await page.screenshot({ path: `e2e-out/reimagining-empty-${tag}.png`, fullPage: true });

    await fill(page);
    for (const index of [0, 1, 2]) {
      await expect(slot(page, index)).toHaveAttribute('data-filled', 'yes');
    }
    await expect(machine).toHaveAttribute('data-lit', 'yes');
    await expect(page.getByTestId('reimagine-gears')).toHaveCSS('color', LIT);
    await expect(page.getByTestId('reimagine')).toBeEnabled();
    // The stack is two down and the single sheet is gone off the tray's count.
    await expect(page.getByTestId(`tray-${SLAB_ARMOUR}`)).toHaveAttribute('data-left', '1');
    await expect(page.getByTestId(`tray-${RANGE_CARDS}`)).toBeDisabled();
    await settleFonts(page);
    await expectNothingOverflowsTheScreen(page);
    await expectNothingClippedVertically(page);
    await page.screenshot({ path: `e2e-out/reimagining-loaded-${tag}.png`, fullPage: true });

    await page.getByTestId('reimagine').click();
    const result = page.getByTestId('reimagine-result');
    await expect(result).toHaveAttribute('data-filled', 'yes');

    // A page, named, that the crew was not holding when it walked in.
    const gained = await result.getAttribute('data-page');
    expect(gained).toBeTruthy();
    expect(Object.keys(INVENTORY)).not.toContain(gained);
    await expect(result).not.toHaveText('');
    for (const index of [0, 1, 2]) {
      await expect(slot(page, index)).toHaveAttribute('data-filled', 'no');
    }

    // The tray moved: the sheet that went in whole is gone and the new one is on it.
    await expect(page.getByTestId(`tray-${RANGE_CARDS}`)).toHaveCount(0);
    await expect(page.getByTestId(`tray-${SLAB_ARMOUR}`)).toHaveAttribute('data-left', '1');
    await expect(page.getByTestId(`tray-${gained ?? ''}`)).toBeVisible();

    await settleFonts(page);
    await growPastTheFold(page);
    await expectNothingOverflowsTheScreen(page);
    await expectNothingClippedVertically(page);
    await expectNoImagesClipped(page, '[data-testid="reimagining-section"]');
    await page.screenshot({ path: `e2e-out/reimagining-done-${tag}.png`, fullPage: true });
  });
}

test('gives a page back when its socket is pressed', async ({ page }) => {
  await installApi(page, lateGame, { inventory: INVENTORY });

  await page.goto('/game/research/reimagining');
  await expect(page.getByTestId('reimagine-machine')).toBeVisible();
  await fill(page);

  await slot(page, 2).click();
  await expect(slot(page, 2)).toHaveAttribute('data-filled', 'no');
  await expect(page.getByTestId('reimagine-machine')).toHaveAttribute('data-lit', 'no');
  await expect(page.getByTestId('reimagine')).toBeDisabled();
  // Back on the tray, pressable again, and the other two sockets untouched.
  await expect(page.getByTestId(`tray-${RANGE_CARDS}`)).toBeEnabled();
  await expect(slot(page, 0)).toHaveAttribute('data-filled', 'yes');
});
