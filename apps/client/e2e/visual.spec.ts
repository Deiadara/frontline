/**
 * MOU-114 acceptance gate: every screen, at every supported viewport, with zero visual bugs.
 *
 * Screenshots land in `screenshots/visual/<screen>-<w>x<h>.png` so a reviewer can eyeball the
 * whole matrix in one directory. The assertions catch the failures that are cheap to detect
 * mechanically: document overflow, unexpected scrollbars, a canvas that does not fill its
 * frame, so review time is spent on the ones that are not (composition, colour, legibility).
 */
import { expect, test, type Page } from '@playwright/test';
import {
  FACTION_NAME_MAX,
  MISSIONS_PER_AREA,
  RESOURCE_LABELS,
  RESOURCE_ORDER,
} from '@frontline/shared';
import { activeResearch, lateGame, me, meNoOverseer, missionsResponse } from './fixtures';
import {
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

/** Anything wider/taller than its container by more than a rounding error is an overflow bug. */
const OVERFLOW_SLACK_PX = 1;

interface DocumentMetrics {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
}

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  await settleFonts(page);
  const metrics = await page.evaluate<DocumentMetrics>(() => {
    const { scrollWidth, clientWidth, scrollHeight, clientHeight } = document.documentElement;
    return { scrollWidth, clientWidth, scrollHeight, clientHeight };
  });
  expect(
    metrics.scrollWidth,
    `horizontal overflow: ${metrics.scrollWidth} > ${metrics.clientWidth}`,
  ).toBeLessThanOrEqual(metrics.clientWidth + OVERFLOW_SLACK_PX);
  expect(
    metrics.scrollHeight,
    `vertical overflow: ${metrics.scrollHeight} > ${metrics.clientHeight}`,
  ).toBeLessThanOrEqual(metrics.clientHeight + OVERFLOW_SLACK_PX);
}

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

/** The map canvas must exactly fill its frame: a short canvas shows a dead band of page ground. */
async function expectCanvasFillsFrame(page: Page): Promise<void> {
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible();
  const gap = await page.evaluate<{ w: number; h: number }>(() => {
    const el = document.querySelector('canvas');
    const frame = el?.parentElement;
    if (!el || !frame) throw new Error('canvas has no frame');
    const c = el.getBoundingClientRect();
    const f = frame.getBoundingClientRect();
    return { w: f.width - c.width, h: f.height - c.height };
  });
  expect(Math.abs(gap.w), `canvas is ${gap.w}px narrower than its frame`).toBeLessThanOrEqual(1);
  expect(Math.abs(gap.h), `canvas is ${gap.h}px shorter than its frame`).toBeLessThanOrEqual(1);
}

