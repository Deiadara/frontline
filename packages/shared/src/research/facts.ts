import { z } from 'zod';
import {
  ATTRIBUTE_NAMES,
  attributeTier,
  type AttributeName,
  type AttributeTier,
  type Attributes,
} from '../attributes.js';
import { OfficerRoleSchema, type OfficerRole } from '../roles.js';

/**
 * What research has taught this crew about hiring (GDD §B9).
 *
 * ####################### THE PUBLIC HALF: NO HIDDEN TABLE #######################
 *
 * §B9 is the one feature allowed to put role knowledge on the wire, which makes it the one most
 * able to defeat §B8a. The containment is structural rather than careful: everything a player is
 * ever told is a **discovered fact**, and this module, which is compiled into the client bundle:
 * can only ever *read* facts. It has no access to the hidden requirement table and cannot import
 * it: the W1 leak guard fails the build if anything under `packages/shared` so much as names it,
 * which is why this comment does not either, and there is nothing here that could reconstruct a
 * weight, an ordering or a fit score even given every fact in the game.
 *
 * Minting facts is the server's job and lives in `apps/server/src/research/discover.ts`.
 *
 * Three properties keep "partial insight" from becoming the raw table (INTERFACES R4):
 *
 *  1. **No numbers.** A fact says an attribute is *in* a role's template. It never says how much
 *     it weighs, and the weights are what the ordering is made of.
 *  2. **Capped below the profile.** `MAX_ROLE_FACTS` is strictly less than the five attributes
 *     every template carries, so a complete profile is not reachable by grinding.
 *  3. **Reveal order carries no signal.** The server reveals in canonical attribute order, never
 *     in weight order: otherwise the sequence itself would spell out the ordering the fact
 *     bodies withhold.
 *
 * #################################################################################
 */

/**
 * How many of a role's template attributes research can ever name. Templates hold five, so two
 * always stay unknown and the raw profile stays unreachable (§B8, INTERFACES R4).
 */
export const MAX_ROLE_FACTS = 3;

/**
 * How many "these two go together" pairings the crew can ever collect.
 *
 * Pairings are role-free, but the union of enough of them is a co-occurrence graph whose maximal
 * cliques *are* the templates. This cap keeps the collection far short of that.
 */
export const MAX_PAIRINGS = 12;

/** "The Head Spy job leans on Stealth": §B9's feedback about an assignment for a given role. */
export const RoleAttributeFactSchema = z.object({
  kind: z.literal('role_attribute'),
  role: OfficerRoleSchema,
  attribute: z.enum(ATTRIBUTE_NAMES),
});
export type RoleAttributeFact = z.infer<typeof RoleAttributeFactSchema>;

/**
 * "Deception and Hacking go together": §B9's *what pairs well with what*, and deliberately
 * role-free: it names no job, so collecting one never extends any role's profile past
 * `MAX_ROLE_FACTS`.
 *
 * The pair is stored in canonical attribute order so a pairing has exactly one representation.
 */
export const PairingFactSchema = z.object({
  kind: z.literal('pairing'),
  attributes: z.tuple([z.enum(ATTRIBUTE_NAMES), z.enum(ATTRIBUTE_NAMES)]),
});
export type PairingFact = z.infer<typeof PairingFactSchema>;

export const DiscoveredFactSchema = z.discriminatedUnion('kind', [
  RoleAttributeFactSchema,
  PairingFactSchema,
]);
export type DiscoveredFact = z.infer<typeof DiscoveredFactSchema>;

/** Canonical position of an attribute: the order everything here sorts and reveals in. */
export function attributeIndex(attribute: AttributeName): number {
  return ATTRIBUTE_NAMES.indexOf(attribute);
}

/** A pairing in canonical order, so `(a,b)` and `(b,a)` are the same fact. */
export function makePairing(a: AttributeName, b: AttributeName): PairingFact {
  const ordered = attributeIndex(a) <= attributeIndex(b) ? ([a, b] as const) : ([b, a] as const);
  return { kind: 'pairing', attributes: [ordered[0], ordered[1]] };
}

/** Stable identity of a fact: what de-duplication and "do we already know this?" run on. */
export function factKey(fact: DiscoveredFact): string {
  return fact.kind === 'pairing'
    ? `pairing:${fact.attributes[0]}+${fact.attributes[1]}`
    : `role:${fact.role}:${fact.attribute}`;
}

export function knowsFact(facts: readonly DiscoveredFact[], fact: DiscoveredFact): boolean {
  const key = factKey(fact);
  return facts.some((known) => factKey(known) === key);
}

/** What is known about `role`, in canonical attribute order. */
export function roleFactsIn(facts: readonly DiscoveredFact[], role: OfficerRole): AttributeName[] {
  return facts
    .filter(
      (fact): fact is RoleAttributeFact => fact.kind === 'role_attribute' && fact.role === role,
    )
    .map((fact) => fact.attribute)
    .sort((a, b) => attributeIndex(a) - attributeIndex(b));
}

/** Every pairing known, in canonical order. */
export function pairingsIn(facts: readonly DiscoveredFact[]): PairingFact[] {
  return facts
    .filter((fact): fact is PairingFact => fact.kind === 'pairing')
    .sort(
      (a, b) =>
        attributeIndex(a.attributes[0]) - attributeIndex(b.attributes[0]) ||
        attributeIndex(a.attributes[1]) - attributeIndex(b.attributes[1]),
    );
}

/** True once `role` has given up everything it is ever going to (`MAX_ROLE_FACTS`). */
export function roleFullyResearched(facts: readonly DiscoveredFact[], role: OfficerRole): boolean {
  return roleFactsIn(facts, role).length >= MAX_ROLE_FACTS;
}

/**
 * One line of §B9 feedback: an attribute research has told you this job leans on, and how the
 * candidate reads on it.
 */
export interface AssignmentNote {
  attribute: AttributeName;
  /** The candidate's own rating: already on their visible sheet, restated for convenience. */
  value: number;
  /** `attributeTier`'s public reading of that rating. Not a fit score: it knows nothing of `role`. */
  tier: AttributeTier;
}

/**
 * §B9: "feedback you can ask for about a potential assignment for a given role".
 *
 * Pure over a **visible sheet** and the crew's **discovered facts**, which is the whole safety
 * argument: the client can and does call this itself, so there is no server-side judgement to
 * leak. Nothing is ranked, scored or totalled: the player is handed the attributes they have
 * earned the right to know about and draws their own conclusion, exactly as §B8 requires.
 *
 * A role nothing is known about yields an empty list, which is the honest answer.
 */
export function consultOnAssignment(
  attributes: Attributes,
  role: OfficerRole,
  facts: readonly DiscoveredFact[],
): AssignmentNote[] {
  return roleFactsIn(facts, role).map((attribute) => ({
    attribute,
    value: attributes[attribute],
    tier: attributeTier(attributes[attribute]),
  }));
}
