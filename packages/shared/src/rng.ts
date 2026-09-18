/**
 * Deterministic rolls, for everything in the game that must come out the same way twice.
 *
 * A battle has to replay identically from its persisted row (see `docs/ARCHITECTURE.md`), so the
 * roll cannot come from `Math.random()`. Neither can the Bar's nightly roster, which is one global
 * draw every player sees the same way, nor the vendor's shelf, nor which missions a district is
 * offering. The seed is a string because that is what those rows store and what a replay hands
 * back: callers never deal in the 32-bit internal state.
 *
 * **This lives at the top level rather than under `battle/`, and that is the point.** It was a
 * battle module, so the four other systems that needed the same two functions each grew their own
 * copy: `missions.areas.ts`, `market/vendor.ts` and the server's `bar/roster.ts` all carried a
 * private `seedFrom`, and `characters/rng.ts` carried a second mulberry32 byte for byte. Four
 * copies of a hash is four chances for one of them to be "improved" and quietly start producing a
 * different roster than the one a test pinned.
 */

/** FNV-1a. Spreads seeds that differ only in their last characters, which sequential ids do. */
export function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    // The 32-bit FNV prime, as shifts: `hash * 16777619` overflows a double's integer range.
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

/**
 * mulberry32: a 32-bit generator. Small and well-distributed enough for a win/lose draw, and it
 * *advances*, so a future model needing several draws per battle gets them from one seed rather
 * than having to re-hash.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The one draw a battle currently takes. Same seed in, same number out, forever. */
export function seededRoll(seed: string): number {
  return mulberry32(seedFrom(seed))();
}

/**
 * One entry out of a weighted pool, off a hash rather than a stream.
 *
 * Seeded the same way a uniform `seedFrom(seed) % length` pick is, so a given seed answers the same
 * way forever; what a weight changes is only which entry a given point in the range lands on.
 *
 * It lives here rather than beside its first caller because there are now two of them, the page
 * draw in `blueprints/prize.ts` and the rarity draw the Reimagining bench takes, and a second copy
 * of this loop is a second place for the scaling trick below to be "tidied" into a float.
 *
 * Weights may be integers (the page pool) or fractions summing to one (the odds ladder): the hash
 * is an integer of arbitrary size, so taking it modulo a scaled total and dividing back is what
 * turns it into a point in [0, total) without ever going through a float. Returns null on an empty
 * pool or one whose weights are all zero, which is a question with no answer rather than a default.
 */
export function drawWeighted<T>(
  pool: readonly { id: T; weight: number }[],
  seed: string,
): T | null {
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
  if (pool.length === 0 || total <= 0) return null;
  const SCALE = 1_000_000;
  let at = (seedFrom(seed) % Math.round(total * SCALE)) / SCALE;
  for (const entry of pool) {
    at -= entry.weight;
    if (at < 0) return entry.id;
  }
  return pool[pool.length - 1]!.id;
}
