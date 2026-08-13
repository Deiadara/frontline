import {
  ATTRIBUTE_NAMES,
  MAX_PAIRINGS,
  MAX_ROLE_FACTS,
  OFFICER_ROLES,
  attributeIndex,
  consultOnAssignment,
  makeAttributes,
  pairingsIn,
  roleFactsIn,
  type AttributeName,
  type DiscoveredFact,
  type OfficerRole,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import {
  ROLE_REQUIREMENTS,
  attributeWeightsOf,
  roleFit,
  weightedAttributesOf,
} from '../roles/requirements.js';
import { TOTAL_PAIRINGS, discoverableAttributes, nextPairing, nextRoleFact } from './discover.js';

/**
 * B8a/INTERFACES R4 — hiring insight is the one feature allowed to put role knowledge on the wire,
 * so it is the one that has to prove it did not put the *table* there.
 *
 * W1's guard (`../roles/hidden-table.leak.test.ts`) scans `packages/shared/src`, `apps/client/src`
 * and `apps/client/e2e`. `apps/server/src/research/` is outside all three, and unlike every other
 * server module this one reads `ROLE_REQUIREMENTS` *in order to* tell a player something. That is
 * the hole this file covers.
 *
 * Assertions here are deliberately over the discovery engine's real output rather than over its
 * source text: a token scan cannot tell the difference between shipping the table and shipping a
 * fact derived from it, and the whole question is which of those this feature does. The one that
 * matters most is `carries no weight information`, which is the *derived* leak the W1 header
 * explicitly says its own scans cannot catch.
 *
 * A note on scope: this file guards the discovery engine. The response-body half — that the real
 * `GET /research` body carries nothing more than what is proved safe here — is asserted at the
 * bottom, over the route.
 */

const NOTHING: readonly DiscoveredFact[] = [];

/** Everything `role` would ever give up, by grinding investigations until they refuse. */
function grind(role: OfficerRole): DiscoveredFact[] {
  const facts: DiscoveredFact[] = [];
  // Bounded well above `MAX_ROLE_FACTS` so a cap that silently stopped working shows up as a
  // failed assertion rather than as an infinite loop.
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const fact = nextRoleFact(role, facts);
    if (!fact) return facts;
    facts.push(fact);
  }
  throw new Error(`${role} never stopped yielding facts`);
}

