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
  'head_spy',
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
  'scout',
  'consigliere',
  'professor',
] as const;

export const OfficerRoleSchema = z.enum(OFFICER_ROLES);
export type OfficerRole = z.infer<typeof OfficerRoleSchema>;

export const OFFICER_ROLE_LABELS: Record<OfficerRole, string> = {
  head_spy: 'Head Spy',
  lead_engineer: 'Lead Engineer',
  finance_officer: 'Finance Officer',
  head_of_growth: 'Head of Growth',
  field_commander: 'Field Commander',
  head_of_research: 'Head of Research',
  wetware_chief: 'Wetware Chief',
  fabricator: 'Fabricator',
  salvager: 'Salvager',
  right_hand: 'Right Hand',
  cartographer: 'Cartographer',
  trader: 'Trader',
  security_officer: 'Security Officer',
  chief_medic: 'Chief Medic',
  instructor_of_the_young: 'Instructor of the Young',
  raid_boss: 'Raid Boss',
  scout: 'Scout',
  consigliere: 'Consigliere',
  professor: 'Professor',
};

/**
 * The faces an officer can have (§C).
 *
 * A **pool**, not a portrait per role: the art is forty-three people, and a Head Spy is a job
 * rather than a face. Which one a given officer wears is derived from their id rather than stored
 * (see `officerPortraitId`), so every officer already on a save has a face the moment the pool
 * lands, with no migration and no column.
 */
export const OFFICER_PORTRAIT_IDS: readonly string[] = Array.from({ length: 43 }, (_, index) =>
  String(index + 1).padStart(2, '0'),
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
  return OFFICER_PORTRAIT_IDS[hashOf(commanderId) % OFFICER_PORTRAIT_IDS.length] as string;
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
 * Assigned in **sorted id order** for two reasons: the answer cannot depend on the order a caller
 * happens to hold the roster in, and hiring somebody new cannot move the face of anybody already
 * placed, because everyone sorted before them is resolved first and their choice does not change.
 *
 * The pool is larger than the nineteen seats, so this always terminates with everybody distinct.
 */
export function officerPortraits(commanderIds: readonly string[]): ReadonlyMap<string, string> {
  const size = OFFICER_PORTRAIT_IDS.length;
  const taken = new Set<string>();
  const assigned = new Map<string, string>();
  for (const id of [...new Set(commanderIds)].sort()) {
    const hash = hashOf(id);
    const stride = (hash % (size - 1)) + 1;
    let pick = OFFICER_PORTRAIT_IDS[hash % size] as string;
    for (let step = 1; taken.has(pick) && step < size; step += 1) {
      pick = OFFICER_PORTRAIT_IDS[(hash + step * stride) % size] as string;
    }
    /*
     * The sweep is not belt-and-braces, it is the part that makes the promise true.
     *
     * A double-hash probe only visits every slot when the stride is coprime with the pool size.
     * The pool is 43, which is prime, so every stride in 1..42 is coprime with it and the probe
     * does walk the whole pool: measured, no full nineteen-chair roster in two hundred thousand
     * reaches this line. It is not dead code, it is the part that keeps the promise true if the
     * pool size ever stops being prime. At the old size of 33 (3 x 11) any stride that was a
     * multiple of 3 or 11 walked a subset and came back to a taken slot having missed free ones,
     * and eight full rosters in three thousand still had a duplicate. A linear pass over what is
     * left cannot fail while the pool is larger than the roster.
     */
    if (taken.has(pick)) {
      pick = OFFICER_PORTRAIT_IDS.find((face) => !taken.has(face)) ?? pick;
    }
    taken.add(pick);
    assigned.set(id, pick);
  }
  return assigned;
}

/**
 * C4: reskilling (§G4) is the Professor's job. The reassign-everyone process gates on *this*
 * constant rather than hardcoding its own role check.
 */
export const RESKILLING_ROLE: OfficerRole = 'professor';

/**
 * C4/B9: the librarian-ish research task that buys partial hiring insight is a Professor /
 * Head of Research activity. W7 (research) gates the task on *this* constant.
 *
 * Note what the task yields: hints about what pairs well with what. Never the raw requirement
 * table (B8).
 */
export const HIRING_INSIGHT_ROLES: readonly OfficerRole[] = ['professor', 'head_of_research'];

export function isOfficerRole(value: string): value is OfficerRole {
  return (OFFICER_ROLES as readonly string[]).includes(value);
}
