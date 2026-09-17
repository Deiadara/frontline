import { expect, test } from '@playwright/test';
import {
  BUILDING_CATALOG,
  MODIFICATION_RARITIES,
  MODIFICATION_RARITY_LABELS,
  type BuildingKind,
} from '@frontline/shared';
import { lateGame, scrapyard } from './fixtures';
import { expectNothingOverflowsTheScreen, installApi, settleFonts } from './harness';

/**
 * The Scrapyard as a screen (§E1 to §E4, reworked 2026-09-10), looked at rather than asserted about.
 *
 * The unit gates say the right rows exist. This says the screen holds them: three benches under a
 * strip of tabs, a rail of structures beside the open bench, and every row fitting inside it
 * without cutting a name or pushing a Build control off the sheet.
 */

test.use({ viewport: { width: 1280, height: 800 } });

/**
 * The head is one line, and the eleven structures stand in the room it leaves (maintainer request,
 * 2026-09-15).
 *
 * Two separate asks that land on the same measurement. The filter and the yard's plate moved up
 * beside the benches, which gives the workspace a whole line back; the rail then has to hold all
 * eleven doors without a scrollbar, which it could not do before either change. Both are geometry,
 * so both are measured in a browser rather than asserted about class names.
 *
 * 1280x800 is the tightest viewport where this is expected to hold. It does not hold at 1280x720
 * or 1024x768 and is not asked to: eleven doors of two lines each want 362px against the 289px
 * that scene leaves, and the only way to close that is to stop saying what level a structure is at.
 * The rows keep a `min-content` floor there and the rail scrolls, which is the honest behaviour.
 */
test('puts the whole head on one line and fits all eleven structures without a scrollbar', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/scrapyard');
  await expect(page.getByTestId('scrapyard-menu')).toBeVisible();
  await settleFonts(page);

  const shape = await page.evaluate(() => {
    const tabs = document.querySelector('[role="tablist"]')!.getBoundingClientRect();
    const boxes = document
      .querySelector('[data-testid="scrapyard-head-boxes"]')!
      .getBoundingClientRect();
    const menu = document.querySelector('[data-testid="scrapyard-menu"]') as HTMLElement;
    const doors = document.querySelectorAll('[data-testid="scrapyard-menu"] li').length;
    return {
      // Same line: their vertical centres agree, which a wrapped row's never would.
      sameLine: Math.abs(tabs.y + tabs.height / 2 - (boxes.y + boxes.height / 2)) < 4,
      // ...and the boxes are the right-hand pair, not stacked under the benches.
      boxesRight: boxes.x > tabs.x + tabs.width - 1,
      overflowPx: menu.scrollHeight - menu.clientHeight,
      doors,
    };
  });

  expect(shape.doors, 'every structure has a door').toBe(11);
  expect(shape.sameLine, 'the filter and the yard plate sit on the benches’ own line').toBe(true);
  expect(shape.boxesRight, 'they are pushed to the right of the benches').toBe(true);
  expect(shape.overflowPx, 'the structures rail needs a scrollbar').toBeLessThanOrEqual(0);
});

const NEXUS = 'scrapyard-nexus';
const doorOf = (kind: BuildingKind) =>
  `scrapyard-bench-${BUILDING_CATALOG[kind].name.toLowerCase().replace(/[^a-z]+/g, '-')}`;

/**
 * A structure the fixture holds a document-locked row for. The row itself is off the board
 * (maintainer request, 2026-09-11: only what the crew has the drawings for is drawn); what is on the
 * bench is the count of what the blueprints are keeping back.
 */
const LOCKED = scrapyard.entries.find(
  (entry) => entry.kind === 'modification' && !entry.documentHeld,
)!;

test("the yard opens on the structures, with the yard's own plate beside the tabs", async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/scrapyard');
  await expect(page.getByTestId('scrapyard-menu')).toBeVisible();
  await settleFonts(page);

  // One door per structure, all eleven, standing or not.
  const doors = page.getByTestId('scrapyard-menu').getByRole('button');
  expect(await doors.count()).toBe(11);
  await expect(page.getByTestId('scrapyard-view-modifications')).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByTestId(NEXUS)).toBeVisible();
  await expect(page.getByTestId('scrapyard-info')).toBeVisible();
  await expect(page.getByTestId('scrapyard-level')).toContainText(
    `Level ${scrapyard.scrapyardLevel}`,
  );

  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'e2e-out/scrapyard-everything.png' });
});

