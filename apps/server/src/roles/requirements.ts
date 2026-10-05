import { type AttributeName, type Attributes, type OfficerRole } from '@frontline/shared';

/**
 * What each officer role actually wants (GDD §C2, §B8, §B8a).
 *
 * ############################ SERVER-SIDE ONLY ############################
 *
 * B8 is a design rule, not a preference: what a role needs is internal to the game and is never
 * exposed to a player. No star ratings, no suitability score, no derived fit indicator: players
 * guess from the attributes and traits they can see, and buy partial hints with the §B9 research
 * task (Professor / Researcher) later.
 *
 * B8a is the architectural consequence: this module must never be imported from
 * `packages/shared` or `apps/client`, and nothing computed from it may appear in an API
 * response. `hidden-table.leak.test.ts` fails if either happens.
 *
 * ##########################################################################
 *
 * Each role's `primary` is the attribute that is genuinely its own (B3, B5): no two roles share
 * one. Weights are relative, not normalised; anything unlisted weighs nothing.
 *
 * What this shapes is the **candidate**: the sheet the generator rolls for a recruit with this
 * affinity. How well somebody then fills the chair is the public tags' business (`seatPoints`).
 */

export interface RoleRequirement {
  primary: AttributeName;
  weights: Partial<Record<AttributeName, number>>;
}

export const ROLE_REQUIREMENTS: Record<OfficerRole, RoleRequirement> = {
  master_of_whispers: {
    primary: 'stealth',
    weights: { stealth: 5, deception: 3, signals: 2, logic: 2, resolve: 1 },
  },
  engineer: {
    primary: 'engineering',
    weights: { engineering: 5, analysis: 3, craft: 2, logistics: 2, leadership: 1 },
  },
  fixer: {
    primary: 'strategy',
    weights: { strategy: 5, analysis: 3, logistics: 2, composure: 2, negotiation: 1 },
  },
  steward: {
    primary: 'charisma',
    weights: { charisma: 5, communication: 3, empathy: 2, negotiation: 2, improvisation: 1 },
  },
  field_commander: {
    primary: 'organization',
    weights: { organization: 5, leadership: 3, composure: 2, resolve: 2, strategy: 1 },
  },
  researcher: {
    primary: 'analysis',
    weights: { analysis: 5, intuition: 3, encyclopedia: 2, composure: 2, chemistry: 1 },
  },
  salvager: {
    primary: 'salvage',
    weights: { salvage: 5, craft: 3, logistics: 2, improvisation: 2, navigation: 1 },
  },
  right_hand: {
    primary: 'leadership',
    weights: { leadership: 5, composure: 3, empathy: 2, intimidation: 2, organization: 1 },
  },
  cartographer: {
    primary: 'navigation',
    weights: { navigation: 5, resolve: 3, stamina: 2, analysis: 2, stealth: 1 },
  },
  trader: {
    primary: 'negotiation',
    weights: { negotiation: 5, strategy: 3, charisma: 2, logistics: 2, deception: 1 },
  },
  veteran: {
    primary: 'resolve',
    weights: { resolve: 5, organization: 3, logistics: 2, toughness: 2, medicine: 1 },
  },
  raid_boss: {
    primary: 'intimidation',
    weights: { intimidation: 5, strength: 3, toughness: 2, improvisation: 2, leadership: 1 },
  },
  professor: {
    primary: 'intuition',
    weights: { intuition: 5, diplomacy: 3, improvisation: 2, analysis: 2, communication: 1 },
  },
};

/**
 * How well a sheet matches the candidate a role's template describes, 0..100: the weighted mean of
 * the attributes the template lists.
 *
 * The generator's measure, and nothing else's. An officer's mark and their chair's output read the
 * public tags through `seatPoints` in `@frontline/shared` (maintainer, 2026-09-30: every tagged
 * skill brought up to its tier); what this answers is whether a roll shaped for a role reads as
 * one, which is the §B8 legibility question `characters/generate.test.ts` holds. It never leaves the
 * server.
 */
export function templateFit(attributes: Attributes, role: OfficerRole): number {
  const { weights } = ROLE_REQUIREMENTS[role];
  let weighted = 0;
  let total = 0;
  for (const [name, weight] of Object.entries(weights)) {
    weighted += attributes[name as AttributeName] * weight;
    total += weight;
  }
  return weighted / total;
}

/** The role's template attributes in descending weight order: what the role "is about". */
export function weightedAttributesOf(role: OfficerRole): AttributeName[] {
  return (Object.entries(ROLE_REQUIREMENTS[role].weights) as [AttributeName, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

/** The role's template as weighted entries: what a character shaped for it is drawn from. */
export function attributeWeightsOf(role: OfficerRole): [AttributeName, number][] {
  return Object.entries(ROLE_REQUIREMENTS[role].weights) as [AttributeName, number][];
}
