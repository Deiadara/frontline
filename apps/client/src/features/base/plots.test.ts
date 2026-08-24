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
import { fitted } from './DistrictScene';

/**
 * The district's interaction layer: twelve outlines traced onto one painting.
 *
 * These numbers were read off `plate-district` by hand — printed under a grid, rendered back over
 * the painting, corrected by eye — which makes them exactly the kind of data that is right today and
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

/** The outward normals of every edge — the only axes a convex pair can be separated along. */
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
   * is a piece of hit area over nothing — and, at the top, a building the player can see and cannot
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
   * painting are blocks seen from above, so tracing them convex costs nothing — where it would not,
   * the shape has to be split and these tests have to be rewritten rather than relaxed.
   *
   * A turn of exactly zero passes: three points on one straight run of the Gate's palisade are a
   * redundant vertex, not a dent. What rules out the degenerate case where *every* turn is zero — a
   * polygon flattened onto a line — is the area, which is asserted first.
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
   * the Cistern stands a couple of percent from the Scrapyard's fence and the Gate lies across the
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
   * its neighbour's roof — which is the entire failure mode the old rectangular plots had and the
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
 * spelling it replaced — a percentage width with `aspect-ratio` and a `max-height` — clamps the
 * height and keeps the width, so on a short viewport the box quietly stops being 16:9 and the
 * `object-cover` image inside it crops to fit. Every layout gate stayed green: the outlines were
 * still laid out correctly *in the box*, and the box was no longer the picture.
 */
describe('fitting the painting into the room the chrome leaves', () => {
  const ratio = (box: CSSProperties): number => Number(box.width) / Number(box.height);
  const room = (width: number, height: number) => ({ width, height });
  /** The band the buildings occupy, in pixels, for a plate of the given height. */
  const bandOf = (box: CSSProperties): number =>
    (Number(box.height) * (DISTRICT_BAND.bottom - DISTRICT_BAND.top)) / 100;

  it('takes the full width of the frame when the chrome leaves room for it', () => {
    // 810px of clear band is more than the 731px the buildings need at 1440 wide, so width wins.
    const box = fitted(room(1440, 900), room(1440, 810));
    expect(Number(box.width)).toBe(1440);
    expect(ratio(box)).toBeCloseTo(DISTRICT_ASPECT, 2);
  });

  /**
   * The whole point of the band. A short viewport cannot show the plate at full width *and* keep
   * every building out from under the bars, and what gives is the width — the painting stops short
   * at the sides, where the shell's blurred backdrop carries on, rather than sliding a door under
   * the stockpile.
   */
  it('gives up width before it lets a building go under the chrome', () => {
    const box = fitted(room(1440, 900), room(1440, 525));
    expect(Number(box.width)).toBeLessThan(1440);
    expect(bandOf(box)).toBeCloseTo(525, 0);
  });

  it('never crops: height always follows from width', () => {
    for (const width of [800, 1024, 1440, 1920, 2560]) {
      const box = fitted(room(width, 400), room(width, 300));
      expect(ratio(box), `${width}px`).toBeCloseTo(DISTRICT_ASPECT, 2);
    }
  });

  /**
   * The buildings' band lands exactly on the clear band, so the plate's empty top margin is what
   * passes under the HUD — that is what the negative offset is for, and getting its sign wrong
   * would push the Quarters *further* under the bar rather than out from under it.
   */
  it('hangs the picture so the first roofline clears the top bar', () => {
    const box = fitted(room(1440, 900), room(1440, 525));
    expect(Number(box.marginTop)).toBeCloseTo(-(DISTRICT_BAND.top / 100) * Number(box.height), 0);
    expect(Number(box.marginTop)).toBeLessThan(0);
  });

  /** The city screen's preview has no bars over it, so it gets the plain reading. */
  it('fits the whole plate, unshifted, where nothing floats over it', () => {
    const box = fitted(room(1440, 900), room(1440, 600), false);
    expect(Number(box.height)).toBe(600);
    expect(ratio(box)).toBeCloseTo(DISTRICT_ASPECT, 2);
    expect(box.marginTop).toBe(0);
  });

  it('falls back to the CSS spelling before the frame has been measured', () => {
    expect(fitted(room(0, 0), room(0, 0))).toEqual({
      width: '100%',
      aspectRatio: DISTRICT_ASPECT,
    });
  });
});
