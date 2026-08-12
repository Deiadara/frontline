import {
  OFFICER_ROLES,
  type AttributeName,
  type Attributes,
  type OfficerRole,
} from '@frontline/shared';

/**
 * What each officer role actually wants (GDD §C2, §B8, §B8a).
 *
 * ############################ SERVER-SIDE ONLY ############################
 *
 * B8 is a design rule, not a preference: what a role needs is internal to the game and is never
 * exposed to a player. No star ratings, no suitability score, no derived fit indicator — players
 * guess from the attributes and traits they can see, and buy partial hints with the §B9 research
 * task (Professor / Head of Research) later.
 *
 * B8a is the architectural consequence: this module must never be imported from
 * `packages/shared` or `apps/client`, and nothing computed from it may appear in an API
 * response. `hidden-table.leak.test.ts` fails if either happens.
 *
 * ##########################################################################
 *
 * Each role's `primary` is the attribute that is genuinely its own (B3, B5) — no two roles share
 * one. Weights are relative, not normalised; anything unlisted weighs nothing.
 */

export interface RoleRequirement {
  primary: AttributeName;
  weights: Partial<Record<AttributeName, number>>;
}

export const ROLE_REQUIREMENTS: Record<OfficerRole, RoleRequirement> = {
  head_spy: {
    primary: 'stealth',
    weights: { stealth: 5, deception: 3, hacking: 2, cunning: 2, vigilance: 1 },
  },
  lead_engineer: {
    primary: 'engineering',
    weights: { engineering: 5, analysis: 3, fabrication: 2, logistics: 2, leadership: 1 },
  },
  finance_officer: {
    primary: 'appraisal',
    weights: { appraisal: 5, analysis: 3, logistics: 2, composure: 2, negotiation: 1 },
  },
  head_of_growth: {
    primary: 'charisma',
    weights: { charisma: 5, communication: 3, empathy: 2, negotiation: 2, imagination: 1 },
  },
  field_commander: {
    primary: 'tactics',
    weights: { tactics: 5, leadership: 3, composure: 2, vigilance: 2, marksmanship: 1 },
  },
  head_of_research: {
    primary: 'analysis',
    weights: { analysis: 5, scholarship: 3, imagination: 2, composure: 2, chemistry: 1 },
  },
  wetware_chief: {
    primary: 'cybernetics',
    weights: { cybernetics: 5, medicine: 3, engineering: 2, analysis: 2, composure: 1 },
  },
  fabricator: {
    primary: 'fabrication',
    weights: { fabrication: 5, engineering: 3, chemistry: 2, salvage: 2, appraisal: 1 },
  },
  salvager: {
    primary: 'salvage',
    weights: { salvage: 5, appraisal: 3, endurance: 2, navigation: 2, fabrication: 1 },
  },
  right_hand: {
    primary: 'leadership',
    weights: { leadership: 5, composure: 3, empathy: 2, intimidation: 2, tactics: 1 },
  },
  cartographer: {
    primary: 'navigation',
    weights: { navigation: 5, vigilance: 3, endurance: 2, analysis: 2, stealth: 1 },
  },
  trader: {
    primary: 'negotiation',
    weights: { negotiation: 5, appraisal: 3, charisma: 2, logistics: 2, deception: 1 },
  },
  security_officer: {
    primary: 'vigilance',
    weights: { vigilance: 5, marksmanship: 3, toughness: 2, reflexes: 2, intimidation: 1 },
  },
  chief_medic: {
    primary: 'medicine',
    weights: { medicine: 5, composure: 3, chemistry: 2, empathy: 2, scholarship: 1 },
  },
  instructor_of_the_young: {
    primary: 'mentoring',
    weights: { mentoring: 5, communication: 3, empathy: 2, scholarship: 2, composure: 1 },
  },
  raid_boss: {
    primary: 'intimidation',
    weights: { intimidation: 5, strength: 3, toughness: 2, demolition: 2, leadership: 1 },
  },
  scout: {
    primary: 'speed',
    weights: { speed: 5, agility: 3, vigilance: 2, navigation: 2, stealth: 1 },
  },
  consigliere: {
    primary: 'cunning',
    weights: { cunning: 5, empathy: 3, deception: 2, appraisal: 2, communication: 1 },
  },
  professor: {
    primary: 'scholarship',
    weights: { scholarship: 5, mentoring: 3, imagination: 2, analysis: 2, communication: 1 },
  },
};

/**
 * How well a sheet matches a role, 0..100 — the weighted mean of the attributes the role cares
 * about.
 *
 * This number never leaves the server. It is the input to internal resolution (how well the
 * officer performs) and, later, to the §B9 research hints — never to a response body.
 */
export function roleFit(attributes: Attributes, role: OfficerRole): number {
  const { weights } = ROLE_REQUIREMENTS[role];
  let weighted = 0;
  let total = 0;
  for (const [name, weight] of Object.entries(weights)) {
    weighted += attributes[name as AttributeName] * weight;
    total += weight;
  }
  return weighted / total;
}

/** The role's template attributes in descending weight order — what the role "is about". */
export function weightedAttributesOf(role: OfficerRole): AttributeName[] {
  return (Object.entries(ROLE_REQUIREMENTS[role].weights) as [AttributeName, number][])
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
}

/** The role's template as weighted entries — what a character shaped for it is drawn from. */
export function attributeWeightsOf(role: OfficerRole): [AttributeName, number][] {
  return Object.entries(ROLE_REQUIREMENTS[role].weights) as [AttributeName, number][];
}

/** Every role, in declaration order. Re-exported so callers need only this module. */
export const REQUIREMENT_ROLES: readonly OfficerRole[] = OFFICER_ROLES;
