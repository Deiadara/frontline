import { z } from 'zod';
import { clampAttribute, type AttributeName, type Attributes } from './attributes.js';

/**
 * Traits (GDD §B7, §B4a).
 *
 * A trait is a discrete thing a character either has or does not — not a 0..100 rating. Some
 * characters carry one, and it moves a couple of attributes by a flat amount.
 *
 * Traits are public: players see them, and they are half of what a player has to guess a
 * character's fit from, since the role requirement table itself is hidden (B8).
 *
 * ## Boons and flaws
 *
 * The board's starter set was six traits, all upside, which made "has a trait" strictly better and
 * gave a player nothing to weigh. A trait is now either a **boon** or a **flaw**, so reading the
 * tag on a recruit card is a real judgement: the same discrete on/off thing can just as easily be
 * a reason not to hire.
 *
 * Both kinds are the same shape — a flaw is simply a `bonus` with negative numbers — so nothing
 * downstream branches on `kind`. It exists so the roll can be weighted and the UI can colour them
 * differently without pattern-matching on the sign of a lookup.
 *
 * **Provisional, and expected to be reworked.** The split below is one flaw for every two boons,
 * drawn from a single uniform pool; a finer system would weight them, let a character carry more
 * than one, or pair a flaw with a compensating boon. None of that is here yet.
 */

export const TRAIT_IDS = [
  // Boons — the board's original six, then the extension.
  'wired_reflexes',
  'gutter_born',
  'field_surgeon',
  'scrap_whisperer',
  'silver_tongue',
  'unbreakable',
  'iron_lungs',
  'deadeye',
  'quartermasters_eye',
  'war_scholar',
  'gearhead',
  'chem_cook',
  'cold_read',
  'night_courier',
  'shift_boss',
  'cipher_clerk',
  'bad_weather_pilot',
  'ward_speaker',
  'long_game',
  'stair_runner',
  // Flaws.
  'glass_jaw',
  'short_fuse',
  'tunnel_vision',
  'marked_face',
  'burned_bridge',
  'loose_tongue',
  'company_man',
  'shakes',
] as const;

export const TraitIdSchema = z.enum(TRAIT_IDS);
export type TraitId = z.infer<typeof TraitIdSchema>;

/** Whether a trait helps or hurts. A flaw's `bonus` is negative throughout. */
export const TRAIT_KINDS = ['boon', 'flaw'] as const;
export const TraitKindSchema = z.enum(TRAIT_KINDS);
export type TraitKind = z.infer<typeof TraitKindSchema>;

export interface Trait {
  id: TraitId;
  name: string;
  description: string;
  kind: TraitKind;
  /**
   * Flat changes applied on top of the rolled sheet, clamped to the 0..100 scale. Positive on a
   * boon, negative on a flaw — never mixed, so a trait is unambiguously one or the other.
   */
  bonus: Partial<Record<AttributeName, number>>;
}

