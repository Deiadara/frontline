/**
 * MOU-167 / GDD §A1 acceptance gate: the district as a place, with zero visual bugs.
 *
 * The board's bar is "no cut text or images, no overflow, no overlapping elements, at every
 * supported viewport". The plots are outlines traced on the painted plate in *percentages* of a
 * scene box, so the failure mode is not one bad viewport. It is a nudged vertex that lands wrong at
 * every viewport at once, or a name plate whose text is wider than the scene that clips it.
 * `plots.test.ts` pins the tracing as plane geometry; this pins what the browser actually laid out
 * and actually hit-tests, which is the only place font metrics, borders and compositing exist.
 *
 * Screenshots land in `screenshots/hideout/` so the board can open the whole matrix at once.
 */
import {
  levelCapForNexus,
  BUILDING_CATALOG,
  BUILDING_KINDS,
  describeBuildingRequirement,
  findAssetSpec,
  type Building,
} from '@frontline/shared';
import { expect, test, type Page } from '@playwright/test';
import { MAX_SQUASH } from '../src/features/base/plots';
import { base, lateGame, lateGameBase, me } from './fixtures';
import {
  expectNoImagesClipped,
  expectNothingClippedVertically,
  expectNothingOverflowsTheScreen,
  installApi,
  settleFonts,
} from './harness';

/**
 * A hideout with every plot standing at `level`, over `lateGame`'s late-game stockpile.
 *
 * Both fat cases only exist at the top of the curve: the widest name plate the catalogue can
 * produce is `Apothecary Lv 20`, two digits under the longest short name, and the widest cost
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
  }));
  // The crew's level as well as the district's (§I3): half the ladder is gated on it, so a
  // fixture that maxed the buildings and left the crew at 1 would draw a district full of locks.
  return { ...lateGame, base: { ...lateGameBase, level, buildings } };
}

/**
 * A district as a new crew actually has it: the two structures `POST /overseer` mints, crew level 1.
 *
 * The fixture the *lock* cases need. `districtAt(1)` builds every plot at level 1, which unlocks
 * nothing: it stands everything, and a standing structure is never locked.
 */
