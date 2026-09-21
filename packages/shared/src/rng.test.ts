import { describe, expect, it } from 'vitest';
import { drawWeighted, mulberry32, seedFrom } from './rng.js';

/**
 * The property `drawWeighted` exists to have: a point drawn **uniformly** over the weight range.
 *
 * There was no test file here at all, which is how the defect this guards against survived. The
 * function took its point as `seedFrom(seed) % Math.round(total * SCALE)`. `seedFrom` is a uint32,
 * so that modulus is only fair when it divides `2^32`, and no real pool's scaled total does: on
 * the `upgrade` page pool (total 585) the modulus is 585,000,000, `2^32` is seven of those plus
 * 199,967,296, and every residue under that remainder had one more preimage than the rest. The
 * first 34.2% of the range came out about 10% over.
 *
 * `blueprints/prize.test.ts` could not see it. That file measures how often each **rarity** drops,
 * and rarity does not track a page's position in the catalogue, so a bias that is purely
 * positional averaged out of every figure it checks. The draw's own uniformity had to be measured
 * directly, against a pool built for the purpose.
 */

/** A flat pool of `size` unit weights, so a bucket of ids is a slice of the weight range. */
const flat = (size: number) => Array.from({ length: size }, (_, id) => ({ id, weight: 1 }));

/** How far the worst decile of the range strays from its share, over `n` draws. */
function worstDrift(size: number, n = 120_000): number {
  const pool = flat(size);
  const buckets = 10;
  const counts = new Array<number>(buckets).fill(0);
  // Bucket by *share of the pool* rather than by id, so buckets hold equal weight even when the
  // pool does not divide by ten: bucketing by id makes a 14-entry bucket look like a 5% bias.
  const edges = Array.from({ length: buckets + 1 }, (_, at) => Math.round((at * size) / buckets));
  for (let i = 0; i < n; i += 1) {
    const id = drawWeighted(pool, `drift:${size}:${i}`)!;
    const bucket = edges.findIndex((edge, at) => at > 0 && id < edge) - 1;
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return Math.max(
    ...counts.map((count, at) => {
      const share = (edges[at + 1]! - edges[at]!) / size;
      return Math.abs(count / (n * share) - 1);
    }),
  );
}

describe('drawWeighted draws uniformly over the range', () => {
  /**
   * The three real pools, by their actual weight totals (`blueprints/prize.ts`): upgrade 585,
   * unit 416, consumable 133. None of them divides `2^32`, which is the whole point.
   */
  it.each([585, 416, 133])('spreads a flat pool of %i evenly across the range', (size) => {
    // 4% is far outside sampling noise at this count (a decile's 2-sigma is about 0.9%) and far
    // inside the ~10% the modulus produced, so this fails loudly on a regression and never flakes.
    expect(worstDrift(size), `pool of ${size} is lopsided`).toBeLessThan(0.04);
  });

  /**
   * The specific arithmetic, stated as a fact rather than a distribution.
   *
   * With the old modulus the *first* third of the range was the over-drawn part, every time,
   * because the surplus residues are always the low ones. So the front half taking a clear
   * majority is the signature, and it is worth pinning on its own: a sampling test can be argued
   * with, a 7-point lead over 120,000 draws cannot.
   */
  it('does not favour the front of the range over the back', () => {
    const pool = flat(585);
    let front = 0;
    const n = 120_000;
    for (let i = 0; i < n; i += 1) front += drawWeighted(pool, `half:${i}`)! < 292 ? 1 : 0;
    expect(Math.abs(front / n - 0.5), `${front} of ${n} landed in the front half`).toBeLessThan(
      0.01,
    );
  });

  it('is a pure function of its seed, and answers a pool with nothing in it with null', () => {
    const pool = flat(40);
    const once = drawWeighted(pool, 'steady');
    for (let again = 0; again < 8; again += 1) expect(drawWeighted(pool, 'steady')).toBe(once);
    expect(drawWeighted([], 'empty')).toBeNull();
    expect(drawWeighted([{ id: 'a', weight: 0 }], 'zero')).toBeNull();
  });

  /** A fractional ladder still reaches both ends, which is what the last-entry fallback is for. */
  it('honours weights rather than treating the pool as flat', () => {
    const pool = [
      { id: 'common', weight: 0.9 },
      { id: 'rare', weight: 0.1 },
    ];
    let rare = 0;
    for (let i = 0; i < 20_000; i += 1) {
      if (drawWeighted(pool, `ladder:${i}`) === 'rare') rare += 1;
    }
    expect(rare / 20_000).toBeGreaterThan(0.08);
    expect(rare / 20_000).toBeLessThan(0.12);
  });
});

describe('the primitives underneath', () => {
  it('spreads seeds that differ only in their last characters', () => {
    const seen = new Set(Array.from({ length: 5000 }, (_, i) => seedFrom(`account-${i}`) % 256));
    // A character sum would cluster hard here, which is the failure `seedFrom`'s doc names.
    expect(seen.size).toBeGreaterThan(200);
  });

  it('advances rather than returning the same number forever', () => {
    const next = mulberry32(seedFrom('advance'));
    const run = Array.from({ length: 500 }, () => next());
    expect(new Set(run).size).toBe(run.length);
    expect(Math.min(...run)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...run)).toBeLessThan(1);
  });
});
