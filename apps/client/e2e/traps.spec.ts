import { TRAP_CATALOG, type BattlesResponse, type TrapOption } from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import { HELD_TRAP, battles, lateGame, market, scrapyard } from './fixtures';
import { expectNothingOverflowsTheScreen, installApi, settleFonts } from './harness';

/**
 * Traps as a defensive consumable, on the screens (plan §I4).
 *
 * Two screens and one object between them: the yard cuts a trap onto a bench of its own, and the
 * battle board sets it under a fight this crew is defending. The unit gates say the right rows
 * exist; this says a player can see them, that an attacker cannot, and that neither screen cuts a
 * word doing it.
 *
 * The battle payloads are built here and routed **after** `installApi`: Playwright matches the
 * most recently registered route first, and what the trap panels need is one crew holding two
 * traps. The yard's trap rows live in the shared `scrapyard` fixture, so the visual matrix shoots
 * the same bench this spec drives.
 */

test.use({ viewport: { width: 1280, height: 720 } });

const HELD = HELD_TRAP;

const trapOptions: TrapOption[] = TRAP_CATALOG.map((spec, index) => ({
  trapId: spec.id,
  name: spec.name,
  description: spec.description,
  held: index === 0 ? 2 : 0,
  available: index === 0,
  blocker: index === 0 ? '' : 'None in the bag. The Scrapyard cuts them',
}));

/** The board with the defender's fight carrying a trap already set, and the attacker's carrying none. */
const withTraps: BattlesResponse = {
  ...battles,
  coming: battles.coming.map((view) =>
    view.side === 'defender'
      ? { ...view, traps: trapOptions, trapId: HELD.id }
      : { ...view, traps: [], trapId: null },
  ),
};

async function serveTraps(page: Page): Promise<void> {
  /*
   * The trap goes into the crew's **own** inventory, not only the market's copy of it.
   *
   * The retired Inventory page drew its rows off the market payload, so that was the only place this
   * fixture stocked. The Battles inventory reads `base.inventory` from `/me`, which is where a held
   * item actually lives; the market response only echoes it. Both are stocked here so the fixture
   * describes one crew rather than two.
   */
  const crew = lateGame.base;
  if (crew === null) throw new Error('the late-game fixture must have a base');
  await installApi(page, {
    ...lateGame,
    base: { ...crew, inventory: { ...crew.inventory, [HELD.id]: 2 } },
  });
  const json = (data: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
  await page.route('**/api/scrapyard**', (route) => route.fulfill(json(scrapyard)));
  await page.route('**/api/battles**', (route) => route.fulfill(json(withTraps)));
  // §I4h: the inventory reads its rows off the market payload rather than an endpoint of its own,
  // so this is where two Pressure Plates have to be for the Consumables panel to hold anything.
  await page.route('**/api/market**', (route) =>
    route.fulfill(json({ ...market, inventory: { ...market.inventory, [HELD.id]: 2 } })),
  );
}

/** The fight this crew is defending, which is the only one with a Trap panel on it. */
const DEFENDED = battles.coming.find((view) => view.side === 'defender')!.battle.id;
const ATTACKED = battles.coming.find((view) => view.side === 'attacker')!.battle.id;

/**
 * Opens one fight on the board.
 *
 * The board is a list and a detail rather than a route per fight, so a fight is opened by pressing
 * its row; landing on `/game/battles` opens the first one, which here is the attack.
 */
async function openFight(page: Page, battleId: string): Promise<void> {
  await page.goto('/game/battles');
  await expect(page.getByTestId('coming-battles')).toBeVisible();
  await page.getByTestId(`battle-${battleId}`).click();
  await expect(page.getByTestId(`battle-detail-${battleId}`)).toBeVisible();
}

test('the yard has a Traps bench, and it is one tab among the rest', async ({ page }) => {
  await serveTraps(page);
  await page.goto('/game/scrapyard');
  await expect(page.getByTestId('scrapyard-menu')).toBeVisible();
  await settleFonts(page);

  await expect(page.getByTestId('scrapyard-view-traps')).toBeVisible();
  await page.getByTestId('scrapyard-view-traps').click();
  await expect(page.getByTestId('scrapyard-traps')).toBeVisible();
  // Narrowed to itself, exactly as the refit bench narrows: the structures are gone.
  await expect(page.getByTestId('scrapyard-nexus')).toHaveCount(0);
  await expect(page.getByTestId('scrapyard-refits')).toHaveCount(0);

  // Only the trap whose document the crew holds is on the bench (maintainer, 2026-09-11); the rest are
  // counted, not drawn, so a player knows there is more to find without being told what.
  await expect(page.getByTestId(`addon-${HELD.id}`)).toBeVisible();
  await expect(page.getByTestId(`addon-build-${HELD.id}`)).toBeVisible();
  for (const spec of TRAP_CATALOG.slice(1)) {
    await expect(page.getByTestId(`addon-${spec.id}`)).toHaveCount(0);
  }
  /*
   * ...and the bench says nothing, because the crew holds one (maintainer report, 2026-09-16).
   *
   * "Go out there and find some more blueprints." is the empty state of a bench now rather than a
   * running count of what is withheld: five traps are still behind their documents here, which
   * the loop above pins one assertion at a time, and a player with a trap on the bench is not a
   * player with nothing to do. The bare bench is driven in `ScrapyardBrackets.test.tsx`.
   */
  await expect(page.getByTestId('scrapyard-hidden-traps')).toHaveCount(0);

  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'e2e-out/scrapyard-traps.png' });
});

