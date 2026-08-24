/**
 * The zoom floor must never uncover the frame: ADR 0001 §5.1, as amended by §8.1.
 *
 * `CityMap` builds the world at frame size (`worldWidth: width, worldHeight: height`), so the
 * invariant that keeps the map full-bleed is `ZOOM_MIN * world >= screen`. Below it the world no
 * longer covers the viewport, `clamp({ direction: 'all' })` centres the shortfall, and the frame
 * edges show bare page ground.
 *
 * Nothing in the suite could see that bug class. `expectCanvasFillsFrame` (`visual.spec.ts`)
 * compares the *DOM* canvas element to its parent, which stays exact whatever the camera is doing,
 * and no other spec touches the wheel, so lowering the floor back to 0.6 left every gate green.
 *
 * This measures the painted pixels instead of the constant, deliberately: it fails for any reason
 * the world stops covering the frame (a lowered floor, a world built smaller than the frame, a
 * clamp that stops clamping), not only for an edit to `ZOOM_MIN`.
 *
 * ## How the uncovered ground is made visible
 *
 * Pixi runs with `backgroundAlpha: 0`, so anywhere the world does not reach, the canvas is
 * genuinely transparent and the page shows through. The test gives the canvas its own loud
 * background, so "transparent" becomes a colour a pixel count can find.
 *
 * The probe is matched by **hue, not brightness**, and that is the whole difficulty. The vignette
 * is a screen-space `multiply` that covers the frame including the uncovered ground, so at the
 * corners, exactly where the gap opens first, it crushes the probe to about 15% of its value
 * (measured: `#ff00ff` reads back as `37,0,37`). A plain "is it bright magenta" test therefore
 * counts zero pixels and passes over the very defect it was written for. Multiply scales all three
 * channels by the same factor, so the *ratio* survives what the brightness does not: the probe
 * stays `(k, 0, k)` at any darkness, while the city's own paint is blue-neutral and the one magenta
 * in the palette (`sear.300 #e11d8f`, the bot-threat code) has `r - b` of 82 and never matches.
 *
 * The PNG is decoded by the browser rather than by a Node image library: `sharp` belongs to
 * `@frontline/scripts`, and a native 30MB dependency is a steep price for one pixel count when the
 * page already has a decoder and a 2D context.
 */
import { expect, test, type Page } from '@playwright/test';
import { me } from './fixtures';
import { installApi } from './harness';

/** Loud enough that nothing the palette paints can be mistaken for it (no ramp goes near it). */
const PROBE_COLOR = '#ff00ff';

/**
 * Rounding at the canvas' own edges can leave a hairline of probe colour that no player can see.
 * The failure this guards against is nothing like that small: at a 0.6 floor the world covers 36%
 * of the frame and the gutters are the other 64%.
 */
const MAX_UNCOVERED_FRACTION = 0.002;

/** Enough steps to reach either stop from the default camera, whatever the per-notch factor is. */
const WHEEL_STEPS = 24;
const WHEEL_DELTA = 400;

interface Coverage {
  uncovered: number;
  total: number;
  /** Where the probe colour showed, in canvas pixels: the shape of the gap, for the failure text. */
  bounds: { left: number; top: number; right: number; bottom: number } | null;
}

/**
 * Wheels the camera all the way to one stop and waits for the smoothing to settle.
 *
 * `wheel({ smooth: 5 })` spreads every notch over five ticks and `decelerate` keeps the camera
 * moving after the drag, so a measurement taken on the last wheel event reads a camera still in
 * flight, which is a false *pass* as often as a false failure.
 */
async function wheelToStop(page: Page, deltaY: number): Promise<void> {
  const box = await page.locator('canvas').boundingBox();
  if (!box) throw new Error('canvas has no box to wheel over');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let step = 0; step < WHEEL_STEPS; step += 1) {
    await page.mouse.wheel(0, deltaY);
  }
  await page.waitForTimeout(600);
}

