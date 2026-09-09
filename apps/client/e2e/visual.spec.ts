/**
 * MOU-114 acceptance gate: every screen, at every supported viewport, with zero visual bugs.
 *
 * Screenshots land in `screenshots/visual/<screen>-<w>x<h>.png` so a reviewer can eyeball the
 * whole matrix in one directory. The assertions catch the failures that are cheap to detect
 * mechanically: document overflow, unexpected scrollbars, a control that has slid off the picture
 * it stands on, so review time is spent on the ones that are not (composition, colour, legibility).
 */
import { expect, test, type Page } from '@playwright/test';
import {
  BUILDING_KINDS,
  CITY_DISTRICTS,
  DISTRICT_NAME_MAX,
  MISSIONS_PER_AREA,
  RESOURCE_LABELS,
  RESOURCE_ORDER,
  UNIT_TIER_LABELS,
  UNIT_TIERS,
} from '@frontline/shared';
import {
  activeResearch,
  districtWithAddons,
  hudExtremes,
  lateGame,
  market,
  me,
  meNoOverseer,
  missionsResponse,
  pagesHeld,
  unitsResponse,
} from './fixtures';
import {
  expectControlNotDimmed,
  expectNoImagesClipped,
  expectNothingOverflowsTheScreen,
  expectNothingClippedVertically,
  expectSheetNotWashedOut,
  installApi,
  settleFonts,
} from './harness';

interface Size {
  readonly width: number;
  readonly height: number;
}

const VIEWPORTS: readonly Size[] = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  // MOU-188 was reported here, so the screenshot the board looks at has to be regenerated, not
  // measured once by hand and thrown away.
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

/**
 * No element may stick out of the viewport horizontally. Vertical is covered by the document
 * check above; horizontal needs per-element inspection because a `w-full` child of an
 * `overflow-hidden` parent clips silently rather than growing the document.
 *
 * `[data-scenery]` opts an element out, and only that element: never its subtree. Full-bleed
 * artwork is deliberately larger than the frame (a blurred backdrop has to over-scale or it shows a
 * soft rim), but the things standing *on* the artwork are still content: the first version of this
 * exemption covered whole subtrees and would have hidden the bug that prompted it, which was a
 * building's plot hanging 58px off the left edge where nobody could click it.
 */
async function expectNothingClippedHorizontally(page: Page): Promise<void> {
  await settleFonts(page);
  const offenders = await page.evaluate<string[]>(() => {
    const bad: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.position === 'fixed') continue;
      if (el.hasAttribute('data-scenery')) continue;
      if (rect.right > window.innerWidth + 1 || rect.left < -1) {
        bad.push(`${el.tagName.toLowerCase()}.${el.className} [${rect.left}..${rect.right}]`);
      }
    }
    return bad.slice(0, 5);
  });
  expect(offenders, `elements outside the viewport: ${offenders.join(' | ')}`).toEqual([]);
}

/**
 * The roster gives up whole cards, never part of one.
 *
 * `expectNothingClippedVertically` proves no card is sliced; this proves the roster is still
 * honest about the ones it dropped. Both branches are real: at 1280x720 two cards do not fit, at
 * every taller viewport all four do, so the tight viewport is the fat case this screen has, its
 * content being the same four presets everywhere.
 *
 * `fitsWholeRoster` pins which of the two branches a viewport is in. Reading the hidden count off
 * the DOM and checking only that the hint agrees with it is self-fulfilling: a card that grew back
 * into the 5px of slack 1024x768 has would silently halve the roster and stay green: the same
 * shape of blind spot that let the horizontal-only gate ship the bug this file exists for.
 */
async function expectWholeCardRows(page: Page, fitsWholeRoster: boolean): Promise<void> {
  // Polled, not read once: the viewport is sized by a layout effect that re-runs on every resize
  // and on the font swap, so a single snapshot can catch an intermediate pass.
  const roster = () =>
    page.evaluate<{ total: number; hidden: number }>(() => {
      const cards = [...document.querySelectorAll('button[aria-pressed]')];
      const viewport = cards[0]?.closest('.overflow-y-auto');
      if (!viewport) throw new Error('roster viewport not found');
      const { bottom } = viewport.getBoundingClientRect();
      return {
        total: cards.length,
        hidden: cards.filter((card) => card.getBoundingClientRect().bottom > bottom + 1).length,
      };
    });

  await expect
    .poll(async () => (await roster()).total, { message: 'every preset must be rendered' })
    .toBe(4);
  await expect
    .poll(async () => (await roster()).hidden === 0, {
      message: fitsWholeRoster
        ? 'this viewport has room for every overseer'
        : 'this viewport is too short for two rows, so cards must drop',
    })
    .toBe(fitsWholeRoster);

  const hidden = (await roster()).hidden;
  const hint = page.getByText(/Scroll for \d+ more/);
  if (hidden === 0) {
    await expect(hint, 'a roster that fits must not advertise hidden cards').toHaveCount(0);
  } else {
    await expect(hint, 'hidden cards must be advertised, and counted correctly').toHaveText(
      new RegExp(`Scroll for ${hidden} more`),
    );
  }
}

/**
 * The training sheet gives up whole drill rows, and owns up to the ones it gave up.
 *
 * Thirty-three rows in four columns do not fit a short viewport: eleven Technical rows want 455px
 * and a 1440x900 laptop leaves 399 for them. The sheet has always been a scrolling region, so
 * nothing was ever unreachable, and every gate in this file passed it: the failure was that the
 * cut landed wherever the frame ended, slicing the last visible row through its digits with no
 * sign that scrolling recovered it. That is what the board reported, and it is what this pins.
 *
 * `fitsWholeSheet` records which branch a viewport is in rather than being a target, the way the
 * character select's roster flag does. Both branches are real and both have to be checked: a fold
 * that swallowed rows at 1920x1080 and a sheet that sliced one at 1280x720 are the same bug seen
 * from two sides, and reading the hidden count off the DOM and only checking the line agrees with
 * it would be self-fulfilling.
 */
async function expectWholeDrillRows(page: Page, fitsWholeSheet: boolean): Promise<void> {
  const fold = await page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>('[data-testid="training-sheet"]');
    const grid = frame?.firstElementChild;
    if (!grid) throw new Error('the training sheet is not on the page');
    const cut = grid.getBoundingClientRect().bottom;
    const rows = [...document.querySelectorAll<HTMLElement>('[data-testid^="drill-"]')];
    return {
      total: rows.length,
      sliced: rows.filter((row) => {
        const box = row.getBoundingClientRect();
        return box.top < cut - 1 && box.bottom > cut + 1;
      }).length,
      hidden: rows.filter((row) => row.getBoundingClientRect().bottom > cut + 1).length,
    };
  });

  expect(fold.total, 'no drill rows on the training page').toBeGreaterThan(20);
  expect(fold.sliced, 'the sheet cut a drill row in half').toBe(0);
  expect(
    fold.hidden === 0,
    fitsWholeSheet
      ? 'this viewport has room for every drill'
      : 'this viewport is too short for eleven Technical rows, so rows must drop',
  ).toBe(fitsWholeSheet);

  const line = page.getByTestId('training-fold');
  if (fold.hidden === 0) {
    await expect(line, 'a sheet that fits must not advertise dropped rows').toHaveCount(0);
  } else {
    await expect(line, 'dropped rows must be advertised, and counted correctly').toHaveText(
      new RegExp(`Scroll for ${fold.hidden} more`),
    );
  }
}

