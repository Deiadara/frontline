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
 * exposed to a player. No star ratings, no suitability score, no derived fit indicator: players
 * guess from the attributes and traits they can see, and buy partial hints with the §B9 research
 * task (Professor / Head of Research) later.
 *
 * B8a is the architectural consequence: this module must never be imported from
 * `packages/shared` or `apps/client`, and nothing computed from it may appear in an API
 * response. `hidden-table.leak.test.ts` fails if either happens.
 *
 * ##########################################################################
 *
 * Each role's `primary` is the attribute that is genuinely its own (B3, B5): no two roles share
 * one. Weights are relative, not normalised; anything unlisted weighs nothing.
 */

export interface RoleRequirement {
  primary: AttributeName;
  weights: Partial<Record<AttributeName, number>>;
}

export const ROLE_REQUIREMENTS: Record<OfficerRole, RoleRequirement> = {
  head_spy: {
    primary: 'stealth',
    weights: { stealth: 5, deception: 3, signals: 2, logic: 2, resolve: 1 },
  },
  lead_engineer: {
    primary: 'engineering',
    weights: { engineering: 5, analysis: 3, craft: 2, logistics: 2, leadership: 1 },
  },
  finance_officer: {
    primary: 'strategy',
    weights: { strategy: 5, analysis: 3, logistics: 2, composure: 2, negotiation: 1 },
  },
  head_of_growth: {
    primary: 'charisma',
    weights: { charisma: 5, communication: 3, empathy: 2, negotiation: 2, improvisation: 1 },
  },
  field_commander: {
    primary: 'organization',
    weights: { organization: 5, leadership: 3, composure: 2, resolve: 2, strategy: 1 },
  },
  head_of_research: {
    primary: 'analysis',
    weights: { analysis: 5, intuition: 3, encyclopedia: 2, composure: 2, chemistry: 1 },
  },
  wetware_chief: {
    primary: 'cybernetics',
    weights: { cybernetics: 5, medicine: 3, engineering: 2, analysis: 2, composure: 1 },
  },
  fabricator: {
    primary: 'craft',
    weights: { craft: 5, engineering: 3, chemistry: 2, salvage: 2, strategy: 1 },
  },
  salvager: {
    primary: 'salvage',
    weights: { salvage: 5, strategy: 3, stamina: 2, navigation: 2, craft: 1 },
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
  security_officer: {
    primary: 'resolve',
    weights: { resolve: 5, reflexes: 3, signals: 2, speed: 2, intimidation: 1 },
  },
  chief_medic: {
    primary: 'medicine',
    weights: { medicine: 5, composure: 3, chemistry: 2, empathy: 2, intuition: 1 },
  },
  instructor_of_the_young: {
    primary: 'diplomacy',
    weights: { diplomacy: 5, communication: 3, empathy: 2, intuition: 2, composure: 1 },
  },
  raid_boss: {
    primary: 'intimidation',
    weights: { intimidation: 5, strength: 3, toughness: 2, improvisation: 2, leadership: 1 },
  },
  scout: {
    primary: 'speed',
    weights: { speed: 5, dexterity: 3, resolve: 2, navigation: 2, stealth: 1 },
  },
  consigliere: {
    primary: 'logic',
    weights: { logic: 5, empathy: 3, deception: 2, strategy: 2, communication: 1 },
  },
  professor: {
    primary: 'intuition',
    weights: { intuition: 5, diplomacy: 3, improvisation: 2, analysis: 2, communication: 1 },
  },
};

/**
 * How well a sheet matches a role, 0..100: the weighted mean of the attributes the role cares
 * about.
 *
 * This number never leaves the server. It is the input to internal resolution (how well the
 * officer performs) and, later, to the §B9 research hints: never to a response body.
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

/** Every role, in declaration order. Re-exported so callers need only this module. */
export const REQUIREMENT_ROLES: readonly OfficerRole[] = OFFICER_ROLES;
