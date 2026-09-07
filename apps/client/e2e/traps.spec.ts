import {
  TRAP_CATALOG,
  blueprintForTrap,
  type BattlesResponse,
  type ScrapyardEntry,
  type ScrapyardResponse,
  type TrapOption,
} from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import { battles, lateGame, market, scrapyard } from './fixtures';
import { expectNothingOverflowsTheScreen, installApi, settleFonts } from './harness';

/**
 * Traps as a defensive consumable, on the screens (plan §I4).
 *
 * Two screens and one object between them: the yard cuts a trap onto a bench of its own, and the
 * battle board sets it under a fight this crew is defending. The unit gates say the right rows
 * exist; this says a player can see them, that an attacker cannot, and that neither screen cuts a
 * word doing it.
 *
 * The payloads are built here and routed **after** `installApi`, so the shared fixture is left
 * alone: Playwright matches the most recently registered route first, and what the trap panels
 * need is one crew holding two traps rather than a change every other spec has to live with.
 */

test.use({ viewport: { width: 1280, height: 720 } });

const HELD = TRAP_CATALOG[0]!;

/** The yard's rows for the three traps, worded exactly as `projectScrapyard` words them. */
const trapEntries: ScrapyardEntry[] = TRAP_CATALOG.map((spec, index) => ({
  id: spec.id,
  kind: 'trap' as const,
  name: spec.name,
  description: spec.description,
  building: null,
  effect: `Takes ${Math.round(spec.killShare * 100)}% off the attack, up to ${spec.maxKills} bodies`,
  cost: spec.cost,
  advanced: (spec.cost.highQualityMetal ?? 0) > 0,
  blueprint: blueprintForTrap(spec.id)?.name ?? null,
  owned: index === 0 ? 2 : 0,
  // One live row and two locked ones, which is the state worth looking at: a bench where every
  // row is buildable never draws a blocker, and one where none is never draws a Build.
  blocker: index === 0 ? null : `Needs the ${blueprintForTrap(spec.id)?.name}`,
}));

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

const yardWithTraps: ScrapyardResponse = {
  ...scrapyard,
  entries: [...scrapyard.entries, ...trapEntries],
};

async function serveTraps(page: Page): Promise<void> {
  await installApi(page, lateGame);
  const json = (data: unknown) => ({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(data),
  });
  await page.route('**/api/scrapyard**', (route) => route.fulfill(json(yardWithTraps)));
  await page.route('**/api/battles**', (route) => route.fulfill(json(withTraps)));
  // §I4h: the satchel reads its rows off the market payload rather than an endpoint of its own,
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

test('the yard has a Traps bench, and it is one door among the rest', async ({ page }) => {
  await serveTraps(page);
  await page.goto('/game/scrapyard');
  await expect(page.getByTestId('scrapyard-menu')).toBeVisible();
  await settleFonts(page);

  await expect(page.getByTestId('scrapyard-bench-traps')).toBeVisible();
  await page.getByTestId('scrapyard-bench-traps').click();
  await expect(page.getByTestId('scrapyard-traps')).toBeVisible();
  // Narrowed to itself, exactly as the refit bench narrows: the structures are gone.
  await expect(page.getByTestId('scrapyard-nexus')).toHaveCount(0);
  await expect(page.getByTestId('scrapyard-refits')).toHaveCount(0);

  for (const spec of TRAP_CATALOG) await expect(page.getByTestId(`addon-${spec.id}`)).toBeVisible();
  await expect(page.getByTestId(`addon-build-${HELD.id}`)).toBeVisible();
  // The locked rows name the document rather than saying "a blueprint".
  await expect(page.getByTestId(`addon-blocker-${TRAP_CATALOG[1]!.id}`)).toContainText(
    /Needs the .+ Blueprint/,
  );

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

  // ...and the rail still writes the URL, so the two cannot disagree about what is open.
  await page.getByTestId('scrapyard-bench-traps').click();
  await expect(page).toHaveURL(/bench=traps/);
  await expect(page.getByTestId('scrapyard-traps')).toBeVisible();

  // A bench this yard has no door for is the whole board rather than an empty workspace: a
  // structure with nothing left to build has no bench, and the building dialog links by structure.
  await page.goto('/game/scrapyard?bench=nothing-here');
  await expect(page.getByTestId('scrapyard-traps')).toBeVisible();
  await expect(page.getByTestId('scrapyard-nexus')).toBeVisible();
  await expect(page.getByTestId('scrapyard-bench-everything')).toHaveAttribute(
    'aria-pressed',
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

    /** §I4h: the satchel's own panel for the new kind, with a trap sitting in it. */
    test('the satchel shows a consumable on its own panel', async ({ page }) => {
      await serveTraps(page);
      await page.goto('/game/inventory');
      await expect(page.getByTestId('satchel-consumable')).toBeVisible();
      await settleFonts(page);

      await expect(page.getByTestId('satchel-consumable')).toContainText(HELD.name);
      await expectNothingOverflowsTheScreen(page);
      await page.screenshot({ path: `e2e-out/satchel-consumable-${tag}.png`, fullPage: true });
    });
  });
}

/** The picker itself, opened: three traps, one live and two saying what is missing. */
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
