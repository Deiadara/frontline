/**
 * MOU-114 acceptance gate: every screen, at every supported viewport, with zero visual bugs.
 *
 * Screenshots land in `screenshots/visual/<screen>-<w>x<h>.png` so a reviewer can eyeball the
 * whole matrix in one directory. The assertions catch the failures that are cheap to detect
 * mechanically — document overflow, unexpected scrollbars, a canvas that does not fill its
 * frame — so review time is spent on the ones that are not (composition, colour, legibility).
 */
import { expect, test, type Page } from '@playwright/test';
import { activeResearch, lateGame, me, meNoOverseer, missionsResponse } from './fixtures';
import { expectNothingClippedVertically, installApi, settleFonts } from './harness';

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
 * every taller viewport all four do — so the tight viewport is the fat case this screen has, its
 * content being the same four presets everywhere.
 *
 * `fitsWholeRoster` pins which of the two branches a viewport is in. Reading the hidden count off
 * the DOM and checking only that the hint agrees with it is self-fulfilling: a card that grew back
 * into the 5px of slack 1024x768 has would silently halve the roster and stay green — the same
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

/** The map canvas must exactly fill its frame — a short canvas shows a dead band of page ground. */
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
      // Two card rows need 592px of frame. Only the 720px-tall viewport cannot pay for it (549px);
      // 1024x768 clears it by 5px, which is the margin this argument exists to keep honest.
      await expectWholeCardRows(page, size.height >= 768);
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

      const hud = page.locator('header');
      for (const chip of ['Caps', 'Food', 'Oil', 'Scrap', 'HQ Metal', 'Morale', 'Infamy']) {
        await expect(hud.getByText(chip, { exact: true })).toBeInViewport({ ratio: 1 });
      }
      await page.screenshot({ path: `screenshots/visual/hud-late-game-${tag}.png` });
    });

    test(`base view at ${tag}`, async ({ page }) => {
      await installApi(page, me);
      await page.goto('/game/base');
      await expect(page.getByRole('heading', { name: 'The Ninth Street Crew' })).toBeVisible();
      await expectNoDocumentOverflow(page);
      await expectNothingClippedHorizontally(page);
      /*
       * No vertical guard here, deliberately. The base panel is a document scroller: its content
       * is arbitrarily long, so the last visible row is cut at every viewport, exactly as an
       * ordinary scrolling page cuts it. That is a different question from a *bounded* viewport
       * silently ending mid-card, which is what the guard exists for. What the fold does expose at
       * 1280x720 is that nothing advertises the scroll — MOU-195 tracks the affordance.
       */
      await page.screenshot({ path: `screenshots/visual/base-${tag}.png` });
    });

    /*
     * MOU-162 §E3/§E4: the dedicated missions page, at the widest state it has. `missionsResponse`
     * fills every crew slot, puts a day-long run one minute into its clock so the countdown reads
     * `25:5x:xx` — the widest string that column can hold — and returns a mission paying all five
     * resources, the longest reward line that can render. Both surfaces are on this one page: the
     * in-flight timers (§E3) and the board, where travel and mission time are quoted separately
     * before you commit (§E4).
     *
     * Like the base view this is a document scroller, so there is no vertical-clip guard: content
     * is arbitrarily long and the fold cuts the last row at every viewport by design.
     */
    /**
     * MOU-227 — the level-up a returning crew paid for is announced on the settling response only,
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
      await expect(page.getByRole('heading', { name: 'Missions' })).toBeVisible();
      await settleFonts(page);

      // §E4 — travel and mission time are quoted separately, and the total is the §E8 sum.
      const expedition = page.getByRole('article').filter({ hasText: 'Deep Expedition' }).first();
      await expect(expedition.getByText('Travel', { exact: true })).toBeVisible();
      await expect(expedition.getByText('1h 00m')).toBeVisible();
      await expect(expedition.getByText('On site', { exact: true })).toBeVisible();
      await expect(expedition.getByText('24h 00m')).toBeVisible();
      await expect(expedition.getByText('Total round trip')).toBeVisible();
      await expect(expedition.getByText('26h 00m')).toBeVisible();

      /*
       * The §E4 breakdown is the narrowest fixed copy on the page, and it shipped cut once
       * already: a three-column layout ellipsised "round trip" to "ROUND TRI…" at every viewport.
       * The copy here is fixed, so a clipped label is a permanent defect and not a fat-content
       * edge case — every one of these must render whole, on every card, at every width.
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
      // `fullPage` cannot reach it — it has to be scrolled to and shot separately, or the pre-
      // commit screen never actually gets looked at.
      await expedition.scrollIntoViewIfNeeded();
      await settleFonts(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/missions-board-${tag}.png` });
    });

    /*
     * MOU-165 §I: the progression readout is sized by the digits in it, and the starting base
     * shows `0 / 100` — the narrowest case there is. `lateGameBase` sits one XP short of level 13,
     * so the row carries four digits either side of the slash and the bar runs to ~100%. Same
     * blind spot the late-game HUD test above exists for, on a different row.
     */
    test(`late-game progression readout at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/base');
      await expect(page.getByRole('heading', { name: 'The Ninth Street Crew' })).toBeVisible();
      await expectNoDocumentOverflow(page);
      await expectNothingClippedHorizontally(page);

      // The base screen is a document scroller, so the panel is below the fold at every viewport
      // in the matrix — scrolled to, then measured, the same way a player reaches it. Scrolling to
      // the *last* row puts the whole panel on screen, so the screenshot shows all of it.
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
     * MOU-164 §H: the Bar, at the widest state it has. `bar` is deliberately a late-game fixture —
     * the longest names the roster generator can produce, a four-digit weekly wage, all four §H5
     * bands including the walkout warning, and recruits in every card state. The starting state of
     * this screen is an empty crew and eight interchangeable cards, which is exactly the
     * half-fixture MOU-207 was filed about.
     *
     * A document scroller, like the base and missions pages, so no vertical-clip guard: the fold
     * cuts the last row at every viewport by design. The roster below it is shot separately.
     */
    test(`the bar at ${tag}`, async ({ page }) => {
      // `lateGame`, so the HUD above the screen describes the same crew the Bar does — serving the
      // fat `bar` fixture over a starting session showed "STREET READS FEARED" under a `Cautious`
      // HUD, which only the screenshot caught (MOU-207).
      await installApi(page, lateGame);
      await page.goto('/game/bar');
      await expect(page.getByRole('heading', { name: 'The Bar' })).toBeVisible();
      await settleFonts(page);

      // §H8 — the slot counter is the one figure on this screen that has to stay legible at the
      // narrowest viewport, and a full crew is what makes it widest.
      await expect(page.getByText('recruits', { exact: false }).first()).toBeInViewport({
        ratio: 1,
      });

      /*
       * Every label on this screen is authored copy at a fixed size, so an ellipsis is a permanent
       * defect rather than a fat-content edge case — the §E4 breakdown shipped cut exactly this
       * way. The §H4 disposition tags and §H5 band tags are the narrowest of them.
       */
      const clipped = await page.evaluate<string[]>(() =>
        [...document.querySelectorAll<HTMLElement>('article span, article p, li span, li p')]
          .filter((el) => el.childElementCount === 0 && el.scrollWidth > el.clientWidth + 1)
          .map((el) => `"${el.textContent?.trim()}" (${el.scrollWidth}>${el.clientWidth}px)`),
      );
      expect(clipped, `cut text on the Bar: ${clipped.join(' | ')}`).toEqual([]);

      await expectNoDocumentOverflow(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/bar-${tag}.png` });

      // The roster is the §H1–§H4 surface and sits below the fold, so `fullPage` cannot reach it.
      const lastCard = page.getByRole('article').filter({ hasText: 'Juno Petrosyan' }).first();
      await lastCard.scrollIntoViewIfNeeded();
      await settleFonts(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/bar-roster-${tag}.png` });
    });

    /*
     * MOU-166 §B9/§F2: the research page, in both of the states it has.
     *
     * Fat in the same specific way the Bar fixture is: the longest role labels in §C1 against the
     * longest attribute names in §B, every listed role at `MAX_ROLE_FACTS` so the leads counter is
     * at its widest, and the pairing list filled to its cap so it wraps as far as it ever will. The
     * two states are shot separately because they render disjoint trees — the start forms only
     * exist when nothing is running, and the countdown only exists when something is.
     */
    test(`research at ${tag}`, async ({ page }) => {
      await installApi(page, lateGame);
      await page.goto('/game/research');
      await expect(page.getByRole('heading', { name: 'The Archive' })).toBeVisible();
      await settleFonts(page);

      // Every label here is authored copy at a fixed size, so an ellipsis is a permanent defect
      // rather than a fat-content edge case. The §F4 lock notice and the fact tags are narrowest.
      const clipped = await page.evaluate<string[]>(() =>
        [...document.querySelectorAll<HTMLElement>('span, p, h3, option, label')]
          .filter((el) => el.childElementCount === 0 && el.scrollWidth > el.clientWidth + 1)
          .map((el) => `"${el.textContent?.trim()}" (${el.scrollWidth}>${el.clientWidth}px)`),
      );
      expect(clipped, `cut text on the research page: ${clipped.join(' | ')}`).toEqual([]);

      await expectNoDocumentOverflow(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/research-${tag}.png` });

      /*
       * What the crew knows sits below the fold on the short viewports, and `fullPage` cannot
       * reach it through the page's own scroller. Centred explicitly rather than with
       * `scrollIntoViewIfNeeded`, which treats a heading already peeking over the fold as in view
       * and leaves the panel it introduces entirely out of the shot.
       */
      const pairings = page.getByText('What goes with what', { exact: true });
      await pairings.evaluate((el) => el.scrollIntoView({ block: 'center' }));
      await expect(pairings).toBeInViewport({ ratio: 1 });
      await settleFonts(page);
      await expectNothingClippedHorizontally(page);
      await page.screenshot({ path: `screenshots/visual/research-facts-${tag}.png` });
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
 * has watched fail is indistinguishable from one that returns early — which is how the horizontal
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
 * in 8 and took the whole visual matrix down with it — training everyone to re-run until green,
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