test("a structure's door narrows the bench to it, and the tabs swap the bench", async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/scrapyard');
  await expect(page.getByTestId(NEXUS)).toBeVisible();
  await settleFonts(page);

  await page.getByTestId(doorOf(LOCKED.building!)).click();
  await expect(page.getByTestId(`scrapyard-${LOCKED.building}`)).toBeVisible();
  await expect(page.getByTestId(NEXUS)).toHaveCount(0);
  // The row behind a document the crew has not assembled is not drawn, and the bench says so.
  await expect(page.getByTestId(`addon-${LOCKED.id}`)).toHaveCount(0);
  /*
   * ...and the bench says nothing about it, because the crew holds six of this structure's own
   * cards (maintainer report, 2026-09-16).
   *
   * "Go out there and find some more blueprints." was drawn whenever anything was withheld, which
   * put it under a bench a player is already working. It is the empty state of a bench now: the
   * withheld row is still absent, which is what the assertion above pins, and the line waits for
   * a bench with nothing on it at all. The test below drives that bench.
   */
  await expect(page.getByTestId(`scrapyard-hidden-${LOCKED.building}`)).toHaveCount(0);

  await page.getByTestId('scrapyard-view-refits').click();
  await expect(page.getByTestId('scrapyard-refits')).toBeVisible();
  await expect(page.getByTestId('scrapyard-menu')).toHaveCount(0);
  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'e2e-out/scrapyard-refits.png' });

  /*
   * ...and coming back lands on the bench that was open, not on the first door in the rail.
   *
   * This asserted the Nexus until 2026-09-11, which was asserting a bug: `setParams` replaces the
   * whole query string, so writing `{ view }` dropped `?bench=<kind>` and a player who had the
   * Gauntlet open came back to the Nexus. A rail of eleven doors is exactly the place not to lose
   * which one was open.
   */
  await page.getByTestId('scrapyard-view-modifications').click();
  await expect(page.getByTestId(`scrapyard-${LOCKED.building}`)).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`bench=${LOCKED.building}`));
  await expect(page.getByTestId(NEXUS)).toHaveCount(0);

  // The Nexus is the default, not the memory: a yard opened with no bench named still starts there.
  await page.goto('/game/scrapyard');
  await expect(page.getByTestId(NEXUS)).toBeVisible();
});

/**
 * The bench with nothing on it is the one that says where to go and find some.
 *
 * The shared fixture holds at least six cards for every structure, so the empty state has to be
 * served rather than found: every one of this structure's rows goes behind its document, and the
 * structure next door, which keeps its cards and its two withheld rows, is the control. Without
 * it the assertion would pass on a page that never draws the line at all.
 */
test('a bench the crew holds nothing for says where to go and find some', async ({ page }) => {
  await installApi(page, lateGame);
  const bare = {
    ...scrapyard,
    /*
     * Every row this bench *shows*, not every row authored for this structure.
     *
     * A card reaches the structures its trade belongs to as of 2026-09-16, so a bench draws cards
     * that were written for somewhere else and a fixture that only hid the local ones left the
     * bench full. The bench asks `targets`, so that is what has to be emptied.
     */
    entries: scrapyard.entries.map((entry) =>
      entry.kind === 'modification' && entry.targets.some((target) => target.id === LOCKED.building)
        ? { ...entry, documentHeld: false, blocker: 'Needs the drawings' }
        : entry,
    ),
  };
  await page.route('**/api/scrapyard**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(bare) }),
  );

  await page.goto(`/game/scrapyard?bench=${LOCKED.building}`);
  await expect(page.getByTestId(`scrapyard-hidden-${LOCKED.building}`)).toContainText(
    'find some more blueprints',
  );
  await expect(page.locator('li[data-testid^="addon-"]')).toHaveCount(0);

  // The Lab holds six of its own and is keeping two back: cards on the bench, no line under it.
  await page.getByTestId(doorOf('lab')).click();
  await expect(page.getByTestId('scrapyard-lab')).toBeVisible();
  expect(await page.locator('li[data-testid^="addon-"]').count()).toBeGreaterThan(0);
  await expect(page.getByTestId('scrapyard-hidden-lab')).toHaveCount(0);

  await expectNothingOverflowsTheScreen(page);
});

/**
 * §E3: "everything you can build, based on the blueprints you hold and what you have researched".
 *
 * Measured as a difference rather than as a count. The filter is only worth having if the board it
 * leaves is *smaller* than the one it started from and still not empty, and the two assertions
 * either side of the click are what make a filter that does nothing fail.
 */