function freshDistrict(): typeof lateGame {
  const buildings: Building[] = [
    { id: 'b1', kind: 'nexus', level: 1, modifications: [], damage: 0 },
    { id: 'b2', kind: 'generator', level: 1, modifications: [], damage: 0 },
  ];
  return { ...lateGame, base: { ...lateGameBase, level: 1, buildings, buildQueue: [] } };
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

/** Every structure's name plate: the control the district is played through (§A1). */
const PLOTS = '[data-testid="district-plots"] [data-testid^="plot-"]';

/**
 * Wait for the scene to be the shape of the plate before measuring anything on it.
 *
 * The scene sizes itself from a measurement of the room the chrome leaves, and the chrome measures
 * *itself*, so there is a window, one or two frames wide, in which the district is laid out
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
      if (box.height <= 0) return false;
      const ratio = box.width / box.height;
      return ratio >= want.min && ratio <= want.max;
    },
    { min: aspect - 0.02, max: aspect / (1 - MAX_SQUASH) + 0.02 },
    { timeout: 5000 },
  );
}

/**
 * Every plot is laid out inside the scene: measured from the DOM, after the display font has
 * swapped in.
 *
 * Overlap is not measured here any more, and deliberately: the plots are polygons now, the browser
 * hit-tests the outline rather than a box around it, and `plots.test.ts` proves the twelve outlines
 * are disjoint as plane geometry. What a DOM sweep could still measure is their *bounding boxes*,
 * which legitimately touch: the Nexus tower's box clips the corner of the Garage's without either
 * shape reaching the other, so a bounding-box gate here would report the painting as a defect.
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
  // assertion in this file stayed green: the outlines were laid out correctly in the box, and the
  // box was no longer the picture.
  const spec = findAssetSpec('plate-district');
  expect(spec, 'the district plate must be in the manifest').toBeDefined();
  const plateAspect = (spec?.width ?? 1) / (spec?.height ?? 1);
  const sceneAspect = (scene.right - scene.left) / (scene.bottom - scene.top);
  // Wider than the plate, never taller, and never wider than the step back can pay for.
  //
  // The box is not the plate's exact shape any more. Between the stockpile and the scenery
  // switcher there is less height than the plate was painted at, and the shortfall used to come
  // entirely off the top of the picture, which is where the tallest buildings are. The scene now
  // compresses by up to `MAX_SQUASH` to bring them back into view. Taller than the plate is still
  // the failure this checks for, and it is the one that means the width was given up and the
  // painting is being cropped at the sides.
  expect(
    sceneAspect,
    'the scene is taller than the plate, so the painting in it is cropped sideways',
  ).toBeGreaterThanOrEqual(plateAspect - 0.01);
  expect(
    sceneAspect,
    'the scene is squashed further than the step back allows',
  ).toBeLessThanOrEqual(plateAspect / (1 - MAX_SQUASH) + 0.01);

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

  // Every plate is permanent now, so there is nothing to hover first, and the whole set is
  // measured rather than whichever one a hover happened to reveal. The failure this catches is a
  // plate whose text outgrows the room it was placed in once the display font lands, which happens
  // to the widest name (`Apothecary Lv 20`) at the narrowest viewport.
  const plates = await page.evaluate(
    (selector) =>
      [...document.querySelectorAll<HTMLElement>(selector)].map((el) => {
        const { left, right } = el.getBoundingClientRect();
        return { label: el.textContent?.trim() ?? '', left, right };
      }),
    PLOTS,
  );
  expect(plates.length, 'no name plates were drawn at all').toBe(BUILDING_KINDS.length);
  for (const plate of plates) {
    expect(plate.left, `${plate.label} runs off the left of the scene`).toBeGreaterThanOrEqual(
      scene.left - SLACK_PX,
    );
    expect(plate.right, `${plate.label} runs off the right of the scene`).toBeLessThanOrEqual(
      scene.right + SLACK_PX,
    );
  }

  /*
   * ...and the painting the outlines are traced on is actually drawn, and drawn edge to edge.
   * Everything above measures the overlay, which would lay out identically over a plate that never
   * loaded.
   *
   * Not "drawn whole": the plate is deliberately taller than the room the bars leave, and its own
   * empty top and bottom margins pass under them. What has to hold is the pair of properties that
   * bleed is *for*: real pixels arrived, and the picture reaches both sides of the frame with no
   * slab of page background down either edge, which is the defect this replaced.
   */
  const painting = await page.evaluate(() => {
    const frame = document.querySelector('[data-testid="district-frame"]');
    const img = document.querySelector<HTMLImageElement>('[data-testid="district-plate"]');
    if (!frame || !img) return null;
    const outer = frame.getBoundingClientRect();
    const inner = img.getBoundingClientRect();
    return {
      loaded: img.complete && img.naturalWidth > 0,
      left: inner.left - outer.left,
      right: outer.right - inner.right,
      width: inner.width,
    };
  });
  expect(painting, 'the district plate must be in the frame').not.toBeNull();
  expect(painting?.loaded, 'the district plate did not load').toBe(true);
  expect(painting?.left ?? 99, 'bare ground down the left of the district').toBeLessThanOrEqual(1);
  expect(painting?.right ?? 99, 'bare ground down the right of the district').toBeLessThanOrEqual(
    1,
  );
}

/**
 * Can a player actually click every building?
 *
 * The district is played through a **name plate under each building** now (§A1), not through a
 * traced outline over it, so this is the question the old outline-ownership gate was asking in a
 * form that matches the control that exists: for each plate, sample the four corners and the centre
 * of its own box and ask the browser what is there.
 *
 * The outlines have not gone anywhere: they still decide where each plate hangs and what the
 * dialog's portrait is cut from, but nothing hit-tests them any more, so a gate that walked their
 * interiors would be measuring a layer no player can reach.
 *
 * What this catches, and caught the day it was written: a plate covered by something else. The
 * in-flight rail sat on the Scrapyard's plate, visible, named, and impossible to click, which is
 * exactly the failure mode the outline gate existed to prevent, arriving through the new control.
 */
