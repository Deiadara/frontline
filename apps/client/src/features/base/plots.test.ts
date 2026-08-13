import { BUILDING_KINDS } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { VILLAGE_PLOTS, type VillagePlot } from './plots';

/** Do the two plot boxes share any area at all? Touching edges is not overlap. */
function overlaps(a: VillagePlot, b: VillagePlot): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('the village layout (GDD §A1)', () => {
  it('gives every structure in the catalogue somewhere to stand', () => {
    expect([...VILLAGE_PLOTS.map((plot) => plot.kind)].sort()).toEqual([...BUILDING_KINDS].sort());
  });

  /*
   * The board's bar is zero overlapping elements. Plots are placed by hand in percentages, so this
   * is the assertion that keeps a nudged coordinate from sliding one sprite's name plate under its
   * neighbour's — at *every* viewport at once, since the boxes are relative to the scene.
   */
  it('never lets two plots overlap', () => {
    for (const [i, a] of VILLAGE_PLOTS.entries()) {
      for (const b of VILLAGE_PLOTS.slice(i + 1)) {
        expect(overlaps(a, b), `${a.kind} overlaps ${b.kind}`).toBe(false);
      }
    }
  });

  it('keeps every plot inside the scene', () => {
    for (const plot of VILLAGE_PLOTS) {
      expect(plot.x, plot.kind).toBeGreaterThanOrEqual(0);
      expect(plot.y, plot.kind).toBeGreaterThanOrEqual(0);
      expect(plot.x + plot.width, plot.kind).toBeLessThanOrEqual(100);
      expect(plot.y + plot.height, plot.kind).toBeLessThanOrEqual(100);
    }
  });
});
