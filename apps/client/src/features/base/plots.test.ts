import { BUILDING_KINDS, findAssetSpec } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { STRUCTURE_ASPECT } from './masters';
import {
  boxHeight,
  DISTRICT_ASPECT,
  DISTRICT_BACK_EDGE,
  DISTRICT_SITES,
  DISTRICT_SITES_BY_DEPTH,
  siteBox,
  type DistrictSite,
} from './plots';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The patch of ground a structure actually stands on.
 *
 * **Not its box.** The box is the room the drawing takes, and on a town view seen from above a tall
 * building's upper mass is *supposed* to pass in front of a shorter one behind it — that is what
 * depth looks like. What may never collide is where two buildings meet the ground, which is the
 * same ellipse `ContactShadow` pools its shade in, taken as its bounding box.
 */
function footprint(site: DistrictSite): Box {
  return {
    x: site.x - site.width * 0.43,
    y: site.baseline - site.height * 0.07,
    width: site.width * 0.86,
    height: site.height * 0.14,
  };
}

/** Do the two boxes share any area at all? Touching edges is not overlap. */
function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The clear ground between two boxes, in percent-of-scene units, along each axis. */
function gap(a: Box, b: Box): number {
  return Math.max(
    Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width)),
    Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height)),
  );
}

/**
 * The narrowest lane the plate leaves between two footprints.
 *
 * A town view reads as a place because there is visible ground between the buildings. Two feet a
 * hair apart technically satisfy "no overlap" and still leave nowhere for the painted road to run,
 * so the floor is stated as a real distance rather than as zero.
 */
const MIN_LANE_PERCENT = 3;

/** Where each depth band starts, and how the layout is read as three rows receding. */
const DEPTH_BANDS = [
  [0, 40],
  [40, 80],
  [80, 101],
] as const;

