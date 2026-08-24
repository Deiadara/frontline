import { describe, expect, it } from 'vitest';
import { BAND_PLANS, CANAL_FILL, generateCityPlan, GROUND_FILL, type CityPlan } from './cityplan';
import { ramps } from '../theme/tokens';
import type { DepthBand } from './skyline';

/**
 * The map's geometry, pinned where it can be checked in a millisecond.
 *
 * Everything here is pure and seeded, which is the whole reason it lives apart from the painter: a
 * city drawn straight into Pixi can only be judged by looking at it, and "looks like a city" is not
 * a thing a suite can hold. These are the properties that make it read as a plan rather than as
 * noise, and each one is a rule the generator would otherwise be free to break silently.
 */

const BANDS: readonly DepthBand[] = ['sky', 'far', 'mid', 'fore'];
const W = 1600;
const H = 900;

const plan = (band: DepthBand, seed = 42): CityPlan => generateCityPlan(band, W, H, seed);

describe('the city plan', () => {
  it('is deterministic — the same seed paints the same city', () => {
    expect(plan('far', 7)).toEqual(plan('far', 7));
  });

  it('is a different city on a different seed', () => {
    expect(plan('far', 7)).not.toEqual(plan('far', 8));
  });

  /** Exactly one band lays the floor and one cuts the water, or the map has two of either. */
  it('has one ground and one canal across the whole stack', () => {
    const grounds = BANDS.filter((band) => plan(band).ground !== null);
    const canals = BANDS.filter((band) => plan(band).canal !== null);
    expect(grounds).toEqual(['sky']);
    // The canal rides the *near* band so it cuts through the blocks rather than being buried
    // under eighteen columns of them.
    expect(canals).toEqual(['fore']);
    expect(plan('sky').ground).toBe(GROUND_FILL);
    expect(plan('fore').canal?.fill).toBe(CANAL_FILL);
  });

  it('builds on every band that is meant to be built on', () => {
    for (const band of BANDS) {
      const built = plan(band).blocks.length;
      const expected = BAND_PLANS[band].columns * BAND_PLANS[band].rows;
      if (expected === 0) expect(built, band).toBe(0);
      else expect(built, band).toBeGreaterThan(expected * 0.5);
    }
  });

  /**
   * Every roof stands inside its own block.
   *
   * A roof that leaks past its block's edge sits in the lane beside it, and a map whose buildings
   * stand in the street is the single fastest way to stop reading as a plan.
   */
  it('keeps every roof inside the block it belongs to', () => {
    for (const band of BANDS) {
      for (const block of plan(band).blocks) {
        const xs = block.outline.map((p) => p.x);
        const ys = block.outline.map((p) => p.y);
        // The block's own outline is jittered, so the bound is its bounding box plus the jitter a
        // roof is allowed — measured against the block, not against a constant.
        const slack = Math.max(...xs) - Math.min(...xs);
        for (const roof of block.roofs) {
          for (const point of roof.outline) {
            expect(point.x).toBeGreaterThan(Math.min(...xs) - slack * 0.12);
            expect(point.x).toBeLessThan(Math.max(...xs) + slack * 0.12);
            expect(point.y).toBeGreaterThan(Math.min(...ys) - slack * 0.12);
            expect(point.y).toBeLessThan(Math.max(...ys) + slack * 0.12);
          }
        }
      }
    }
  });

  /**
   * Nothing is a rectangle.
   *
   * Right angles everywhere are the tell of a generated city — it reads as a spreadsheet seen from
   * above. Every roof is a jittered quad, so no two opposite edges should be exactly parallel.
   */
  it('draws no perfect rectangles', () => {
    const roofs = plan('mid').blocks.flatMap((block) => block.roofs);
    expect(roofs.length).toBeGreaterThan(10);
    const rectangles = roofs.filter((roof) => {
      const [a, b, c, d] = roof.outline;
      if (!a || !b || !c || !d) return false;
      return a.y === b.y && c.y === d.y && a.x === d.x && b.x === c.x;
    });
    expect(rectangles).toHaveLength(0);
  });

  /**
   * Lit roofs are the minority, on every band.
   *
   * A lamp means somebody is in. If most roofs carry one the signal is gone and the map is just
   * bright — and the bloom pass, which thresholds on brightness, would catch the whole city.
   */
  it('lights a minority of roofs', () => {
    for (const band of ['far', 'mid', 'fore'] as const) {
      const roofs = plan(band).blocks.flatMap((block) => block.roofs);
      const lit = roofs.filter((roof) => roof.lamp !== null).length;
      expect(lit, band).toBeGreaterThan(0);
      expect(lit / roofs.length, band).toBeLessThan(0.6);
    }
  });

  /** Near bands carry bigger, fewer roofs — which is what reads as depth in a plan. */
  it('draws the near band larger than the far one', () => {
    const area = (band: DepthBand) => {
      const roofs = plan(band).blocks.flatMap((b) => b.roofs);
      const total = roofs.reduce((sum, roof) => {
        const xs = roof.outline.map((p) => p.x);
        const ys = roof.outline.map((p) => p.y);
        return sum + (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
      }, 0);
      return total / roofs.length;
    };
    expect(area('fore')).toBeGreaterThan(area('far'));
  });

  /** The canal crosses the whole plane — a river that stops halfway is a pond. */
  it('cuts the canal from edge to edge', () => {
    const canal = plan('fore').canal;
    expect(canal).not.toBeNull();
    const ys = canal?.outline.map((p) => p.y) ?? [];
    expect(Math.min(...ys)).toBeLessThanOrEqual(1);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(H - 1);
  });

  it('scales with the plane rather than assuming a size', () => {
    const small = generateCityPlan('mid', 800, 450, 3);
    const large = generateCityPlan('mid', 1600, 900, 3);
    expect(small.blocks).toHaveLength(large.blocks.length);
    const width = (p: CityPlan) => {
      const xs = p.blocks[0]?.outline.map((q) => q.x) ?? [0];
      return Math.max(...xs) - Math.min(...xs);
    };
    expect(width(large) / width(small)).toBeCloseTo(2, 1);
  });

  /** ART-BIBLE §2.1 — whole ramp stops only, never an invented intermediate hue. */
  it('paints only with ramp stops', () => {
    const stops = new Set(Object.values(ramps).flatMap((ramp) => Object.values(ramp)));
    for (const band of BANDS) {
      const p = plan(band);
      const used = [
        p.ground,
        p.canal?.fill,
        ...p.lanes.map((lane) => lane.fill),
        ...p.blocks.map((block) => block.fill),
        ...p.blocks.flatMap((block) => block.roofs.map((roof) => roof.fill)),
      ].filter((value): value is string => typeof value === 'string');
      for (const colour of used) expect(stops, `${band}: ${colour}`).toContain(colour);
    }
  });
});