test('the ready filter leaves exactly the rows the yard could cut today', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/scrapyard?view=refits');
  await expect(page.getByTestId('scrapyard-refits')).toBeVisible();
  await settleFonts(page);

  const rows = page.locator('li[data-testid^="addon-"]');
  const before = await rows.count();
  const buildable = await page.locator('[data-testid^="addon-build-"]').count();
  expect(buildable).toBeGreaterThan(0);
  expect(buildable).toBeLessThan(before);

  await page.getByTestId('scrapyard-ready-only').click();
  await expect(page.locator('[data-testid^="addon-blocker-"]')).toHaveCount(0);
  expect(await page.locator('[data-testid^="addon-build-"]').count()).toBe(buildable);

  await expectNothingOverflowsTheScreen(page);
  await page.screenshot({ path: 'e2e-out/scrapyard-ready.png' });
});

/**
 * A row the yard is too low for says which level, before it says anything about documents.
 *
 * The Hardshell Exoframe is a MASTERPIECE card, which opens at a yard level the fixture (level 6)
 * has not reached; the fixture holds its document, so the level is the only thing in the way.
 */
test('a card the yard cannot reach names the level it opens at', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/scrapyard?view=refits');
  await expect(page.getByTestId('addon-hardshell_exoframe')).toBeVisible();
  await expect(page.getByTestId('addon-blocker-hardshell_exoframe')).toContainText(
    /Needs the Scrapyard at level \d+/,
  );
});

/**
 * The unit bench is four groups in the yard's order, and one press (maintainer request, 2026-09-15).
 *
 * This replaced the four refit ladders and the test that held their tiers level across columns.
 * The cards have no tiers now; what they have is a grade, and the two things worth measuring are
 * that the groups come in the order the yard opens them and that a group boundary does not change
 * a card's height. The second is the one that fails quietly: four separate trays would each be
 * internally level and the bench would still read as a broken fence between them.
 */
test('the unit bench groups its cards by rarity, every card the same height', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await installApi(page, lateGame);
  await page.goto('/game/scrapyard?view=refits');
  await expect(page.getByTestId('scrapyard-refits')).toBeVisible();
  await settleFonts(page);

  const headings = await page
    .locator('[data-testid^="scrapyard-rarity-"] h3')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent));
  expect(headings).toEqual(
    MODIFICATION_RARITIES.map((rarity) => MODIFICATION_RARITY_LABELS[rarity]),
  );

  // Every card on the bench, its group, and its height, in document order.
  const cards = await page.getByTestId('scrapyard-unit-modifications').evaluate((tray) =>
    [...tray.children].reduce<{ group: string; height: number }[]>((acc, node) => {
      const id = node.getAttribute('data-testid') ?? '';
      if (id.startsWith('scrapyard-rarity-')) acc.push({ group: id, height: 0 });
      else if (id.startsWith('addon-')) {
        const group = acc[acc.length - 1];
        if (group) acc.push({ group: group.group, height: node.getBoundingClientRect().height });
      }
      return acc;
    }, []),
  );
  const heights = cards.filter((card) => card.height > 0).map((card) => Math.round(card.height));
  // A guard on the fixture: more than one group, more than one card each, or this proves nothing.
  expect(new Set(cards.map((card) => card.group)).size).toBe(4);
  expect(heights.length).toBeGreaterThan(8);
  expect(
    Math.max(...heights) - Math.min(...heights),
    `heights: ${heights.join(', ')}`,
  ).toBeLessThanOrEqual(1);

  // The groups are contiguous: a card's group never goes back to one already closed.
  const order = cards
    .map((card) => card.group)
    .filter((group, at, all) => all.indexOf(group) === at);
  expect(order).toEqual(MODIFICATION_RARITIES.map((rarity) => `scrapyard-rarity-${rarity}`));

  await expectNothingOverflowsTheScreen(page);
});

/**
 * The sheet on a hover, over a door that is still a door (maintainer, 2026-09-17).
 *
 * "Make it so their unit card appears with portrait etc, but it does not stop you from clicking."
 * Three things have to hold at once and none of them is visible to a unit test: the card opens, it
 * takes no pointer events of its own, and the press underneath it still chooses that unit's bench.
 * The last is the one that broke first: the row became a `HoverCard` trigger and stopped announcing
 * which door was open, because `aria-pressed` was left behind on the button it replaced.
 */
