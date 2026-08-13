/**
 * MOU-114 acceptance gate: every screen, at every supported viewport, with zero visual bugs.
 *
 * Screenshots land in `screenshots/visual/<screen>-<w>x<h>.png` so a reviewer can eyeball the
 * whole matrix in one directory. The assertions catch the failures that are cheap to detect
 * mechanically — document overflow, unexpected scrollbars, a canvas that does not fill its
 * frame — so review time is spent on the ones that are not (composition, colour, legibility).
 */
import { expect, test, type Page } from '@playwright/test';
import { lateGame, me, meNoOverseer } from './fixtures';
import { expectNothingClippedVertically, installApi, settleFonts } from './harness';

interface Size {
  readonly width: number;
  readonly height: number;
}

const VIEWPORTS: readonly Size[] = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
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
 */
async function expectWholeCardRows(page: Page): Promise<void> {
  const roster = await page.evaluate<{ total: number; hidden: number }>(() => {
    const cards = [...document.querySelectorAll('button[aria-pressed]')];
    const viewport = cards[0]?.closest('.overflow-y-auto');
    if (!viewport) throw new Error('roster viewport not found');
    const { bottom } = viewport.getBoundingClientRect();
    return {
      total: cards.length,
      hidden: cards.filter((card) => card.getBoundingClientRect().bottom > bottom + 1).length,
    };
  });

  expect(roster.total, 'every preset must be rendered').toBe(4);
  const hint = page.getByText(/Scroll for \d+ more/);
  if (roster.hidden === 0) {
    await expect(hint, 'a roster that fits must not advertise hidden cards').toHaveCount(0);
  } else {
    await expect(hint, 'hidden cards must be advertised, and counted correctly').toHaveText(
      new RegExp(`Scroll for ${roster.hidden} more`),
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
      await expectWholeCardRows(page);
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
      await expect(page.getByRole('heading', { name: "Operator's Foothold" })).toBeVisible();
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