/**
 * §I3a: the yard opens on the bench a door somewhere else asked for.
 *
 * The building dialog's "build more" link is what this is for, and the query parameter is the whole
 * contract between the two screens, so it is driven here as a URL rather than through a click on a
 * page this spec does not own.
 */
test('a ?bench= link opens the yard on that bench', async ({ page }) => {
  await serveTraps(page);
  await page.goto('/game/scrapyard?bench=traps');
  await expect(page.getByTestId('scrapyard-traps')).toBeVisible();
  await expect(page.getByTestId('scrapyard-nexus')).toHaveCount(0);

  // A structure's bench, which is what the building dialog will actually link to.
  await page.goto('/game/scrapyard?bench=garage');
  await expect(page.getByTestId('scrapyard-garage')).toBeVisible();
  await expect(page.getByTestId('scrapyard-traps')).toHaveCount(0);

  // ...and the tabs still write the URL, so the two cannot disagree about what is open.
  await page.getByTestId('scrapyard-view-traps').click();
  await expect(page).toHaveURL(/view=traps/);
  await expect(page.getByTestId('scrapyard-traps')).toBeVisible();

  // A bench this yard has no door for falls back to the first structure rather than to an empty
  // workspace: the building dialog links by structure, and a typo is not a screen.
  await page.goto('/game/scrapyard?bench=nothing-here');
  await expect(page.getByTestId('scrapyard-nexus')).toBeVisible();
  await expect(page.getByTestId('scrapyard-traps')).toHaveCount(0);
  await expect(page.getByTestId('scrapyard-view-modifications')).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('a defender sets a trap on the fight, and an attacker has no panel at all', async ({
  page,
}) => {
  await serveTraps(page);
  await openFight(page, DEFENDED);
  await expect(page.getByTestId('trap-picker')).toBeVisible();
  await settleFonts(page);

  // What is buried, and the one in the bag offered beside it.
  await expect(page.getByTestId('trap-set')).toContainText(HELD.name);
  await expect(page.getByTestId('set-trap')).toBeVisible();
  await expect(page.getByTestId('trap-clear')).toBeVisible();

  await expectNothingOverflowsTheScreen(page);

  await openFight(page, ATTACKED);
  // The Boosts panel is the anchor: the detail pane rendered, and the Trap panel is absent by
  // decision rather than because the screen never loaded.
  await expect(page.getByTestId('name-buys')).toBeVisible();
  await expect(page.getByTestId('trap-picker')).toHaveCount(0);
});

/**
 * The two panels, looked at, at both of the board's sizes.
 *
 * `fullPage` is deliberately not used for the battle board. The detail beside the rail is its own
 * `overflow-y-auto` scroller, so a full-page shot is the viewport again with the Trap panel still
 * below the fold: the first version of this file produced exactly that and certified nothing. The
 * panel is scrolled to and shot as an element, which is the only image that can show a cut word in
 * it.
 */
for (const size of [
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
]) {
  const tag = `${size.width}x${size.height}`;

  test.describe(`at ${tag}`, () => {
    test.use({ viewport: size });

    test('the Trap panel reads completely', async ({ page }) => {
      await serveTraps(page);
      await openFight(page, DEFENDED);
      const panel = page.getByTestId('trap-picker');
      await expect(panel).toBeVisible();
      await settleFonts(page);
      await panel.scrollIntoViewIfNeeded();

      await expect(panel).toContainText(HELD.name);
      await expect(panel).toContainText('2 in the bag');
      await expectNothingOverflowsTheScreen(page);
      await panel.screenshot({ path: `e2e-out/battles-trap-${tag}.png` });
      await page.screenshot({ path: `e2e-out/battles-trap-page-${tag}.png` });
    });

    test('the Traps bench reads completely', async ({ page }) => {
      await serveTraps(page);
      await page.goto('/game/scrapyard?bench=traps');
      await expect(page.getByTestId('scrapyard-traps')).toBeVisible();
      await settleFonts(page);

      await expectNothingOverflowsTheScreen(page);
      await page.screenshot({ path: `e2e-out/scrapyard-traps-${tag}.png` });
    });

    /**
     * §I4h: a cut trap, where it is spent.
     *
     * This used to look at the Inventory page's consumable panel. That page was retired (maintainer
     * request, 2026-09-14) and a trap moved to the Battles screen's Inventory tab, beside the back
     * room's boosts: both are bought, held, and spent on exactly one fight, and having them on two
     * screens was the thing the old page was doing wrong.
     */
    test('a cut trap waits on the battles inventory, beside the boosts', async ({ page }) => {
      await serveTraps(page);
      await page.goto('/game/battles');
      await page.getByRole('tab', { name: /Inventory/i }).click();
      await expect(page.getByTestId('battle-traps')).toBeVisible();
      await settleFonts(page);

      await expect(page.getByTestId('battle-traps')).toContainText(HELD.name);
      await expectNothingOverflowsTheScreen(page);
      await page.screenshot({ path: `e2e-out/battle-traps-${tag}.png`, fullPage: true });
    });
  });
}

/** The picker itself, opened: six traps, one live and the rest saying what is missing. */
test('the trap picker offers the whole catalogue and greys what is not in the bag', async ({
  page,
}) => {
  await serveTraps(page);
  await openFight(page, DEFENDED);
  await expect(page.getByTestId('trap-picker')).toBeVisible();
  await settleFonts(page);

  await page.getByTestId('trap-option-picker').click();
  const options = page.getByRole('option');
  await expect(options).toHaveCount(TRAP_CATALOG.length);
  await expect(options.first()).toContainText('2 in the bag');
  await expect(options.nth(1)).toContainText('None in the bag');
  await expect(options.nth(1)).toHaveAttribute('aria-disabled', 'true');

  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'e2e-out/battles-trap-picker.png' });
});

