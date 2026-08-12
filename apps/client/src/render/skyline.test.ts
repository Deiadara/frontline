import { describe, expect, it } from 'vitest';
import { ramps } from '../theme/tokens';
import { fillForDepth, generateSkyline, mulberry32, type DepthBand, type Skyline } from './skyline';

const BANDS: DepthBand[] = ['sky', 'far', 'mid', 'fore'];
const RAMP_STOPS = new Set<string>(Object.values(ramps).flatMap((ramp) => Object.values(ramp)));

const towersOf = (skyline: Skyline) => skyline.towers;

describe('mulberry32', () => {
  it('is deterministic for a seed and differs between seeds', () => {
    const draw = (seed: number) => Array.from({ length: 5 }, mulberry32(seed));
    expect(draw(42)).toEqual(draw(42));
    expect(draw(42)).not.toEqual(draw(43));
  });

  it('stays inside [0, 1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('fillForDepth', () => {
  const fills = ['a', 'b', 'c'];

  it('walks the stops front to back and clamps out-of-range depths', () => {
    expect(fillForDepth(fills, 0)).toBe('a');
    expect(fillForDepth(fills, 0.5)).toBe('b');
    expect(fillForDepth(fills, 0.99)).toBe('c');
    expect(fillForDepth(fills, 1)).toBe('c');
    expect(fillForDepth(fills, -1)).toBe('a');
  });
});

describe('generateSkyline', () => {
  it('paints the same skyline for the same seed, and a different one otherwise', () => {
    expect(generateSkyline('far', 1600, 900, 11)).toEqual(generateSkyline('far', 1600, 900, 11));
    expect(generateSkyline('far', 1600, 900, 11)).not.toEqual(
      generateSkyline('far', 1600, 900, 12),
    );
  });

  it.each(BANDS)('%s: keeps every tower inside the plane and standing on its floor', (band) => {
    const skyline = generateSkyline(band, 1600, 900, 3);
    expect(towersOf(skyline).length).toBeGreaterThan(0);

    for (const tower of towersOf(skyline)) {
      const ys = tower.outline.map((p) => p.y);
      // Silhouettes are grounded: the lowest point of every tower is the plane's floor.
      expect(Math.max(...ys)).toBeCloseTo(900, 6);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
    }
  });

  it.each(BANDS)('%s: closes each silhouette as an even, non-degenerate polygon', (band) => {
    for (const tower of towersOf(generateSkyline(band, 1600, 900, 5))) {
      // Left and right walls are walked in pairs, so the point count is even and >= one segment.
      expect(tower.outline.length % 2).toBe(0);
      expect(tower.outline.length).toBeGreaterThanOrEqual(8);
    }
  });

  it.each(BANDS)('%s: never widens going up — setbacks step in, never out', (band) => {
    for (const tower of towersOf(generateSkyline(band, 1600, 900, 9))) {
      const half = tower.outline.length / 2;
      const leftWall = tower.outline.slice(0, half);
      // Walking up the left wall, x must be monotonically non-decreasing (moving inward).
      for (let i = 1; i < leftWall.length; i += 1) {
        expect(leftWall[i]!.x).toBeGreaterThanOrEqual(leftWall[i - 1]!.x - 1e-9);
      }
    }
  });

  it.each(BANDS)('%s: only uses whole ART-BIBLE ramp stops as fills', (band) => {
    for (const tower of towersOf(generateSkyline(band, 1600, 900, 4))) {
      expect(RAMP_STOPS.has(tower.fill)).toBe(true);
    }
  });

  it.each(BANDS)('%s: keeps lit windows within the plane', (band) => {
    for (const tower of towersOf(generateSkyline(band, 1600, 900, 6))) {
      for (const cell of tower.windows) {
        expect(cell.y).toBeGreaterThanOrEqual(0);
        expect(cell.y + cell.h).toBeLessThanOrEqual(900);
        expect(cell.w).toBeGreaterThan(0);
      }
    }
  });

  it('sorts towers back to front so nearer masses overlap hazier ones', () => {
    const depths = towersOf(generateSkyline('far', 1600, 900, 8)).map((t) => t.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
  });

  it('lights the far band far more densely than the foreground occluders', () => {
    const lit = (band: DepthBand) =>
      towersOf(generateSkyline(band, 1600, 900, 2)).reduce((n, t) => n + t.windows.length, 0);
    expect(lit('far')).toBeGreaterThan(lit('fore'));
  });

  it('scales with the plane it is painted into', () => {
    const wide = generateSkyline('far', 3200, 900, 1);
    const narrow = generateSkyline('far', 1600, 900, 1);
    const spread = (s: Skyline) =>
      Math.max(...towersOf(s).flatMap((t) => t.outline.map((p) => p.x)));
    expect(spread(wide)).toBeGreaterThan(spread(narrow));
  });
});