export const TRAIT_CATALOG: Record<TraitId, Trait> = {
  wired_reflexes: {
    id: 'wired_reflexes',
    kind: 'boon',
    name: 'Wired Reflexes',
    description: 'A back-alley neural shunt that fires before the thought arrives.',
    bonus: { reflexes: 8, speed: 5 },
  },
  gutter_born: {
    id: 'gutter_born',
    kind: 'boon',
    name: 'Gutter Born',
    description: 'Raised in the dead levels. Knows which shadows the patrols never sweep.',
    bonus: { stealth: 8, logic: 5 },
  },
  field_surgeon: {
    id: 'field_surgeon',
    kind: 'boon',
    name: 'Field Surgeon',
    description: 'Learned medicine in a war nobody volunteered for.',
    bonus: { medicine: 10 },
  },
  scrap_whisperer: {
    id: 'scrap_whisperer',
    kind: 'boon',
    name: 'Scrap Whisperer',
    description: "Reads a machine's whole history off its rust.",
    bonus: { salvage: 8, fabrication: 5 },
  },
  silver_tongue: {
    id: 'silver_tongue',
    kind: 'boon',
    name: 'Silver Tongue',
    description: 'Has talked a cordon into standing down. Twice.',
    bonus: { negotiation: 8, charisma: 5 },
  },
  unbreakable: {
    id: 'unbreakable',
    kind: 'boon',
    name: 'Unbreakable',
    description: 'Has been broken before. It did not take.',
    bonus: { toughness: 8, composure: 5 },
  },
  iron_lungs: {
    id: 'iron_lungs',
    kind: 'boon',
    name: 'Iron Lungs',
    description: 'Grew up breathing the vent smog. Runs where others are still coughing.',
    bonus: { stamina: 8, toughness: 5 },
  },
  deadeye: {
    id: 'deadeye',
    kind: 'boon',
    name: 'Deadeye',
    description: 'Does not fire twice. Has never needed to.',
    bonus: { reflexes: 9, resolve: 4 },
  },
  quartermasters_eye: {
    id: 'quartermasters_eye',
    kind: 'boon',
    name: "Quartermaster's Eye",
    description: 'Counts a crate by looking at it, and knows what it is worth by tomorrow.',
    bonus: { logistics: 8, strategy: 5 },
  },
  war_scholar: {
    id: 'war_scholar',
    kind: 'boon',
    name: 'War Scholar',
    description: 'Read every after-action report the Combine forgot to burn.',
    bonus: { intuition: 8, analysis: 5 },
  },
  gearhead: {
    id: 'gearhead',
    kind: 'boon',
    name: 'Gearhead',
    description: 'Talks to machines. Occasionally they answer.',
    bonus: { engineering: 8, cybernetics: 5 },
  },
  chem_cook: {
    id: 'chem_cook',
    kind: 'boon',
    name: 'Chem Cook',
    description: 'Ran a bathtub lab under a noodle bar for nine years without one raid.',
    bonus: { chemistry: 9, medicine: 4 },
  },
  cold_read: {
    id: 'cold_read',
    kind: 'boon',
    name: 'Cold Read',
    description: 'Knows what you want before you have finished deciding to want it.',
    bonus: { empathy: 8, deception: 5 },
  },
  night_courier: {
    id: 'night_courier',
    kind: 'boon',
    name: 'Night Courier',
    description: 'Ran packages through the undergrid on a curfew clock. Never late.',
    bonus: { navigation: 8, speed: 5 },
  },
  shift_boss: {
    id: 'shift_boss',
    kind: 'boon',
    name: 'Shift Boss',
    description: 'Ran a floor of two hundred. Nothing on it ever waited for a decision.',
    bonus: { organization: 8, authority: 5 },
  },
  cipher_clerk: {
    id: 'cipher_clerk',
    kind: 'boon',
    name: 'Cipher Clerk',
    description: 'Filed Combine traffic for six years. Kept a copy of the key.',
    bonus: { cryptography: 9, analysis: 4 },
  },
  bad_weather_pilot: {
    id: 'bad_weather_pilot',
    kind: 'boon',
    name: 'Bad Weather Pilot',
    description: 'Flies the route everyone else cancels, and lands.',
    bonus: { improvisation: 8, composure: 5 },
  },
  ward_speaker: {
    id: 'ward_speaker',
    kind: 'boon',
    name: 'Ward Speaker',
    description: 'Held a room of four hundred angry people and left with all of them agreeing.',
    bonus: { diplomacy: 8, communication: 5 },
  },
  long_game: {
    id: 'long_game',
    kind: 'boon',
    name: 'Long Game',
    description: 'Was already planning for this three years ago. Says so rarely.',
    bonus: { strategy: 8, logic: 5 },
  },
  stair_runner: {
    id: 'stair_runner',
    kind: 'boon',
    name: 'Stair Runner',
    description: 'Grew up forty floors above a broken lift. Legs like a machine.',
    bonus: { stamina: 8, dexterity: 5 },
  },
  glass_jaw: {
    id: 'glass_jaw',
    kind: 'flaw',
    name: 'Glass Jaw',
    description:
      'Something in the ribs never set right, and everyone who has fought them knows it.',
    bonus: { toughness: -9, stamina: -5 },
  },
  short_fuse: {
    id: 'short_fuse',
    kind: 'flaw',
    name: 'Short Fuse',
    description: 'Has walked out of two negotiations. One of them was through the window.',
    bonus: { composure: -9, negotiation: -5 },
  },
  tunnel_vision: {
    id: 'tunnel_vision',
    kind: 'flaw',
    name: 'Tunnel Vision',
    description: 'Finishes what is in front of them. Does not see what is beside it.',
    bonus: { resolve: -8, improvisation: -5 },
  },
  marked_face: {
    id: 'marked_face',
    kind: 'flaw',
    name: 'Marked Face',
    description: 'On a Combine watchlist with a photograph. Doors close early.',
    bonus: { stealth: -8, deception: -5 },
  },
  burned_bridge: {
    id: 'burned_bridge',
    kind: 'flaw',
    name: 'Burned Bridge',
    description: 'Left a crew badly enough that the story still gets told in three districts.',
    bonus: { diplomacy: -8, charisma: -5 },
  },
  loose_tongue: {
    id: 'loose_tongue',
    kind: 'flaw',
    name: 'Loose Tongue',
    description: 'Tells a good story. Has never once checked who was still in the room.',
    bonus: { cryptography: -9, deception: -4 },
  },
  company_man: {
    id: 'company_man',
    kind: 'flaw',
    name: 'Company Man',
    description: 'Twenty years inside. Still flinches at doing anything without a form for it.',
    bonus: { improvisation: -9, authority: -4 },
  },
  shakes: {
    id: 'shakes',
    kind: 'flaw',
    name: 'The Shakes',
    description: 'Something they took in the war, or something they took to forget it.',
    bonus: { dexterity: -8, reflexes: -5 },
  },
};

/** The traits that help, and the traits that hurt — derived, never listed twice. */
export const TRAIT_BOONS: readonly TraitId[] = TRAIT_IDS.filter(
  (id) => TRAIT_CATALOG[id].kind === 'boon',
);
export const TRAIT_FLAWS: readonly TraitId[] = TRAIT_IDS.filter(
  (id) => TRAIT_CATALOG[id].kind === 'flaw',
);

/** Whether this trait is a reason not to hire someone. */
export function isFlaw(id: TraitId): boolean {
  return TRAIT_CATALOG[id].kind === 'flaw';
}

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
