import { BUILDING_KINDS } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { DISTRICT_ASPECT, DISTRICT_HORIZON, DISTRICT_PLOTS, type DistrictPlot } from './plots';

/** Do the two plot boxes share any area at all? Touching edges is not overlap. */
function overlaps(a: DistrictPlot, b: DistrictPlot): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('the district layout (GDD §A1)', () => {
  it('gives every structure in the catalogue somewhere to stand', () => {
    expect([...DISTRICT_PLOTS.map((plot) => plot.kind)].sort()).toEqual([...BUILDING_KINDS].sort());
  });

  /*
   * The board's bar is zero overlapping elements. Plots are laid out in percentages, so this is the
   * assertion that keeps a nudged row from sliding one sprite's name plate under its neighbour's —
   * at *every* viewport at once, since the boxes are relative to the scene. Thirteen plots in three
   * rows is where a hand-eyeballed layout stops being trustworthy.
   */
  it('never lets two plots overlap', () => {
    for (const [i, a] of DISTRICT_PLOTS.entries()) {
      for (const b of DISTRICT_PLOTS.slice(i + 1)) {
        expect(overlaps(a, b), `${a.kind} overlaps ${b.kind}`).toBe(false);
      }
    }
  });

  it('keeps every plot inside the scene', () => {
    for (const plot of DISTRICT_PLOTS) {
      expect(plot.x, plot.kind).toBeGreaterThanOrEqual(0);
      expect(plot.y, plot.kind).toBeGreaterThanOrEqual(0);
      expect(plot.x + plot.width, plot.kind).toBeLessThanOrEqual(100);
      expect(plot.y + plot.height, plot.kind).toBeLessThanOrEqual(100);
    }
  });

  /**
   * Every plot must be square in *pixels*, which at a 2:1 scene means width is half the height.
   *
   * The sprites are drawn square and fitted with `meet`, so any other shape letterboxes them and
   * draws the district smaller than the space it is taking up — a defect that is invisible in a
   * screenshot diff and obvious to a player.
   */
  it('keeps every plot square in pixels', () => {
    for (const plot of DISTRICT_PLOTS) {
      expect(plot.width * DISTRICT_ASPECT, plot.kind).toBeCloseTo(plot.height, 6);
    }
  });

  /** The horizon has to sit on the back row's baseline, or the far structures float over it. */
  it('keeps the back row standing on the horizon rather than over it', () => {
    const highest = Math.min(...DISTRICT_PLOTS.map((plot) => plot.y));
    const backRow = DISTRICT_PLOTS.filter((plot) => plot.y === highest);
    expect(backRow.length).toBeGreaterThan(0);
    for (const plot of backRow) {
      expect(plot.y + plot.height, plot.kind).toBeLessThanOrEqual(DISTRICT_HORIZON);
    }
  });
});