async function expectEveryBuildingIsReachable(page: Page): Promise<void> {
  await settleDistrict(page);
  const stolen = await page.evaluate((selector) => {
    /** How far in from each corner to sample, so a 1px rounding is not a failure. */
    const INSET = 3;
    const wrong: string[] = [];
    for (const plate of document.querySelectorAll<HTMLElement>(selector)) {
      const mine = plate.getAttribute('data-testid') ?? '?';
      const box = plate.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) {
        wrong.push(`${mine} has no box at all`);
        continue;
      }
      const points = [
        { x: box.left + box.width / 2, y: box.top + box.height / 2 },
        { x: box.left + INSET, y: box.top + INSET },
        { x: box.right - INSET, y: box.top + INSET },
        { x: box.left + INSET, y: box.bottom - INSET },
        { x: box.right - INSET, y: box.bottom - INSET },
      ];
      for (const point of points) {
        const found = document.elementFromPoint(point.x, point.y);
        // `closest` walks up to the plate itself: the text inside a plate is the plate.
        const owner =
          found?.closest('[data-testid]')?.getAttribute('data-testid') ??
          found?.tagName ??
          'nothing';
        if (owner !== mine) wrong.push(`${mine} answers as ${owner}`);
      }
    }
    return wrong.slice(0, 8);
  }, PLOTS);
  expect(stolen, `plates a player cannot click: ${stolen.join(' | ')}`).toEqual([]);
}

/** Every structure in the catalogue has a plate, and no two plates overlap each other. */
async function expectPlatesDoNotCollide(page: Page): Promise<void> {
  await settleDistrict(page);
  const overlaps = await page.evaluate((selector) => {
    const plates = [...document.querySelectorAll<HTMLElement>(selector)].map((plate) => ({
      id: plate.getAttribute('data-testid') ?? '?',
      box: plate.getBoundingClientRect(),
    }));
    const bad: string[] = [];
    for (let i = 0; i < plates.length; i += 1) {
      for (let j = i + 1; j < plates.length; j += 1) {
        const a = plates[i]!.box;
        const b = plates[j]!.box;
        const hit = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        if (hit) bad.push(`${plates[i]!.id} overlaps ${plates[j]!.id}`);
      }
    }
    return bad.slice(0, 6);
  }, PLOTS);
  expect(overlaps, `name plates on top of each other: ${overlaps.join(' | ')}`).toEqual([]);
}