for (const size of VIEWPORTS) {
  const tag = `${size.width}x${size.height}`;

  test.describe(`viewport ${tag}`, () => {
    test.use({ viewport: size });

    test(`auth screen at ${tag}`, async ({ page }) => {
      await page.goto('/auth');
      await expect(page.getByRole('heading', { name: 'FRONTLINE' })).toBeVisible();
      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await expectNothingClippedVertically(page);
      await page.screenshot({ path: `screenshots/visual/auth-${tag}.png` });
    });

    test(`character select at ${tag}`, async ({ page }) => {
      await installApi(page, meNoOverseer);
      await page.goto('/overseer');
      await expect(page.getByRole('heading', { name: 'CHOOSE YOUR OVERSEER' })).toBeVisible();
      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await expectNothingClippedVertically(page);
      // Two card rows need ~652px of frame, and only viewports 900px tall and up can pay for it.
      //
      // This flag has never been a target; it records which branch each viewport lands in, and it
      // has moved twice. 1024x768 used to clear the old ~608px by 5px and stopped when the display
      // face went from Orbitron to Rajdhani. 1280x800 cleared it until the attribute model was
      // reworked: the sheet gained two attributes (Authority and Cryptography) and its labels went
      // up a size and a shade for legibility, which is 22px of card. Both times the alternative was
      // squeezing type on a screen whose whole job is to be read, and both times the screen already
      // did the right thing without help: it drops a whole row and says "scroll for 2 more". So
      // the number moves and the assertion keeps its teeth: a viewport on the wrong side of it
      // still fails, and a roster that silently halves itself at 1440x900 still fails.
      await expectWholeCardRows(page, size.height >= 900);
      await page.screenshot({ path: `screenshots/visual/overseer-${tag}.png` });
    });

    /*
     * The city, and the ten ways into it.
     *
     * The painting is cover-cropped to fill the frame, which means a tag placed at a fraction of
     * the *picture* can land outside the part of it that is on screen: at 1024x768 the frame is
     * short enough that the top eighth of the painting is cut away, and the two tags up there went
     * with it. `PlateRoom` clamps every mark into the visible window for exactly that reason, and
     * this is what proves it, at every viewport and for every district rather than for the two
     * that were reported.
     */
    test(`the city at ${tag}`, async ({ page }) => {
      await installApi(page, me);
      await page.goto('/game');
      await expect(page.getByTestId('city-room')).toBeVisible();
      await settleFonts(page);
      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await expectNothingClippedVertically(page);

      /*
       * The same picture on every screen, and that is the whole requirement.
       *
       * Cover-fitting showed a different slice of the painting for every window shape, so the city
       * was one thing windowed, another full screen, and another again on a second monitor: a
       * player could not learn where anything was. The plate is painted at 21:10 for this frame and
       * is now drawn `whole`, which means two things that are checked exactly rather than loosely:
       * the aspect it is drawn at is its own, and all of it is inside the frame.
       *
       * 3780x1800 is restated here rather than imported from the screen it is testing. That is the
       * point of it: a test that reads the aspect out of `CityView` would agree with any value the
       * component happened to hold, including a wrong one.
       */
      const TRUE_ASPECT = 3780 / 1800;
      const measure = () =>
        page.evaluate(() => {
          const room = document.querySelector('[data-testid="city-room"]');
          const images = [...(room?.querySelectorAll('img') ?? [])];
          // The sharp painting is the last one: the blurred surround is drawn behind it.
          const picture = images[images.length - 1]?.getBoundingClientRect();
          const frame = room?.firstElementChild?.getBoundingClientRect();
          if (!picture || !frame) throw new Error('the city has no painting in a frame');
          return { pw: picture.width, ph: picture.height, fw: frame.width, fh: frame.height };
        });

      /*
       * Polled, because the frame is still settling when the page first looks ready.
       *
       * `--nav-h` grows the moment the in-flight rail arrives, which is after the first paint, and
       * the room's size is read back through a `ResizeObserver`, so there is a frame where the
       * painting is sized against the taller frame it had a moment ago. Asserting once inside that
       * window measures a page that is mid-update rather than the page.
       *
       * It still has teeth: a painting that were permanently distorted, or permanently larger than
       * its frame, never reaches this state and the poll fails on the timeout.
       */
      await expect
        .poll(
          async () => {
            const at = await measure();
            return {
              aspect: Number((at.pw / at.ph).toFixed(3)),
              fits: at.pw <= at.fw + 1 && at.ph <= at.fh + 1,
            };
          },
          { message: `the city's painting is distorted or overflowing its frame at ${tag}` },
        )
        .toEqual({ aspect: Number(TRUE_ASPECT.toFixed(3)), fits: true });

      const offScreen: string[] = [];
      for (const district of CITY_DISTRICTS) {
        const tag$ = page.getByTestId(`district-tag-${district.id}`);
        await expect(tag$, `${district.name} has no tag on the painting`).toBeVisible();
        const box = await tag$.boundingBox();
        if (!box) throw new Error(`${district.id} has no box`);
        if (
          box.y < 0 ||
          box.x < 0 ||
          box.y + box.height > size.height ||
          box.x + box.width > size.width
        ) {
          offScreen.push(`${district.name} at [${Math.round(box.x)},${Math.round(box.y)}]`);
        }
      }
      expect(offScreen, `district tags off screen: ${offScreen.join(' | ')}`).toEqual([]);

      /*
       * ...and no two of them on top of each other.
       *
       * The marks are hand-placed against features in the painting, so the only thing that decides
       * how wide a tag is is the *text*, and four of the twelve print a crew's name rather than an
       * authored one (`districtDisplayName`). A crew called something long is three times the width
       * of the word the mark was placed for: "The Ninth Street Crew" on the far-right terraces ran
       * left under the cathedral and shouldered the CCS tag off it. Renaming a crew must not be
       * able to bury a district, so the collision is measured rather than eyeballed.
       */
      const collisions = await page.evaluate(() => {
        const tags = [...document.querySelectorAll('[data-testid^="district-tag-"]')].map(
          (node) => ({
            id: node.getAttribute('data-testid')!.replace('district-tag-', ''),
            box: node.getBoundingClientRect(),
          }),
        );
        const hits: string[] = [];
        for (let i = 0; i < tags.length; i += 1) {
          for (let j = i + 1; j < tags.length; j += 1) {
            const a = tags[i]!.box;
            const b = tags[j]!.box;
            const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (overlapX > 0 && overlapY > 0) hits.push(`${tags[i]!.id} over ${tags[j]!.id}`);
          }
        }
        return hits;
      });
      expect(collisions, `district tags overlap: ${collisions.join(' | ')}`).toEqual([]);

      await page.screenshot({ path: `screenshots/visual/city-${tag}.png` });
    });

    /*
     * MOU-161: HUD chips are sized by the digits inside them, so the starting stockpile is the
     * easiest case, not a representative one. A six-figure bank with both meters pegged at 100
     * is what a real save looks like, and it is what pushed the infamy meter clean off a
     * horizontally-scrolling economy row at 1024px. Every resource and meter must stay on
     * screen without the player dragging anything.
     */
    test(`late-game HUD stays on screen at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game');
      await expect(page.getByTestId('city-room')).toBeVisible();
      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await expectNothingClippedVertically(page);

      // The whole chip, not just its label: the label is now the chip's accessible name rather
      // than a word printed beside the number, and "the readout is fully on screen" was always the
      // thing worth asserting anyway.
      // Each chip is a hover trigger now: a real button, so the reading is its accessible name
      // rather than a `role="img"` wrapper. "The whole readout is on screen" is still the thing
      // being asserted, which is what matters when the numbers get long enough to wrap the bar.
      // Derived from the domain rather than listed, because a hand-written list is how §D5b's
      // planks reached the stockpile, the market and the HUD without this ever checking it was on
      // screen. A resource added to `RESOURCE_ORDER` is now asserted here the day it exists.
      const hud = page.locator('header');
      const readouts = [...RESOURCE_ORDER.map((key) => RESOURCE_LABELS[key]), 'Infamy'];
      expect(readouts).toHaveLength(7);
      for (const chip of readouts) {
        await expect(
          hud.getByRole('button', { name: new RegExp(`^${chip}:`, 'i') }),
        ).toBeInViewport({ ratio: 1 });
      }
      // The crew's level took the morale meter's place in the bar (§I). Named differently because
      // it is not a `Thing: number` readout: it is a level, and it reads as one. "Crew" rather than
      // "faction": a faction is now a team of players (§J) and this is the player's own progression.
      await expect(hud.getByRole('button', { name: /^Crew level/i })).toBeInViewport({
        ratio: 1,
      });
      await page.screenshot({ path: `screenshots/visual/hud-late-game-${tag}.png` });
    });

    /**
     * The bar has to survive a name the game itself allows.
     *
     * The cap was 40 and every fixture uses 21, so the row was fitted to a plaque half the width
     * of a legal one and the bar wrapped at the ceiling. `DISTRICT_NAME_MAX` is 28 now, chosen as
     * what the row can actually carry, so the bar is asserted to keep **one line** at the longest
     * name the game will accept. The chips are not the thing to count: an over-wide plaque pushes
     * the meters and the avatar onto the second line and leaves every stockpile chip where it was,
     * which is how the first version of this passed with the fix taken out.
     */
    test(`the HUD survives the longest legal district name at ${tag}`, async ({ page }) => {
      const longest = 'The Ninth Street Reclamation Company Ltd'.slice(0, DISTRICT_NAME_MAX);
      expect(longest).toHaveLength(DISTRICT_NAME_MAX);
      const crew = lateGame.base;
      if (crew === null) throw new Error('the late-game fixture must have a crew');
      await installApi(page, { ...lateGame, base: { ...crew, name: longest } });
      await page.goto('/game');
      await expect(page.getByTestId('resource-chip-caps')).toBeVisible();
      await settleFonts(page);

      // Whole and on screen. The crew name is the one label on this bar a player chose
      // themselves, so it is also the one that must not be sliced. It reads off the plaque rather
      // than off a heading now: the bar carries no page heading, and the sign in the middle of it
      // is a button with two names on it (`DistrictPlaque`).
      const plaque = page.getByTestId('district-plaque');
      await expect(plaque).toBeVisible();
      await expect(plaque).toContainText(longest);

      // The stockpile stays on one line whatever the name does. It is the row read most often, and
      // a name that reflowed it would cost a tier of the world underneath. The plaque itself may
      // sit on a second tier below 1500px, which is authored: see the note in `TopHud`.
      const rows = await page.evaluate(() => {
        const bar = document.querySelector('header')!;
        const items = [...bar.querySelectorAll('[data-testid^="resource-chip-"]')];
        return new Set(items.map((i) => Math.round(i.getBoundingClientRect().top))).size;
      });
      expect(rows, 'a legal district name wrapped the stockpile').toBe(1);
      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
    });

    test(`base view at ${tag}`, async ({ page }) => {
      await installApi(page, me);
      await page.goto('/game/base');
      await expect(page.getByTestId('district-plaque')).toContainText('The Ninth Street Crew');
      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      /*
       * No vertical guard here, deliberately. The base panel is a document scroller: its content
       * is arbitrarily long, so the last visible row is cut at every viewport, exactly as an
       * ordinary scrolling page cuts it. That is a different question from a *bounded* viewport
       * silently ending mid-card, which is what the guard exists for. What the fold does expose at
       * 1280x720 is that nothing advertises the scroll: MOU-195 tracks the affordance.
       */
      await page.screenshot({ path: `screenshots/visual/base-${tag}.png` });
    });

    /**
     * §A1: the district with work under way, so the rail down the left is on screen.
     *
     * A separate case rather than a queue bolted onto the starting fixture, which is the honest
     * split: `me` is a crew's first hour and should screenshot as one. The rail is only drawn when
     * there is something in it, so without a fixture that has orders in it nobody reviews it.
     */
    test(`the district with a queue at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/base');
      await expect(page.getByTestId('build-rail')).toBeVisible();
      await settleFonts(page);

      // The one being worked, and the two waiting behind it.
      await expect(page.getByTestId('build-rail-quarters')).toBeVisible();
      await expect(page.getByTestId('build-rail-gate')).toBeVisible();

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/base-queue-${tag}.png` });
    });

    /*
     * MOU-162 §E3/§E4: the dedicated missions page, at the widest state it has. `missionsResponse`
     * fills every crew slot, puts a day-long run one minute into its clock so the countdown reads
     * `25:5x:xx`, the widest string that column can hold, and returns a mission paying all five
     * resources, the longest reward line that can render. Both surfaces are on this one page: the
     * in-flight timers (§E3) and the board, where travel and mission time are quoted separately
     * before you commit (§E4).
     *
     * Like the base view this is a document scroller, so there is no vertical-clip guard: content
     * is arbitrarily long and the fold cuts the last row at every viewport by design.
     */
    /**
     * MOU-227: the level-up a returning crew paid for is announced on the settling response only,
     * so this banner is the whole moment. Its copy is fixed, which makes a cut label a permanent
     * defect rather than a fat-content edge case: it has to render whole at every width.
     */
    test(`missions page announces a level-up at ${tag}`, async ({ page }) => {
      await installApi(page, me);
      // Registered after `installApi`, so Playwright's reverse-order matching gives it priority.
      await page.route('**/api/missions', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...missionsResponse(),
            // Two levels at once: the widest the banner ever gets, since the count only renders
            // above 1 (§I2 grants read off the new level).
            levelUp: {
              level: 6,
              levelsGained: 2,
              grants: { assigneePool: 8, assigneeCapPerOfficer: 3, recruitSlots: 7 },
            },
          }),
        }),
      );
      await page.goto('/game/missions');

      const banner = page.getByRole('region', { name: 'Level up' });
      await expect(banner).toBeVisible();
      await settleFonts(page);

      const clipped = await page.evaluate<string[]>(() =>
        [...document.querySelectorAll<HTMLElement>('section[aria-label="Level up"] *')]
          .filter((el) => el.children.length === 0 && el.scrollWidth > el.clientWidth + 1)
          .map((el) => `"${el.textContent?.trim()}" (${el.scrollWidth}>${el.clientWidth}px)`),
      );
      expect(clipped, `cut text in the level-up banner: ${clipped.join(' | ')}`).toEqual([]);

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/missions-levelup-${tag}.png` });
    });

    test(`missions page at ${tag}`, async ({ page }) => {
      await installApi(page, me);
      await page.goto('/game/missions');
      await expect(page.getByTestId('board-area')).toBeVisible();
      await settleFonts(page);

      // The inner board: one area at a time, with the arrows either side of its name (§E4).
      await expect(page.getByTestId('board-area')).toBeVisible();
      await expect(page.getByTestId('board-left')).toBeVisible();
      await expect(page.getByTestId('board-right')).toBeVisible();

      // §E4: travel and mission time are quoted separately, and the total is the §E8 sum. Read off
      // whichever job the board is offering rather than a named one: which three an area offers is
      // `missionOffers`' business, and naming one here would pin content this test is not about.
      const offers = page.locator('[data-testid^="offer-"]');
      await expect(offers).toHaveCount(MISSIONS_PER_AREA);
      const first = offers.first();
      await expect(first.getByText('Travel', { exact: true })).toBeVisible();
      await expect(first.getByText('On site', { exact: true })).toBeVisible();
      await expect(first.getByText('Round trip', { exact: true })).toBeVisible();

      /*
       * Three cards, and every section on the same line across all three.
       *
       * The board asked for it in those words, and it is what makes three offers comparable at a
       * glance: a player reading them is comparing them, and a column that shifts because one
       * brief is a line longer makes that comparison work. Measured on the deploy button, which is
       * the last thing in a card and therefore carries every drift above it.
       */
      const buttonTops = await offers.evaluateAll((cards) =>
        cards.map((card) =>
          Math.round(
            (card.querySelector('button:last-of-type')?.getBoundingClientRect().top ?? 0) -
              card.getBoundingClientRect().top,
          ),
        ),
      );
      expect(new Set(buttonTops).size, `deploy buttons at ${buttonTops.join(', ')}px`).toBe(1);

      /*
       * And no band's contents running through the band under it.
       *
       * Every section of an offer card is a fixed height, which is what makes three cards
       * comparable and is also how a card comes to overlap *itself*: a six-resource haul wraps to
       * two rows, and a band sized for one line drew its own last line straight through the
       * experience row below.
       *
       * Measured on the *text*, not on the bands. The bands are fixed boxes, so their rectangles
       * never overlap however far their contents spill; and nothing here reaches the document's
       * edges, so neither the overflow guard nor the cut-text sweep can see it either.
       */
      const spilling = await offers.evaluateAll((cards) =>
        cards.flatMap((card) =>
          [...card.children].flatMap((band) => {
            const box = band.getBoundingClientRect();
            return [...band.querySelectorAll('*')]
              .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim().length > 0)
              .filter((el) => el.getBoundingClientRect().bottom > box.bottom + 1)
              .map((el) => `"${el.textContent?.trim().slice(0, 24)}"`);
          }),
        ),
      );
      expect(spilling, `text below its own band: ${spilling.join(' | ')}`).toEqual([]);

      /*
       * The §E4 breakdown is the narrowest fixed copy on the page, and it shipped cut once
       * already: a three-column layout ellipsised "round trip" to "ROUND TRI…" at every viewport.
       * The copy here is fixed, so a clipped label is a permanent defect and not a fat-content
       * edge case: every one of these must render whole, on every card, at every width.
       */
      const clipped = await page.evaluate<string[]>(() =>
        [...document.querySelectorAll<HTMLElement>('article dl dt, article dl dd')]
          .filter((el) => el.scrollWidth > el.clientWidth + 1)
          .map((el) => `"${el.textContent?.trim()}" (${el.scrollWidth}>${el.clientWidth}px)`),
      );
      expect(clipped, `cut text in the §E4 timing breakdown: ${clipped.join(' | ')}`).toEqual([]);

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/missions-${tag}.png` });

      // The board is the §E4 surface and it sits below the fold in a bounded inner scroller, so
      // `fullPage` cannot reach it. It has to be scrolled to and shot separately, or the pre-
      // commit screen never actually gets looked at.
      await first.scrollIntoViewIfNeeded();
      await settleFonts(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/missions-board-${tag}.png` });
    });

    /*
     * MOU-165 §I: the progression readout is sized by the digits in it, and the starting base
     * shows `0 / 100`: the narrowest case there is. `lateGameBase` sits one XP short of level 13,
     * so the row carries four digits either side of the slash and the bar runs to ~100%. Same
     * blind spot the late-game HUD test above exists for, on a different row.
     */
    test(`late-game progression readout at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/base');
      await expect(page.getByTestId('district-plaque')).toContainText('The Ninth Street Crew');
      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);

      // The district is the screen now, and everything written *about* it lives in a drawer that
      // starts closed, so the readout is reached by opening the drawer and then scrolling inside
      // it, which is what a player does. Scrolling to the *last* row puts the whole panel on
      // screen, so the screenshot shows all of it.
      await page.getByTestId('reports-toggle').click();
      const grantValue = (label: string) =>
        page.locator('dl > div').filter({ hasText: label }).locator('dd');
      await grantValue('Recruit slots').scrollIntoViewIfNeeded();
      await settleFonts(page);

      await expect(page.getByText('Level 12 → 13')).toBeInViewport({ ratio: 1 });
      await expect(page.getByText('7799 / 7800 XP')).toBeInViewport({ ratio: 1 });

      // §I2 grants at level 12: §H8 slots 2+11. The two assignee rows that used to sit above this
      // one went with the pool, which is why the panel is one row now.
      await expect(grantValue('Recruit slots')).toHaveText('13');

      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/progression-${tag}.png` });
    });

    /*
     * MOU-164 §H: the Bar, at the widest state it has. `bar` is deliberately a late-game fixture:
     * the longest names the roster generator can produce, a four-digit weekly wage, all four §H5
     * bands including the walkout warning, and recruits in every card state. The starting state of
     * this screen is an empty crew and eight interchangeable cards, which is exactly the
     * half-fixture MOU-207 was filed about.
     *
     * A document scroller, like the base and missions pages, so no vertical-clip guard: the fold
     * cuts the last row at every viewport by design. The roster below it is shot separately.
     */
    test(`the bar at ${tag}`, async ({ page }) => {
      // `lateGame`, so the HUD above the screen describes the same crew the Bar does: serving the
      // fat `bar` fixture over a starting session showed "STREET READS FEARED" under a `Cautious`
      // HUD, which only the screenshot caught (MOU-207).
      await installApi(page, lateGame);
      await page.goto('/game/bar');
      await expect(page.getByTestId('sit-down')).toBeVisible();
      await settleFonts(page);

      /*
       * Every label on this screen is authored copy at a fixed size, so an ellipsis is a permanent
       * defect rather than a fat-content edge case: the §E4 breakdown shipped cut exactly this
       * way. The §H4 disposition tags and §H5 band tags are the narrowest of them.
       */
      const clipped = async () =>
        page.evaluate<string[]>(() =>
          [...document.querySelectorAll<HTMLElement>('span, p, h2, h3')]
            .filter((el) => el.childElementCount === 0 && el.scrollWidth > el.clientWidth + 1)
            .map((el) => `"${el.textContent?.trim()}" (${el.scrollWidth}>${el.clientWidth}px)`),
        );

      // §H8: the slot counter is the one figure the room itself carries, on the door to the crew.
      await expect(page.getByTestId('open-crew')).toBeInViewport({ ratio: 1 });
      // §H7: and the tables strip, which is the other thing standing on the painting now. It is
      // the one readout on this screen whose height depends on the fixture, so it is the one that
      // pushes the row off the floor of the frame when a crew is in three auctions at once.
      await expect(page.getByTestId('your-tables')).toBeInViewport({ ratio: 1 });

      // And the three controls standing on the artwork are lit, not buried under something drawn
      // over them. See `expectControlNotDimmed`: this is the one screen where a room's own vignette
      // and a screen's own chrome overlap, so it is the one that catches the z-index escaping.
      await expectControlNotDimmed(page, 'open-payroll');
      await expectControlNotDimmed(page, 'open-crew');
      await expectControlNotDimmed(page, 'info-note');

      const cutRoom = await clipped();
      expect(cutRoom, `cut text in the Bar's room: ${cutRoom.join(' | ')}`).toEqual([]);
      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/bar-${tag}.png` });

      /*
       * The dossier, for the person with the longest name in the fixture.
       *
       * The §B6 thirty-three attributes under an identity band is the widest thing this screen
       * renders, and the sheet's four-column mode switches on a *viewport* media query, so the
       * window it opens in has to be wide enough that four groups still clear `Communication`.
       */
      await page.getByTestId('sit-down').click();
      await expect(page.getByTestId('bar-file')).toBeVisible();
      await settleFonts(page);
      const cutFile = await clipped();
      expect(cutFile, `cut text on a recruit's dossier: ${cutFile.join(' | ')}`).toEqual([]);
      await expectNothingClippedHorizontally(page);

      /*
       * Two rows of two, which is the shape the card was rebuilt for.
       *
       * It used to be four groups on one line under the whole card, and the line above this one
       * used to say that three-across-with-one-underneath is an L and an L reads as a layout that
       * ran out of room. Still true, and a 2x2 is not that: it is a block. What changed is that
       * the sheet now sits *beside* the dossier rather than under it, and four groups do not fit
       * beside a portrait: they need about 210px each, and fourteen labels were measurably cut
       * when this was tried at four. Two across also makes the block about as tall as the
       * dossier, which is what fills the card.
       *
       * Counted by how many distinct tops the four headings have.
       */
      const groupRows = await page.evaluate(
        () =>
          new Set(
            [...document.querySelectorAll('[data-testid="attribute-sheet"] h3')].map((h) =>
              Math.round(h.getBoundingClientRect().top),
            ),
          ).size,
      );
      expect(groupRows, `the attribute groups should be a 2x2 at ${tag}`).toBe(2);
      await page.screenshot({ path: `screenshots/visual/bar-roster-${tag}.png` });
      await page.keyboard.press('Escape');

      /* The two screens behind the doors on the glass. */
      await page.getByTestId('open-payroll').click();
      await expect(page.getByTestId('payroll-book')).toBeVisible();
      await settleFonts(page);
      const cutPayroll = await clipped();
      expect(cutPayroll, `cut text in the payroll book: ${cutPayroll.join(' | ')}`).toEqual([]);
      await page.screenshot({ path: `screenshots/visual/bar-payroll-${tag}.png` });
      await page.keyboard.press('Escape');

      await page.getByTestId('open-crew').click();
      await expect(page.getByTestId('crew-list')).toBeVisible();
      await settleFonts(page);
      const cutCrew = await clipped();
      expect(cutCrew, `cut text in the crew list: ${cutCrew.join(' | ')}`).toEqual([]);
      await page.screenshot({ path: `screenshots/visual/bar-crew-${tag}.png` });
      await page.keyboard.press('Escape');

      /* §H7: last night's four outcomes, which are four different sentences with four different
         sets of figures in them, so the row is as fat as this screen gets. */
      await page.getByTestId('open-results').click();
      await expect(page.getByTestId('auction-results')).toBeVisible();
      await settleFonts(page);
      const cutResults = await clipped();
      expect(cutResults, `cut text in last night's results: ${cutResults.join(' | ')}`).toEqual([]);
      await page.screenshot({ path: `screenshots/visual/bar-results-${tag}.png` });
    });

    /**
     * The Bar is a room with a seat in it, and the seat is the control.
     *
     * The plate is a painting of a dive with one empty stool dead centre, and `Sit down` is drawn
     * *on* that stool: its position is a fraction of the image, so the picture is sized to cover
     * the frame at the plate's own aspect and the button lives inside that box. A percentage of the
     * viewport instead would slide off the stool the moment somebody resized a window, which is
     * exactly the failure this pins.
     */
    test(`the Bar's seat stays on the stool at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/bar');
      const seat = page.getByTestId('sit-down');
      await expect(seat).toBeVisible();
      await settleFonts(page);

      /*
       * Measured against the **picture**, not the frame it is centred in.
       *
       * The frame is the whole viewport less the chrome and the painting is letterboxed inside it,
       * so a fraction of the frame is not a fraction of the painting and the two diverge by more
       * at some window shapes than others. Every mark on this screen is authored as a fraction of
       * the picture, so that is what a gate on those marks has to divide by.
       */
      const picture = await page.getByTestId('plate-picture').boundingBox();
      const button = await seat.boundingBox();
      if (!picture || !button) throw new Error('the picture and the seat must both have boxes');

      // Horizontally on the stool: it stands at 0.502 of the painting, a shade right of centre.
      const centre = (button.x + button.width / 2 - picture.x) / picture.width;
      expect(centre, 'the seat drifted off the stool').toBeGreaterThan(0.46);
      expect(centre).toBeLessThan(0.54);

      /*
       * And **clear of the cushion**, which is the whole point of the placement.
       *
       * The empty stool is the thing the control is about, so a plaque drawn over it is the one
       * placement that cannot be right: a player looking for the free seat finds a button where it
       * should be. The gate that stood here asked only that the button was somewhere on the lower
       * half of the room, which every wrong placement in the room's history would also have passed.
       *
       * `CUSHION_TOP` is read off the delivered plate: on the 1926×817 room the stool's cushion
       * starts at 64.3% of the painting's height. The plaque is a fixed pixel size, so how much of
       * the painting it covers changes with the window: at 1024 it is 15% of the picture's height
       * and at 1920 it is 8%. That is exactly why it hangs from its bottom edge, and why this
       * checks the bottom edge rather than the middle.
       */
      const CUSHION_TOP = 0.643;
      const bottom = (button.y + button.height - picture.y) / picture.height;
      expect(bottom, 'the Sit down plaque is covering the empty stool').toBeLessThanOrEqual(
        CUSHION_TOP,
      );
      // ...and still down among the stools rather than up among the bottles: a plate that failed
      // to load leaves the button at the top of an empty box.
      expect(bottom, 'the seat is not down among the stools').toBeGreaterThan(0.5);

      await expect(seat).toBeInViewport({ ratio: 1 });
      // The two readouts sit on the glass over the room rather than under the nav bar.
      await expect(page.getByTestId('open-payroll')).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('info-note')).toBeInViewport({ ratio: 1 });

      // And the note's card opens *over* the room rather than off the bottom of it. The chip
      // stands on the floor of the frame, so a card that can only hang downward puts most of the
      // rule below the fold, which is where this one was.
      await page.getByTestId('info-note').hover();
      const note = page.getByRole('tooltip').filter({ hasText: 'How the Bar works' });
      await expect(note).toBeVisible();
      await expect(note, 'the standing note opened off the screen').toBeInViewport({ ratio: 1 });
    });
    /*
     * §C/§D/§I1: the research page, at both of its doors.
     *
     * Fat in the same specific way the Bar fixture is: the longest role labels in §C1, the deepest
     * track the marks allow, and a satchel holding documents in every state §D6 to §D10 draws. The
     * two sections are shot separately because they render disjoint trees.
     */
    test(`research at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      // A satchel with a document in every state §D6 to §D10 draws. Registered after `installApi`,
      // so it wins: the default late-game bag holds no pages at all and would put an empty screen
      // behind the second door.
      await page.route('**/api/market', (route) =>
        route.fulfill({ json: { ...market, inventory: pagesHeld } }),
      );
      await page.goto('/game/research');
      await expect(page.getByTestId('research-sections')).toBeVisible();
      await settleFonts(page);

      /*
       * `sr-only` is excluded by name rather than by size.
       *
       * Tailwind's screen-reader-only class clips its box to 1px, so every label inside a
       * blueprint's row of squares reads as overflowing by construction, and a size threshold
       * would silently pardon a real box that collapsed to nothing as well.
       */
      const clipped = async () =>
        page.evaluate<string[]>(() =>
          [...document.querySelectorAll<HTMLElement>('span, p, h3, option, label')]
            .filter(
              (el) =>
                el.childElementCount === 0 &&
                !el.closest('.sr-only') &&
                el.scrollWidth > el.clientWidth + 1,
            )
            .map((el) => `"${el.textContent?.trim()}" (${el.scrollWidth}>${el.clientWidth}px)`),
        );

      /*
       * The rail is exactly two doors, looked at rather than counted in a unit test.
       *
       * The desk and the files were doors here until §I1e, and a door left rendering behind a
       * condition nobody notices is the failure this shot exists to catch.
       */
      await expect(page.getByTestId('research-sections').getByRole('button')).toHaveCount(2);

      /*
       * The Lab's tree, and the one thing on it that has been wrong before.
       *
       * Every rung prints what it does and what it costs, and both used to leak the field name
       * instead of the words: `+8% PRODUCTIONPERCENT` and `140 highQualityMetal`. The effect line
       * was worse than a typo, because the *fixture* built it differently from the route, so every
       * screenshot of this page certified a string the running game never produced.
       *
       * Caught by shape rather than by matching a list of names: a raw key is camelCase or a
       * SCREAMING run with no spaces, and neither is anything a person writes.
       */
      await expect(page.getByTestId('research-tracks')).toBeVisible();
      const raw = await page.evaluate<string[]>(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid^="tech-track-"] p')]
          .map((el) => el.textContent ?? '')
          .filter((text) => /\b(?:[a-z]+[A-Z]|[A-Z]{6,})[A-Za-z]*\b/.test(text)),
      );
      expect(raw, `a field name reached the Lab's tree: ${raw.join(' | ')}`).toEqual([]);
      const cutTree = await clipped();
      expect(cutTree, `cut text on the Lab's tree: ${cutTree.join(' | ')}`).toEqual([]);
      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await expectSheetNotWashedOut(page);
      await page.screenshot({ path: `screenshots/visual/research-programmes-${tag}.png` });

      // And the documents, behind the other door, which is where §D's widest rows live.
      await page.getByTestId('research-section-blueprints').click();
      await expect(page.getByTestId('blueprints-section')).toBeVisible();
      await settleFonts(page);
      const cutDocs = await clipped();
      expect(cutDocs, `cut text on the blueprints: ${cutDocs.join(' | ')}`).toEqual([]);
      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await expectNoImagesClipped(page, '[data-testid="blueprints-section"]');
      await page.screenshot({ path: `screenshots/visual/research-blueprints-${tag}.png` });
    });

    /**
     * The roster, relaid out: portrait down the left third, everything you *do* to a unit on the
     * right, and the prose along the bottom across all three. The card is the densest thing in the
     * game, twelve of them, each with a stat table, a price and a control, so it is the most
     * likely place for a column to collapse or a number to be cut in half.
     */
    test(`units at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/units');
      // The line is a quotation now rather than the page's heading, which is what it always read
      // as: every screen the scenery switcher leads to opens on one instead of repeating its own
      // name back at the player.
      await expect(page.getByTestId('unit-catalogue')).toBeVisible();
      await settleFonts(page);

      /*
       * The card is a fixed frame, and this is the half of it a class list cannot prove.
       *
       * Two things have to hold. The portrait is a real column rather than a thumbnail, and every
       * card in the grid is the *same* card: same height, and the Train control on the same line.
       * That is the whole reason the roster was rebuilt, and it is exactly the kind of thing that
       * regresses silently the next time somebody adds a line to a card.
       */
      const layout = await page.evaluate<{ portrait: number; card: number } | null>(() => {
        // Inside the catalogue: `unit-catalogue` itself starts with `unit-`, and matching the
        // grid instead of a card silently measures the portrait against the whole page.
        const card = document.querySelector(
          '[data-testid="unit-catalogue"] [data-testid^="unit-"]',
        );
        const image = card?.querySelector('img, svg');
        if (!card || !image) return null;
        return {
          portrait: image.getBoundingClientRect().width,
          card: card.getBoundingClientRect().width,
        };
      });
      expect(layout, 'a unit card must render a portrait').not.toBeNull();
      const share = (layout?.portrait ?? 0) / (layout?.card ?? 1);
      // The band, not a target. Below it the picture is a thumbnail beside a heading, which is what
      // it was; above it the sheet is being squeezed to make room for a portrait, which is what
      // happened at 1024 when the card went two-up. Both ends have been the live defect.
      expect(share, `portrait took ${Math.round(share * 100)}% of the card`).toBeGreaterThan(0.12);
      expect(share, `portrait took ${Math.round(share * 100)}% of the card`).toBeLessThan(0.45);

      /*
       * Every card the same card, on **every tier**.
       *
       * The tier walk is not padding. The marks band prints all of a unit's rules, modifiers and
       * characteristics and wraps (board request, 2026-09-08), and the frame budgets a fixed number
       * of rows for it, so the card that breaks the frame is the one with the most marks: the
       * Colossus, on Legendary, which the screen never shows until somebody clicks the tab. A sweep
       * that only ever measured the tier the page opens on would have passed the entire time.
       */
      for (const tier of UNIT_TIERS) {
        await page.getByRole('button', { name: UNIT_TIER_LABELS[tier] }).click();
        await expect(page.getByTestId('unit-catalogue')).toBeVisible();
        await settleFonts(page);

        const aligned = await page.evaluate(() => {
          const cards = [
            ...document.querySelectorAll('[data-testid="unit-catalogue"] > [data-testid^="unit-"]'),
          ];
          const heights = new Set(
            cards.map((card) => Math.round(card.getBoundingClientRect().height)),
          );
          // The action *box*, not the control inside it: a locked card's box holds a padlock and an
          // unlocked one holds a stepper and a button, so measuring the control would report the
          // two states as a misalignment. What has to land on the same line is the box.
          const actions = new Set(
            cards.map((card) => {
              const box = card.getBoundingClientRect();
              const action = card.querySelector('[data-testid^="action-"]');
              return action ? Math.round(action.getBoundingClientRect().top - box.top) : -1;
            }),
          );
          // Every mark on every card, whole. A chip cut in half by the bottom of its own band is
          // the defect the frame's headroom exists to prevent, and the card-level spill sweep
          // further down only sees a chip that leaves the *card*.
          const cropped = cards.flatMap((card) => {
            const band = card.querySelector('[data-testid^="marks-"]');
            if (!band) return [];
            const box = band.getBoundingClientRect();
            return [...band.children]
              .filter((chip) => chip.getBoundingClientRect().bottom > box.bottom + 1)
              .map((chip) => `"${chip.textContent?.trim()}"`);
          });
          // ...and nothing pushed out of the card by a band that grew. The price box is `shrink-0`
          // precisely so this can see it: left shrinkable it swallows the overflow and moves the
          // Train button instead, which is a defect no overflow sweep can find.
          const outside = cards.flatMap((card) => {
            const frame = card.getBoundingClientRect();
            return [...card.querySelectorAll('*')]
              .filter((el) => {
                const box = el.getBoundingClientRect();
                return box.height > 0 && box.bottom > frame.bottom + 1;
              })
              .slice(0, 2)
              .map((el) => `"${el.textContent?.trim().slice(0, 24)}"`);
          });
          return {
            cards: cards.length,
            heights: [...heights],
            actions: [...actions],
            cropped,
            outside,
          };
        });
        expect(aligned.cards, `${tier} draws no cards`).toBeGreaterThan(0);
        expect(
          aligned.heights,
          `${tier}: cards of ${aligned.heights.length} different heights`,
        ).toHaveLength(1);
        expect(aligned.actions, `${tier}: the action box moves between cards`).toHaveLength(1);
        expect(aligned.cropped, `${tier}: marks cut off: ${aligned.cropped.join(' | ')}`).toEqual(
          [],
        );
        expect(
          aligned.outside,
          `${tier}: pushed out of its card: ${aligned.outside.join(' | ')}`,
        ).toEqual([]);
      }

      // The machines, on the last tab (board request, 2026-09-08): every card whole, nothing
      // out of the screen, and its own picture of the sheet.
      await page.getByTestId('tier-vehicles').click();
      await expect(page.getByTestId('vehicle-catalogue')).toBeVisible();
      await settleFonts(page);
      const machines = await page.evaluate<string[]>(() => {
        const cards = [...document.querySelectorAll('[data-testid="vehicle-catalogue"] article')];
        return cards.flatMap((card) => {
          const frame = card.getBoundingClientRect();
          return [...card.querySelectorAll('*')]
            .filter((el) => {
              const box = el.getBoundingClientRect();
              return (
                box.height > 0 && (box.bottom > frame.bottom + 1 || box.right > frame.right + 1)
              );
            })
            .slice(0, 2)
            .map((el) => `"${el.textContent?.trim().slice(0, 24)}"`);
        });
      });
      expect(machines, `content outside its machine card: ${machines.join(' | ')}`).toEqual([]);
      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/units-vehicles-${tag}.png` });

      // Back to the tier the page opens on, so the sweeps below and the screenshot are of the
      // screen a player actually lands on.
      await page.getByRole('button', { name: UNIT_TIER_LABELS[UNIT_TIERS[0]] }).click();
      await settleFonts(page);

      // Cut text, horizontally: the stat labels sit in a two-column table inside two thirds of a
      // card, which is the narrowest any of them ever get.
      const clipped = await page.evaluate<string[]>(() =>
        [...document.querySelectorAll<HTMLElement>('span, p, h3, dt, dd, li')]
          .filter((el) => el.childElementCount === 0 && el.scrollWidth > el.clientWidth + 1)
          .map((el) => `"${el.textContent?.trim()}"`),
      );
      expect(clipped, `cut text on the roster: ${clipped.join(' | ')}`).toEqual([]);

      /*
       * Nothing hanging out of its own card, and no label drawn across the graphic beside it.
       *
       * Both were live: the price box hung 58px below the bottom border of every card on a
       * 1280px screen, and `Penetration` was printed straight over its own bar in the narrow
       * column that the same layout produced. Neither is caught by the guards above. Document
       * overflow does not see it, because a card that overflows *downward* inside a page that
       * scrolls anyway adds nothing to the document's width; and the cut-text sweep does not see
       * it either, because a `truncate` on an inline span does not clip, so `scrollWidth` and
       * `clientWidth` agree while the word is drawn well past its box.
       */
      const spilling = await page.evaluate<string[]>(() => {
        const cards = [
          ...document.querySelectorAll('[data-testid="unit-catalogue"] > [data-testid^="unit-"]'),
        ];
        return cards.flatMap((card) => {
          const frame = card.getBoundingClientRect();
          return [...card.querySelectorAll('*')]
            .filter((el) => {
              const box = el.getBoundingClientRect();
              return (
                box.height > 0 && (box.bottom > frame.bottom + 1 || box.right > frame.right + 1)
              );
            })
            .slice(0, 2)
            .map((el) => `"${el.textContent?.trim().slice(0, 24)}"`);
        });
      });
      expect(spilling, `content outside its card: ${spilling.join(' | ')}`).toEqual([]);

      const crossing = await page.evaluate<string[]>(() => {
        const cells = [
          ...document.querySelectorAll(
            '[data-testid="unit-catalogue"] dt, [data-testid="unit-catalogue"] dd',
          ),
        ];
        return cells.flatMap((cell) => {
          const box = cell.getBoundingClientRect();
          return [...cell.querySelectorAll('*')]
            .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim().length > 0)
            .filter((el) => el.getBoundingClientRect().right > box.right + 0.5)
            .map((el) => `"${el.textContent?.trim()}"`);
        });
      });
      expect(crossing, `stat text drawn outside its cell: ${crossing.join(' | ')}`).toEqual([]);

      // No vertical guard here, and deliberately: the roster is a scrolling document, so the last
      // visible row is *always* half-cut by the fold. That is what a scroller does, and it is why
      // the other document pages in this file gate on overflow and horizontal clipping instead.
      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await expectSheetNotWashedOut(page);
      await page.screenshot({ path: `screenshots/visual/units-${tag}.png` });
    });

    /*
     * The card closes on the picture (board request, 2026-09-08).
     *
     * Four measurements, on every card of every tier, with **every unit unlocked**: the sweep
     * above runs on the late-game fixture, where most of the roster is locked and the price box
     * holds a padlock, so it never laid out a five-material price at the two-up width. Those wrap
     * to a second line, and the box is sized to exactly that: a box that fits a padlock and not
     * a price is the defect this exists to catch.
     *
     * The card is 12px over the portrait and 12px under it; the brackets sit the same distance
     * under the sheet's rule as the price box sits under them; the price box's bottom edge is
     * the portrait's bottom edge; and the box's contents fit inside it. The column is budgeted
     * to the pixel for the tallest card in the game (see `UnitCard.tsx`), so any band that grows
     * by a line shows up here as the box sliding off the picture, before it is far enough out to
     * leave the card and trip the spill sweep.
     */
    test(`the roster card closes on its portrait at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.route('**/api/units', (route) =>
        route.fulfill({
          json: {
            ...unitsResponse,
            units: unitsResponse.units.map((unit) => ({ ...unit, unlocked: true, missing: [] })),
          },
        }),
      );
      await page.goto('/game/units');
      await expect(page.getByTestId('unit-catalogue')).toBeVisible();
      await settleFonts(page);

      for (const tier of UNIT_TIERS) {
        await page.getByTestId(`tier-${tier}`).click();
        await expect(page.getByTestId('unit-catalogue')).toBeVisible();
        await settleFonts(page);

        const off = await page.evaluate(() => {
          const cards = [
            ...document.querySelectorAll<HTMLElement>(
              '[data-testid="unit-catalogue"] > [data-testid^="unit-"]',
            ),
          ];
          return cards.flatMap((card) => {
            const frame = card.getBoundingClientRect();
            const rect = (selector: string) =>
              card.querySelector(selector)!.getBoundingClientRect();
            const portrait = rect('[data-testid^="unit-portrait-"]');
            const sheet = rect('.border-y');
            const slots = rect('[data-testid^="slots-"]');
            const action = rect('[data-testid^="action-"]');
            const box = card.querySelector('[data-testid^="action-"]')!.firstElementChild!;
            // The children against the box's padding edge, rather than `scrollHeight`: the box
            // centres what it holds, so a price that outgrows it eats the padding first, then
            // leaks out of the top as well as the bottom, and only the bottom half of that is
            // scrollable overflow. Sized right, the padding is intact on the tallest price.
            const boxRect = box.getBoundingClientRect();
            const boxStyle = getComputedStyle(box);
            const inset = {
              top:
                boxRect.top + parseFloat(boxStyle.borderTopWidth) + parseFloat(boxStyle.paddingTop),
              bottom:
                boxRect.bottom -
                parseFloat(boxStyle.borderBottomWidth) -
                parseFloat(boxStyle.paddingBottom),
            };
            const leak = Math.max(
              0,
              ...[...box.children].flatMap((child) => {
                const r = child.getBoundingClientRect();
                return [inset.top - r.top, r.bottom - inset.bottom];
              }),
            );
            const faults = [
              [
                'portrait margins',
                Math.abs(portrait.top - frame.top - (frame.bottom - portrait.bottom)),
              ],
              ['bracket gaps', Math.abs(slots.top - sheet.bottom - (action.top - slots.bottom))],
              ['box off the portrait', Math.abs(action.bottom - portrait.bottom)],
              ['box contents', leak],
            ] as const;
            return faults
              .filter(([, px]) => px > 1)
              .map(([what, px]) => `${card.dataset.testid}: ${what} by ${Math.round(px)}px`);
          });
        });
        expect(off, `${tier}: ${off.join(' | ')}`).toEqual([]);
      }
    });

    /** §F2: the Training tab, with an hour already running and an officer idle beside it. */
    test(`training at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/training');
      await expect(page.getByTestId('training-in-flight')).toBeVisible();
      await settleFonts(page);

      // Thirty-three drills in four columns is the one screen in the game where a label has real
      // competition for its width.
      const clipped = await page.evaluate<string[]>(() =>
        [...document.querySelectorAll<HTMLElement>('span, p, h3')]
          .filter((el) => el.childElementCount === 0 && el.scrollWidth > el.clientWidth + 1)
          .map((el) => `"${el.textContent?.trim()}"`),
      );
      expect(clipped, `cut text on the training page: ${clipped.join(' | ')}`).toEqual([]);

      /*
       * The rating gauges are actually drawn, and drawn to the rating.
       *
       * Every row carries a painted stroke along its bottom edge as long as the rating is out of a
       * hundred, and it is the thing that stops thirty-three rows of `label ..... number` being a
       * spreadsheet. It is also invisible to every other assertion on this page: it has no text, so
       * the clipping sweep cannot see it, and it overflows nothing, so the layout gates cannot
       * either. It shipped broken once, as a 3px nick at the right of every row, because
       * `.paint-track` sets `position: relative` itself and beat the `absolute` utility.
       *
       * Measured rather than merely counted: a track that has collapsed to its content is the
       * exact failure, and a track that is present but 3px wide passes any "is it there" check.
       */
      const gauges = await page.evaluate(() => {
        const rows = [...document.querySelectorAll<HTMLElement>('[data-testid^="drill-"]')];
        return rows.map((row) => {
          const track = row.querySelector<HTMLElement>('.paint-track');
          const fill = row.querySelector<HTMLElement>('.paint-fill');
          return {
            row: row.getBoundingClientRect().width,
            track: track?.getBoundingClientRect().width ?? 0,
            fill: fill?.getBoundingClientRect().width ?? 0,
          };
        });
      });
      expect(gauges.length, 'no drill rows on the training page').toBeGreaterThan(20);
      for (const gauge of gauges) {
        // The track runs the width of its row, give or take the row's own border.
        expect(gauge.track, 'a rating gauge collapsed to its content').toBeGreaterThan(
          gauge.row - 6,
        );
        // And the pigment in it is a fraction of that, never the whole track: nobody in the
        // fixture is at a hundred, so a full bar would mean the width is not being read at all.
        expect(gauge.fill).toBeGreaterThan(0);
        expect(gauge.fill).toBeLessThan(gauge.track);
      }

      // The sheet is a fixed region on a page that does not scroll, so a row that does not fit is
      // cut rather than pushed below a fold: the vertical guard is the one that sees it, and this
      // is the screen it was missing.
      await expectNothingClippedVertically(page);
      // Only a 1080-tall frame has the room for all eleven Technical rows once the banner above
      // them has been paid for. See the note on the helper: this records the branch, it is not a
      // target, and it moves whenever the banner or the row height does.
      await expectWholeDrillRows(page, size.height >= 1000);

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await expectSheetNotWashedOut(page);
      await page.screenshot({ path: `screenshots/visual/training-${tag}.png` });
    });

    /**
     * The shape of the console: what is where, and what moves.
     *
     * Training is a console rather than a document. The page used to stack a note, the day and the
     * sheet inside a scrolling body, which put a hundred and ten pixels of standing chrome above
     * the only thing anybody comes here to read and meant picking the fourth officer scrolled the
     * sheet off the top of the screen to do it.
     *
     * Three claims, and the *order* one is the load-bearing one. "Nothing scrolls" on its own is
     * nearly free: it passed on a build with the fixed frame taken out, because the sheet's own
     * overflow quietly absorbed what the page would have scrolled. The vertical order of the rail
     * cannot be faked that way.
     */
    test(`the training console keeps its shape at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/training');
      await expect(page.getByTestId('training-subjects')).toBeVisible();
      await settleFonts(page);

      const box = async (id: string) => {
        const rect = await page.getByTestId(id).boundingBox();
        if (!rect) throw new Error(`${id} has no box`);
        return rect;
      };

      // 1. The rail reads top to bottom: the crew, then the day, then the rule of the room.
      //
      // Measured on the day's *card* rather than on the tally strokes inside it: the strokes are
      // indented past their own label, so comparing them to the note's left edge would be
      // comparing an inner box to an outer one and failing on a layout that is correct.
      const roster = await box('training-subjects');
      const day = await box('training-day');
      expect(day.y, 'the day belongs under the roster').toBeGreaterThan(roster.y);
      // Both in the same column, left-aligned with each other rather than merely stacked.
      expect(Math.abs(day.x - roster.x)).toBeLessThan(12);
      // The paragraph explaining the rules is gone (board request): it was read once and then sat
      // at the foot of the rail for good, and the day's own strokes say what it said.
      await expect(page.getByTestId('info-note')).toHaveCount(0);

      // 2. The rail sits beside the sheet, not above it: one row, two columns.
      const sheet = await box('training-sheet');
      expect(sheet.x, 'the sheet belongs to the right of the rail').toBeGreaterThan(
        roster.x + roster.width - 1,
      );

      /*
       * 3. The frame fills the screen, and the rail's last block is pinned to the foot of it.
       *
       * This is the assertion that catches the fixed frame being taken out. Without it the page
       * falls back to stacking at content height: the order above still holds, the page still
       * does not scroll (the sheet's own overflow absorbs it), and every other check here passes
       * on a layout where the rail has floated up into the middle of the screen.
       *
       * The last block is the day now that the rule of the room is gone, which is also what makes
       * the roster above it grow: it is the one that has to reach the floor.
       */
      const frame = await box('page-sheet');
      const floor = frame.y + frame.height;
      expect(floor - (day.y + day.height), 'the day is not at the foot of the rail').toBeLessThan(
        48,
      );
      expect(floor - (sheet.y + sheet.height), 'the sheet does not reach the floor').toBeLessThan(
        48,
      );

      // 4. The page itself does not scroll, and the roster is a scrolling region.
      const shape = await page.evaluate(() => ({
        page:
          document.documentElement.scrollHeight > document.documentElement.clientHeight + 1 ||
          document.body.scrollHeight > document.body.clientHeight + 1,
        roster: getComputedStyle(
          document.querySelector('[data-testid="training-subjects"]') as HTMLElement,
        ).overflowY,
      }));
      expect(shape.page, 'the training page itself scrolled').toBe(false);
      expect(shape.roster, 'the roster is not a scrolling region').toBe('auto');
    });

    /** The Overseer's own file, reached by clicking the identity in the HUD. */
    test(`overseer profile at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game');
      await page.getByTestId('hud-overseer').click();
      // "What the crew is buying" is its own screen now (board request), reached from the crew
      // page. The file is the person: their own sheet, and the door to the bench.
      await expect(page.getByTestId('file-body')).toBeVisible();
      await expect(page.getByTestId('crew-effects')).toHaveCount(0);
      await settleFonts(page);

      const cut = await page.evaluate<string[]>(() =>
        [...document.querySelectorAll<HTMLElement>('span, p, h2, li')]
          .filter((el) => el.childElementCount === 0 && el.scrollWidth > el.clientWidth + 1)
          .map((el) => `"${el.textContent?.trim()}"`),
      );
      expect(cut, `cut text on the overseer's file: ${cut.join(' | ')}`).toEqual([]);

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await expectSheetNotWashedOut(page);
      await page.screenshot({ path: `screenshots/visual/overseer-profile-${tag}.png` });

      /*
       * The file is one screen, and the person on it is legible at every height.
       *
       * The identity block sits under a 3:4 portrait at the rail's full width, which is 405px tall:
       * on a 720-tall laptop that left nothing under it and the name was cut in half at the panel's
       * own scroll edge. `toBeVisible` is no use for that class of defect, because an element
       * clipped out of a scroll container still counts as visible, so the name is measured against
       * the viewport instead.
       */
      await expect(page.getByTestId('overseer-name')).toBeInViewport({ ratio: 1 });

      const shape = await page.evaluate(() => {
        const rect = (id: string) =>
          document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect() ?? null;
        return {
          scrolled:
            document.documentElement.scrollHeight > document.documentElement.clientHeight + 1 ||
            document.body.scrollHeight > document.body.clientHeight + 1,
          name: rect('overseer-name'),
          body: rect('file-body'),
        };
      });
      expect(shape.scrolled, "the overseer's file scrolled as a page").toBe(false);
      // The rail is beside the numbers rather than above them: one row, two columns.
      expect(shape.body?.x ?? 0).toBeGreaterThan((shape.name?.x ?? 0) + (shape.name?.width ?? 0));
    });

    /**
     * A resource popup must sit *over* the world, not push it down.
     *
     * The board's words: hovering a number should not make the whole top of the screen grow. It
     * did, because the card rendered inside the stockpile bar and the bar wraps, so every pointer
     * that crossed a chip shoved the district down by the height of the explanation. The card is
     * portalled to `document.body` now, and this is the assertion that keeps it there: the HUD's
     * height before and after must be identical, and the card must overhang past the bar's bottom
     * edge, which is the whole point of letting it hang into the world.
     */
    test(`a resource popup does not move the HUD at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game');
      const hud = page.locator('header').first();
      await expect(hud).toBeVisible();
      await settleFonts(page);

      const before = await hud.boundingBox();
      await page.getByTestId('resource-hover-scrap').hover();
      const card = page.getByRole('tooltip');
      await expect(card).toBeVisible();
      const after = await hud.boundingBox();

      expect(after?.height, 'the HUD grew when a resource was hovered').toBe(before?.height);

      const box = await card.boundingBox();
      expect(box, 'the popup must be laid out').not.toBeNull();
      // It hangs into the world below the bar: measured at its *bottom* edge, because the card is
      // anchored under the chip it explains and the chip sits on the bar's lower tier, a couple of
      // pixels inside the bar's own padding. What matters is that the window overhangs the chrome
      // rather than being contained by it, and that is a statement about where it ends.
      expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThan(
        (before?.y ?? 0) + (before?.height ?? 0),
      );
      expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(size.width);
    });

    /**
     * Grepolis' standing queue readout: what is in flight, on whatever screen you are on.
     *
     * Timestamps are made *live* here rather than taken from the shared fixture. The fixture's
     * clock is a fixed date, so every order in it finished long ago and the rail would render a
     * row of zeroes, which is exactly the state that cannot tell a working countdown from a
     * broken one. Overriding `/me` for this one test is what makes the assertion mean something.
     */
    test(`the in-flight rail counts down at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.route('**/api/me', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            ...lateGame,
            base: {
              ...lateGame.base,
              buildQueue: [
                {
                  id: 'live-build',
                  kind: 'quarters',
                  level: 4,
                  startedAt: new Date(Date.now() - 60_000).toISOString(),
                  durationSeconds: 1200,
                },
              ],
              trainingQueue: [],
            },
          }),
        }),
      );
      // The rail lives on the one screen that is about things being in flight (board request).
      // On the city and district screens it was a third band of chrome over the artwork, appearing
      // and disappearing with what the crew was doing, so the painting moved under it; and on the
      // missions page it wrapped under the board with two or three crews out, so that screen now
      // stacks its own crews in a column and the strip stays off it.
      await page.goto('/game');
      await expect(page.getByTestId('queue-rail')).toHaveCount(0);
      await page.goto('/game/missions');
      await expect(page.getByTestId('queue-rail')).toHaveCount(0);

      await page.goto('/game/actions');
      const rail = page.getByTestId('queue-rail');
      await expect(rail).toBeVisible();
      const row = page.getByTestId('queue-rail-build-live-build');
      await expect(row).toContainText('The Quarters');
      // Nineteen minutes left of twenty, not zero and not the whole thing.
      await expect(row).toContainText(/1[89]m/);

      /*
       * The chip's underline is pinned to its bottom edge, across its whole width.
       *
       * Measured rather than trusted, because it was not: the chip is `painted`, and
       * `.painted > *` sets `position: relative` on every direct child at the same specificity as
       * a plain `absolute`, so the custom rule won on emission order. The bar fell into the chip's
       * own flex row as a 3px item beside the countdown, and no chip on the road ever drew a
       * progress edge. Geometry rather than a class check: the class was always there.
       */
      const underline = await row.evaluate((chip): { gap: number; span: number } | null => {
        const drawn = chip.querySelector('span[class*="bottom-0"]');
        if (drawn === null) return null;
        const chipBox = chip.getBoundingClientRect();
        const barBox = drawn.getBoundingClientRect();
        return {
          gap: Math.abs(barBox.bottom - chipBox.bottom),
          span: chipBox.width === 0 ? 0 : barBox.width / chipBox.width,
        };
      });
      expect(underline, 'the chip draws a progress underline at all').not.toBeNull();
      // Within the chip's own 1px border of its bottom edge, and across all but that border's
      // width. A ratio rather than the exact figure, so the assertion is about the bar spanning
      // the chip rather than about the border being 1px: broken, the bar sat 15.5px up on the
      // row's centre line, which is what the reverted-fix run measured.
      expect(underline?.gap).toBeLessThanOrEqual(2);
      expect(underline?.span).toBeGreaterThan(0.9);

      // Clicking opens the clock rather than navigating: the rail has room for four words, and
      // what a player wants from it is when the thing lands and whether they can change their mind.
      await row.click();
      const detail = page.getByRole('dialog');
      await expect(detail).toBeVisible();
      await expect(detail).toContainText('Your district');
      await expect(detail).toContainText('Expected');

      // And the window is the way *to* the screen that owns it.
      await detail.getByRole('link', { name: 'Go there' }).click();
      await expect(page).toHaveURL(/\/game\/base$/);

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
    });

    /** The market: the Runner's window, the Broker's rate and the players' board. */
    test(`the market at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/market');
      await expect(page.getByTestId('vendor-stock')).toBeVisible();
      await settleFonts(page);

      // The three things a market screen has to actually say: whether he is in, what the Broker
      // gives, and what is left of the day's run. The board between crews is its own page now.
      await expect(page.getByTestId('info-note')).toContainText('The Runner: in');
      await expect(page.getByTestId('barter-quote')).toContainText('50');
      await expect(page.getByTestId('supply-allowance')).toContainText('left');

      /*
       * The frame does not scroll, and neither does anything in it at the sizes the game is
       * drawn at (board request, 2026-09-08). The sheet's body is `overflow-hidden`, so a counter
       * pushed below its fold is not caught by the page-overflow sweep: it is simply cut. The
       * barrow and the Broker are the two panels that give when the frame is short, each behind
       * its own scroller, and this is what says neither had to.
       *
       * Below 1100px wide the barrow draws three lots to a row and the second row scrolls: that
       * is the one concession, on the one size where six lots cannot share a line, so the barrow
       * check is not asked there. The sheet and the Broker are held at every size.
       */
      const fit = await page.evaluate((wide: boolean) => {
        const inside = (selector: string) => {
          const el = document.querySelector<HTMLElement>(selector);
          if (!el) return `${selector} missing`;
          return el.scrollHeight > el.clientHeight + 1
            ? `${selector} scrolls ${el.scrollHeight - el.clientHeight}px`
            : null;
        };
        const sheet = document.querySelector<HTMLElement>('[data-testid="page-sheet"] > div');
        return [
          sheet && sheet.scrollHeight > sheet.clientHeight + 1
            ? `the sheet's body hides ${sheet.scrollHeight - sheet.clientHeight}px`
            : null,
          wide ? inside('[data-testid="vendor-stock"]') : null,
          inside('[data-testid="barter-quote"]'),
        ].filter((fault): fault is string => fault !== null);
      }, size.width >= 1100);
      expect(fit, `the market does not fit its frame: ${fit.join(' | ')}`).toEqual([]);

      const clipped = await page.evaluate<string[]>(() =>
        [...document.querySelectorAll<HTMLElement>('span, p, h3, li')]
          .filter((el) => el.childElementCount === 0 && el.scrollWidth > el.clientWidth + 1)
          .map((el) => `"${el.textContent?.trim()}"`),
      );
      expect(clipped, `cut text on the market: ${clipped.join(' | ')}`).toEqual([]);

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await expectSheetNotWashedOut(page);
      await page.screenshot({ path: `screenshots/visual/market-${tag}.png` });
    });

    /**
     * The offers board: two halves of a table, theirs and ours.
     *
     * Its own screen since the board left the front of the market, and the one in the suite made
     * entirely of piles: two columns of cards whose whole content is chips, an arrow and a row of
     * buttons. That is the shape that wraps badly first, so it is measured at every width the rest
     * of the matrix is.
     */
    test(`the offers board at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/market/offers');
      await expect(page.getByTestId('market-board')).toBeVisible();
      await settleFonts(page);

      // Both halves, drawn: somebody else's listings, and the composer that answers them.
      await expect(page.getByTestId('my-offers')).toBeVisible();
      await expect(page.getByTestId('offer-composer')).toBeVisible();

      const clipped = await page.evaluate<string[]>(() =>
        [...document.querySelectorAll<HTMLElement>('span, p, h3, li')]
          .filter((el) => el.childElementCount === 0 && el.scrollWidth > el.clientWidth + 1)
          .map((el) => `"${el.textContent?.trim()}"`),
      );
      expect(clipped, `cut text on the offers board: ${clipped.join(' | ')}`).toEqual([]);

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await expectSheetNotWashedOut(page);
      await page.screenshot({ path: `screenshots/visual/market-offers-${tag}.png` });
    });

    /**
     * The workshop: three ladders, and no yard.
     *
     * The vehicle assertion that used to live here moved to the Garage with the vehicles
     * themselves (§B11). Left in place it would have gone on passing only for as long as the
     * Workshop kept a page it no longer owns, which is the wrong thing for a test to defend.
     */
    test(`the workshop at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/workshop');
      await expect(page.getByTestId('upgrade-armour_1')).toBeVisible();
      await settleFonts(page);

      // A built rung, a reachable one and a locked one all render differently, and all three are
      // on this fixture, which is the point of the fixture.
      await expect(page.getByTestId('upgrade-armour_1')).toContainText('Built');
      await expect(page.getByTestId('upgrade-armour_3')).toContainText('Needs the Gauntlet');
      // The yard is gone from here: see the Garage's own test below.
      await expect(page.getByTestId('vehicle-rotorcraft')).toHaveCount(0);

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await expectSheetNotWashedOut(page);
      await page.screenshot({ path: `screenshots/visual/workshop-${tag}.png` });
    });

    /**
     * §I3b: the Workshop's other view, which builds nothing and points at both ends.
     *
     * The district behind it is deliberately not `lateGame`'s: that one stands three structures at
     * level 1, so this shot would be twelve panels all reading "not built yet" and would certify
     * none of the three slot states the view is for.
     */
    test(`the workshop's modifications at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.route('**/api/me', (route) =>
        route.fulfill({ json: { ...me, base: districtWithAddons } }),
      );
      await page.goto('/game/workshop');
      await page.getByTestId('workshop-view-modifications').click();
      await expect(page.getByTestId('workshop-modifications')).toBeVisible();
      await settleFonts(page);

      // A bracket with something in it, an open empty one and one the level has not opened: all
      // three on screen, or the screenshot is of a state rather than of the view.
      const first = BUILDING_KINDS[0];
      const last = BUILDING_KINDS[BUILDING_KINDS.length - 1];
      await expect(page.getByTestId(`workshop-slot-${first}-1`)).toContainText('Empty');
      await expect(page.getByTestId(`workshop-shelf-${first}`)).toBeVisible();
      await expect(page.getByTestId(`workshop-slot-${last}-0`)).toContainText('Opens at level');

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await expectSheetNotWashedOut(page);
      await page.screenshot({ path: `screenshots/visual/workshop-modifications-${tag}.png` });
    });

    /**
     * §B9: the Scrapyard, where add-ons are built.
     *
     * The page, its route and its server handler all landed without a fixture, so under this
     * harness it fell through to the 404 catch-all: a whole screen that could be walked to and
     * found empty. This is the test that would have said so.
     */
    test(`the scrapyard at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/scrapyard');
      await expect(page.getByTestId('scrapyard-nexus')).toBeVisible();
      await settleFonts(page);

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/scrapyard-${tag}.png`, fullPage: true });
    });

    /**
     * §C: the Garage's page is the door, and the machines are behind it on the roster (board
     * request, 2026-09-08).
     *
     * The page is the yard's level and seats and one button; the roster's Vehicles tab carries
     * what the Workshop's yard assertion used to, a machine already in the yard and one held
     * behind a blueprint saying so, and `units at` above sweeps that tab. Both get a screenshot,
     * which the Garage did not have at all when it landed: that is how a new full-width grid
     * reaches the board unreviewed.
     */
    test(`the garage at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/garage');
      await expect(page.getByTestId('garage-machines')).toBeVisible();
      await settleFonts(page);
      await expect(page.locator('[data-testid^="vehicle-"]')).toHaveCount(0);

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/garage-${tag}.png`, fullPage: true });

      await page.getByTestId('garage-machines').click();
      await expect(page.getByTestId('vehicle-motorcycle')).toBeVisible();
      await settleFonts(page);
      await expect(page.getByTestId('vehicle-motorcycle')).toContainText('in the yard');
      await expect(page.getByTestId('vehicle-rotorcraft')).toContainText('Needs the');
    });

    /** The satchel, grouped by what a player would do with the thing. */
    /*
     * §J: the two faction screens, at every supported size.
     *
     * Both are new and both are the kind that breaks quietly: the founding screen centres a column
     * that has to fit a 720p content area with a Create button on it, and the faction page is six
     * separate framed panels in a grid. A probe run once during authoring proves neither stays
     * fixed, which is what this matrix is for.
     */
    test(`joining or founding a faction at ${tag}`, async ({ page }) => {
      await installApi(page, me);
      await page.goto('/game/faction');
      await expect(page.getByTestId('faction-none')).toBeVisible();
      await settleFonts(page);

      await expect(
        page.getByRole('heading', { name: 'Join a faction or create your own' }),
      ).toBeVisible();
      // Both doors are on screen whole, not merely in the DOM: the whole point of the screen.
      await expect(page.getByTestId('join-sheet')).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('start-faction')).toBeInViewport({ ratio: 1 });

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/faction-none-${tag}.png` });
    });

    test(`the badge builder at ${tag}`, async ({ page }) => {
      await installApi(page, me);
      await page.goto('/game/faction');
      await page.getByTestId('start-faction').click();
      await expect(page.getByTestId('create-sheet')).toBeVisible();
      await settleFonts(page);

      // The three fields the board asked for, and the control that draws the badge.
      await expect(page.getByTestId('faction-name')).toBeVisible();
      await expect(page.getByTestId('faction-blurb')).toBeVisible();
      await expect(page.getByTestId('badge-shape-shield')).toBeVisible();
      await expect(page.getByTestId('found-faction')).toBeVisible();

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/faction-create-${tag}.png` });
    });

    test(`the faction table at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/faction');
      await expect(page.getByTestId('faction-workspace')).toBeVisible();
      await settleFonts(page);

      await expect(page.getByTestId('faction-identity')).toBeVisible();
      await expect(page.getByTestId('faction-tally')).toBeVisible();
      // The empty seats are drawn rather than left as blank panel.
      await expect(page.getByTestId('faction-vacancies')).toBeVisible();

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/faction-${tag}.png` });
    });

    /*
     * What the crew is buying: twenty-two channel cards on one screen.
     *
     * The paleness check follows the cards here because that is where they live now, but it is a
     * **smoke check on this page, not a proven guard**. On the overseer's file it fires: the cards
     * sat inside a `FileSection` inside the sheet, and `soft-light` layers compound through every
     * ancestor that has one. Putting `painted washed` back on the card here does *not* trip it,
     * because this page has one fewer blending ancestor. Verified by trying it, rather than
     * assumed from the fact that the same helper is being called.
     *
     * Read `ChannelCard`'s own note before restyling these: the failure mode is real even where
     * this particular threshold does not catch it.
     */
    /**
     * §C2/§G: the roster, chairs and bench together.
     *
     * This page had no screenshot at all, which is how a nineteen-card grid and the screen a
     * player spends the most time on went unreviewed. The fixture seats three and benches two, so
     * one run covers a filled chair, an empty one, and the section under them.
     */
    test(`the crew at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/crew');
      await expect(page.getByTestId('crew-books')).toBeVisible();
      await settleFonts(page);

      await expect(page.getByTestId('crew-bench')).toBeVisible();
      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/crew-${tag}.png` });
    });

    test(`what the crew is buying at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/crew/effects');
      await expect(page.getByTestId('crew-effects')).toBeVisible();
      await settleFonts(page);

      await expect(page.getByTestId('back-to-crew')).toBeVisible();
      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      // Pointed at the **cards**, not at the default `main section`: the first section on this
      // page is the radar, and a gate aimed there passes happily with every card washed out. The
      // first version of this test did exactly that, and only a positive control showed it.
      await expectSheetNotWashedOut(page, '[data-testid="crew-effects"]');
      await page.screenshot({ path: `screenshots/visual/crew-effects-${tag}.png` });
    });

    /** §J9: the standings, both boards, at every supported size. */
    test(`the standings at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/leaderboard');
      await expect(page.getByTestId('leaderboard')).toBeVisible();
      await settleFonts(page);

      await expect(page.getByTestId('board-players')).toBeVisible();
      await expect(page.getByTestId('local-only')).toBeVisible();
      await expect(page.getByTestId('your-rank')).toBeInViewport({ ratio: 1 });

      /*
       * One left edge down the faction column, whether or not a crew is at a table.
       *
       * The badge was drawn only for the crews that have one, so a named faction started 30px
       * further in than `none` did and the column read as two ragged lists. The fixture carries
       * both kinds, which is what makes this measurable at all.
       */
      const factionEdges = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid^="standing-"]')].map((row) => {
          // The leaf, not the cell around it: the `w-40` cell holds the same text and sits at the
          // column's own edge whatever is inside it, so matching on text alone reported one edge
          // for every row and passed against the ragged column this exists to catch.
          const cell = [...row.querySelectorAll<HTMLElement>('span')].find(
            (span) =>
              span.childElementCount === 0 &&
              /^(none|The Ninth Circle)$/.test(span.textContent?.trim() ?? ''),
          );
          return cell === undefined ? null : Math.round(cell.getBoundingClientRect().left);
        }),
      );
      const named = factionEdges.filter((edge): edge is number => edge !== null);
      expect(named.length, 'no faction cells on the ladder to compare').toBeGreaterThan(1);
      expect(
        new Set(named).size,
        `the faction column has ${new Set(named).size} left edges: ${named.join(', ')}`,
      ).toBe(1);

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/standings-${tag}.png` });
    });

    test(`the satchel at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/inventory');
      await expect(page.getByTestId('satchel-component')).toBeVisible();
      await settleFonts(page);

      await expect(page.getByTestId('satchel-blueprint')).toContainText('Cybernetics');
      await expect(page.getByTestId('satchel-relic')).toContainText('Ivory Dice');

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await expectSheetNotWashedOut(page);
      await page.screenshot({ path: `screenshots/visual/satchel-${tag}.png` });
    });

    /** The other half of the same screen: a programme on the bench, with its clock running. */
    test(`research in progress at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.route('**/api/research', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(activeResearch()),
        }),
      );
      await page.goto('/game/research');
      await expect(page.getByTestId('research-progress')).toBeVisible();
      await settleFonts(page);

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/research-active-${tag}.png` });
    });
  });
}

/**
 * The vertical guard has to be able to fail.
 *
 * `expectNothingClippedVertically` is the entire regression story for MOU-188, and a guard nobody
 * has watched fail is indistinguishable from one that returns early, which is how the horizontal
 * check shipped this bug green in the first place. So the original defect is reproduced here, a
 * roster viewport ending part-way down a card, and the guard is required to reject it. A later
 * refactor that neuters the guard fails this test instead of quietly passing the whole matrix.
 */
test('the vertical clipping guard rejects a bisected card row', async ({ page }) => {
  await installApi(page, meNoOverseer);
  await page.goto('/overseer');
  await expect(page.getByRole('heading', { name: 'CHOOSE YOUR OVERSEER' })).toBeVisible();
  await expectNothingClippedVertically(page);

  await page.evaluate(() => {
    const card = document.querySelector('button[aria-pressed]');
    const viewport = card?.closest<HTMLElement>('.overflow-y-auto');
    const frame = viewport?.parentElement;
    if (!card || !viewport || !frame) throw new Error('roster viewport not found');

    // The frame centres its content, so shrinking the viewport would also move it and the cut
    // would land somewhere unintended. Pin it to the top so the cut lands where it is computed.
    frame.style.justifyContent = 'flex-start';

    // Cut through the middle of a glyph, not through the padding between two attribute rows.
    const glyph = [...card.querySelectorAll('*')]
      .filter((el) => el.childElementCount === 0 && el.textContent?.trim())
      .map((el) => el.getBoundingClientRect())
      .findLast((box) => box.height > 0);
    if (!glyph) throw new Error('the card has no text to bisect');

    const top = viewport.getBoundingClientRect().top;
    viewport.style.maxHeight = `${glyph.top + glyph.height / 2 - top}px`;
  });

  await expect(expectNothingClippedVertically(page)).rejects.toThrow(/sliced by a clipping edge/);
});

/*
 * MOU-197: no geometry gate may depend on a third-party fetch.
 *
 * The webfonts used to be a runtime `<link>` to fonts.googleapis.com, which failed about 1 load
 * in 8 and took the whole visual matrix down with it: training everyone to re-run until green,
 * which is the same habit that lets a real regression through. It was a product defect too: a
 * player on a bad connection got fallback metrics that no gate has ever measured.
 *
 * Every off-origin request is aborted and reported by name, so re-introducing a hosted stylesheet
 * fails here with the offending URL in the message. Verified by mutation: serving an `index.html`
 * that still carries the old `<link>` fails this test. Aborting rather than merely counting also
 * means that if the local `@font-face` rules are ever dropped as well, `settleFonts` refuses to
 * measure the screen instead of silently grading fallback metrics.
 */
test('typography survives with every third-party origin unreachable', async ({ page }) => {
  const LOCAL = new Set(['localhost', '127.0.0.1']);
  const offOrigin: string[] = [];

  // Registered before `installApi` so the narrower `**/api/**` handler still wins: Playwright
  // matches routes in reverse registration order.
  await page.route('**/*', (route) => {
    const { hostname } = new URL(route.request().url());
    if (LOCAL.has(hostname)) return route.continue();
    offOrigin.push(route.request().url());
    return route.abort('failed');
  });

  await installApi(page, meNoOverseer);
  await page.goto('/overseer');
  await expect(page.getByRole('heading', { name: 'CHOOSE YOUR OVERSEER' })).toBeVisible();
  await settleFonts(page);

  expect(offOrigin, `the client fetched third-party assets: ${offOrigin.join(' | ')}`).toEqual([]);
});