describe('the district layout (GDD §A1)', () => {
  it('gives every structure in the catalogue somewhere to stand', () => {
    expect([...DISTRICT_SITES.map((site) => site.kind)].sort()).toEqual([...BUILDING_KINDS].sort());
  });

  it('takes its shape from the delivered plate, not from a second copy of the number', () => {
    const spec = findAssetSpec('plate-district');
    expect(spec).toBeDefined();
    expect(DISTRICT_ASPECT).toBeCloseTo((spec?.width ?? 0) / (spec?.height ?? 1), 6);
  });

  /**
   * Nothing may leave the frame on any side, the top included.
   *
   * The top used to be allowed to run over — a structure could poke above `DISTRICT_BACK_EDGE` by
   * its whole height — which is not a bound at all, and the scene is `overflow-hidden`, so what it
   * permitted was a building silently cut off at the roof. The e2e caught the Lab 1.5px over at
   * every viewport; this is that rule stated where it fails in a millisecond instead.
   */
  it('keeps every structure inside the scene', () => {
    for (const site of DISTRICT_SITES) {
      const box = siteBox(site);
      expect(box.x, `${site.kind} runs off the left`).toBeGreaterThanOrEqual(0);
      expect(box.y, `${site.kind} runs off the top`).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, `${site.kind} runs off the right`).toBeLessThanOrEqual(100);
      expect(box.y + box.height, `${site.kind} runs off the bottom`).toBeLessThanOrEqual(100);
    }
  });

  /**
   * Nothing stands on anything else.
   *
   * This is the assertion the layout exists to satisfy: the sites were read off a painting by hand,
   * so they are only trustworthy where something measures them, and it has to hold at every viewport
   * at once — which it does, because the footprints are percentages of the scene rather than pixels.
   */
  it('never lets two structures stand on the same ground', () => {
    for (const [i, a] of DISTRICT_SITES.entries()) {
      for (const b of DISTRICT_SITES.slice(i + 1)) {
        expect(overlaps(footprint(a), footprint(b)), `${a.kind} stands on ${b.kind}`).toBe(false);
      }
    }
  });

  /** ...and leaves room between them for the plate's roads to run. */
  it('leaves a lane of clear ground between every pair', () => {
    for (const [i, a] of DISTRICT_SITES.entries()) {
      for (const b of DISTRICT_SITES.slice(i + 1)) {
        expect(
          gap(footprint(a), footprint(b)),
          `${a.kind} and ${b.kind} are too close to paint a path between`,
        ).toBeGreaterThanOrEqual(MIN_LANE_PERCENT);
      }
    }
  });

  /**
   * Every box is the shape of the master that goes in it.
   *
   * A structure is drawn `object-contain` and bottom-anchored, so a box taller than its art leaves
   * a band of dead hit area over the roof and lifts the name plate off the building; a box wider
   * than its art shrinks the drawing to fit a size nobody chose. Neither is visible in a screenshot
   * — the art looks right either way — which is exactly why it is measured.
   *
   * This half only pins that a height was *derived* rather than typed. Whether the shapes in
   * `STRUCTURE_ASPECT` are the shapes the files actually have is a different question, and it is
   * answered where the files can be opened: `scripts/district-masters.test.ts`.
   */
  it('proportions every box to the master that stands in it', () => {
    for (const site of DISTRICT_SITES) {
      expect(site.height, site.kind).toBeCloseTo(
        (site.width * DISTRICT_ASPECT) / STRUCTURE_ASPECT[site.kind],
        1,
      );
    }
  });

  /**
   * ...and that the derivation is doing something.
   *
   * The layout used to give every structure a square box, which is what a single `squareHeight`
   * produces no matter what the art is shaped like. A regression to that would satisfy the check
   * above at any aspect table at all, because both sides would move together — so the shapes are
   * also required to *differ*, which only a real per-master derivation can manage.
   */
  it('does not give every structure the same box shape', () => {
    const shapes = new Set(DISTRICT_SITES.map((s) => Math.round((s.width / s.height) * 100)));
    expect(shapes.size).toBeGreaterThan(DISTRICT_SITES.length / 2);
  });

  /** The derivation itself, at the two ends: a wide master gets a short box and a tall one a deep box. */
  it('derives a box height that is taller for a narrower master', () => {
    expect(boxHeight(10, 2)).toBeCloseTo((10 * DISTRICT_ASPECT) / 2, 1);
    expect(boxHeight(10, 0.5)).toBeGreaterThan(boxHeight(10, 2));
  });

  /** Painting order has to run back to front, or a near structure draws behind a far one. */
  it('paints from the back of the district forward', () => {
    const baselines = DISTRICT_SITES_BY_DEPTH.map((site) => site.baseline);
    expect(baselines).toEqual([...baselines].sort((a, b) => a - b));
    expect(DISTRICT_SITES_BY_DEPTH).toHaveLength(DISTRICT_SITES.length);
  });

  /** Nothing stands above the compound's back boundary. */
  it('keeps the back row inside the compound', () => {
    const highest = Math.min(...DISTRICT_SITES.map((site) => site.baseline));
    expect(highest).toBeGreaterThan(DISTRICT_BACK_EDGE);
  });

  /**
   * Depth has to be readable from size as well as from position, or a district with only the back
   * row built looks like a district with only the front row built.
   *
   * Stated over the *mean* of each band rather than over every pair, because the sizes now follow
   * the lots the plate paints: one back lot may be larger than one middle lot, and forcing a strict
   * ladder would mean sizing a structure to a rule instead of to the ground it stands on.
   */
  it('draws the far rows smaller than the near ones', () => {
    const means = DEPTH_BANDS.map(([from, to]) => {
      const row = DISTRICT_SITES.filter((s) => s.baseline >= from && s.baseline < to);
      expect(row.length, `depth band ${from}-${to} is empty`).toBeGreaterThan(0);
      return row.reduce((total, s) => total + s.width, 0) / row.length;
    });
    expect(means).toEqual([...means].sort((a, b) => a - b));
    expect(means.at(-1) ?? 0).toBeGreaterThan(means[0] ?? 0);
  });
});