describe('discovery never reconstructs the hidden table', () => {
  it('caps every role strictly below its own template', () => {
    for (const role of OFFICER_ROLES) {
      const learned = roleFactsIn(grind(role), role);
      const template = weightedAttributesOf(role);

      expect(learned.length, `${role} yielded more than the cap`).toBe(MAX_ROLE_FACTS);
      expect(
        learned.length,
        `${role}'s whole profile is reachable — B8 says it must not be`,
      ).toBeLessThan(template.length);
      // What *is* revealed is genuinely part of the template — hints have to be true (§B9).
      for (const attribute of learned) expect(template).toContain(attribute);
    }
  });

  /**
   * The derived leak, and the assertion with the teeth.
   *
   * A fact body carries no number, so the only channel left is *which* attributes come out and in
   * *what order*. Both are computed from `ATTRIBUTE_NAMES` position, so re-weighting a role — same
   * attributes, permuted weights — must not move the reveal at all. If discovery ever sorted by
   * weight, this is what would catch it, and nothing else here would.
   */
  it('carries no weight information: reveal is invariant under re-weighting', () => {
    for (const role of OFFICER_ROLES) {
      const before = discoverableAttributes(role);
      const weights = attributeWeightsOf(role);

      // Rotate the weights across the same attributes: the ordering changes completely, the
      // membership does not.
      const rotated = Object.fromEntries(
        weights.map(([name], index) => [name, weights[(index + 1) % weights.length]?.[1] ?? 1]),
      ) as Partial<Record<AttributeName, number>>;
      const original = ROLE_REQUIREMENTS[role].weights;
      ROLE_REQUIREMENTS[role].weights = rotated;
      try {
        expect(discoverableAttributes(role), `${role}'s reveal follows its weights`).toEqual(
          before,
        );
      } finally {
        ROLE_REQUIREMENTS[role].weights = original;
      }
    }
  });

  it('would fire on a weight-ordered reveal — the invariance check is not vacuous', () => {
    // Positive control. `weightedAttributesOf` is exactly the banned ordering, so the two must
    // disagree somewhere; if they agreed everywhere, the test above would prove nothing.
    const disagreeing = OFFICER_ROLES.filter((role) => {
      const byWeight = weightedAttributesOf(role).slice(0, MAX_ROLE_FACTS);
      return JSON.stringify(byWeight) !== JSON.stringify(discoverableAttributes(role));
    });
    expect(
      disagreeing.length,
      'canonical order matches weight order everywhere — the check is vacuous',
    ).toBeGreaterThan(OFFICER_ROLES.length / 2);
  });

  it('reveals in canonical order, which is what makes the sequence uninformative', () => {
    for (const role of OFFICER_ROLES) {
      const revealed = discoverableAttributes(role);
      const positions = revealed.map(attributeIndex);
      expect(positions, `${role} reveals out of canonical order`).toEqual(
        [...positions].sort((a, b) => a - b),
      );
    }
  });

  it('never lets cross-referencing walk one role past its cap', () => {
    // §F4's bonus is role-free by construction: the pairing a crew gets does not depend on what
    // they were investigating, so it cannot be aimed at a role to extend its profile.
    const [first, second] = OFFICER_ROLES;
    if (!first || !second) throw new Error('need two roles');
    expect(nextPairing(NOTHING)).toEqual(nextPairing(grind(first)));
    expect(nextPairing(grind(first))).toEqual(nextPairing(grind(second)));
  });

  it('stops pairings well short of a co-occurrence graph of the table', () => {
    const facts: DiscoveredFact[] = [];
    for (let attempt = 0; attempt < TOTAL_PAIRINGS + 5; attempt += 1) {
      const pairing = nextPairing(facts);
      if (!pairing) break;
      facts.push(pairing);
    }
    expect(pairingsIn(facts)).toHaveLength(MAX_PAIRINGS);
    // The cap has to be a small fraction of what exists, or "capped" is a formality: the union of
    // enough pairings is a graph whose maximal cliques are the templates themselves.
    expect(TOTAL_PAIRINGS).toBeGreaterThan(MAX_PAIRINGS * 4);
  });

  it('emits nothing but attribute names — no weight, no score, anywhere in a fact', () => {
    const everything: DiscoveredFact[] = [
      ...OFFICER_ROLES.flatMap(grind),
      ...(() => {
        const pairings: DiscoveredFact[] = [];
        for (let i = 0; i < MAX_PAIRINGS; i += 1) {
          const pairing = nextPairing(pairings);
          if (pairing) pairings.push(pairing);
        }
        return pairings;
      })(),
    ];
    expect(everything.length).toBeGreaterThan(OFFICER_ROLES.length * MAX_ROLE_FACTS);

    const vocabulary = new Set<string>([
      'kind',
      'role',
      'attribute',
      'attributes',
      'role_attribute',
      'pairing',
      ...OFFICER_ROLES,
      ...ATTRIBUTE_NAMES,
    ]);
    // Every scalar and key in every fact ever mintable has to be a name from that vocabulary.
    // A number of any kind reaching a fact body is a weight by some other spelling.
    for (const token of JSON.stringify(everything).match(/"[^"]*"/g) ?? []) {
      expect(vocabulary.has(token.slice(1, -1)), `a fact carries ${token}`).toBe(true);
    }
    expect(JSON.stringify(everything)).not.toMatch(/:\s*-?\d/);
  });

  /**
   * The consultation is where insight actually reaches a player (§B9), and it is deliberately a
   * pure function in `@frontline/shared` — a package the W1 guard proves cannot name the hidden
   * module. This asserts the consequence rather than the structure: permuting which attribute
   * holds which rating preserves the sheet as a multiset and destroys its alignment to every role
   * at once, so a consultation that ranked candidates by fit would move and this one does not.
   */
  it('answers only from discovered facts and the visible sheet', () => {
    const role = OFFICER_ROLES[0];
    if (!role) throw new Error('need a role');
    const facts = grind(role);
    // Every rating distinct, so rotating the sheet genuinely moves every role's fit. A flat sheet
    // looks like a fine fixture and quietly makes the positive control below unfalsifiable for the
    // roles whose whole template sits on the same number.
    const sheet = makeAttributes(0, {
      ...(Object.fromEntries(ATTRIBUTE_NAMES.map((name, index) => [name, 5 + index * 2])) as Record<
        AttributeName,
        number
      >),
    });
    const rotated = Object.fromEntries(
      ATTRIBUTE_NAMES.map((name, index) => [
        name,
        sheet[ATTRIBUTE_NAMES[(index + 1) % ATTRIBUTE_NAMES.length] as AttributeName],
      ]),
    ) as typeof sheet;

    // Positive control first: rotating the sheet has to move role fit, or the comparison below is
    // comparing two things that were never going to differ.
    expect(OFFICER_ROLES.filter((r) => roleFit(rotated, r) !== roleFit(sheet, r))).toHaveLength(
      OFFICER_ROLES.length,
    );

    // The consultation reports the same *attributes* either way — its content is decided by the
    // facts, not by fit — and each reported value is simply what is on the sheet it was handed.
    const straight = consultOnAssignment(sheet, role, facts);
    const permuted = consultOnAssignment(rotated, role, facts);
    expect(permuted.map((note) => note.attribute)).toEqual(straight.map((note) => note.attribute));
    for (const note of straight) expect(note.value).toBe(sheet[note.attribute]);
    for (const note of permuted) expect(note.value).toBe(rotated[note.attribute]);

    // And nothing aggregates: no total, no rank, no verdict — just the lines (§B8).
    expect(Object.keys(straight[0] ?? {})).toEqual(['attribute', 'value', 'tier']);
  });

  it('tells a player nothing about a role they have not researched', () => {
    const role = OFFICER_ROLES[3];
    if (!role) throw new Error('need a role');
    const sheet = makeAttributes(25);
    expect(consultOnAssignment(sheet, role, NOTHING)).toEqual([]);
    // ...and having researched a *different* role does not answer for this one.
    const otherRole = OFFICER_ROLES[4];
    if (!otherRole) throw new Error('need a second role');
    expect(consultOnAssignment(sheet, role, grind(otherRole))).toEqual([]);
  });
});
