/**
 * MOU-167 / GDD §A1 acceptance gate: the district as a place, with zero visual bugs.
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
import {
  expectNoImagesClipped,
  expectNothingClippedVertically,
  installApi,
  settleFonts,
} from './harness';

/**
 * A hideout with every plot standing at `level`, over `lateGame`'s late-game stockpile.
 *
 * Both fat cases only exist at the top of the curve: the widest name plate the catalogue can
 * produce is `Apothecary Lv 20` — two digits under the longest short name — and the widest cost
 * line is the level-20 Garage, five figures across four materials. `lateGame` on its own is a
 * *rich* base still wearing the starting two structures, so it renders neither.
 */
function districtAt(level: number): typeof lateGame {
  const buildings: Building[] = BUILDING_KINDS.map((kind, index) => ({
    id: `b${index + 1}`,
    kind,
    level,
    modifications: [],
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

/** Do the two rects share any area at all? A shared edge is not an overlap. */
function intersects(a: Box, b: Box): boolean {
  return (
    a.left < b.right - SLACK_PX &&
    b.left < a.right - SLACK_PX &&
    a.top < b.bottom - SLACK_PX &&
    b.top < a.bottom - SLACK_PX
  );
}

/**
 * The band of ground a plot stands on: the bottom of its box, at the width `ContactShadow` pools
 * its shade across. `plots.ts` uses the same two fractions.
 *
 * A plot's *box* is the room its drawing takes, and on a town view seen from above a tall
 * building's upper mass is supposed to pass in front of a shorter one behind it — that is what
 * depth looks like, and requiring the boxes to be disjoint would cap every structure's height at
 * the gap to the row behind it. What may never collide is where two buildings meet the ground.
 */
function groundBand(box: Box): Box {
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const midX = (box.left + box.right) / 2;
  return {
    label: box.label,
    left: midX - width * 0.43,
    right: midX + width * 0.43,
    top: box.bottom - height * 0.14,
    bottom: box.bottom,
  };
}

/**
 * Every plot is laid out inside the scene, and no two of them stand on the same ground — measured
 * from the DOM, after the display font has swapped in.
 *
 * A town view reads as a place because there is visible ground between the buildings, so the
 * layout leaves a lane between every pair (`plots.ts`) and this is where that survives contact
 * with a real browser at five viewports.
 *
 * Name plates are checked separately from the plot buttons on purpose: a plate is `nowrap` text
 * centred on its plot, so it is the one element that can grow *wider than the box it was placed
 * in* when the font lands, and it would then be silently cut by the scene's `overflow-hidden`
 * rather than pushing the document out. Plates render on hover and focus for a structure that is
 * simply standing, so this measures the one the pointer is on.
 */
async function expectDistrictLaidOutCleanly(page: Page): Promise<void> {
  const [scene] = await boxes(page, '[data-testid="district-scene"]');
  expect(scene, 'the district scene must be rendered').toBeDefined();
  if (!scene) return;

  const plots = await boxes(page, '[data-testid="district-scene"] > button');
  expect(plots, 'every structure in the catalogue stands on a plot').toHaveLength(
    BUILDING_KINDS.length,
  );

  for (const box of plots) {
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

  const bands = plots.map(groundBand);
  const clashes: string[] = [];
  for (const [i, a] of bands.entries()) {
    for (const b of bands.slice(i + 1))
      if (intersects(a, b)) clashes.push(`${a.label} × ${b.label}`);
  }
  expect(clashes, `plots standing on the same ground: ${clashes.join(' | ')}`).toEqual([]);

  // The plate a player can actually see: hovering one plot reveals its name, and that is the
  // element that can outgrow its plot once the display font lands.
  const middle = Math.floor(plots.length / 2);
  const named = plots[middle];
  await page.locator('[data-testid="district-scene"] > button').nth(middle).hover();
  await expect(page.locator('[data-testid^="plot-label-"]').nth(middle)).toHaveCSS('opacity', '1');
  await settleFonts(page);

  // Read by *computed* opacity, not by class: the hidden state keeps its `opacity-0` class and a
  // `group-hover:` variant overrides it, so a class selector would find every plate hidden.
  const plates = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid^="plot-label-"]')]
      .filter((el) => Number(getComputedStyle(el).opacity) > 0.5)
      .map((el) => {
        const { left, right } = el.getBoundingClientRect();
        return { label: el.textContent?.trim() ?? '', left, right };
      }),
  );
  expect(
    plates.length,
    `no name plate appeared for ${named?.label ?? 'the hovered plot'}`,
  ).toBeGreaterThan(0);
  for (const plate of plates) {
    expect(plate.left, `${plate.label} runs off the left of the scene`).toBeGreaterThanOrEqual(
      scene.left - SLACK_PX,
    );
    expect(plate.right, `${plate.label} runs off the right of the scene`).toBeLessThanOrEqual(
      scene.right + SLACK_PX,
    );
  }

  // ...and the structure standing on each plot is actually drawn. Everything above measures
  // *buttons*; a sprite is fitted inside its plot, so a sprite squeezed to nothing leaves every
  // assertion so far untouched.
  await expectNoImagesClipped(page, '[data-testid="district-scene"]');
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

    test(`the district lays out cleanly at ${tag}`, async ({ page }) => {
      await installApi(page, me);
      await page.goto('/game/base');
      await expect(page.getByRole('heading', { name: 'The Ninth Street Crew' })).toBeVisible();

      await expectDistrictLaidOutCleanly(page);
      await expectNoDocumentOverflow(page);
      // The HUD's resource glyphs and the nav's icons, at the width that squeezes them hardest.
      // Both are fixed bars rather than scrollers, so nothing here is cut by design.
      await expectNoImagesClipped(page, 'header');
      await expectNoImagesClipped(page, 'nav');
      // Scoped to the scene: this page is a document scroller, so its own fold cuts the last row
      // of the panels below by design (the same argument `visual.spec.ts` makes for the base view).
      // The scene is `overflow-hidden` and fixed-aspect, so a cut inside it is always a real bug.
      await expectNothingClippedVertically(page, '[data-testid="district-scene"]');
      await page.screenshot({ path: `screenshots/hideout/district-${tag}.png` });
    });

    /*
     * The dialog is the fat case: the widest cost line the game has (a level-20 Garage,
     * five figures in three materials) over the longest refusal copy. Its own screenshot, because
     * a modal is drawn over the page and a `fullPage` shot of the district cannot show it.
     */
    test(`the plot dialog lays out cleanly at ${tag}`, async ({ page }) => {
      // One level below the ceiling, so the dialog quotes the level-20 price rather than level 2's.
      await installApi(page, districtAt(19));
      await page.goto('/game/base');
      await page.getByRole('button', { name: /^The Garage —/ }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('heading', { name: 'The Garage' })).toBeInViewport({
        ratio: 1,
      });
      await expect(dialog.getByRole('button', { name: 'Queue upgrade' })).toBeInViewport({
        ratio: 1,
      });
      await expectNoDocumentOverflow(page);
      await expectNothingClippedVertically(page, '[role="dialog"]');
      await page.screenshot({ path: `screenshots/hideout/dialog-${tag}.png` });
    });

    /**
     * Positive control for the assertion above.
     *
     * `expectNothingClippedVertically` walks clipping ancestors, and it was taught to stop at a
     * `position: fixed` box — which is correct (a modal is laid out against the viewport, not
     * against the scrolling page it happens to sit inside) and is also exactly the kind of change
     * that can quietly turn a gate off. So: cut the dialog for real, and check it goes red.
     */
    test(`the dialog clipping gate goes red on a real cut at ${tag}`, async ({ page }) => {
      await installApi(page, districtAt(19));
      await page.goto('/game/base');
      await page.getByRole('button', { name: /^The Garage —/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();

      // The dialog's own overflow, so the cut is one a fixed box genuinely suffers.
      await page.addStyleTag({
        content: '[role="dialog"] { max-height: 120px !important; overflow-y: hidden !important; }',
      });
      await expect(expectNothingClippedVertically(page, '[role="dialog"]')).rejects.toThrow(
        /sliced/,
      );
    });
  });
}

/**
 * The district with every plot standing — what it looks like once it has been played, and the only
 * state that shows all thirteen silhouettes at once. Screenshot-only: the geometry gates above
 * already run over the thirteen *plots*, which are in the same place whether or not they are built.
 */
test.describe('a district that has been played', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('renders every structure standing', async ({ page }) => {
    // At the ceiling, not mid-curve: this is the only fixture that lays out a two-digit name plate
    // (`Apothecary Lv 20`), which is the widest string a plate can ever hold.
    await installApi(page, districtAt(20));
    await page.goto('/game/base');

    await expectDistrictLaidOutCleanly(page);
    await expectNothingClippedVertically(page, '[data-testid="district-scene"]');
    await page.screenshot({ path: 'screenshots/hideout/district-built.png' });
  });

  /**
   * Every structure can be clicked, and clicking it selects **it**.
   *
   * This is the end-to-end half: real DOM, real stacking, real handler. It is deliberately *not*
   * the overlap gate — Playwright clicks each button at its centre, and a plot's centre stays clear
   * even when a quarter of the building around it is covered by a nearer plot's box. Run against
   * the layout this replaced, it passes. `scripts/district-layout.test.ts` is what measures that,
   * by rasterising the masters and counting painted pixels a nearer box would swallow.
   */
  test('every structure answers its own click', async ({ page }) => {
    await installApi(page, districtAt(20));
    await page.goto('/game/base');
    await settleFonts(page);

    for (const kind of BUILDING_KINDS) {
      const plot = page.locator(`[data-testid="plot-${kind}"]`);
      await plot.click({ timeout: 4000 });
      await expect(plot, `${kind} did not answer its own click`).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      // ...and it is the only one that did.
      await expect(page.locator('[data-testid^="plot-"][aria-pressed="true"]')).toHaveCount(1);
      // Selecting a plot opens its dialog over the whole scene, so it has to go before the next
      // plot can be reached — otherwise every structure after the first fails on the backdrop
      // rather than on anything about the district.
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
    }
  });

  /**
   * The positive control for {@link expectNoImagesClipped} — a guard that cannot be made to fail is
   * not a guard, and this family has a long record of looking covered and not being.
   *
   * Both halves are injected as CSS rather than by editing the component, so the control tests the
   * *gate* and leaves the shipped district exactly as the assertions above just found it. The two
   * mutations are the two ways a sprite is lost: squeezed to no height by its `flex-1` span, and
   * pushed past the scene's `overflow-hidden` edge.
   */
  test('the image gate goes red on a sprite that is not drawn whole', async ({ page }) => {
    await installApi(page, districtAt(20));
    await page.goto('/game/base');
    const scene = '[data-testid="district-scene"]';
    const rejection = async (): Promise<string> =>
      expectNoImagesClipped(page, scene).then(
        () => 'the gate passed',
        (error: Error) => error.message,
      );

    /** Install one mutation, replacing any previous one; `''` puts the district back. */
    const mutate = (css: string) =>
      page.evaluate((rule) => {
        const ID = 'mou-365-mutation';
        document.getElementById(ID)?.remove();
        if (!rule) return;
        const style = document.createElement('style');
        style.id = ID;
        style.textContent = rule;
        document.head.append(style);
      }, css);

    // Baseline: the gate is quiet on the district the assertions above just approved.
    await expectNoImagesClipped(page, scene);

    await mutate(`${scene} [data-testid^="sprite-"] { height: 0 !important; }`);
    expect(await rejection(), 'a sprite with no height must be reported').toContain('collapsed');

    // Put back, so the second mutation is measured on its own rather than on the first's wreckage.
    await mutate('');
    await expectNoImagesClipped(page, scene);

    await mutate(`${scene} > button:first-of-type { top: -12% !important; }`);
    expect(await rejection(), 'a sprite the scene cuts must be reported').toContain('sliced');
  });
});

/**
 * The whole §A1/§D3 loop through the real client: pick an empty plot, pay for it, watch the order
 * appear in the queue. The build response is what the page re-renders from, so a client that
 * dropped the body would leave the queue empty here — which no unit test mocking the hook can see.
 */
test.describe('building in the district (§A1, §D3)', () => {
  test('an empty plot becomes an order in the queue', async ({ page }) => {
    await installApi(page, me);
    // Registered after `installApi`, so Playwright's reverse-order matching gives it priority.
    await page.route('**/api/base/build', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          base: {
            ...base,
            resources: { ...base.resources, oil: base.resources.oil - 10 },
            buildQueue: [
              {
                id: 'q1',
                kind: 'quarters',
                level: 1,
                startedAt: new Date().toISOString(),
                durationSeconds: 20,
              },
            ],
          },
        }),
      }),
    );
    await page.goto('/game/base');

    const quarters = page.getByRole('button', { name: /^The Quarters —/ });
    await expect(quarters).toHaveAttribute('aria-label', /vacant plot/);
    await quarters.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Vacant plot')).toBeVisible();
    await dialog.getByRole('button', { name: 'Queue build' }).click();

    await expect(quarters).toHaveAttribute('aria-label', /under construction/);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(page.getByTestId('build-queue')).toContainText('The Quarters → Lv 1');
    await page.screenshot({ path: 'screenshots/hideout/after-build.png' });
  });

  test('a plot the Nexus is holding down says so instead of offering an upgrade', async ({
    page,
  }) => {
    await installApi(page, me);
    await page.goto('/game/base');

    await page.getByRole('button', { name: /^The Generator —/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/CAPPED BY THE NEXUS/)).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: 'Queue upgrade' })).toBeDisabled();
  });

  test('a plot the Nexus has not unlocked yet says what would unlock it', async ({ page }) => {
    await installApi(page, me);
    await page.goto('/game/base');

    await page.getByRole('button', { name: /^The Garage —/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/NEEDS THE NEXUS AT LEVEL 12/)).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: 'Queue build' })).toBeDisabled();
  });
});
