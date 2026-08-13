/**
 * MOU-167 / GDD §A1 acceptance gate: the hideout as a village, with zero visual bugs.
 *
 * The board's bar is "no cut text or images, no overflow, no overlapping elements, at every
 * supported viewport". The plots are placed in *percentages* of a scene box, so the failure mode
 * is not one bad viewport — it is a nudged coordinate that overlaps at every viewport at once, or
 * a name plate whose text is wider than the plot that clips it. `plots.test.ts` pins the declared
 * boxes; this pins what the browser actually laid out, which is the only place font metrics,
 * borders and padding exist.
 *
 * Screenshots land in `screenshots/hideout/` so the board can open the whole matrix at once.
 */
import { BUILDING_KINDS, type Building } from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import { base, lateGame, lateGameBase, me } from './fixtures';
import { expectNothingClippedVertically, installApi, settleFonts } from './harness';

/**
 * A hideout with every plot standing at `level`, over `lateGame`'s late-game stockpile.
 *
 * Both fat cases only exist at the top of the curve: the widest name plate the catalogue can
 * produce is `Data Hub Lv 10` — the only two-digit one — and the widest cost line is the level-10
 * Command Center, five figures across three materials. `lateGame` on its own is a *rich* base
 * still wearing the starting village, so it renders neither.
 */
function villageAt(level: number): typeof lateGame {
  const buildings: Building[] = BUILDING_KINDS.map((kind, index) => ({
    id: `b${index + 1}`,
    kind,
    level,
  }));
  return { ...lateGame, base: { ...lateGameBase, buildings } };
}

interface Size {
  readonly width: number;
  readonly height: number;
}

const VIEWPORTS: readonly Size[] = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

/** Rounding slack, in px. Sub-pixel layout makes an exact-equality geometry test flap. */
const SLACK_PX = 1;

interface Box {
  label: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The rects of everything matching `selector`, tagged with its accessible name for the message. */
async function boxes(page: Page, selector: string): Promise<Box[]> {
  await settleFonts(page);
  return page.evaluate((sel) => {
    return [...document.querySelectorAll<HTMLElement>(sel)].map((el) => {
      const { left, right, top, bottom } = el.getBoundingClientRect();
      return {
        label: el.getAttribute('aria-label') ?? el.textContent?.trim() ?? sel,
        left,
        right,
        top,
        bottom,
      };
    });
  }, selector);
}

function intersects(a: Box, b: Box): boolean {
  return (
    a.left < b.right - SLACK_PX &&
    b.left < a.right - SLACK_PX &&
    a.top < b.bottom - SLACK_PX &&
    b.top < a.bottom - SLACK_PX
  );
}

function expectNoPairOverlaps(rects: Box[], what: string): void {
  const clashes: string[] = [];
  for (const [i, a] of rects.entries()) {
    for (const b of rects.slice(i + 1)) {
      if (intersects(a, b)) clashes.push(`${a.label} × ${b.label}`);
    }
  }
  expect(clashes, `overlapping ${what}: ${clashes.join(' | ')}`).toEqual([]);
}

/**
 * Every plot, and every name plate on one, is laid out inside the scene and clear of its
 * neighbours — measured from the DOM, after the display font has swapped in.
 *
 * Name plates are checked separately from the plot buttons on purpose: a plate is `nowrap` text
 * centred in its plot, so it is the one element that can grow *wider than the box it was placed
 * in* when the font lands, and it would then be silently cut by the scene's `overflow-hidden`
 * rather than pushing the document out.
 */
async function expectVillageLaidOutCleanly(page: Page): Promise<void> {
  const [scene] = await boxes(page, '[data-testid="village-scene"]');
  expect(scene, 'the village scene must be rendered').toBeDefined();
  if (!scene) return;

  const plots = await boxes(page, '[data-testid="village-scene"] > button');
  expect(plots, 'every structure in the catalogue stands on a plot').toHaveLength(6);
  const plates = await boxes(page, '[data-testid^="plot-label-"]');
  expect(plates).toHaveLength(6);

  for (const box of [...plots, ...plates]) {
    expect(box.left, `${box.label} runs off the left of the scene`).toBeGreaterThanOrEqual(
      scene.left - SLACK_PX,
    );
    expect(box.right, `${box.label} runs off the right of the scene`).toBeLessThanOrEqual(
      scene.right + SLACK_PX,
    );
    expect(box.top, `${box.label} runs off the top of the scene`).toBeGreaterThanOrEqual(
      scene.top - SLACK_PX,
    );
    expect(box.bottom, `${box.label} runs off the bottom of the scene`).toBeLessThanOrEqual(
      scene.bottom + SLACK_PX,
    );
  }

  expectNoPairOverlaps(plots, 'plots');
  expectNoPairOverlaps(plates, 'name plates');
}

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  await settleFonts(page);
  const metrics = await page.evaluate(() => {
    const { scrollWidth, clientWidth } = document.documentElement;
    return { scrollWidth, clientWidth };
  });
  expect(
    metrics.scrollWidth,
    `horizontal overflow: ${metrics.scrollWidth} > ${metrics.clientWidth}`,
  ).toBeLessThanOrEqual(metrics.clientWidth + SLACK_PX);
}

