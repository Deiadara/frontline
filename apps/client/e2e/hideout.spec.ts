/**
 * MOU-167 / GDD §A1 acceptance gate: the district as a place, with zero visual bugs.
 *
 * The board's bar is "no cut text or images, no overflow, no overlapping elements, at every
 * supported viewport". The plots are outlines traced on the painted plate in *percentages* of a
 * scene box, so the failure mode is not one bad viewport — it is a nudged vertex that lands wrong at
 * every viewport at once, or a name plate whose text is wider than the scene that clips it.
 * `plots.test.ts` pins the tracing as plane geometry; this pins what the browser actually laid out
 * and actually hit-tests, which is the only place font metrics, borders and compositing exist.
 *
 * Screenshots land in `screenshots/hideout/` so the board can open the whole matrix at once.
 */
import { BUILDING_KINDS, findAssetSpec, type Building } from '@frontline/shared';
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
    damage: 0,
    garrisons: 0,
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

/** Every plot outline on the plate. */
const PLOTS = '[data-testid="district-plots"] polygon';

/**
 * Wait for the scene to be the shape of the plate before measuring anything on it.
 *
 * The scene sizes itself from a measurement of the room the chrome leaves, and the chrome measures
 * *itself* — so there is a window, one or two frames wide, in which the district is laid out
 * against sizes that have not settled. Anything read inside that window is a reading of a page the
 * player never sees, and it flaps: the same assertion passed and failed in the same run.
 */
async function settleDistrict(page: Page): Promise<void> {
  await settleFonts(page);
  const spec = findAssetSpec('plate-district');
  const aspect = (spec?.width ?? 16) / (spec?.height ?? 9);
  await page.waitForFunction(
    (want) => {
      const scene = document.querySelector('[data-testid="district-scene"]');
      if (!scene) return false;
      const box = scene.getBoundingClientRect();
      return box.height > 0 && Math.abs(box.width / box.height - want) < 0.02;
    },
    aspect,
    { timeout: 5000 },
  );
}

/**
 * Every plot is laid out inside the scene — measured from the DOM, after the display font has
 * swapped in.
 *
 * Overlap is not measured here any more, and deliberately: the plots are polygons now, the browser
 * hit-tests the outline rather than a box around it, and `plots.test.ts` proves the twelve outlines
 * are disjoint as plane geometry. What a DOM sweep could still measure is their *bounding boxes*,
 * which legitimately touch — the Nexus tower's box clips the corner of the Garage's without either
 * shape reaching the other — so a bounding-box gate here would report the painting as a defect.
 * What replaced it is the ownership hit test below, which asks the browser the real question.
 *
 * Name plates are checked separately from the outlines on purpose: a plate is `nowrap` text on its
 * building's base line, so it is the one element that can grow *wider than the room it was placed
 * in* when the font lands, and it would then be silently cut by the scene's `overflow-hidden`
 * rather than pushing the document out. Plates render on hover and focus for a structure that is
 * simply standing, so this measures the one the pointer is on.
 */
async function expectDistrictLaidOutCleanly(page: Page): Promise<void> {
  await settleDistrict(page);
  const [scene] = await boxes(page, '[data-testid="district-scene"]');
  expect(scene, 'the district scene must be rendered').toBeDefined();
  if (!scene) return;

  // The scene is the plate's shape, or the painting inside it is cropped.
  //
  // First, because everything below is measured *against* this box and would happily agree with a
  // box of the wrong shape. That is not hypothetical: a `max-height` clamp once left this 1368×525
  // where the plate is 16:9, `object-cover` cropped a third of the picture away, and every
  // assertion in this file stayed green — the outlines were laid out correctly in the box, and the
  // box was no longer the picture.
  const spec = findAssetSpec('plate-district');
  expect(spec, 'the district plate must be in the manifest').toBeDefined();
  expect(
    (scene.right - scene.left) / (scene.bottom - scene.top),
    'the scene is not the shape of the plate, so the painting in it is cropped',
  ).toBeCloseTo((spec?.width ?? 1) / (spec?.height ?? 1), 1);

  const plots = await boxes(page, PLOTS);
  expect(plots, 'every structure in the catalogue has an outline').toHaveLength(
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

  // The plate a player can actually see: pointing at one building reveals its name, and that is the
  // element that can outgrow the room it was placed in once the display font lands.
  const middle = Math.floor(plots.length / 2);
  const named = plots[middle];
  await page.locator(PLOTS).nth(middle).hover();
  await settleFonts(page);

  // Read by *computed* opacity, not by class: the hidden state keeps its `opacity-0` class and the
  // hovered one overrides it, so a class selector would find every plate hidden.
  const plates = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-testid^="nameplate-"]')]
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

  // ...and the painting the outlines are traced on is actually drawn, whole. Everything above
  // measures the overlay, which would lay out identically over a plate that never loaded.
  await expectNoImagesClipped(page, '[data-testid="district-frame"]');
}

