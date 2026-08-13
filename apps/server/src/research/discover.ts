import {
  ATTRIBUTE_NAMES,
  MAX_PAIRINGS,
  MAX_ROLE_FACTS,
  OFFICER_ROLES,
  attributeIndex,
  knowsFact,
  makePairing,
  pairingsIn,
  roleFactsIn,
  type AttributeName,
  type DiscoveredFact,
  type OfficerRole,
  type PairingFact,
} from '@frontline/shared';
import { attributeWeightsOf } from '../roles/requirements.js';

/**
 * Turning the hidden role requirement table into discovered facts (GDD §B9).
 *
 * ####################### THE ONLY BRIDGE OFF THE HIDDEN TABLE #######################
 *
 * This module is the single place in the codebase where `ROLE_REQUIREMENTS` is allowed to produce
 * something a player will eventually see. Everything it emits is a `DiscoveredFact`: an attribute
 * *name*, or a pair of them. No weight, no ordering, no score crosses this line, and the caps
 * below mean the raw profile is not reachable however long a crew grinds (INTERFACES R4).
 *
 * Two properties are load-bearing and are asserted in `discovery.leak.test.ts`:
 *
 *  - **The reveal order is weight-blind.** Everything sorts by `ATTRIBUTE_NAMES` position, never
 *    by weight. If facts came out heaviest-first, the *sequence* would spell out the ordering the
 *    fact bodies are careful not to carry — a leak with no leaked value anywhere in it.
 *  - **Cross-referencing does not extend the role you asked about.** Pairings are drawn from one
 *    global enumeration that does not depend on the investigated role, so §F4's bonus cannot be
 *    used to walk a single role's profile past `MAX_ROLE_FACTS`.
 *
 * ####################################################################################
 */

/**
 * Which attributes of `role` research can ever name, in reveal order.
 *
 * `attributeWeightsOf` hands back the template in *declaration* order — which happens to be
 * descending weight order, because every literal in `ROLE_REQUIREMENTS` is authored heaviest-first
 * (pinned by `../roles/requirements.test.ts`). Passing it through untouched would therefore leak
 * the primary as fact #1, so this immediately re-sorts into canonical order and then truncates:
 * which attributes are revealed — and in which sequence — is decided by `ATTRIBUTE_NAMES`, not by
 * how much the role cares. Templates hold five and `MAX_ROLE_FACTS` is three, so two are withheld
 * from every role, permanently.
 */
export function discoverableAttributes(role: OfficerRole): AttributeName[] {
  const template = new Set(attributeWeightsOf(role).map(([name]) => name));
  return ATTRIBUTE_NAMES.filter((name) => template.has(name)).slice(0, MAX_ROLE_FACTS);
}

/** The next thing an investigation into `role` would turn up, or nothing if it is exhausted. */
export function nextRoleFact(
  role: OfficerRole,
  facts: readonly DiscoveredFact[],
): DiscoveredFact | null {
  const known = new Set(roleFactsIn(facts, role));
  const attribute = discoverableAttributes(role).find((name) => !known.has(name));
  return attribute ? { kind: 'role_attribute', role, attribute } : null;
}

/**
 * Every pairing that exists in the game, de-duplicated and in canonical order.
 *
 * Built from all 19 templates at once and sorted by attribute position, so the order a crew meets
 * them in says nothing about which role any of them came from — which is what keeps §F4's reward
 * role-free. Computed once: the table is a module constant and never changes at runtime.
 */
const ALL_PAIRINGS: readonly PairingFact[] = (() => {
  const byKey = new Map<string, PairingFact>();
  for (const role of OFFICER_ROLES) {
    const template = attributeWeightsOf(role)
      .map(([name]) => name)
      .sort((a, b) => attributeIndex(a) - attributeIndex(b));
    for (const [i, first] of template.entries()) {
      for (const second of template.slice(i + 1)) {
        const pairing = makePairing(first, second);
        byKey.set(`${pairing.attributes[0]}+${pairing.attributes[1]}`, pairing);
      }
    }
  }
  return pairingsIn([...byKey.values()]);
})();

/** How many distinct pairings exist at all — the number `MAX_PAIRINGS` is a small fraction of. */
export const TOTAL_PAIRINGS = ALL_PAIRINGS.length;

/** True once the crew has collected every pairing it is ever allowed to hold. */
export function pairingsExhausted(facts: readonly DiscoveredFact[]): boolean {
  return pairingsIn(facts).length >= MAX_PAIRINGS;
}

/**
 * §F4 — the cross-reference result: the next pairing the crew has not seen.
 *
 * Deliberately independent of whatever role prompted it. Returns nothing once `MAX_PAIRINGS` is
 * reached, so the collection never grows into a co-occurrence graph of the whole table.
 */
export function nextPairing(facts: readonly DiscoveredFact[]): DiscoveredFact | null {
  if (pairingsExhausted(facts)) return null;
  return ALL_PAIRINGS.find((pairing) => !knowsFact(facts, pairing)) ?? null;
}
