import { z } from 'zod';

/**
 * The attribute model (GDD §B).
 *
 * Every human in the game — recruits, officers and the Overseer alike — carries *every*
 * attribute, rated 0..100, regardless of the role they are hired into (B1, B6). Attributes are
 * grouped Football-Manager style (B4a); Traits are a separate, discrete kind and live in
 * `traits.ts` (B7).
 *
 * The set is deliberately wide (B3, B5): each of the 19 roles in §C1 has one attribute that is
 * genuinely its own, so no two roles read off the same headline number. Which attributes a role
 * actually wants is server-side only and never reaches a player (B8, B8a).
 */

export const PHYSICAL_ATTRIBUTES = [
  'strength',
  'endurance',
  'agility',
  'speed',
  'reflexes',
  'toughness',
  'marksmanship',
  'stealth',
] as const;

export const MENTAL_ATTRIBUTES = [
  'tactics',
  'analysis',
  'imagination',
  'cunning',
  'composure',
  'vigilance',
  'scholarship',
  'appraisal',
] as const;

export const SOCIAL_ATTRIBUTES = [
  'leadership',
  'charisma',
  'communication',
  'intimidation',
  'negotiation',
  'deception',
  'empathy',
  'mentoring',
] as const;

export const TECHNICAL_ATTRIBUTES = [
  'engineering',
  'hacking',
  'fabrication',
  'medicine',
  'cybernetics',
  'salvage',
  'demolition',
  'navigation',
  'chemistry',
  'logistics',
] as const;

export const ATTRIBUTE_GROUPS = ['physical', 'mental', 'social', 'technical'] as const;
export const AttributeGroupSchema = z.enum(ATTRIBUTE_GROUPS);
export type AttributeGroup = z.infer<typeof AttributeGroupSchema>;

/** The attributes of each group, in display order. */
export const ATTRIBUTES_BY_GROUP: Record<AttributeGroup, readonly AttributeName[]> = {
  physical: PHYSICAL_ATTRIBUTES,
  mental: MENTAL_ATTRIBUTES,
  social: SOCIAL_ATTRIBUTES,
  technical: TECHNICAL_ATTRIBUTES,
};

/** Every attribute, in canonical (group, then within-group) order. */
export const ATTRIBUTE_NAMES = [
  ...PHYSICAL_ATTRIBUTES,
  ...MENTAL_ATTRIBUTES,
  ...SOCIAL_ATTRIBUTES,
  ...TECHNICAL_ATTRIBUTES,
] as const;

export type AttributeName =
  | (typeof PHYSICAL_ATTRIBUTES)[number]
  | (typeof MENTAL_ATTRIBUTES)[number]
  | (typeof SOCIAL_ATTRIBUTES)[number]
  | (typeof TECHNICAL_ATTRIBUTES)[number];

/** Lowest and highest rating any attribute can ever hold (B1). */
export const MIN_ATTRIBUTE = 0;
export const MAX_ATTRIBUTE = 100;

/**
 * The ceiling at recruitment (B2a). The 40..100 band exists purely so progression has somewhere
 * to go; a freshly generated character never touches it.
 */
export const MAX_RECRUITMENT_ATTRIBUTE = 40;

/** A single attribute rating: integer 0..100. */
export const AttributeValueSchema = z.number().int().min(MIN_ATTRIBUTE).max(MAX_ATTRIBUTE);

export type Attributes = Record<AttributeName, number>;

/** Validates a full sheet: every attribute present, each 0..100. */
export const AttributesSchema: z.ZodType<Attributes> = z.object(
  Object.fromEntries(ATTRIBUTE_NAMES.map((name) => [name, AttributeValueSchema])) as Record<
    AttributeName,
    typeof AttributeValueSchema
  >,
);

/** Clamp an arbitrary number onto the valid 0..100 attribute scale. */
export function clampAttribute(value: number): number {
  return Math.min(MAX_ATTRIBUTE, Math.max(MIN_ATTRIBUTE, Math.round(value)));
}

/** The group an attribute belongs to. */
export function groupOf(attribute: AttributeName): AttributeGroup {
  const group = ATTRIBUTE_GROUPS.find((candidate) =>
    ATTRIBUTES_BY_GROUP[candidate].includes(attribute),
  );
  if (!group) throw new Error(`attribute ${attribute} belongs to no group`);
  return group;
}

/** Mean rating across a group — the shape a character-select radar reads off. */
export function groupAverage(attributes: Attributes, group: AttributeGroup): number {
  const names = ATTRIBUTES_BY_GROUP[group];
  const total = names.reduce((sum, name) => sum + attributes[name], 0);
  return total / names.length;
}

export const ATTRIBUTE_TIERS = ['weak', 'average', 'strong', 'elite'] as const;
export type AttributeTier = (typeof ATTRIBUTE_TIERS)[number];

/**
 * How a single rating reads, on the bands the recruitment curve actually produces (B2: a good
 * attribute ~30, average 15-20, a bad one ~10). `elite` only becomes reachable through
 * progression, since nothing starts above 40.
 *
 * This is a reading of a number the player can already see — not a fit indicator. B8 bans
 * telling the player how well an attribute suits a *role*, which needs the hidden table.
 */
export function attributeTier(value: number): AttributeTier {
  if (value >= 60) return 'elite';
  if (value >= 28) return 'strong';
  if (value >= 14) return 'average';
  return 'weak';
}

/** Build a full sheet from a base rating plus overrides. */
export function makeAttributes(base: number, overrides: Partial<Attributes> = {}): Attributes {
  const sheet = Object.fromEntries(
    ATTRIBUTE_NAMES.map((name) => [name, clampAttribute(overrides[name] ?? base)]),
  ) as Attributes;
  return sheet;
}

/** Neutral sheet at the recruitment mean, useful as a factory default. */
export const DEFAULT_ATTRIBUTES: Attributes = makeAttributes(15);