/**
 * The standing bar, with every readout at its widest legal value.
 *
 * The bar is a row of instruments and its recurring failure is that an instrument grows with its
 * reading. A long notoriety rank, a seven-figure stockpile and a maximum-length crew name each
 * used to widen their own plate and push everything to the right of them along; the board hit that
 * and screenshotted a rank sitting over the doors.
 *
 * These are pixel assertions on purpose. jsdom has no layout engine, so a unit test can check that
 * the sizing classes are present and nothing more: whether two boxes actually overlap is a
 * question only a browser can answer, and it is the question that was being got wrong.
 */
test.describe('the standing bar does not resize itself', () => {
  /** Every pair of boxes in a row, checked for horizontal overlap. */
  async function overlaps(page: Page, selector: string): Promise<string[]> {
    return page.evaluate((sel) => {
      const boxes = [...document.querySelectorAll(sel)].map((el) => ({
        id: el.getAttribute('data-testid') ?? el.className.slice(0, 24),
        rect: el.getBoundingClientRect(),
      }));
      const found: string[] = [];
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]!;
          const b = boxes[j]!;
          // Same line, and their horizontal spans cross by more than a rounding error.
          const sameRow = Math.abs(a.rect.top - b.rect.top) < 4;
          const cross = Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left);
          if (sameRow && cross > 1) found.push(`${a.id} over ${b.id} by ${Math.round(cross)}px`);
        }
      }
      return found;
    }, selector);
  }

  /*
   * The widths the bar actually changes shape at, which are not the screenshot matrix's.
   *
   * The bar has two regimes: an authored two-tier break below 1550, and a plain flex row above it.
   * The matrix skips from 1440 straight to 1920, so the whole middle regime went unmeasured, and
   * that is where the board's screenshot came from: a centred grid, since removed, engaged at 1500
   * while needing about 1960, promised each side more room than the frame had, and ran the
   * stockpile over the identity plaque. Every boundary is sampled on both sides.
   *
   * 1549 and 1550 straddle the break. It sits 20px above the width where the plaque stops fitting
   * the middle column at `DISTRICT_NAME_MAX`, which is measured rather than chosen: the plaque's
   * spare room grows a pixel per pixel of viewport and reaches zero at 1530. 1500 is inside the
   * two-tier regime and is kept because it is the width the old grid used to engage at. The
   * 1719/1720 and 1959/1960 pairs no longer bound anything and are kept as plain samples.
   */
  const BAR_WIDTHS = [
    1024, 1280, 1440, 1500, 1549, 1550, 1600, 1700, 1719, 1720, 1800, 1920, 1959, 1960, 2560,
  ];

  for (const width of BAR_WIDTHS) {
    test(`nothing in the bar sits on anything else at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await installApi(page, hudExtremes);
      await page.goto('/game/city');
      await expect(page.getByTestId('infamy-chip')).toBeVisible();
      await settleFonts(page);

      /*
       * Every labelled box in the bar against every other, not a hand-listed few.
       *
       * The narrower check below names four selectors and misses the doors, which is exactly what
       * the plaque was overlapping in the board's screenshot: the test was looking at the two
       * things that did not collide. Containment is skipped, because a chip inside a chip is not
       * an overlap.
       */
      const hits = await page.evaluate(() => {
        const bar = document.querySelector('header');
        if (!bar) throw new Error('no standing bar on the page');
        const boxes = [...bar.querySelectorAll<HTMLElement>('[data-testid]')].filter(
          (el) => el.offsetParent !== null,
        );
        const found: string[] = [];
        for (let i = 0; i < boxes.length; i += 1) {
          for (let j = i + 1; j < boxes.length; j += 1) {
            const a = boxes[i]!;
            const b = boxes[j]!;
            if (a.contains(b) || b.contains(a)) continue;
            const x = a.getBoundingClientRect();
            const y = b.getBoundingClientRect();
            if (
              x.left < y.right - 1 &&
              y.left < x.right - 1 &&
              x.top < y.bottom - 1 &&
              y.top < x.bottom - 1
            )
              found.push(`${a.dataset.testid} over ${b.dataset.testid}`);
          }
        }
        return [...new Set(found)];
      });

      expect(hits, `standing bar overlaps at ${width}px`).toEqual([]);
      await expectNothingClippedHorizontally(page);
    });
  }

  for (const { width, height } of VIEWPORTS) {
    const tag = `${width}x${height}`;

    test(`holds its shape at the widest legal values at ${tag}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await installApi(page, hudExtremes);
      await page.goto('/game/city');
      await expect(page.getByTestId('infamy-chip')).toBeVisible();
      await settleFonts(page);

      // Nothing in the bar sits on top of anything else in it.
      expect(
        await overlaps(
          page,
          '[data-testid^="resource-chip-"], [data-testid="level-chip"], [data-testid="infamy-chip"], [data-testid="district-plaque"]',
        ),
        `standing bar overlaps at ${tag}`,
      ).toEqual([]);

      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedHorizontally(page);
    });

    /**
     * And the plates are the *same size* as with a starting crew.
     *
     * The overlap check above only catches the failure once it is bad enough to collide. This is
     * the rule underneath it: only the identity plaque is allowed to size itself to its contents,
     * because only its content is something the player typed. Every other plate is an instrument.
     */
    test(`keeps every plate the same width as an empty crew at ${tag}`, async ({ page }) => {
      const widthsOf = async (): Promise<Record<string, number>> =>
        page.evaluate(() =>
          Object.fromEntries(
            [
              ...document.querySelectorAll(
                '[data-testid^="resource-chip-"], [data-testid="level-chip"], [data-testid="infamy-chip"]',
              ),
            ].map((el) => [
              el.getAttribute('data-testid') ?? '',
              Math.round(el.getBoundingClientRect().width),
            ]),
          ),
        );

      await page.setViewportSize({ width, height });
      await installApi(page, me);
      await page.goto('/game/city');
      await expect(page.getByTestId('infamy-chip')).toBeVisible();
      await settleFonts(page);
      const small = await widthsOf();

      await installApi(page, hudExtremes);
      await page.reload();
      await expect(page.getByTestId('infamy-chip')).toBeVisible();
      await settleFonts(page);
      const large = await widthsOf();

      expect(large, `plates resized themselves at ${tag}`).toEqual(small);
    });

    /**
     * Fixed columns are only half the rule: the other half is that the figure still *fits*.
     *
     * `truncate` keeps an absurd number from shoving the bar apart, but a truncated number is a
     * lie: `9,999,9...` reads as a different score. The board's bar is worth nothing if it is
     * wrong, so at the largest figures the game can produce, nothing in it may be cut off.
     */
    test(`shows every figure in full at its largest at ${tag}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await installApi(page, hudExtremes);
      await page.goto('/game/city');
      await expect(page.getByTestId('infamy-chip')).toBeVisible();
      await settleFonts(page);

      const cut = await page.evaluate(() =>
        [
          ...document.querySelectorAll<HTMLElement>(
            '[data-testid^="resource-chip-"], [data-testid="infamy-chip"], [data-testid="level-chip"], [data-testid="notoriety-tier"]',
          ),
        ].flatMap((chip) =>
          [chip, ...chip.querySelectorAll<HTMLElement>('*')]
            .filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)
            .map(
              (el) =>
                `${chip.dataset.testid}: "${el.textContent?.trim()}" needs ${el.scrollWidth}px, has ${el.clientWidth}px`,
            ),
        ),
      );

      expect(cut, `text cut off in the standing bar at ${tag}`).toEqual([]);
    });
  }
});
