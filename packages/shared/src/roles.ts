import { z } from 'zod';

/**
 * Officer roles (GDD §C).
 *
 * Humans are generic; a role is what you hire them *into* (C2). Any character can be slotted
 * anywhere: well or badly. One officer per role slot: a role is either filled or empty (C3).
 *
 * This module is the public half of the role model: ids, display names, and the §C4 bindings.
 * What a role actually *requires* is a hidden, server-side-only table (B8, B8a). It is not in
 * this package and must never be.
 */

export const OFFICER_ROLES = [
  'master_of_whispers',
  'lead_engineer',
  'finance_officer',
  'head_of_growth',
  'field_commander',
  'head_of_research',
  'wetware_chief',
  'fabricator',
  'salvager',
  'right_hand',
  'cartographer',
  'trader',
  'security_officer',
  'chief_medic',
  'instructor_of_the_young',
  'raid_boss',
  'consigliere',
  'professor',
] as const;

export const OfficerRoleSchema = z.enum(OFFICER_ROLES);
export type OfficerRole = z.infer<typeof OfficerRoleSchema>;

export const OFFICER_ROLE_LABELS: Record<OfficerRole, string> = {
  master_of_whispers: 'Master of Whispers',
  lead_engineer: 'Lead Engineer',
  finance_officer: 'Head of Finance',
  head_of_growth: 'Head of Growth',
  field_commander: 'Field Commander',
  head_of_research: 'Head of Research',
  wetware_chief: 'Wetware Chief',
  fabricator: 'Fabricator',
  salvager: 'Salvager',
  right_hand: 'Right Hand',
  cartographer: 'Cartographer',
  trader: 'Trader',
  security_officer: 'Head of Security',
  chief_medic: 'Chief Medic',
  instructor_of_the_young: 'Instructor of the Young',
  raid_boss: 'Raid Boss',
  consigliere: 'Consigliere',
  professor: 'Professor',
};

/**
 * What a chair with nobody's name on it is called, everywhere it is printed.
 *
 * Shared rather than typed out on each screen, because the training board, the crew page and the
 * Bar all name it and three copies of one word drift the moment somebody rewords one of them.
 */
export const BENCH_LABEL = 'On the bench';

/**
 * The faces an officer can have (§C).
 *
 * A **pool**, not a portrait per role: the art is a hundred and sixty-four people, and a Master of Whispers
 * is a job rather than a face. Which one a given officer wears is derived from their id rather than
 * stored (see `officerPortraitId`), so every officer already on a save has a face the moment the
 * pool lands, with no migration and no column.
 *
 * This is the list of art that **exists**, which is what the manifest and the order sheet are
 * about. What the game actually hands out is {@link ASSIGNABLE_OFFICER_PORTRAIT_IDS}, and the two
 * are not the same list.
 *
 * Grown only at the end, never in the middle. `officerPortraitId` indexes this list by hash, so an
 * id inserted anywhere but the tail moves every face after it onto a different officer, on saves
 * that already exist.
 */
export const OFFICER_PORTRAIT_IDS: readonly string[] = Array.from({ length: 164 }, (_, index) =>
  String(index + 1).padStart(2, '0'),
);

/**
 * The thirty faces an **overseer** can have, and no one else (§C, board 2026-09-15).
 *
 * A separate pool rather than thirty more entries in {@link OFFICER_PORTRAIT_IDS}, because the
 * overseer is the player and the officers are the people the player hires. A face that can turn up
 * on both sides of that line reads as the player having hired themselves, which is the crew-screen
 * twin bug one table up arriving from a different direction. Kept disjoint by construction: the
 * two lists share no id, the art shares no master, and `roles.test.ts` pins both.
 *
 * These are `portraitId` values, the form an `OverseerPreset` stores and the client passes to
 * `deliveredUrl({ type: 'portrait', portraitId })`. The asset key is `portrait-<id>`, so this list
 * delivers `portrait-overseer-01` through `portrait-overseer-30`. The zero padding is what keeps
 * them clear of the original four heroes, whose keys are `portrait-overseer-1` to
 * `portrait-overseer-4` and whose art is not from this drop.
 */
export const OVERSEER_PORTRAIT_IDS: readonly string[] = Array.from(
  { length: 30 },
  (_, index) => `overseer-${String(index + 1).padStart(2, '0')}`,
);