for (const size of VIEWPORTS) {
  const tag = `${size.width}x${size.height}`;

  test.describe(`hideout ${tag}`, () => {
    test.use({ viewport: size });

    test(`the district lays out cleanly at ${tag}`, async ({ page }) => {
      await installApi(page, me);
      await page.goto('/game/base');
      await expect(page.getByTestId('district-plaque')).toContainText('The Ninth Street Crew');

      await expectDistrictLaidOutCleanly(page);
      await expectNothingOverflowsTheScreen(page);
      // The HUD's resource glyphs and the nav's icons, at the width that squeezes them hardest.
      // Both are fixed bars rather than scrollers, so nothing here is cut by design.
      //
      // Not the scene. The plate is deliberately full-bleed: it takes the whole width of the frame
      // and lets its own empty top and bottom margins pass under the floating bars, which is what
      // "the district *is* the screen" means and what `plateTop` then keeps every control clear of.
      // Sweeping it here would report the art direction as a defect.
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
      await expectNothingOverflowsTheScreen(page);
      await expectNothingClippedVertically(page, '[role="dialog"]');
      await page.screenshot({ path: `screenshots/hideout/dialog-${tag}.png` });
    });

    /**
     * Positive control for the assertion above.
     *
     * `expectNothingClippedVertically` walks clipping ancestors, and it was taught to stop at a
     * `position: fixed` box, which is correct (a modal is laid out against the viewport, not
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
      // The height has to leave the body **partially** visible, because a cut is what this gate
      // reports and a row squeezed to nothing is hidden rather than sliced. Too small and the
      // header and footer alone fill the box, the body collapses to zero, and the gate is
      // correctly quiet, which reads exactly like a gate that has stopped working. This was 260px
      // when the header carried a 128px portrait of the building; without it the whole dialog fits
      // inside that and nothing is cut, so the clamp follows the header down.
      await page.addStyleTag({
        content: '[role="dialog"] { max-height: 200px !important; overflow-y: hidden !important; }',
      });
      await expect(expectNothingClippedVertically(page, '[role="dialog"]')).rejects.toThrow(
        /sliced/,
      );
    });
  });
}

/**
 * The district with every plot standing: what it looks like once it has been played, and the only
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
   * plate at the centre of its box, which is the *easy* point, so the corners are checked
   * separately, right after, by {@link expectEveryBuildingIsReachable}.
   */
  test('every structure answers its own click', async ({ page }) => {
    await installApi(page, districtAt(20));
    await page.goto('/game/base');
    await settleFonts(page);

    await expectEveryBuildingIsReachable(page);

    for (const kind of BUILDING_KINDS) {
      const plot = page.locator(`[data-testid="plot-${kind}"]`);
      await plot.click({ timeout: 4000 });
      // The dialog it opened is *that* structure's, which is the whole claim: a plate that opened
      // its neighbour's window would be indistinguishable from one that worked.
      const dialog = page.getByRole('dialog');
      await expect(dialog, `${kind} did not answer its own click`).toBeVisible();
      await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(
        BUILDING_CATALOG[kind].name,
      );
      // The dialog covers the whole scene, so it has to go before the next plate can be reached.
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    }
  });

  /**
   * The positive control for the ownership gate above.
   *
   * A hit test that cannot go red is not a hit test, and this one is easy to write in a way that
   * quietly passes: `elementFromPoint` returning `null`, or the whole overlay sitting behind
   * something inert, both read as "nothing stolen". So: put a transparent sheet over the district,
   * the exact failure a stray full-frame overlay would cause, and check the gate says so.
   */
  test('the ownership gate goes red when something covers the district', async ({ page }) => {
    await installApi(page, districtAt(20));
    await page.goto('/game/base');
    await settleFonts(page);
    await expectEveryBuildingIsReachable(page);

    await page.evaluate(() => {
      const thief = document.createElement('div');
      thief.dataset.testid = 'thief';
      thief.style.cssText = 'position:fixed;inset:0;z-index:9999;background:transparent';
      document.body.append(thief);
    });
    await expect(expectEveryBuildingIsReachable(page)).rejects.toThrow(/answers as thief/);
  });

  /**
   * Pointing at a plate drops a note out of it saying how to unlock the building (§I3).
   *
   * The one behaviour that replaced the lit-up outline, and a better one: a wash over a painting
   * told a player *that* something was there, and this tells them what to do about it. Measured on
   * a locked structure, because that is the case the note exists for, and on a district a fresh
   * crew actually has, so the clauses in it are the ones a new player meets.
   */
  test('a locked plate says what would unlock it, on hover', async ({ page }) => {
    await installApi(page, freshDistrict());
    await page.goto('/game/base');
    await settleFonts(page);

    const garage = page.getByTestId('plot-garage');
    await expect(garage).toBeVisible();
    await garage.hover();

    const note = page.getByText('Not yet. You need:');
    await expect(note).toBeVisible();
    // Every clause, not the first rung: the Nexus level, the structures and the crew's own level.
    for (const clause of BUILDING_CATALOG.garage.requires) {
      await expect(
        page.getByText(describeBuildingRequirement(clause), { exact: true }),
      ).toBeVisible();
    }
  });

  /** And a plate that is *not* locked says what the building does instead: never nothing. */
  test('an unlocked plate explains the building rather than the lock', async ({ page }) => {
    await installApi(page, districtAt(20));
    await page.goto('/game/base');
    await settleFonts(page);

    await page.getByTestId('plot-nexus').hover();
    await expect(page.getByText(BUILDING_CATALOG.nexus.role)).toBeVisible();
    await expect(page.getByText('Not yet. You need:')).toHaveCount(0);
  });

  /** Twelve plates, none on top of another: the layout claim the outlines used to make. */
  test('gives every structure its own plate, and none of them collide', async ({ page }) => {
    await installApi(page, districtAt(20));
    await page.goto('/game/base');
    await settleFonts(page);

    for (const kind of BUILDING_KINDS) {
      await expect(page.getByTestId(`plot-${kind}`)).toBeVisible();
    }
    await expectPlatesDoNotCollide(page);
  });

  /**
   * The positive control for {@link expectNoImagesClipped}: a guard that cannot be made to fail is
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
    /*
     * Waited for before anything is measured.
     *
     * Everything below goes through `expectNoImagesClipped`, which is a raw `page.evaluate` and
     * therefore does not auto-wait: with no wait here the baseline runs against a shell that has
     * not painted the scene yet and throws "no element matched" instead of measuring anything.
     * Latent since the test was written; it only started losing when the shell began prefetching
     * the other screens on mount and gave the first paint more to do.
     */
    await expect(page.getByTestId('district-scene')).toBeVisible();
    /*
     * Scoped to the **scene**, not to the frame around it.
     *
     * `visibleBand` walks clipping ancestors and stops at the scope, and the frame is the element
     * with `overflow-hidden` on it: the plate takes the full width of the frame and lets its own
     * empty top and bottom margins pass under the floating bars, so a sweep that walked as far as
     * the frame would find the shipped district permanently "sliced" and the control would have no
     * baseline to start from. Inside the scene the plate is `inset-0` and fills it exactly, which
     * is the invariant worth a control: both mutations below break it, and neither of them is the
     * bleed.
     */
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

    await mutate(`${scene} [data-testid="district-plate"] { height: 0 !important; }`);
    expect(await rejection(), 'a plate with no height must be reported').toContain('collapsed');

    // Put back, so the second mutation is measured on its own rather than on the first's wreckage.
    await mutate('');
    await expectNoImagesClipped(page, scene);

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
 * dropped the body would leave the queue empty here, which no unit test mocking the hook can see.
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

  /**
   * §B1: a plot standing on its Nexus ceiling says so instead of offering an upgrade.
   *
   * The state is built here rather than taken from the shared fixture, because the ceiling stopped
   * being "whatever the Nexus is at". `NEXUS_LADDERS` gives every structure its own asymmetric
   * rungs, so a Generator at 1 under a Nexus at 1 is no longer capped: it may reach 3 before the
   * Nexus has to move. Pinning the test to the fixture's own levels meant it silently stopped
   * testing a ceiling the moment the ladder was authored.
   *
   * Read off the ladder rather than hard-coded, so a retune moves the fixture with it and this
   * keeps testing the sentence it is named for.
   */
  test('a plot the Nexus is holding down says so instead of offering an upgrade', async ({
    page,
  }) => {
    const nexusLevel = 1;
    const capped = levelCapForNexus('generator', nexusLevel);
    expect(capped, 'the Generator must be reachable at all under a level-1 Nexus').toBeGreaterThan(
      0,
    );

    await installApi(page, {
      ...me,
      base: {
        ...me.base!,
        buildings: me.base!.buildings.map((building) =>
          building.kind === 'generator' ? { ...building, level: capped } : building,
        ),
      },
    });
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
    await expect(dialog.getByText(/NEEDS THE NEXUS AT 12/)).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: 'Queue build' })).toBeDisabled();
  });
});
