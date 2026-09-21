import { expect, test } from '@playwright/test';
import { lateGame } from './fixtures';
import { installApi, settleFonts } from './harness';

/**
 * The four screens that were asked for the feats board's hand (maintainer, 2026-09-17).
 *
 * The archive, the market and both modification benches took the board's paper, its palette and its
 * drawn controls. Every one of those changes is a class name, which is the kind of change that
 * looks right in a diff and is wrong on the screen, and none of it is visible to a unit test.
 *
 * Two rules are worth a browser. The first is that the drawn chrome is actually **there**: a
 * `DrawnFace` is an inline SVG inside the control, so a screen that lost it still renders a button
 * and reads as the old one. The second is that these screens are quiet: a restyle that leaves a
 * React warning or an unkeyed list behind is a restyle that broke something else on the way past.
 */

const DRAWN = [
  { path: '/game/research', anchor: 'research-workspace', control: 'research-tab-programmes' },
  { path: '/game/market', anchor: 'page-sheet', control: 'bid-l3' },
  {
    path: '/game/scrapyard?view=modifications',
    anchor: 'scrapyard-workspace',
    control: 'scrapyard-view-modifications',
  },
  {
    path: '/game/scrapyard?view=refits',
    anchor: 'scrapyard-workspace',
    control: 'scrapyard-view-refits',
  },
] as const;

test('the restyled screens are drawn rather than struck, and say nothing to the console', async ({
  page,
}) => {
  const noise: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      noise.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => noise.push(`pageerror: ${error.message}`));
  await installApi(page, lateGame);

  for (const { path, anchor, control } of DRAWN) {
    await page.goto(path);
    await expect(page.getByTestId(anchor)).toBeVisible();
    await settleFonts(page);

    /*
     * The pen, counted. `DrawnFace` draws the face, the box and two overshoot strokes, so four
     * paths inside the control is the signature of the drawn box and one or none is the struck
     * plate it replaced.
     */
    const paths = await page.getByTestId(control).locator('svg path').count();
    expect(paths, `${path}: ${control} is not drawn`).toBeGreaterThanOrEqual(4);

    // And the sheet does not run off the side of the window at the width the game opens at.
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(wide, `${path} scrolls sideways`).toBe(false);
  }

  // Fonts and favicons are the platform's business, not the page's.
  expect(noise.filter((line) => !/favicon|font/i.test(line))).toEqual([]);
});

/**
 * And the plot window, which the maintainer asked for next (2026-09-18).
 *
 * Not in the table above, because it is not a screen you can navigate to: it opens over the
 * district when a plot is clicked, and it is portalled to `document.body`, so it is outside every
 * sweep the rest of this file and `visual.spec.ts` run over `#root`.
 *
 * Two claims the class names cannot make on their own. Its panels are actually *painted* as paper
 * (`.ink-frame` is a `border-image`, and a `border-image-source` of `none` is what a dropped class
 * looks like from the browser's side), and its controls are drawn rather than struck, counted the
 * same way as above.
 */
test('the plot window is drawn rather than struck', async ({ page }) => {
  const noise: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      noise.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => noise.push(`pageerror: ${error.message}`));

  await installApi(page, lateGame);
  await page.goto('/game/base');
  await page.locator('[data-testid="plot-nexus"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await settleFonts(page);

  const unpainted = await page.evaluate(() => {
    const panels = [...document.querySelectorAll('[role="dialog"] section')];
    if (panels.length < 3) return [`the window drew ${panels.length} panels`];
    return panels.flatMap((panel) => {
      const style = getComputedStyle(panel);
      const name = panel.querySelector('h3')?.textContent ?? '(unnamed)';
      // The drawn frame, and the sheet under it. `card-paper` declares its ground as a longhand
      // `background-color` precisely so that a later `background-image` cannot take it away, so
      // that is the honest thing to read back.
      if (style.borderImageSource === 'none') return [`${name}: no drawn frame`];
      if (style.backgroundColor !== 'rgb(18, 18, 22)') return [`${name}: ${style.backgroundColor}`];
      return [];
    });
  });
  expect(unpainted, `panels that are not on paper: ${unpainted.join(' | ')}`).toEqual([]);

  for (const name of ['Queue upgrade', 'Close']) {
    const paths = await dialog.getByRole('button', { name }).locator('svg path').count();
    expect(paths, `${name} is not drawn`).toBeGreaterThanOrEqual(4);
  }

  expect(noise.filter((line) => !/favicon|font/i.test(line))).toEqual([]);
});