/**
 * Two faces in the delivered art that are not their own face.
 *
 * `officer-42` is pixel-identical to `officer-26`, and `officer-43` is `officer-33` mirrored. A
 * roster is guaranteed distinct *ids* by {@link officerPortraits}, which is why this was never
 * caught there: two different ids were drawing the same person, once the right way round and once
 * flipped, and on the crew screen that reads as a bug, because it is one.
 *
 * Measured rather than eyeballed. Every portrait is compared against every other and against its
 * mirror on a 16x16 luminance signature, one bit per cell set where the cell is above the
 * signature's own mean, scored by Hamming distance over the 256 bits. These two pairs sit at 0 and
 * 1, the 1 being resampling noise on the mirrored one, and the next closest pair anywhere is at 36.
 * There is no judgement call in the cut.
 *
 * Re-run over the whole pool on 2026-09-15, when the drop that became `officer-140` to
 * `officer-164` and the thirty {@link OVERSEER_PORTRAIT_IDS} landed: 194 masters, 18721 pairs, the
 * same two at 0 and 1 and nothing else under 36. The sweep is not a per-commit test because it
 * decodes two hundred masters; what the suite pins is this list and the counts around it.
 */
export const DUPLICATE_OFFICER_PORTRAIT_IDS: readonly string[] = ['42', '43'];

/**
 * The faces the game will actually give somebody.
 *
 * Separate from {@link OFFICER_PORTRAIT_IDS} because the two answer different questions. That list
 * is what art exists, and the manifest and `docs/ART-ORDER.md` are built from it; this one is what
 * a roster may draw from. Dropping a duplicate from the second does not pretend the file is gone:
 * it stays on disk, still described, for the maintainer to replace with a new face. The day they do,
 * `DUPLICATE_OFFICER_PORTRAIT_IDS` goes back to empty and the two lists are the same again.
 *
 * A hundred and sixty-two, and it is **not** prime, which is the case the linear sweep in
 * {@link officerPortraits} was written for. The probe there only walks the whole pool when its
 * stride is coprime with the size, and 162 is 2 x 3^4, so every even stride and every multiple of
 * three walks a subset. Two drops running the number happened to be prime (ninety-nine faces less
 * the two duplicates is ninety-seven; a hundred and thirty-nine less the same two is a hundred and
 * thirty-seven) and the comment here read that luck as a property. This drop ends it, and nothing
 * about the guarantee changes: the sweep finishes what the probe misses.
 */
export const ASSIGNABLE_OFFICER_PORTRAIT_IDS: readonly string[] = OFFICER_PORTRAIT_IDS.filter(
  (portraitId) => !DUPLICATE_OFFICER_PORTRAIT_IDS.includes(portraitId),
);

