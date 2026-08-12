/**
 * A small seeded PRNG. Character generation must be reproducible: the Bar's roster is one
 * global roll shared by every player (GDD §H2a), so it has to be a pure function of its seed.
 */
export type Rng = () => number;

/** mulberry32 — fast, and good enough for content rolls. */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

/** Pick `count` distinct members, Fisher-Yates on a copy. */
export function sample<T>(rng: Rng, items: readonly T[], count: number): T[] {
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j] as T, pool[i] as T];
  }
  return pool.slice(0, count);
}
