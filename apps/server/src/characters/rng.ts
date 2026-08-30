import { mulberry32 } from '@frontline/shared';

/**
 * The draws character generation takes, over the shared generator.
 *
 * Reproducibility is the whole requirement: the Bar's roster is one global roll every player sees
 * the same way (GDD §H2a), so it has to be a pure function of its seed on every process and host.
 *
 * `createRng` used to be a second mulberry32, byte for byte identical to the one in the shared
 * package. Two copies of a generator is two chances for one of them to be "improved" and quietly
 * start dealing a different roster than the one a test pinned, and the compiler cannot see it
 * happen. What is left here is the part that is genuinely this module's own: a normal deviate, a
 * uniform integer, and two ways of drawing without replacement.
 */
export type Rng = () => number;

/** The shared generator, under the name this module's callers already use. */
export const createRng = (seed: number): Rng => mulberry32(seed);

/** Box-Muller normal deviate. */
export function gaussian(rng: Rng, mean: number, stdDev: number): number {
  const u = 1 - rng();
  const v = rng();
  return mean + stdDev * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** A uniform integer in [min, max]. */
export function randomInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

/** Pick `count` distinct members, Fisher-Yates on a copy. A non-positive `count` picks none. */
export function sample<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j] as T, pool[i] as T];
  }
  return pool.slice(0, Math.max(0, count));
}

/**
 * Pick `count` distinct members with probability proportional to weight: Efraimidis-Spirakis:
 * key each item as `u ** (1 / weight)` and keep the largest keys, which is exactly weighted
 * sampling without replacement in one pass. A non-positive `count` picks none.
 */
export function weightedSample<T>(
  rng: Rng,
  entries: readonly (readonly [T, number])[],
  count: number,
): T[] {
  return entries
    .map(([item, weight]) => ({ item, key: rng() ** (1 / weight) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, Math.max(0, count))
    .map(({ item }) => item);
}