/** FNV-1a over the id. A character sum clusters hard over UUIDs; this does not. */
function hashOf(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The face one person wears when there is nobody to clash with.
 *
 * For a lone card: a recruit being read at the Bar, a preview, a test. Where several people are on
 * screen together, use {@link officerPortraits} instead, which is the same rule plus the one thing
 * this cannot know about.
 */
export function officerPortraitId(commanderId: string): string {
  return ASSIGNABLE_OFFICER_PORTRAIT_IDS[
    hashOf(commanderId) % ASSIGNABLE_OFFICER_PORTRAIT_IDS.length
  ] as string;
}

/**
 * Faces for a whole roster, **no two the same**.
 *
 * Hashing each id on its own is not enough and the arithmetic says why: forty-three faces against
 * six officers is the birthday problem, and it collides on **31% of rosters** (it was 38% at the
 * old pool of thirty-three). That is not an unlucky save, it is the common case, and a crew screen
 * showing one woman twice reads as a bug because it is one. At a full nineteen-chair roster the
 * naive pick collides on 99% of them.
 *
 * So the pick is a property of the roster rather than of the person. Each officer keeps their own
 * probe sequence (double hashing, so two people who want the same face do not then want the same
 * second choice either), and the first free face in it is theirs.
 *
 * Assigned in **roster order**, which is hire order: `hireRecruit` appends
 * (`apps/server/src/bar/hire.ts`), reassigning maps in place and releasing filters, so a crew's
 * `commanders` array is the order they were signed in. That is what makes the promise this function
 * is written for true: **hiring somebody new cannot move the face of anybody already placed**,
 * because everybody already on the books is resolved before the newcomer and their choice does not
 * change.
 *
 * It used to sort by id instead, for the different property that the answer could not depend on the
 * order a caller held the roster in. Officer ids are UUIDs, so a new hire sorts *anywhere* in the
 * list, and when it landed before an existing officer with a colliding probe sequence it took the
 * face first and the incumbent probed on to a different one: measured at 1.8% of hires on a
 * four-officer roster, 4.0% at eight, 5.8% at twelve and 11.2% at a full nineteen chairs. A player
 * who has looked at the same face for a week hires somebody and finds one of their officers is now
 * a different person, which is the exact failure the distinctness rule exists to avoid, arriving
 * from the other side.
 *
 * The two properties cannot both hold: with a fixed pool and no stored assignment, resolving a
 * collision has to prefer somebody, and "the incumbent" is only expressible as an order. Stability
 * is the one a player can see.
 *
 * **So the caller must pass the roster in its own order and must not sort it.** Both live callers
 * do (`apps/server/src/crew/training.ts` maps `base.commanders`, and the crew screen maps the
 * `officers` array the server projected from it in the same order), and the two sides compute this
 * independently, so a caller that re-sorted would draw different faces from the same roster.
 *
 * The pool is larger than the nineteen seats, so this always terminates with everybody distinct.
 */
export function officerPortraits(commanderIds: readonly string[]): ReadonlyMap<string, string> {
  const size = ASSIGNABLE_OFFICER_PORTRAIT_IDS.length;
  const taken = new Set<string>();
  const assigned = new Map<string, string>();
  for (const id of new Set(commanderIds)) {
    const hash = hashOf(id);
    const stride = (hash % (size - 1)) + 1;
    let pick = ASSIGNABLE_OFFICER_PORTRAIT_IDS[hash % size] as string;
    for (let step = 1; taken.has(pick) && step < size; step += 1) {
      pick = ASSIGNABLE_OFFICER_PORTRAIT_IDS[(hash + step * stride) % size] as string;
    }
    /*
     * The sweep is not belt-and-braces, it is the part that makes the promise true.
     *
     * A double-hash probe only visits every slot when the stride is coprime with the pool size.
     * The pool is 162, which is 2 x 3^4, so half the strides walk a subset and can come back to a
     * taken slot having missed free ones. That used to be hypothetical, because the pool was 137
     * and every stride is coprime with a prime; it is not any more. At the old size of 33 (3 x 11)
     * the same arithmetic left eight full rosters in three thousand with a duplicate, and this
     * line is what stops that. A linear pass over what is left cannot fail while the pool is
     * larger than the roster, and 162 faces against nineteen chairs is not close.
     */
    if (taken.has(pick)) {
      pick = ASSIGNABLE_OFFICER_PORTRAIT_IDS.find((face) => !taken.has(face)) ?? pick;
    }
    taken.add(pick);
    assigned.set(id, pick);
  }
  return assigned;
}

/**
 * Faces for people who do not have one yet, against everyone in the city who does.
 *
 * The city-wide half of the rule (maintainer request, 2026-09-11): a face on somebody's books is
 * nobody else's, on any crew. `taken` is every stored `portraitId` in the city; `ids` are the
 * people to place, in order (a Bar roster in seat order, or the officers of one base in hire
 * order), and each gets the first face in their own probe sequence that neither the city nor
 * anybody placed before them holds. The probe is {@link officerPortraits}'s, so a roster with no
 * city behind it resolves exactly as it always did.
 *
 * **When the pool runs out** the walk finds nothing free, and the fallback is the person's own
 * hashed face, shared or not: a hundred and sixty-two faces is the whole of the delivered art, and
 * refusing to draw the hundred and sixty-third officer in a city would be worse than a twin. The
 * board is still adding portraits; the day the pool is bigger than the city's roster this branch is
 * never reached.
 */
export function freePortraits(
  ids: readonly string[],
  taken: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const size = ASSIGNABLE_OFFICER_PORTRAIT_IDS.length;
  const used = new Set(taken);
  const assigned = new Map<string, string>();
  for (const id of new Set(ids)) {
    const hash = hashOf(id);
    const stride = (hash % (size - 1)) + 1;
    let pick = ASSIGNABLE_OFFICER_PORTRAIT_IDS[hash % size] as string;
    for (let step = 1; used.has(pick) && step < size; step += 1) {
      pick = ASSIGNABLE_OFFICER_PORTRAIT_IDS[(hash + step * stride) % size] as string;
    }
    if (used.has(pick)) {
      pick =
        ASSIGNABLE_OFFICER_PORTRAIT_IDS.find((face) => !used.has(face)) ?? officerPortraitId(id);
    }
    used.add(pick);
    assigned.set(id, pick);
  }
  return assigned;
}

/**
 * C4: reskilling (§G4) is the Professor's job. The reassign-everyone process gates on *this*
 * constant rather than hardcoding its own role check.
 */
export const RESKILLING_ROLE: OfficerRole = 'professor';

export function isOfficerRole(value: string): value is OfficerRole {
  return (OFFICER_ROLES as readonly string[]).includes(value);
}