/** How much of the canvas is showing its own background rather than painted world. */
async function measureCoverage(page: Page): Promise<Coverage> {
  const shot = (await page.locator('canvas').screenshot()).toString('base64');
  return page.evaluate<Coverage, string>(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();

    const scratch = document.createElement('canvas');
    scratch.width = image.width;
    scratch.height = image.height;
    const ctx = scratch.getContext('2d');
    if (!ctx) throw new Error('no 2d context to decode the screenshot into');
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, scratch.width, scratch.height);

    /**
     * Probe hue, at any brightness the vignette leaves it: red and blue equal and non-trivial,
     * green an order of magnitude below them.
     *
     * The floor is 24 rather than 8. At 8 this matched `rgb(10,2,12)`: the outermost pixel of a
     * district marker's magenta glow, faded by the vignette to something a player cannot tell from
     * black, and reported it as bare ground. Uncovered `#ff00ff` never arrives that dark: even
     * under the darkest corner of the vignette it lands well above 24, which the control below
     * measures rather than assumes.
     */
    const isProbe = (r: number, g: number, b: number): boolean =>
      r > 24 && b > 24 && Math.abs(r - b) <= 8 && g * 4 < r;

    let uncovered = 0;
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (let i = 0; i < data.length; i += 4) {
      if (isProbe(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0)) {
        uncovered += 1;
        const pixel = i / 4;
        const x = pixel % scratch.width;
        const y = Math.floor(pixel / scratch.width);
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
    return {
      uncovered,
      total: scratch.width * scratch.height,
      bounds: uncovered === 0 ? null : { left, top, right, bottom },
    };
  }, shot);
}

async function expectWorldCoversFrame(page: Page, atStop: string): Promise<void> {
  const { uncovered, total, bounds } = await measureCoverage(page);
  const fraction = uncovered / total;
  const where = bounds
    ? `: bare ground spans x ${bounds.left}-${bounds.right}, y ${bounds.top}-${bounds.bottom}`
    : '';
  expect(
    fraction,
    `at ${atStop} the world left ${(fraction * 100).toFixed(1)}% of the frame uncovered${where}`,
  ).toBeLessThanOrEqual(MAX_UNCOVERED_FRACTION);
}

test.describe('city map zoom', () => {
  test.beforeEach(async ({ page }) => {
    await installApi(page, me);
    await page.goto('/game');
    await expect(page.locator('canvas')).toBeVisible();
    // The planes are painted after `Application.init()` resolves and the bundle settles.
    await page.waitForTimeout(900);
    // Applied after the scene exists so the probe cannot be mistaken for a slow first paint.
    await page.addStyleTag({ content: `canvas { background: ${PROBE_COLOR} !important; }` });
  });

  /**
   * The regression itself: at the zoom floor the painted world must still reach every frame edge.
   */
  test('zooming out to the floor never uncovers the frame', async ({ page }) => {
    await wheelToStop(page, WHEEL_DELTA);
    await expectWorldCoversFrame(page, 'the zoom floor');
  });

  /**
   * The other stop, and the panned corners with it. Zooming in cannot shrink the world, so this
   * fails only if a *pan* can walk past the painted edge: the same bare-ground defect reached the
   * other way, which `clamp({ direction: 'all' })` is what prevents.
   */
  /**
   * Positive control for the two assertions above.
   *
   * `measureCoverage` looks for one hue at one brightness range, and it was loosened once already
   * after a marker's faded glow tripped it. A threshold nobody re-measures is a gate that has
   * quietly stopped working, so paint the canvas' own backdrop the probe colour and check the
   * measurement goes red.
   */
  test('the coverage gate goes red when the world really does not cover the frame', async ({
    page,
  }) => {
    // Painted *over* the canvas rather than behind it: an element screenshot captures whatever is
    // composited on top of the element's box, and the canvas' own CSS background sits under its
    // WebGL surface where no screenshot can see it.
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) throw new Error('no canvas to cover');
      const box = canvas.getBoundingClientRect();
      const patch = document.createElement('div');
      patch.style.cssText = `position:fixed;left:${box.left}px;top:${box.top}px;width:${box.width}px;height:${box.height / 3}px;background:#ff00ff;z-index:9999`;
      document.body.append(patch);
    });

    const { uncovered, total } = await measureCoverage(page);
    expect(
      uncovered / total,
      'bare probe-coloured ground must register as uncovered',
    ).toBeGreaterThan(MAX_UNCOVERED_FRACTION);
  });

  test('zooming in and panning to a corner never uncovers the frame', async ({ page }) => {
    await wheelToStop(page, -WHEEL_DELTA);
    const box = await page.locator('canvas').boundingBox();
    if (!box) throw new Error('canvas has no box to drag');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    for (const [dx, dy] of [
      [1, 1],
      [-1, -1],
    ] as const) {
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      await page.mouse.move(cx + dx * box.width, cy + dy * box.height, { steps: 12 });
      await page.mouse.up();
      // `decelerate({ friction: 0.93 })` keeps the camera coasting well past mouseup.
      await page.waitForTimeout(800);
      await expectWorldCoversFrame(page, `the ${dy < 0 ? 'bottom-right' : 'top-left'} corner`);
    }
  });
});