for (const size of VIEWPORTS) {
  const tag = `${size.width}x${size.height}`;

  test.describe(`viewport ${tag}`, () => {
    test.use({ viewport: size });

    test(`auth screen at ${tag}`, async ({ page }) => {
      await page.goto('/auth');
      await expect(page.getByRole('heading', { name: 'FRONTLINE' })).toBeVisible();
      await expectNoDocumentOverflow(page);
      await expectNothingClippedHorizontally(page);
      await expectNothingClippedVertically(page);
      await page.screenshot({ path: `screenshots/visual/auth-${tag}.png` });
    });

    test(`character select at ${tag}`, async ({ page }) => {
      await installApi(page, meNoOverseer);
      await page.goto('/overseer');
      await expect(page.getByRole('heading', { name: 'CHOOSE YOUR OVERSEER' })).toBeVisible();
      await expectNoDocumentOverflow(page);
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

    test(`city map at ${tag}`, async ({ page }) => {
      await installApi(page, me);
      await page.goto('/game');
      await expect(page.locator('canvas')).toBeVisible();
      await page.waitForTimeout(900);
      await expectNoDocumentOverflow(page);
      await expectNothingClippedHorizontally(page);
      await expectNothingClippedVertically(page);
      await expectCanvasFillsFrame(page);
      await page.screenshot({ path: `screenshots/visual/map-${tag}.png` });
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
      await expect(page.locator('canvas')).toBeVisible();
      await expectNoDocumentOverflow(page);
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
      // The faction level took the morale meter's place in the bar (§I). Named differently
      // because it is not a `Thing: number` readout: it is a level, and it reads as one.
      await expect(hud.getByRole('button', { name: /^Faction level/i })).toBeInViewport({
        ratio: 1,
      });
      await page.screenshot({ path: `screenshots/visual/hud-late-game-${tag}.png` });
    });

    /**
     * The bar has to survive a name the game itself allows.
     *
     * The cap was 40 and every fixture uses 21, so the row was fitted to a plaque half the width
     * of a legal one and the bar wrapped at the ceiling. `FACTION_NAME_MAX` is 28 now, chosen as
     * what the row can actually carry, so the bar is asserted to keep **one line** at the longest
     * name the game will accept. The chips are not the thing to count: an over-wide plaque pushes
     * the meters and the avatar onto the second line and leaves every stockpile chip where it was,
     * which is how the first version of this passed with the fix taken out.
     */
    test(`the HUD survives the longest legal faction name at ${tag}`, async ({ page }) => {
      const longest = 'The Ninth Street Reclamation Company Ltd'.slice(0, FACTION_NAME_MAX);
      expect(longest).toHaveLength(FACTION_NAME_MAX);
      const crew = lateGame.base;
      if (crew === null) throw new Error('the late-game fixture must have a crew');
      await installApi(page, { ...lateGame, base: { ...crew, name: longest } });
      await page.goto('/game');
      await expect(page.getByTestId('resource-chip-caps')).toBeVisible();
      await settleFonts(page);

      // Whole and on screen. The crew name is the one label on this bar a player chose
      // themselves, so it is also the one that must not be sliced. It reads off the plaque rather
      // than off a heading now: the bar carries no page heading, and the sign in the middle of it
      // is a button with two names on it (`FactionPlaque`).
      const plaque = page.getByTestId('faction-plaque');
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
      expect(rows, 'a legal faction name wrapped the stockpile').toBe(1);
      await expectNoDocumentOverflow(page);
      await expectNothingClippedHorizontally(page);
    });

    test(`base view at ${tag}`, async ({ page }) => {
      await installApi(page, me);
      await page.goto('/game/base');
      await expect(page.getByTestId('faction-plaque')).toContainText('The Ninth Street Crew');
      await expectNoDocumentOverflow(page);
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

      await expectNoDocumentOverflow(page);
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

      await expectNoDocumentOverflow(page);
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
      await expect(page.getByTestId('faction-plaque')).toContainText('The Ninth Street Crew');
      await expectNoDocumentOverflow(page);
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

      // §I2 grants at level 12: §G8 pool 2+11+2, §G3a cap floor(12/2), §H8 slots 2+11.
      await expect(grantValue('Assignee pool')).toHaveText('15');
      await expect(grantValue('Assignees / officer')).toHaveText('6');
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

      const cutRoom = await clipped();
      expect(cutRoom, `cut text in the Bar's room: ${cutRoom.join(' | ')}`).toEqual([]);
      await expectNoDocumentOverflow(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/bar-${tag}.png` });

      /*
       * The dossier, for the person with the longest name in the fixture.
       *
       * The §B6 thirty-three attributes beside an identity column is the widest thing this screen
       * renders, and the sheet's four-column mode switches on a *viewport* media query: inside a
       * modal that lays out four columns in the modal's width and cuts `Communication`. Which is
       * exactly what it did, and why the dossier asks for three.
       */
      await page.getByTestId('sit-down').click();
      await expect(page.getByTestId('bar-file')).toBeVisible();
      await settleFonts(page);
      const cutFile = await clipped();
      expect(cutFile, `cut text on a recruit's dossier: ${cutFile.join(' | ')}`).toEqual([]);
      await expectNothingClippedHorizontally(page);
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

      const room = await page.getByTestId('bar-room').boundingBox();
      const button = await seat.boundingBox();
      if (!room || !button) throw new Error('the room and the seat must both have boxes');

      // Horizontally centred, within a few percent: the stool is at 0.492 of the painting and the
      // picture is centred on the frame, so the two agree wherever the frame is cropped.
      const centre = (button.x + button.width / 2 - room.x) / room.width;
      expect(centre, 'the seat drifted off the middle of the room').toBeGreaterThan(0.4);
      expect(centre).toBeLessThan(0.6);
      // And on the lower half of the picture, where the stools are, rather than up among the
      // bottles: a plate that failed to load leaves the button at the top of an empty box.
      const down = (button.y + button.height / 2 - room.y) / room.height;
      expect(down, 'the seat is not down among the stools').toBeGreaterThan(0.45);

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
     * MOU-166 §B9/§F2: the research page, in both of the states it has.
     *
     * Fat in the same specific way the Bar fixture is: the longest role labels in §C1 against the
     * longest attribute names in §B, every listed role at `MAX_ROLE_FACTS` so the leads counter is
     * at its widest, and the pairing list filled to its cap so it wraps as far as it ever will. The
     * two states are shot separately because they render disjoint trees: the start forms only
     * exist when nothing is running, and the countdown only exists when something is.
     */
    test(`research at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/research');
      await expect(page.getByTestId('research-sections')).toBeVisible();
      await settleFonts(page);

      /*
       * The sweep runs on all three sections, not just the one the page opens on.
       *
       * The page used to be five panels in one scrolling column, so a single pass saw everything.
       * It is a rail and a workspace now: two thirds of the screen's copy is behind a door, and a
       * sweep of the desk alone would certify a third of the page and call it the page.
       */
      const clipped = async () =>
        page.evaluate<string[]>(() =>
          [...document.querySelectorAll<HTMLElement>('span, p, h3, option, label')]
            .filter((el) => el.childElementCount === 0 && el.scrollWidth > el.clientWidth + 1)
            .map((el) => `"${el.textContent?.trim()}" (${el.scrollWidth}>${el.clientWidth}px)`),
        );

      const box = async (id: string) => {
        const rect = await page.getByTestId(id).boundingBox();
        if (!rect) throw new Error(`${id} has no box`);
        return rect;
      };

      // The desk, on each of its three benches.
      for (const bench of ['investigate', 'develop', 'modify']) {
        await page.getByTestId(`research-bench-${bench}`).click();
        await settleFonts(page);
        const cut = await clipped();
        expect(cut, `cut text on the ${bench} bench: ${cut.join(' | ')}`).toEqual([]);
      }
      await page.getByTestId('research-bench-investigate').click();
      await settleFonts(page);
      await expectNoDocumentOverflow(page);
      await expectNothingClippedHorizontally(page);
      await expectSheetNotWashedOut(page);
      await page.screenshot({ path: `screenshots/visual/research-${tag}.png` });

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
      /*
       * The bench strip does not move when the bench does.
       *
       * It used to live *inside* the scrolling workspace, and the modification bench is sixty-five
       * cards: scrolling down to read them carried the three buttons off the top of the screen, so
       * the controls for choosing a bench disappeared the moment you used the bench you chose. At
       * 1280x720 the strip ended up at y=-77, which is off the sheet entirely.
       *
       * Measured against the *frame* rather than merely asserted visible: Playwright counts an
       * element clipped out of a scroll container as visible, so `toBeVisible` passed throughout
       * the bug.
       *
       * Scrolled with the **wheel**, over the middle of the sheet, rather than by calling
       * `scrollTo` on the element this test believes is the scroller. That belief is exactly what
       * regressed: moving the overflow one level up the tree reintroduces the bug and leaves a
       * `scrollTo` on the old node doing nothing, so the gate passes on the broken build. A wheel
       * scrolls whatever is actually scrollable under the pointer, which is also what a player
       * does.
       */
      await page.getByTestId('research-bench-modify').click();
      await settleFonts(page);
      const stripBefore = await box('research-benches');
      const sheet = await box('research-workspace');
      await page.mouse.move(sheet.x + sheet.width / 2, sheet.y + sheet.height / 2);
      for (let turn = 0; turn < 12; turn += 1) await page.mouse.wheel(0, 400);
      await page.waitForTimeout(200);
      const stripAfter = await box('research-benches');
      expect(stripAfter.y, 'the bench strip scrolled away with its own content').toBe(
        stripBefore.y,
      );
      await expect(page.getByTestId('research-benches')).toBeInViewport({ ratio: 1 });
      await page.getByTestId('research-bench-investigate').click();

      await page.getByTestId('research-section-programmes').click();
      await settleFonts(page);
      const raw = await page.evaluate<string[]>(() =>
        [...document.querySelectorAll<HTMLElement>('[data-testid^="tech-track-"] p')]
          .map((el) => el.textContent ?? '')
          .filter((text) => /\b(?:[a-z]+[A-Z]|[A-Z]{6,})[A-Za-z]*\b/.test(text)),
      );
      expect(raw, `a field name reached the Lab's tree: ${raw.join(' | ')}`).toEqual([]);
      const cutTree = await clipped();
      expect(cutTree, `cut text on the Lab's tree: ${cutTree.join(' | ')}`).toEqual([]);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/research-programmes-${tag}.png` });

      // And the files, which is where the fat fixture's longest labels live.
      await page.getByTestId('research-section-the-files').click();
      await expect(page.getByTestId('research-file')).toBeVisible();
      await settleFonts(page);
      const pairings = page.getByText('What goes with what', { exact: true });
      await pairings.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await expect(pairings).toBeInViewport({ ratio: 1 });
      await settleFonts(page);
      const cutFiles = await clipped();
      expect(cutFiles, `cut text on the files: ${cutFiles.join(' | ')}`).toEqual([]);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/research-facts-${tag}.png` });
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

      // Every card the same card. Heights first, then the one control a player hunts for.
      const aligned = await page.evaluate(() => {
        const cards = [
          ...document.querySelectorAll('[data-testid="unit-catalogue"] > [data-testid^="unit-"]'),
        ];
        const heights = new Set(
          cards.map((card) => Math.round(card.getBoundingClientRect().height)),
        );
        // The action *box*, not the control inside it: a locked card's box holds a padlock and an
        // unlocked one holds a stepper and a button, so measuring the control would report the two
        // states as a misalignment. What has to land on the same line is the box.
        const actions = new Set(
          cards.map((card) => {
            const box = card.getBoundingClientRect();
            const action = card.querySelector('[data-testid^="action-"]');
            return action ? Math.round(action.getBoundingClientRect().top - box.top) : -1;
          }),
        );
        return { cards: cards.length, heights: [...heights], actions: [...actions] };
      });
      expect(aligned.cards, 'the roster must draw some cards').toBeGreaterThan(1);
      expect(aligned.heights, `cards of ${aligned.heights.length} different heights`).toHaveLength(
        1,
      );
      expect(aligned.actions, 'the action box moves between cards').toHaveLength(1);

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
      await expectNoDocumentOverflow(page);
      await expectNothingClippedHorizontally(page);
      await expectSheetNotWashedOut(page);
      await page.screenshot({ path: `screenshots/visual/units-${tag}.png` });
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

      await expectNoDocumentOverflow(page);
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
      const note = await box('info-note');
      expect(day.y, 'the day belongs under the roster').toBeGreaterThan(roster.y);
      expect(note.y, 'the note belongs under the day').toBeGreaterThan(day.y);
      // All three in the same column, left-aligned with each other rather than merely stacked.
      expect(Math.abs(note.x - day.x)).toBeLessThan(12);
      expect(Math.abs(day.x - roster.x)).toBeLessThan(12);

      // 2. The rail sits beside the sheet, not above it: one row, two columns.
      const sheet = await box('training-sheet');
      expect(sheet.x, 'the sheet belongs to the right of the rail').toBeGreaterThan(
        roster.x + roster.width - 1,
      );

      /*
       * 3. The frame fills the screen, and the note is pinned to the foot of it.
       *
       * This is the assertion that catches the fixed frame being taken out. Without it the page
       * falls back to stacking at content height: the order above still holds, the page still
       * does not scroll (the sheet's own overflow absorbs it), and every other check here passes
       * on a layout where the note has floated up into the middle of the screen.
       */
      const frame = await box('page-sheet');
      const floor = frame.y + frame.height;
      expect(
        floor - (note.y + note.height),
        'the note is not at the foot of the rail',
      ).toBeLessThan(48);
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
      await expect(page.getByTestId('crew-effects')).toBeVisible();
      await settleFonts(page);

      const cut = await page.evaluate<string[]>(() =>
        [...document.querySelectorAll<HTMLElement>('span, p, h2, li')]
          .filter((el) => el.childElementCount === 0 && el.scrollWidth > el.clientWidth + 1)
          .map((el) => `"${el.textContent?.trim()}"`),
      );
      expect(cut, `cut text on the overseer's file: ${cut.join(' | ')}`).toEqual([]);

      await expectNoDocumentOverflow(page);
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
      await page.goto('/game');

      const rail = page.getByTestId('queue-rail');
      await expect(rail).toBeVisible();
      const row = page.getByTestId('queue-rail-build-live-build');
      await expect(row).toContainText('The Quarters');
      // Nineteen minutes left of twenty, not zero and not the whole thing.
      await expect(row).toContainText(/1[89]m/);

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

      await expectNoDocumentOverflow(page);
      await expectNothingClippedHorizontally(page);
    });

    /** The market: the Runner's window, the Broker's rate and the players' board. */
    test(`the market at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/market');
      await expect(page.getByTestId('vendor-stock')).toBeVisible();
      await settleFonts(page);

      // The three things a market screen has to actually say.
      await expect(page.getByTestId('vendor-state')).toContainText('In');
      await expect(page.getByTestId('barter-quote')).toContainText('50');
      await expect(page.getByTestId('market-board')).toBeVisible();

      const clipped = await page.evaluate<string[]>(() =>
        [...document.querySelectorAll<HTMLElement>('span, p, h3, li')]
          .filter((el) => el.childElementCount === 0 && el.scrollWidth > el.clientWidth + 1)
          .map((el) => `"${el.textContent?.trim()}"`),
      );
      expect(clipped, `cut text on the market: ${clipped.join(' | ')}`).toEqual([]);

      await expectNoDocumentOverflow(page);
      await expectNothingClippedHorizontally(page);
      await expectSheetNotWashedOut(page);
      await page.screenshot({ path: `screenshots/visual/market-${tag}.png` });
    });

    /** The workshop: three ladders and the yard. */
    test(`the workshop at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/workshop');
      await expect(page.getByTestId('upgrade-armour_1')).toBeVisible();
      await settleFonts(page);

      // A built rung, a reachable one and a locked one all render differently, and all three are
      // on this fixture, which is the point of the fixture.
      await expect(page.getByTestId('upgrade-armour_1')).toContainText('Built');
      await expect(page.getByTestId('upgrade-armour_3')).toContainText('Needs the Gauntlet');
      await expect(page.getByTestId('vehicle-rotorcraft')).toContainText('Blueprint');

      await expectNoDocumentOverflow(page);
      await expectNothingClippedHorizontally(page);
      await expectSheetNotWashedOut(page);
      await page.screenshot({ path: `screenshots/visual/workshop-${tag}.png` });
    });

    /** The satchel, grouped by what a player would do with the thing. */
    test(`the satchel at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/inventory');
      await expect(page.getByTestId('satchel-component')).toBeVisible();
      await settleFonts(page);

      await expect(page.getByTestId('satchel-blueprint')).toContainText('Cybernetics');
      await expect(page.getByTestId('satchel-relic')).toContainText('Ivory Dice');

      await expectNoDocumentOverflow(page);
      await expectNothingClippedHorizontally(page);
      await expectSheetNotWashedOut(page);
      await page.screenshot({ path: `screenshots/visual/satchel-${tag}.png` });
    });

    /** The other half of the same screen: a project in flight, with §F4's option showing. */
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
      await expect(page.getByText('Investigating the Instructor of the Young')).toBeVisible();
      await settleFonts(page);

      await expectNoDocumentOverflow(page);
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
