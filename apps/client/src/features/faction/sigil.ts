/**
 * Which face a person at the table wears, decided by their account id.
 *
 * The payload carries no portrait for a faction member (`FactionMemberSchema` is a name, a
 * district and some numbers), and the art policy says an agent draws rather than generates. So the
 * roster's portraits are assembled from a small set of drawn parts, and *which* parts a member gets
 * is a hash of their user id: stable across reloads, stable across machines, and free.
 *
 * The pick is here rather than in the component because it is the only part with a wrong answer.
 * A hash that collapses (every id landing on the same face) draws a roster of identical people and
 * looks like a rendering bug rather than like a hash, and that is a thing a test can hold.
 */

/** How many drawings there are of each part. `MemberSigil` holds the paths. */
export const SIGIL_SKULLS = 4;
export const SIGIL_FACES = 5;
export const SIGIL_HATS = 4;

export interface Sigil {
  /** The head outline. */
  skull: number;
  /** What is on the face: a visor, goggles, a respirator, a patch, or nothing. */
  face: number;
  /** What is on the head: nothing, a cap, a hood, a crest. */
  hat: number;
}

/**
 * FNV-1a, 32 bits.
 *
 * Any cheap avalanche would do. What matters is that neighbouring ids (`ally-1`, `ally-2`) land far
 * apart, which a sum of char codes does not: the seeded world hands out ids that differ in one
 * character, so a weak mixer puts the whole roster in the same face.
 */
function hash(seed: string): number {
  let value = 0x811c9dc5;
  for (let at = 0; at < seed.length; at += 1) {
    value ^= seed.charCodeAt(at);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/** The three drawings this person is made of. Same id, same face, always. */
export function sigilOf(seed: string): Sigil {
  const value = hash(seed);
  return {
    skull: value % SIGIL_SKULLS,
    // Shifted rather than divided by the previous modulus: taking successive remainders of the same
    // number correlates the parts, so a given skull would only ever appear with two of the faces.
    face: (value >>> 8) % SIGIL_FACES,
    hat: (value >>> 17) % SIGIL_HATS,
  };
}
