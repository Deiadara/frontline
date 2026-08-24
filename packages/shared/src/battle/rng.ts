/**
 * Deterministic rolls for battle resolution.
 *
 * A battle has to replay identically from its persisted row (see `docs/ARCHITECTURE.md`), so the
 * roll cannot come from `Math.random()`. The seed is a string because that is what the battle row
 * stores and what a replay hands back: callers never deal in the 32-bit internal state.
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
