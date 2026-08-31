import { BUILDING_KINDS, findAssetSpec } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import {
  DISTRICT_ASPECT,
  DISTRICT_BAND,
  DISTRICT_PLATE,
  DISTRICT_SITES,
  DISTRICT_SITES_BY_DEPTH,
  siteArea,
  siteCentroid,
  siteDepth,
  sitePoints,
  type DistrictSite,
  type ScenePoint,
} from './plots';
import type { CSSProperties } from 'react';
import { MAX_SQUASH } from './plots';
import { fitted, plateTop } from './DistrictScene';

/**
 * The district's interaction layer: twelve outlines traced onto one painting.
 *
 * These numbers were read off `plate-district` by hand: printed under a grid, rendered back over
 * the painting, corrected by eye, which makes them exactly the kind of data that is right today and
 * quietly wrong after the next pass. What is measured here is everything about a tracing that can be
 * checked without opening the image: that it is inside the frame, that it is a *shape* rather than a
 * box, that it is convex (which is what makes the cheap non-overlap test below exact), and that no
 * two of them claim the same pixels.
 *
 * The last one used to need a rasterising test in `scripts/` that composited every master and
 * counted stolen pixels, because plots were rectangles over a painting where nothing is a rectangle.
 * The browser now hit-tests the outline itself, so the question collapses into plane geometry and
 * is answered here in a millisecond.
 */

const cross = (o: ScenePoint, a: ScenePoint, b: ScenePoint): number =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

const at = (site: DistrictSite, i: number): ScenePoint =>
  site.shape[i % site.shape.length] as ScenePoint;

/** The outward normals of every edge: the only axes a convex pair can be separated along. */
function axes(site: DistrictSite): ScenePoint[] {
  return site.shape.map((_, i) => {
    const [x1, y1] = at(site, i);
    const [x2, y2] = at(site, i + 1);
    return [-(y2 - y1), x2 - x1] as ScenePoint;
  });
}

/**
 * Do two outlines share any area at all?
 *
 * The separating-axis test, which is exact for convex polygons and is why convexity is asserted
 * rather than assumed. A shared edge is not an overlap: the comparison is strict.
 */
function overlaps(a: DistrictSite, b: DistrictSite): boolean {
  const project = (site: DistrictSite, axis: ScenePoint): [number, number] => {
    const values = site.shape.map(([x, y]) => axis[0] * x + axis[1] * y);
    return [Math.min(...values), Math.max(...values)];
  };
  for (const axis of [...axes(a), ...axes(b)]) {
    const [aMin, aMax] = project(a, axis);
    const [bMin, bMax] = project(b, axis);
    if (aMax <= bMin || bMax <= aMin) return false;
  }
  return true;
}

/** Is the point strictly inside a clockwise convex outline? */
function contains(site: DistrictSite, point: ScenePoint): boolean {
  return site.shape.every((_, i) => cross(at(site, i), at(site, i + 1), point) > 0);
}

