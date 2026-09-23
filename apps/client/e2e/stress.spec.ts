import { expect, test, type Page } from '@playwright/test';
import { fullQueue, hudExtremes } from './fixtures';
import { expectNothingOverflowsTheScreen, installApi, settleFonts } from './harness';

/**
 * Every screen under the heaviest save the fixtures can build, at the narrowest frame (bug pass,
 * 2026-09-23, maintainer: "stuff overflowing, when too much is queued").
 *
 * The visual matrix already sweeps the standard save at five viewports. What it does not do is put
 * the *worst* numbers on every screen at once: a 120-level crew with a district name at its
 * character ceiling, seven-figure stores, a build queue at `MAX_BUILD_QUEUE` and a roster deep
 * enough to scroll. Those are the inputs that turn a layout that fits into one that does not, and
 * 1024x768 is where the frame has the least room to absorb them.
 *
 * One test per screen rather than one loop over all of them, so a failure names the screen instead
 * of naming the sweep.
 */

test.use({ viewport: { width: 1024, height: 768 } });

/**
 * No element may stick out of the viewport horizontally.
 *
 * The same check `visual.spec.ts` runs, and a copy of it rather than an import, because it is
 * private there and this file is the one place outside that matrix that needs it. `[data-scenery]`
 * opts one element out and never its subtree: full-bleed artwork is deliberately wider than the
 * frame, and what stands on it is still content.
 */
async function expectNothingClippedHorizontally(page: Page): Promise<void> {
  const offenders = await page.evaluate<string[]>(() => {
    /*
     * An element lying past the fold *inside a sideways scroller* is reachable, not cut.
     *
     * Both of this sweep's first two reports were that: the build rail is `overflow-x-auto` and
     * runs six orders across a box 860px wide, and the missions board's body scrolls below `xl`.
     * The scroller's own box still has to be inside the frame, which is the part worth checking,
     * so what is skipped is a descendant of one and never the scroller itself.
     */
    const reachable = (el: HTMLElement): boolean => {
      for (let node = el.parentElement; node !== null; node = node.parentElement) {
        const how = getComputedStyle(node).overflowX;
        if (how !== 'auto' && how !== 'scroll') continue;
        if (node.scrollWidth <= node.clientWidth + 1) continue;
        const box = node.getBoundingClientRect();
        if (box.right <= window.innerWidth + 1 && box.left >= -1) return true;
      }
      return false;
    };
    const bad: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.position === 'fixed') continue;
      if (el.hasAttribute('data-scenery')) continue;
      if (rect.right > window.innerWidth + 1 || rect.left < -1) {
        if (reachable(el)) continue;
        bad.push(`${el.tagName.toLowerCase()}.${el.className} [${rect.left}..${rect.right}]`);
      }
    }
    return bad.slice(0, 5);
  });
  expect(offenders, `elements outside the viewport: ${offenders.join(' | ')}`).toEqual([]);
}

/** The screens a player actually walks between, by the path the bottom bar uses. */
const SCREENS: readonly (readonly [name: string, path: string, ready: string])[] = [
  ['the district', '/game/base', 'district-frame'],
  ['the units roster', '/game/units', 'unit-slots'],
  ['the missions board', '/game/missions', 'mission-board'],
  ['the Monitor', '/game/actions', 'monitor-tabs'],
  ['the feats board', '/game/feats', 'feats-ledger'],
  ['the crew', '/game/crew', 'crew-books'],
  ['the research floor', '/game/research', 'research-tracks'],
  ['the market', '/game/market', 'vendor-stock'],
  ['the standings', '/game/leaderboard', 'standings-search'],
  ['the settings', '/game/settings', 'settings-sounds-panel'],
];

/** The heaviest save the fixtures can build: extreme numbers *and* a full build queue. */
const HEAVIEST = {
  ...hudExtremes,
  base: { ...hudExtremes.base!, buildQueue: fullQueue.base!.buildQueue },
};

async function open(page: Page, path: string, ready: string): Promise<void> {
  await installApi(page, HEAVIEST);
  await page.goto(path);
  // A screen that never drew is a screen this sweep says nothing about, so each one waits for a
  // landmark of its own rather than for a timeout.
  await expect(page.getByTestId(ready).first()).toBeVisible({ timeout: 15_000 });
  await settleFonts(page);
}

for (const [name, path, ready] of SCREENS) {
  test(`${name} holds its shape under the heaviest save`, async ({ page }) => {
    await open(page, path, ready);
    await expectNothingOverflowsTheScreen(page);
    await expectNothingClippedHorizontally(page);
    await page.screenshot({ path: `screenshots/stress/${ready}.png` });
  });
}

/*
 * There is deliberately no vertical-clip sweep here.
 *
 * Every screen in this file is one whose body scrolls below `xl`, so a card whose last line is
 * under the fold is the scrolling region doing its job, not a cut: measured on the missions board
 * at 1024x768, where the sweep reported six sliced figures and scrolling the page reached all of
 * them. The repo's own note on this ("an unscoped vertical-clip sweep is a knife edge") is why it
 * is not here. Vertical clipping is pinned in `visual.spec.ts`, scoped to the frames that really
 * are fixed.
 */