/**
 * Every door's card is the same box (maintainer, 2026-09-17).
 *
 * "Make the unit cards all be equally as big in size so that it all comfortably fits." They were
 * not: the portal was `w-max` under a 42rem ceiling, so the card took its width from whichever unit
 * the pointer was on. Measured across the rail it ran 547px for a Razor to 672px for a Cyber Dog,
 * and the two widest were being *clipped* by that ceiling rather than fitted by it, which wrapped
 * their marks band.
 *
 * Walked across the whole rail rather than sampled at two doors, because the widths were content's
 * and the content is per unit: a pair that happened to agree would pass a two-door test while the
 * nineteen between them disagreed.
 */
test('draws every unit door card at one size, with nothing spilling out of it', async ({
  page,
}) => {
  await installApi(page, lateGame);
  await page.goto('/game/scrapyard?view=refits');
  await expect(page.getByTestId('scrapyard-unit-menu')).toBeVisible();
  await settleFonts(page);

  const doors = await page
    .getByTestId('scrapyard-unit-menu')
    .evaluate((rail) =>
      [...rail.querySelectorAll('[data-testid^="scrapyard-unit-"]')].map((door) =>
        door.getAttribute('data-testid')!,
      ),
    );
  expect(doors.length, 'the rail should carry the whole roster').toBeGreaterThan(10);

  const sizes = new Map<string, string>();
  for (const id of doors) {
    await page.getByTestId(id).hover();
    const card = page.getByRole('tooltip');
    await expect(card).toBeVisible();
    const box = (await card.boundingBox())!;
    sizes.set(id, `${Math.round(box.width)}x${Math.round(box.height)}`);
    /*
     * And "comfortably", which a width on its own does not prove: a card clamped to one size can
     * still be one whose chips are hanging over the edge. Measured against the card's own box
     * rather than the screen, because the screen is what `expectNothingOverflowsTheScreen` covers
     * and a portal can be inside the window while its contents are outside the frame.
     */
    const spill = await card.evaluate((root) => {
      const frame = root.getBoundingClientRect();
      let worst = 0;
      for (const element of root.querySelectorAll('*')) {
        const box = element.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) continue;
        worst = Math.max(
          worst,
          box.right - frame.right,
          frame.left - box.left,
          box.bottom - frame.bottom,
        );
      }
      return Math.round(worst);
    });
    expect(spill, `${id} has content ${spill}px outside its own card`).toBeLessThanOrEqual(0);
    await page.mouse.move(2, 2);
  }

  const distinct = new Set(sizes.values());
  expect(
    distinct.size,
    `the rail draws ${distinct.size} different cards: ${JSON.stringify([...sizes])}`,
  ).toBe(1);
});

test('hovering a unit shows its card, and the door underneath still opens', async ({ page }) => {
  await installApi(page, lateGame);
  await page.goto('/game/scrapyard?view=refits');
  await expect(page.getByTestId('scrapyard-unit-menu')).toBeVisible();
  await settleFonts(page);

  const door = page.getByTestId('scrapyard-unit-anodics');
  await door.hover();
  const card = page.getByRole('tooltip');
  await expect(card).toBeVisible();
  // The card a roster shows, portrait and all, rather than a line of prose.
  await expect(card.getByTestId('unit-anodics')).toBeVisible();
  await expect(card.locator('img, canvas, svg').first()).toBeVisible();

  /*
   * It does not eat the pointer, which is what "does not stop you from clicking" means in the DOM.
   * Measured by asking the document what is under the middle of the card rather than by trusting a
   * class: `pointer-events-none` is one `cn` away from being lost.
   */
  const box = (await card.boundingBox())!;
  const through = await page.evaluate(
    ([x, y]) => {
      const el = document.elementFromPoint(x as number, y as number);
      return el?.closest('[role="tooltip"]') === null;
    },
    [box.x + box.width / 2, box.y + box.height / 2],
  );
  expect(through, 'the card is swallowing clicks meant for the page').toBe(true);

  await door.click();
  await expect(door).toHaveAttribute('aria-pressed', 'true');
  // ...and no other door is, which is the half `aria-pressed` on one row cannot prove on its own.
  await expect(page.getByTestId('scrapyard-unit-razors')).toHaveAttribute('aria-pressed', 'false');
  await settleFonts(page);
  await page.screenshot({ path: 'screenshots/scrapyard-unit-hover.png' });
});
