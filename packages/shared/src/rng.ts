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