/**
 * A bench holding every trap, for the geometry below.
 *
 * The shared fixture holds one trap's document, which draws a single card: a bench that cannot
 * overflow measures nothing about a scroller. This one holds all six, which is the state a crew
 * that has worked the mission board is actually in.
 */
async function serveEveryTrap(page: Page): Promise<void> {
  await serveTraps(page);
  const full = {
    ...scrapyard,
    entries: scrapyard.entries.map((entry) =>
      entry.kind === 'trap' ? { ...entry, documentHeld: true, blocker: null } : entry,
    ),
  };
  await page.route('**/api/scrapyard**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(full),
    }),
  );
}

/**
 * The Traps bench scrolls inside its own board (maintainer report, 2026-09-16).
 *
 * The brass thumb started above the dark board and ran up into the page chrome: the scroller was
 * the whole bench, the "only when defending" line included, with the board a child of it. The
 * other benches put the scroll on the board, so the track is painted steel from top to bottom.
 * Measured rather than screenshotted, because the defect is a box: the element that scrolls has to
 * sit inside the element that is painted, and the bench has to actually overflow while it is
 * measured or the gate proves nothing.
 */
for (const size of [
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
]) {
  const tag = `${size.width}x${size.height}`;

  test.describe(`at ${tag}`, () => {
    test.use({ viewport: size });

    test('the Traps bench keeps its scrollbar inside the board', async ({ page }) => {
      await serveEveryTrap(page);
      await page.goto('/game/scrapyard?bench=traps');
      await expect(page.getByTestId('scrapyard-traps')).toBeVisible();
      await settleFonts(page);

      // The fixture is fat: every trap is drawn, or the bench below has nothing to scroll.
      await expect(page.locator('li[data-testid^="addon-trap"]')).toHaveCount(TRAP_CATALOG.length);

      const shape = await page.evaluate(() => {
        const tray = document.querySelector('[data-testid="scrapyard-traps"]')!;
        // `.ink-frame`, not `.steel-plate`: the benches were reskinned from yard steel to the feats
        // board's paper (maintainer, 2026-09-17), and `BENCH_BOARD` is what both names came from.
        const board = tray.closest('.ink-frame');
        let scroller: HTMLElement | null = tray.parentElement;
        while (scroller !== null && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) {
          scroller = scroller.parentElement;
        }
        const rect = (el: Element | null) => (el === null ? null : el.getBoundingClientRect());
        return {
          board: rect(board),
          scroller: rect(scroller),
          overflowPx: scroller === null ? 0 : scroller.scrollHeight - scroller.clientHeight,
          scrollerClass: scroller?.className ?? null,
        };
      });

      expect(shape.board, 'the trap tray sits on a board').not.toBeNull();
      expect(shape.scroller, 'something above the tray scrolls').not.toBeNull();
      const board = shape.board!;
      const scroller = shape.scroller!;
      expect(
        shape.overflowPx,
        'the bench has to overflow, or this measures nothing',
      ).toBeGreaterThan(0);
      expect(
        Math.round(scroller.top - board.top),
        `the scroller starts above the board: ${shape.scrollerClass}`,
      ).toBeGreaterThanOrEqual(-1);
      expect(
        Math.round(board.bottom - scroller.bottom),
        `the scroller runs past the bottom of the board: ${shape.scrollerClass}`,
      ).toBeGreaterThanOrEqual(-1);
      expect(
        Math.round(board.right - scroller.right),
        `the scrollbar sits outside the right edge of the board: ${shape.scrollerClass}`,
      ).toBeGreaterThanOrEqual(-1);

      await expectNothingOverflowsTheScreen(page);
      await page.screenshot({ path: `e2e-out/scrapyard-traps-scroll-${tag}.png` });
    });
  });
}
