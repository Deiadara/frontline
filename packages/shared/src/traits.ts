import { z } from 'zod';
import { clampAttribute, type AttributeName, type Attributes } from './attributes.js';

/**
 * Traits (GDD §B7, §B4a).
 *
 * A trait is a discrete thing a character either has or does not — not a 0..100 rating. Some
 * characters carry one, and it grants a flat bonus to a couple of attributes. This is the
 * starter set the board asked for; the full trait system is [TODO-LATER].
 *
 * Traits are public: players see them, and they are half of what a player has to guess a
 * character's fit from, since the role requirement table itself is hidden (B8).
 */

export const TRAIT_IDS = [
  'wired_reflexes',
  'gutter_born',
  'field_surgeon',
  'scrap_whisperer',
  'silver_tongue',
  'unbreakable',
] as const;

export const TraitIdSchema = z.enum(TRAIT_IDS);
export type TraitId = z.infer<typeof TraitIdSchema>;

export interface Trait {
  id: TraitId;
  name: string;
  description: string;
  /** Flat additions applied on top of the rolled sheet, clamped to the 0..100 scale. */
  bonus: Partial<Record<AttributeName, number>>;
}

export const TRAIT_CATALOG: Record<TraitId, Trait> = {
  wired_reflexes: {
    id: 'wired_reflexes',
    name: 'Wired Reflexes',
    description: 'A back-alley neural shunt that fires before the thought arrives.',
    bonus: { reflexes: 8, speed: 5 },
  },
  gutter_born: {
    id: 'gutter_born',
    name: 'Gutter Born',
    description: 'Raised in the dead levels. Knows which shadows the patrols never sweep.',
    bonus: { stealth: 8, cunning: 5 },
  },
  field_surgeon: {
    id: 'field_surgeon',
    name: 'Field Surgeon',
    description: 'Learned medicine in a war nobody volunteered for.',
    bonus: { medicine: 10 },
  },
  scrap_whisperer: {
    id: 'scrap_whisperer',
    name: 'Scrap Whisperer',
    description: "Reads a machine's whole history off its rust.",
    bonus: { salvage: 8, fabrication: 5 },
  },
  silver_tongue: {
    id: 'silver_tongue',
    name: 'Silver Tongue',
    description: 'Has talked a cordon into standing down. Twice.',
    bonus: { negotiation: 8, charisma: 5 },
  },
  unbreakable: {
    id: 'unbreakable',
    name: 'Unbreakable',
    description: 'Has been broken before. It did not take.',
    bonus: { toughness: 8, composure: 5 },
  },
};

export const TraitsSchema = z.array(TraitIdSchema);

export function findTrait(id: string): Trait | undefined {
  return TRAIT_IDS.includes(id as TraitId) ? TRAIT_CATALOG[id as TraitId] : undefined;
}

/**
 * Apply every trait's bonus to a sheet. Ratings stay on the 0..100 scale.
 *
 * This builds a sheet; it is not a read-time view. Stored sheets — generated characters and
 * `OVERSEER_PRESETS` alike — already have their bonuses in them, so calling this on one double
 * counts the trait.
 */
export function applyTraitBonuses(attributes: Attributes, traits: readonly TraitId[]): Attributes {
  const boosted = { ...attributes };
  for (const traitId of traits) {
    for (const [name, amount] of Object.entries(TRAIT_CATALOG[traitId].bonus)) {
      const attribute = name as AttributeName;
      boosted[attribute] = clampAttribute(boosted[attribute] + amount);
    }
  }
  return boosted;
}