/**
 * Does the building under the pointer answer for itself?
 *
 * The one question the whole tracing exists to get right, asked the way the browser answers it:
 * sample points spread across each outline's own **interior** and call `elementFromPoint` at each.
 *
 * Sampled toward the vertices rather than only at the centre, because a centre stays clear under
 * almost any mistake — that is how the rectangular layout this replaced passed a click test while a
 * quarter of the Greenhouse answered for the Nexus. But the samples stop short of the boundary, at
 * `INTERIOR_REACH` of the way out, and that bound is doing real work now that the district is full
 * bleed: the painting runs under the floating HUD and the scenery switcher, so the extreme top and
 * bottom rows of pixels legitimately belong to a bar. What must hold is that every building has a
 * **usable interior** — a player who aims at the building hits the building.
 */
async function expectEveryBuildingOwnsItsOwnEdges(page: Page): Promise<void> {
  await settleDistrict(page);
  const stolen = await page.evaluate((selector) => {
    /** How far from the centre toward each vertex the interior is sampled. */
    const INTERIOR_REACH = 0.72;
    const wrong: string[] = [];
    for (const plot of document.querySelectorAll<SVGPolygonElement>(selector)) {
      const mine = plot.getAttribute('data-testid') ?? '?';
      const screen = plot.getScreenCTM();
      if (!screen) continue;
      const at = (point: DOMPoint): { x: number; y: number } => ({
        x: point.x * screen.a + point.y * screen.c + screen.e,
        y: point.x * screen.b + point.y * screen.d + screen.f,
      });
      const corners = [...plot.points].map(at);
      const centre = {
        x: corners.reduce((total, p) => total + p.x, 0) / corners.length,
        y: corners.reduce((total, p) => total + p.y, 0) / corners.length,
      };
      for (const point of [
        centre,
        ...corners.map((corner) => ({
          x: centre.x + (corner.x - centre.x) * INTERIOR_REACH,
          y: centre.y + (corner.y - centre.y) * INTERIOR_REACH,
        })),
      ]) {
        const found = document.elementFromPoint(point.x, point.y);
        const owner =
          found?.getAttribute('data-testid') ??
          found?.closest('[data-testid]')?.getAttribute('data-testid') ??
          found?.tagName ??
          'nothing';
        if (owner !== mine) wrong.push(`${mine} answers as ${owner}`);
      }
    }
    return wrong.slice(0, 8);
  }, PLOTS);
  expect(stolen, `outlines answering for the wrong building: ${stolen.join(' | ')}`).toEqual([]);
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
      await expectNothingClippedVertically(page, '[data-testid="district-frame"]');
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
      await page.getByRole('button', { name: /^The Garage,/ }).click();

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
      await page.getByRole('button', { name: /^The Garage,/ }).click();
      await expect(page.getByRole('dialog')).toBeVisible();

      // The dialog's own overflow, so the cut is one a fixed box genuinely suffers.
      //
      // 260px, not 120: the height has to leave the body **partially** visible, because a cut is
      // what this gate reports and a row squeezed to nothing is hidden rather than sliced. At 120px
      // the header and footer alone fill the box, the body collapses to zero, and the gate is
      // correctly quiet — which reads exactly like a gate that has stopped working.
      await page.addStyleTag({
        content: '[role="dialog"] { max-height: 260px !important; overflow-y: hidden !important; }',
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
    await expectNothingClippedVertically(page, '[data-testid="district-frame"]');
    await page.screenshot({ path: 'screenshots/hideout/district-built.png' });
  });

  /**
   * Every structure can be clicked, and clicking it selects **it**.
   *
   * This is the end-to-end half: real DOM, real stacking, real handler. Playwright clicks each
   * outline at the centre of its bounding box, which is the *easy* point — it stays clear under
   * almost any tracing mistake — so the edges are checked separately, right after, by
   * {@link expectEveryBuildingOwnsItsOwnEdges}.
   */
  test('every structure answers its own click', async ({ page }) => {
    await installApi(page, districtAt(20));
    await page.goto('/game/base');
    await settleFonts(page);

    await expectEveryBuildingOwnsItsOwnEdges(page);

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
   * The positive control for the ownership gate above.
   *
   * A hit test that cannot go red is not a hit test, and this one is easy to write in a way that
   * quietly passes — `elementFromPoint` returning `null`, or the whole overlay sitting behind
   * something inert, both read as "nothing stolen". So: put a transparent sheet over the district,
   * the exact failure a stray full-frame overlay would cause, and check the gate says so.
   */
  test('the ownership gate goes red when something covers the district', async ({ page }) => {
    await installApi(page, districtAt(20));
    await page.goto('/game/base');
    await settleFonts(page);
    await expectEveryBuildingOwnsItsOwnEdges(page);

    await page.evaluate(() => {
      const thief = document.createElement('div');
      thief.dataset.testid = 'thief';
      thief.style.cssText = 'position:fixed;inset:0;z-index:9999;background:transparent';
      document.body.append(thief);
    });
    await expect(expectEveryBuildingOwnsItsOwnEdges(page)).rejects.toThrow(/answers as thief/);
  });

  /**
   * Pointing at a building lights **that** building, and nothing else.
   *
   * The wash is painted inside the outline, so the failure this catches is a hover that leaks: one
   * `pointed` state shared across the district would light all twelve, and a `group-hover` left over
   * from the pasted-sprite layout would light none.
   */
  test('lights the building under the pointer, and only that one', async ({ page }) => {
    await installApi(page, districtAt(20));
    await page.goto('/game/base');
    await settleFonts(page);

    const resting = await page.locator('[data-testid="plot-nexus"]').evaluate((el) => ({
      fill: getComputedStyle(el).fill,
      stroke: getComputedStyle(el).strokeWidth,
    }));

    await page.locator('[data-testid="plot-nexus"]').hover();
    const lit = await page.locator('[data-testid="plot-nexus"]').evaluate((el) => ({
      fill: getComputedStyle(el).fill,
      stroke: getComputedStyle(el).strokeWidth,
    }));
    expect(lit, 'the pointed building did not light up').not.toEqual(resting);

    // The name plate comes with it, and it is the one for this building.
    await expect(page.getByTestId('nameplate-nexus')).toHaveCSS('opacity', '1');
    // ...while a neighbour that is simply standing stays dark. Read on the Gauntlet rather than the
    // Quarters: this fixture has the Quarters in the build queue, and a plot being worked on carries
    // a permanent plate by design, so asserting on it would have passed whatever hover did.
    await expect(page.getByTestId('nameplate-gauntlet')).toHaveCSS('opacity', '0');
  });

  /**
   * The positive control for {@link expectNoImagesClipped} — a guard that cannot be made to fail is
   * not a guard, and this family has a long record of looking covered and not being.
   *
   * Both halves are injected as CSS rather than by editing the component, so the control tests the
   * *gate* and leaves the shipped district exactly as the assertions above just found it. The two
   * mutations are the two ways the painting is lost: squeezed to no height, and pushed off the box
   * it was fitted to.
   */
  test('the image gate goes red on a plate that is not drawn whole', async ({ page }) => {
    await installApi(page, districtAt(20));
    await page.goto('/game/base');
    // Scoped to the frame, which is the element with `overflow-hidden` on it. `visibleBand` walks
    // clipping ancestors and stops *at* the scope, so scoping to the scene inside it made the gate
    // structurally unable to see a cut — it reported a deliberately sliced sprite as fine.
    const frame = '[data-testid="district-frame"]';
    const scene = '[data-testid="district-scene"]';
    const rejection = async (): Promise<string> =>
      expectNoImagesClipped(page, frame).then(
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
    await expectNoImagesClipped(page, frame);

    await mutate(`${scene} [data-testid="district-plate"] { height: 0 !important; }`);
    expect(await rejection(), 'a plate with no height must be reported').toContain('collapsed');

    // Put back, so the second mutation is measured on its own rather than on the first's wreckage.
    await mutate('');
    await expectNoImagesClipped(page, frame);

    // Pushed off its box, which on a plate fitted exactly to the scene is how it leaves the frame.
    await mutate(`${scene} [data-testid="district-plate"] { margin-top: -12% !important; }`);
    expect(await rejection(), 'a plate pushed out of the scene must be reported').toContain(
      'spills',
    );
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

    const quarters = page.getByRole('button', { name: /^The Quarters,/ });
    await expect(quarters).toHaveAttribute('aria-label', /vacant plot/);
    await quarters.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Vacant plot')).toBeVisible();
    await dialog.getByRole('button', { name: 'Queue build' }).click();

    await expect(quarters).toHaveAttribute('aria-label', /under construction/);
    await dialog.getByRole('button', { name: 'Close' }).click();
    // The queue is a report on the district rather than part of it, so it lives in the drawer.
    await page.getByTestId('reports-toggle').click();
    await expect(page.getByTestId('build-queue')).toContainText('The Quarters → Lv 1');
    await page.screenshot({ path: 'screenshots/hideout/after-build.png' });
  });

  test('a plot the Nexus is holding down says so instead of offering an upgrade', async ({
    page,
  }) => {
    await installApi(page, me);
    await page.goto('/game/base');

    await page.getByRole('button', { name: /^The Generator,/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/CAPPED BY THE NEXUS/)).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: 'Queue upgrade' })).toBeDisabled();
  });

  test('a plot the Nexus has not unlocked yet says what would unlock it', async ({ page }) => {
    await installApi(page, me);
    await page.goto('/game/base');

    await page.getByRole('button', { name: /^The Garage,/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(/NEEDS THE NEXUS AT LEVEL 12/)).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: 'Queue build' })).toBeDisabled();
  });
});