describe('the district layout (GDD §A1)', () => {
  it('gives every structure in the catalogue an outline on the plate', () => {
    expect([...DISTRICT_SITES.map((site) => site.kind)].sort()).toEqual([...BUILDING_KINDS].sort());
  });

  it('takes its shape from the delivered plate, not from a second copy of the number', () => {
    const spec = findAssetSpec('plate-district');
    expect(spec).toBeDefined();
    expect(DISTRICT_ASPECT).toBeCloseTo((spec?.width ?? 0) / (spec?.height ?? 1), 6);
    expect(DISTRICT_PLATE).toEqual({ width: spec?.width, height: spec?.height });
  });

  /**
   * Nothing may leave the frame on any side.
   *
   * The scene is `overflow-hidden` and the plate is fitted to it exactly, so a vertex outside 0..100
   * is a piece of hit area over nothing, and, at the top, a building the player can see and cannot
   * click.
   */
  it('keeps every outline inside the scene', () => {
    for (const site of DISTRICT_SITES) {
      for (const [x, y] of site.shape) {
        expect(x, `${site.kind} has a vertex off the sides`).toBeGreaterThanOrEqual(0);
        expect(x, `${site.kind} has a vertex off the sides`).toBeLessThanOrEqual(100);
        expect(y, `${site.kind} has a vertex off the top or bottom`).toBeGreaterThanOrEqual(0);
        expect(y, `${site.kind} has a vertex off the top or bottom`).toBeLessThanOrEqual(100);
      }
    }
  });

  /**
   * Every outline is clockwise and convex.
   *
   * Convexity is not an aesthetic rule, it is what the two checks below stand on: the
   * separating-axis test is exact only for convex shapes, and a concave outline's area centroid can
   * fall outside it, which would hang a name plate on the building next door. The buildings in the
   * painting are blocks seen from above, so tracing them convex costs nothing: where it would not,
   * the shape has to be split and these tests have to be rewritten rather than relaxed.
   *
   * A turn of exactly zero passes: three points on one straight run of the Gate's palisade are a
   * redundant vertex, not a dent. What rules out the degenerate case where *every* turn is zero: a
   * polygon flattened onto a line: is the area, which is asserted first.
   */
  it('traces every building as a clockwise convex outline', () => {
    for (const site of DISTRICT_SITES) {
      expect(siteArea(site), `${site.kind} is wound anticlockwise or has no area`).toBeGreaterThan(
        0,
      );
      for (let i = 0; i < site.shape.length; i += 1) {
        expect(
          cross(at(site, i), at(site, i + 1), at(site, i + 2)),
          `${site.kind} turns back on itself at vertex ${i}`,
        ).toBeGreaterThanOrEqual(0);
      }
    }
  });

  /**
   * Nothing claims anybody else's pixels.
   *
   * This is the assertion the layout exists to satisfy, and the reason the outlines are outlines:
   * the Apothecary stands a couple of percent from the Nexus and the Gate lies across the
   * road below both, so their *bounding boxes* would have argued and their shapes do not.
   */
  it('never lets two outlines claim the same ground', () => {
    for (const [i, a] of DISTRICT_SITES.entries()) {
      for (const b of DISTRICT_SITES.slice(i + 1)) {
        expect(overlaps(a, b), `${a.kind} overlaps ${b.kind}`).toBe(false);
      }
    }
  });

  /**
   * An outline is a silhouette, not a bounding box.
   *
   * The failure this catches is the cheap one: somebody re-tracing a building in a hurry types its
   * bounding rectangle, the picture still looks fine, and the plot silently goes back to claiming
   * its neighbour's roof, which is the entire failure mode the old rectangular plots had and the
   * reason this layer was redrawn. Four corners standing on two x values and two y values *is* a
   * bounding box, whatever it is called, so that is the shape that is refused.
   *
   * The Gate is four corners and passes, because they are four different x-or-y readings: the wall
   * it is traced on runs downhill, so its rectangle is not axis-aligned and does not swallow
   * anything beside it.
   */
  it('traces the building rather than boxing it', () => {
    for (const site of DISTRICT_SITES) {
      expect(
        site.shape.length,
        `${site.kind} is traced with too few points`,
      ).toBeGreaterThanOrEqual(4);
      const columns = new Set(site.shape.map(([x]) => x)).size;
      const rows = new Set(site.shape.map(([, y]) => y)).size;
      expect(
        columns > 2 || rows > 2,
        `${site.kind} is an axis-aligned bounding box, not an outline`,
      ).toBe(true);
    }
  });

  /** Every outline is big enough to be a hand-sized target at the smallest viewport the game runs at. */
  it('leaves every building clickable', () => {
    for (const site of DISTRICT_SITES) {
      // 1024px wide is the narrow end of the supported range; the scene takes 95% of it. One percent
      // of scene area is ~9,700px² there, comfortably past a fingertip.
      expect(siteArea(site), `${site.kind} is too small to point at`).toBeGreaterThan(20);
    }
  });

  /** The name plate hangs on the building it names. */
  it('puts every centroid inside its own outline', () => {
    for (const site of DISTRICT_SITES) {
      const centre = siteCentroid(site);
      expect(contains(site, [centre.x, centre.y]), `${site.kind}'s label falls outside it`).toBe(
        true,
      );
    }
  });

  /** Painting order runs back to front, so a nearer glow draws over a farther one. */
  it('paints from the back of the district forward', () => {
    const depths = DISTRICT_SITES_BY_DEPTH.map(siteDepth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    expect(DISTRICT_SITES_BY_DEPTH).toHaveLength(DISTRICT_SITES.length);
  });

  /**
   * The outline is emitted in the plate's own pixel units, which is what the `<svg>` viewBox is.
   *
   * Percent-of-scene and viewBox units are different numbers, and the conversion is the one line
   * between a correct table and twelve outlines bunched into the top-left ninth of the picture.
   */
  it('emits points in the plate pixel space the overlay is drawn in', () => {
    const site = DISTRICT_SITES.find((candidate) => candidate.kind === 'nexus');
    expect(site).toBeDefined();
    if (!site) return;

    const first = site.shape[0] as ScenePoint;
    const [x, y] = (sitePoints(site).split(' ')[0] ?? '').split(',').map(Number);
    expect(x).toBeCloseTo((first[0] / 100) * DISTRICT_PLATE.width, 0);
    expect(y).toBeCloseTo((first[1] / 100) * DISTRICT_PLATE.height, 0);
    expect(sitePoints(site).split(' ')).toHaveLength(site.shape.length);
  });
});

/**
 * The scene box is the plate's shape, or the painting is cropped.
 *
 * This is measured because it failed silently once and cost a third of the picture. The CSS
 * spelling it replaced, a percentage width with `aspect-ratio` and a `max-height`, clamps the
 * height and keeps the width, so on a short viewport the box quietly stops being 16:9 and the
 * `object-cover` image inside it crops to fit. Every layout gate stayed green: the outlines were
 * still laid out correctly *in the box*, and the box was no longer the picture.
 */
describe('fitting the painting into the room the chrome leaves', () => {
  const ratio = (box: CSSProperties): number => Number(box.width) / Number(box.height);
  const room = (width: number, height: number) => ({ width, height });
  /** Frame width and the clear band a real browser leaves under the bars at that width. */
  const VIEWPORTS = [
    [1024, 500],
    [1280, 503],
    [1440, 736],
    [1920, 916],
    [2560, 1200],
  ] as const;
  /** The band the buildings occupy, in pixels, for a plate of the given height. */
  const bandOf = (box: CSSProperties): number =>
    (Number(box.height) * (DISTRICT_BAND.bottom - DISTRICT_BAND.top)) / 100;
  /** Where the building band starts and ends, measured from the top of the clear band. */
  const occupies = (box: CSSProperties): { top: number; bottom: number } => {
    const offset = Number(box.marginTop);
    const height = Number(box.height);
    return {
      top: offset + (DISTRICT_BAND.top / 100) * height,
      bottom: offset + (DISTRICT_BAND.bottom / 100) * height,
    };
  };

  it('takes the full width of the frame, at every viewport', () => {
    for (const [width, clear] of VIEWPORTS) {
      const box = fitted(room(width, clear + 200), room(width, clear));
      expect(Number(box.width), `${width}px`).toBe(width);
    }
  });

  /**
   * The picture is allowed to be *wider* than the plate's shape and never taller.
   *
   * Wider is the step back: the frame between the bars is a shorter box than the plate was
   * painted at, so a full-width picture is compressed a little to bring the far side of the
   * district out from behind the stockpile. Taller would be the opposite failure, the one this
   * whole box exists to prevent: it would mean the width had been given up and the painting was
   * being cropped at the sides.
   */
  it('never draws the picture taller than the plate was painted', () => {
    for (const [width, clear] of VIEWPORTS) {
      const box = fitted(room(width, clear + 200), room(width, clear));
      expect(ratio(box), `${width}px`).toBeGreaterThanOrEqual(DISTRICT_ASPECT - 0.001);
    }
  });

  /** And the compression is bounded, or the buildings start to look squat. */
  it('compresses the picture by no more than the cap, at every viewport', () => {
    for (const [width, clear] of VIEWPORTS) {
      const box = fitted(room(width, clear + 200), room(width, clear));
      const squash = 1 - Number(box.height) / (width / DISTRICT_ASPECT);
      expect(squash, `${width}px`).toBeGreaterThanOrEqual(0);
      expect(squash, `${width}px`).toBeLessThanOrEqual(MAX_SQUASH + 0.001);
    }
  });

  /**
   * And it is actually spent where it is needed. A laptop is the case the whole cap exists for:
   * 1280x720 leaves about 500px of clear band under a 720px picture, and before the step back
   * every one of those pixels came off the top.
   */
  it('steps back on a frame too short to hold the whole plate', () => {
    const tall = fitted(room(1280, 703), room(1280, 503));
    expect(Number(tall.height)).toBeLessThan(1280 / DISTRICT_ASPECT);
  });

  /**
   * The margins are what slide under the bars, and only the margins, whenever there is room for
   * that. A frame with more clear band than the buildings need puts them squarely in the middle of
   * it, which is the arrangement the board asked for.
   */
  it('centres the buildings in the clear band when they fit in it', () => {
    const box = fitted(room(1440, 900), room(1440, 810));
    const band = occupies(box);
    expect(band.top).toBeGreaterThan(0);
    expect(810 - band.bottom).toBeCloseTo(band.top, 0);
  });

  /**
   * And when they do not fit, the whole shortfall goes to the **bottom**.
   *
   * The back row is where the tallest buildings are, and it was losing its rooflines behind the
   * stockpile on any viewport short enough to overflow at all. What slides under the scenery
   * switcher instead is the front row, which is what a floating bar should be covering, and
   * `plateTop` keeps its name plates reachable. Splitting it evenly, which is what this used to
   * assert, cropped both ends and the top one is the one a player looks at.
   */
  it('puts the whole overflow at the bottom when the band will not fit', () => {
    const box = fitted(room(1440, 900), room(1440, 400));
    const band = occupies(box);
    // The band's top edge lands on the top of the clear area: nothing above it is cut.
    expect(band.top).toBeCloseTo(0, 0);
    expect(band.bottom).toBeGreaterThan(400);
  });

  /** And with room to spare it is centred, which is the arrangement the board asked for. */
  it('centres the band when there is room for it', () => {
    const box = fitted(room(1440, 1200), room(1440, 900));
    const band = occupies(box);
    expect(band.top).toBeGreaterThan(0);
    expect(900 - band.bottom).toBeCloseTo(band.top, 0);
  });

  it('never crops sideways: the box is always the frame wide', () => {
    for (const width of [800, 1024, 1440, 1920, 2560]) {
      const box = fitted(room(width, 400), room(width, 300));
      expect(Number(box.width), `${width}px`).toBe(width);
      expect(ratio(box), `${width}px`).toBeGreaterThanOrEqual(DISTRICT_ASPECT - 0.001);
      expect(bandOf(box), `${width}px`).toBeGreaterThan(0);
    }
  });

  /** The city screen's preview has no bars over it, so it gets the plain reading. */
  it('fits the whole plate, unshifted, where nothing floats over it', () => {
    // Short and wide: the preview's own box is the only constraint, and it is never cropped.
    const box = fitted(room(1440, 600), room(1440, 600), false);
    expect(Number(box.height)).toBe(600);
    expect(ratio(box)).toBeCloseTo(DISTRICT_ASPECT, 2);
    expect(box.marginTop).toBeUndefined();
  });

  it('falls back to the CSS spelling before the frame has been measured', () => {
    expect(fitted(room(0, 0), room(0, 0))).toEqual({
      width: '100%',
      aspectRatio: DISTRICT_ASPECT,
    });
  });
});

/**
 * Pulling a name plate back inside the bars.
 *
 * The other half of the bleed, and the half that keeps it honest: the picture is allowed to run
 * under the chrome, and a *control* is not. Every one of these is a plate that would otherwise be
 * visible and unclickable, which is exactly the failure the plates replaced.
 */
describe('keeping every plate reachable', () => {
  const height = 810;
  const clear = 525;

  it('leaves a plate alone when it is already well inside the band', () => {
    const roomy = 810;
    // Real ground lines: the Lab is the highest building on the plate and the Infirmary the lowest.
    for (const anchor of [Math.min(...DISTRICT_SITES.map(siteDepth)), 50, 80]) {
      expect(plateTop(anchor, height, roomy), `${anchor}%`).toBeCloseTo(anchor, 5);
    }
  });

  it('pulls the front row up off the bottom bar, and the back row down off the top one', () => {
    const lowest = plateTop(91, height, clear);
    const highest = plateTop(1, height, clear);
    expect(lowest).toBeLessThan(91);
    expect(highest).toBeGreaterThan(1);
  });

  it('puts every plate inside the clear band, at every viewport the game is played at', () => {
    for (const [width, band] of [
      [1024, 400],
      [1280, 503],
      [1440, 736],
      [1920, 916],
    ] as const) {
      const picture = width / DISTRICT_ASPECT;
      const offset =
        -(DISTRICT_BAND.top / 100) * picture +
        (band - ((DISTRICT_BAND.bottom - DISTRICT_BAND.top) / 100) * picture) / 2;
      for (const site of DISTRICT_SITES) {
        const top = (plateTop(siteDepth(site), picture, band) / 100) * picture + offset;
        expect(top, `${site.kind} at ${width}`).toBeGreaterThanOrEqual(0);
        expect(top, `${site.kind} at ${width}`).toBeLessThanOrEqual(band);
      }
    }
  });

  /** The title row floats over the picture too, and a plate must not end up behind it. */
  it('clears whatever the screen itself puts over the top of the painting', () => {
    const inset = 48;
    const picture = 810;
    const band = 736;
    const offset =
      -(DISTRICT_BAND.top / 100) * picture +
      (band - ((DISTRICT_BAND.bottom - DISTRICT_BAND.top) / 100) * picture) / 2;
    for (const site of DISTRICT_SITES) {
      const top = (plateTop(siteDepth(site), picture, band, inset) / 100) * picture + offset;
      expect(top, site.kind).toBeGreaterThanOrEqual(inset);
    }
  });

  it('leaves the anchor alone rather than inventing a window it cannot honour', () => {
    expect(plateTop(50, 0, 500)).toBe(50);
    expect(plateTop(50, 810, 0)).toBe(50);
    // A band too short to hold a plate at all: no legal answer, so the honest one is the anchor.
    expect(plateTop(50, 810, 10)).toBe(50);
  });
});