for (const size of VIEWPORTS) {
  const tag = `${size.width}x${size.height}`;

  test.describe(`hideout ${tag}`, () => {
    test.use({ viewport: size });

    test(`the village lays out cleanly at ${tag}`, async ({ page }) => {
      await installApi(page, me);
      await page.goto('/game/base');
      await expect(page.getByRole('heading', { name: "Operator's Foothold" })).toBeVisible();

      await expectVillageLaidOutCleanly(page);
      await expectNoDocumentOverflow(page);
      // Scoped to the scene: this page is a document scroller, so its own fold cuts the last row
      // of the panels below by design (the same argument `visual.spec.ts` makes for the base view).
      // The scene is `overflow-hidden` and fixed-aspect, so a cut inside it is always a real bug.
      await expectNothingClippedVertically(page, '[data-testid="village-scene"]');
      await page.screenshot({ path: `screenshots/hideout/village-${tag}.png` });
    });

    /*
     * The dialog is the fat case: the widest cost line the game has (a level-10 Command Center,
     * five figures in three materials) over the longest refusal copy. Its own screenshot, because
     * a modal is drawn over the page and a `fullPage` shot of the village cannot show it.
     */
    test(`the plot dialog lays out cleanly at ${tag}`, async ({ page }) => {
      // One level below the ceiling, so the dialog quotes the level-10 price rather than level 2's.
      await installApi(page, villageAt(9));
      await page.goto('/game/base');
      await page.getByRole('button', { name: /^Command Center —/ }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'Command Center' })).toBeInViewport({
        ratio: 1,
      });
      await expect(dialog.getByRole('button', { name: 'Upgrade' })).toBeInViewport({ ratio: 1 });
      await expectNoDocumentOverflow(page);
      await expectNothingClippedVertically(page, '[role="dialog"]');
      await page.screenshot({ path: `screenshots/hideout/dialog-${tag}.png` });
    });
  });
}

/**
 * The village with every plot standing — what the hideout looks like once it has been played, and
 * the only state that shows all six silhouettes at once. Screenshot-only: the geometry gates above
 * already run over the six *plots*, which are in the same place whether or not they are built.
 */
test.describe('a hideout that has been played', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('renders every structure standing', async ({ page }) => {
    // At the ceiling, not mid-curve: this is the only fixture that lays out a two-digit name plate
    // (`Data Hub Lv 10`), which is the widest string a plate can ever hold.
    await installApi(page, villageAt(10));
    await page.goto('/game/base');

    await expectVillageLaidOutCleanly(page);
    await expectNothingClippedVertically(page, '[data-testid="village-scene"]');
    await page.screenshot({ path: 'screenshots/hideout/village-built.png' });
  });
});

/**
 * The whole §D3 loop through the real client: pick an empty plot, pay for it, watch the village
 * change. The build response is what the page re-renders from, so a client that dropped the body
 * would leave a vacant plot vacant here — which no unit test mocking the hook can see.
 */
test.describe('building in the hideout (§D3)', () => {
  test('an empty plot becomes a standing structure', async ({ page }) => {
    await installApi(page, me);
    // Registered after `installApi`, so Playwright's reverse-order matching gives it priority.
    await page.route('**/api/base/build', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          base: {
            ...base,
            resources: { ...base.resources, oil: base.resources.oil - 50 },
            buildings: [...base.buildings, { id: 'b-foundry', kind: 'foundry', level: 1 }],
          },
        }),
      }),
    );
    await page.goto('/game/base');

    const foundry = page.getByRole('button', { name: /^Foundry —/ });
    await expect(foundry).toHaveAttribute('aria-label', /vacant plot/);
    await foundry.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Vacant plot')).toBeVisible();
    await dialog.getByRole('button', { name: 'Build' }).click();

    await expect(foundry).toHaveAttribute('aria-label', /level 1/);
    await page.screenshot({ path: 'screenshots/hideout/after-build.png' });
  });

  test('a plot the Command Center is holding down says so instead of offering an upgrade', async ({
    page,
  }) => {
    await installApi(page, me);
    await page.goto('/game/base');

    await page.getByRole('button', { name: /^Fusion Reactor —/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/CAPPED BY THE COMMAND CENTER/)).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: 'Upgrade' })).toBeDisabled();
  });
});
