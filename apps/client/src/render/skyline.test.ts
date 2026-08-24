import { describe, expect, it } from 'vitest';
import { ramps } from '../theme/tokens';
import {
  BAND_PROFILES,
  fillForDepth,
  generateSkyline,
  mulberry32,
  type DepthBand,
  type Skyline,
} from './skyline';

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

  /**
   * `sky` is the one band whose masses may poke out of the top of their plane: its tallest tower is
   * `height[1]` = 0.9 of the plane, and `segmentsFor` adds a mast of up to a further 0.2 *on top of*
   * that budget, so a silhouette can reach 1.08. Every other band's `height[1] * 1.2` is below 1, so
   * for them the overshoot is exactly zero. That is the shape of the real invariant: `>= 0` for the
   * three low bands, and a bounded, deliberate, plane-clipped overhang for `sky`.
   *
   * Asserting `>= 0` for all four (as this test used to) passes at seed 3 by luck: 21 of the 800
   * (band, seed) pairs below 200 fail it, first at `sky` seed 10, so it was a red waiting for
   * someone else's unrelated fixture-seed change.
   */
  const MAX_OVERSHOOT = 0.08 * 900;

  it.each(BANDS)('%s: keeps every tower inside the plane and standing on its floor', (band) => {
    for (let seed = 0; seed < 40; seed += 1) {
      const skyline = generateSkyline(band, 1600, 900, seed);
      expect(towersOf(skyline).length).toBeGreaterThan(0);

      for (const tower of towersOf(skyline)) {
        const ys = tower.outline.map((p) => p.y);
        // Silhouettes are grounded: the lowest point of every tower is the plane's floor.
        expect(Math.max(...ys)).toBeCloseTo(900, 6);
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(band === 'sky' ? -MAX_OVERSHOOT : 0);
      }
    }
  });

  it.each(BANDS)('%s: closes each silhouette as an even, non-degenerate polygon', (band) => {
    for (const tower of towersOf(generateSkyline(band, 1600, 900, 5))) {
      // Left and right walls are walked in pairs, so the point count is even and >= one segment.
      expect(tower.outline.length % 2).toBe(0);
      expect(tower.outline.length).toBeGreaterThanOrEqual(8);
    }
  });

  /**
   * Recovers the horizontal extent of each storey from a finished outline. `outlineFor` walks the
   * left wall bottom → top and appends the right wall reversed, pushing a base and a top point per
   * storey, so storey `k` spans `[left[2k].x, right[2k].x]`.
   */
  const storeysOf = (tower: { outline: { x: number; y: number }[] }) => {
    const half = tower.outline.length / 2;
    const leftWall = tower.outline.slice(0, half);
    const rightWall = tower.outline.slice(half).reverse();
    return leftWall
      .filter((_, i) => i % 2 === 0)
      .map((point, k) => ({ left: point.x, right: rightWall[2 * k]!.x }));
  };

  // Replaces an earlier "never widens going up" assertion. That invariant encoded a *planned*
  // tower's inward setbacks, which is the clean-futurism silhouette GDD §A2 rejects and ART-BIBLE
  // §5 ("accretion steps out, not just in") now explicitly asks us to break. What actually has to
  // hold is the weaker, real constraint: consecutive storeys must overlap in x, or the single-pass
  // left-wall-up / right-wall-down polygon crosses itself and the painter fills a bowtie.
  it.each(BANDS)('%s: overlaps consecutive storeys, so no silhouette self-intersects', (band) => {
    for (let seed = 0; seed < 40; seed += 1) {
      for (const tower of towersOf(generateSkyline(band, 1600, 900, seed))) {
        const storeys = storeysOf(tower);
        for (const storey of storeys) {
          expect(storey.right).toBeGreaterThan(storey.left);
        }
        for (let k = 1; k < storeys.length; k += 1) {
          const below = storeys[k - 1]!;
          const above = storeys[k]!;
          expect(Math.max(below.left, above.left)).toBeLessThan(Math.min(below.right, above.right));
        }
      }
    }
  });

  // Counter-test to the one above: overlap alone is also satisfied by a pure taper, so without
  // this the silhouette could silently regress to the planned-tower read that W9 exists to kill
  // and the suite would stay green (ART-BIBLE §5).
  it('accretes outward as well as inward: storeys overhang the one below', () => {
    // Measures *width growth*, not edge excursion: a narrower storey shifted sideways already
    // pokes past one edge of the one below, so an edge test is satisfied by a pure taper that
    // merely leans and would not catch a regression to the planned-tower silhouette.
    let wider = 0;
    let storeys = 0;
    for (const band of BANDS) {
      for (let seed = 0; seed < 40; seed += 1) {
        for (const tower of towersOf(generateSkyline(band, 1600, 900, seed))) {
          const walls = storeysOf(tower);
          for (let k = 1; k < walls.length; k += 1) {
            const below = walls[k - 1]!;
            const above = walls[k]!;
            // The mast is always a sliver by construction; counting it would drown the signal.
            if (above.right - above.left < (below.right - below.left) * 0.2) continue;
            storeys += 1;
            if (above.right - above.left > below.right - below.left + 1e-9) wider += 1;
          }
        }
      }
    }
    expect(storeys).toBeGreaterThan(0);
    expect(wider / storeys).toBeGreaterThan(0.2);
  });

  /** Ground-storey extent: the footprint the mass actually stands on. */
  const baseOf = (tower: { outline: { x: number; y: number }[] }) => {
    const baseY = Math.max(...tower.outline.map((p) => p.y));
    const xs = tower.outline.filter((p) => p.y === baseY).map((p) => p.x);
    return { left: Math.min(...xs), right: Math.max(...xs) };
  };

  // `sprawl` is documented as the single bound on every horizontal excursion: overhanging storeys,
  // lean, and the scrap sheds at the foot, and nothing pinned it. The cap that enforces it for
  // storeys (`Math.min(width, 2 * reach)` in `accretedOnto`, which is what keeps `reach - half`
  // non-negative so the `dx` clamp range cannot invert) could be deleted with the whole suite green.
  it.each(BANDS)('%s: keeps every storey within `sprawl` of the ground it stands on', (band) => {
    const { sprawl } = BAND_PROFILES[band];
    for (let seed = 0; seed < 40; seed += 1) {
      for (const tower of towersOf(generateSkyline(band, 1600, 900, seed))) {
        const base = baseOf(tower);
        const centre = (base.left + base.right) / 2;
        const reach = (base.right - base.left) * (0.5 + sprawl);
        for (const point of tower.outline) {
          expect(Math.abs(point.x - centre)).toBeLessThanOrEqual(reach + 1e-9);
        }
      }
    }
  });

  // The other half of the same contract, and the half that was broken. A shed is emitted with its
  // parent's exact `depth`, so a depth shared by two masses is a parent/shed pair; the shed is the
  // narrower of the two, since its width is a `sprawl` fraction of its parent's.
  //
  // Two things go wrong if the shed is anchored to the *whole* outline rather than the ground
  // storey: it is planted up to the overhang's width away from the wall it is supposed to lean on,
  // and that displacement stacks on top of its own width, taking the pair's excursion past `sprawl`.
  it.each(BANDS)('%s: leans each scrap shed on its parent, within `sprawl`', (band) => {
    const { sprawl } = BAND_PROFILES[band];
    let pairs = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      const byDepth = new Map<number, ReturnType<typeof towersOf>>();
      for (const tower of towersOf(generateSkyline(band, 1600, 900, seed))) {
        byDepth.set(tower.depth, [...(byDepth.get(tower.depth) ?? []), tower]);
      }
      for (const group of byDepth.values()) {
        if (group.length !== 2) continue;
        pairs += 1;
        const [parent, shed] = [...group].sort(
          (a, b) => baseOf(b).right - baseOf(b).left - (baseOf(a).right - baseOf(a).left),
        ) as [(typeof group)[number], (typeof group)[number]];
        const wall = baseOf(parent);
        const foot = baseOf(shed);
        // Flush against one ground-floor wall: no gap of open air between shed and mass. Exact by
        // construction up to the rounding in `centre ± width / 2`, hence the epsilon.
        expect(
          Math.min(Math.abs(foot.left - wall.right), Math.abs(foot.right - wall.left)),
        ).toBeLessThan(1e-6);
        const excursion = Math.max(wall.left - foot.left, foot.right - wall.right);
        expect(excursion).toBeLessThanOrEqual((wall.right - wall.left) * sprawl + 1e-9);
      }
    }
    expect(pairs).toBeGreaterThan(0);
  });

  it.each(BANDS)('%s: only uses whole ART-BIBLE ramp stops as fills', (band) => {
    for (const tower of towersOf(generateSkyline(band, 1600, 900, 4))) {
      expect(RAMP_STOPS.has(tower.fill)).toBe(true);
    }
  });

  it.each(BANDS)('%s: keeps lit windows within the plane', (band) => {
    for (let seed = 0; seed < 40; seed += 1) {
      for (const tower of towersOf(generateSkyline(band, 1600, 900, seed))) {
        for (const cell of tower.windows) {
          // A `sky` mast is wide enough to carry a single column of windows, so a lit cell rides
          // the same bounded overhang the silhouette does. See MAX_OVERSHOOT.
          expect(cell.y).toBeGreaterThanOrEqual(band === 'sky' ? -MAX_OVERSHOOT : 0);
          expect(cell.y + cell.h).toBeLessThanOrEqual(900);
          expect(cell.w).toBeGreaterThan(0);
        }
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

  it.each(BANDS)('%s: strings gantries only across genuinely adjacent masses', (band) => {
    for (let seed = 0; seed < 40; seed += 1) {
      const skyline = generateSkyline(band, 1600, 900, seed);
      for (const strut of skyline.struts) {
        const xs = strut.outline.map((p) => p.x);
        const ys = strut.outline.map((p) => p.y);
        // A catwalk nobody could have built is the failure mode: bound the span, and keep it
        // between the floor and the roof it hangs off rather than crossing either.
        expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0);
        expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(1600 * 0.05);
        expect(Math.max(...ys)).toBeLessThanOrEqual(900);
        expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
        expect(RAMP_STOPS.has(strut.fill)).toBe(true);
      }
    }
  });

  // `fore`'s two margins exist to leave the middle of the plate clickable (BAND_PROFILES.spans).
  //
  // Honest scope: this is a regression net, not evidence. At the shipped profile the nearest
  // cross-middle pair sits ~325px apart against an 80px `MAX_GANTRY_SPAN`, so the case is
  // unreachable and deleting the `spannable` guard in `strutsBetween` does not fail this test.
  // It earns its place by catching a *profile* change: widening `fore.width` to close that gap
  // makes it fail immediately, which is how the guard came to exist.
  it('never bridges the clickable middle of the foreground plane', () => {
    for (let seed = 0; seed < 60; seed += 1) {
      for (const strut of generateSkyline('fore', 1600, 900, seed).struts) {
        for (const point of strut.outline) {
          expect(point.x < 1600 * 0.34 || point.x > 1600 * 0.66).toBe(true);
        }
      }
    }
  });

  it('piles scrap lean-tos against the masses without breaking the floor line', () => {
    // Sheds are emitted as masses, so they are already covered by the grounded/polygon invariants
    // above; what this pins is that they are actually produced and share their parent's stop.
    const skyline = generateSkyline('mid', 1600, 900, 3);
    const plain = skyline.towers.filter((t) => t.windows.length === 0);
    expect(plain.length).toBeGreaterThan(0);
    expect(skyline.towers.length).toBeGreaterThan(BANDS.length);
  });

  it('scales with the plane it is painted into', () => {
    const wide = generateSkyline('far', 3200, 900, 1);
    const narrow = generateSkyline('far', 1600, 900, 1);
    const spread = (s: Skyline) =>
      Math.max(...towersOf(s).flatMap((t) => t.outline.map((p) => p.x)));
    expect(spread(wide)).toBeGreaterThan(spread(narrow));
  });
});
