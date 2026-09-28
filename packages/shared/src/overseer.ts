import { z } from 'zod';
import { AttributesSchema, makeAttributes, type Attributes } from './attributes.js';
import { IdSchema } from './primitives.js';
import { PerksSchema } from './crew/perks.js';
import { mulberry32, seedFrom } from './rng.js';

export const OVERSEER_ARCHETYPES = ['enforcer', 'netrunner', 'fixer', 'technocrat'] as const;
export const OverseerArchetypeSchema = z.enum(OVERSEER_ARCHETYPES);
export type OverseerArchetype = z.infer<typeof OverseerArchetypeSchema>;

/**
 * The player's avatar/commander-in-chief. Same sheet as everyone else (GDD §F1).
 *
 * `attributes` is the **effective** sheet: any trait bonus is already in it, exactly as the
 * server's recruitment roll stores it. Read it, render it, level it: never run
 * `applyTraitBonuses` over it again, or the trait counts twice.
 */
export const OverseerSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  archetype: OverseerArchetypeSchema,
  portraitId: z.string().min(1),
  bio: z.string(),
  attributes: AttributesSchema,
  /** §B7, defaulted so a row written before the perk book still parses. */
  perks: PerksSchema.default([]),
});
export type Overseer = z.infer<typeof OverseerSchema>;

/** A selectable template. The server mints a fresh Overseer (new id) from a preset. */
export const OverseerPresetSchema = z.object({
  presetId: IdSchema,
  name: z.string().min(1),
  archetype: OverseerArchetypeSchema,
  portraitId: z.string().min(1),
  bio: z.string(),
  attributes: AttributesSchema,
  perks: PerksSchema,
});
export type OverseerPreset = z.infer<typeof OverseerPresetSchema>;

/**
 * How many characters a new player is shown (§F6, maintainer request 2026-09-15).
 *
 * Four out of thirty, not thirty. A wall of thirty portraits is not a choice, it is a catalogue,
 * and the player reading it has no way to tell a Drillmaster from a Spymaster before they have
 * played either. Four is enough to be a decision and few enough to read every word of.
 */
export const OVERSEER_OFFER_SIZE = 4;

/** Shorthand so thirty characters read as a table rather than as thirty object literals. */
function preset(
  presetId: string,
  name: string,
  archetype: OverseerArchetype,
  portraitIndex: string,
  bio: string,
  attributes: Partial<Attributes>,
  signature: string,
): OverseerPreset {
  return {
    presetId,
    name,
    archetype,
    // The art is `portrait-overseer-NN`, thirty faces used for nothing else (`roles.ts`,
    // `OVERSEER_PORTRAIT_IDS`). An officer can never draw one, so a player never meets their own
    // character working a chair in somebody's crew.
    portraitId: `overseer-${portraitIndex}`,
    bio,
    attributes: makeAttributes(OVERSEER_BASE_ATTRIBUTE, attributes),
    perks: [signature],
  };
}

/** Everything the sheet does not name sits at the recruitment mean, as a recruit's does (§B2a). */
const OVERSEER_BASE_ATTRIBUTE = 15;

/**
 * The thirty characters (§F6), of which a new player is shown {@link OVERSEER_OFFER_SIZE}.
 *
 * ## One signature perk each, and no two the same
 *
 * The bonus is the character. Each carries exactly one perk from the signature block in
 * `crew/perks.ts`, no officer can ever roll one (`ROLLABLE_PERK_IDS`), and no two Overseers share
 * one. That is what makes the pick a decision about the whole run: a Drillmaster crew is built
 * around its officers, a Gatekeeper crew is built around never losing the door, an Industrialist
 * crew is built around a district that out-produces the fight. They land through the same
 * `PerkBonus` fold everything else does, so no mechanic needed a new parameter to read them.
 *
 * The four ids the game shipped with (`enforcer`, `netrunner`, `fixer`, `technocrat`) are kept
 * exactly as they were. They are written into every save's `overseers.preset_id` and into the
 * seeded rivals in `seed/constants.ts`, so renaming them would orphan live rows to buy nothing.
 *
 * Listed ratings are post-perk, per {@link OverseerSchema}: nothing here exceeds the recruitment
 * ceiling, because a perk moves the crew rather than the sheet it is written on.
 */
export const OVERSEER_PRESETS: readonly OverseerPreset[] = [
  preset(
    'enforcer',
    'Marcus "Bulwark" Kane',
    'enforcer',
    '01',
    'Ran riot control for a Combine contractor until the contract ended. Took the squad with him when he left, and their shields.',
    {
      intimidation: 34,
      leadership: 31,
      toughness: 30,
      organization: 28,
      strength: 27,
      signals: 6,
      cybernetics: 8,
      intuition: 9,
    },
    'sig_ironbacked',
  ),
  preset(
    'netrunner',
    'Yumi "Ghostwire" Tanaka',
    'netrunner',
    '02',
    'The story is that she put three district grids to sleep in one night to see whether she could. She says it was four.',
    {
      signals: 36,
      cybernetics: 30,
      analysis: 29,
      stealth: 26,
      improvisation: 25,
      strength: 7,
      intimidation: 9,
      toughness: 10,
    },
    'sig_spymaster',
  ),
  preset(
    'fixer',
    'Dante "Silver" Okonkwo',
    'fixer',
    '03',
    'Never carried a gun and never needed one. For a decade every favour in this city paid him a cut on the way through.',
    {
      negotiation: 35,
      charisma: 31,
      empathy: 28,
      diplomacy: 28,
      deception: 26,
      strength: 8,
      toughness: 9,
      engineering: 10,
    },
    'sig_broker',
  ),
  preset(
    'technocrat',
    'Dr. Adaeze Okafor',
    'technocrat',
    '04',
    'Ran water and power for the Combine until she decided the city deserved better management. Her own, specifically.',
    {
      engineering: 35,
      craft: 30,
      intuition: 29,
      encyclopedia: 28,
      logistics: 27,
      intimidation: 7,
      stealth: 9,
      deception: 10,
    },
    'sig_foreman',
  ),
  preset(
    'drillmaster',
    'Sergeant Ilse Vantner',
    'enforcer',
    '05',
    'Twenty years on a training yard. Outlived every class she ran through it and still knows all their names.',
    {
      authority: 33,
      leadership: 32,
      resolve: 29,
      composure: 27,
      stamina: 26,
      deception: 8,
      signals: 9,
      chemistry: 10,
    },
    'sig_drillmaster',
  ),
  preset(
    'headhunter',
    'Corrine Vey',
    'fixer',
    '06',
    'Kept a list of everybody in the district who was one bad week from walking out on their chief. Then waited.',
    {
      empathy: 33,
      communication: 31,
      intuition: 29,
      negotiation: 27,
      analysis: 25,
      strength: 8,
      toughness: 9,
      craft: 10,
    },
    'sig_headhunter',
  ),
  preset(
    'paymaster',
    'Otto Brand',
    'technocrat',
    '07',
    'Did the books for three crews at once. None of them ever learned about the other two.',
    {
      logistics: 34,
      organization: 31,
      logic: 28,
      composure: 27,
      encyclopedia: 25,
      intimidation: 8,
      strength: 9,
      stealth: 10,
    },
    'sig_paymaster',
  ),
  preset(
    'surgeon',
    'Dr. Miriam Halloway',
    'technocrat',
    '08',
    'Six years running a field hospital on a rooftop, with the generator on the stairs. Still keeps a tally of the ones she lost.',
    {
      medicine: 36,
      composure: 30,
      dexterity: 27,
      resolve: 27,
      empathy: 26,
      intimidation: 7,
      strength: 8,
      deception: 9,
    },
    'sig_field_surgeon',
  ),
  preset(
    'quartermaster',
    'Ansel Rooke',
    'technocrat',
    '09',
    'Ran a garrison depot for six years without losing a crate. Knows which shelf a thief goes for first.',
    {
      logistics: 33,
      organization: 30,
      salvage: 28,
      analysis: 26,
      resolve: 25,
      charisma: 9,
      stealth: 9,
      intimidation: 10,
    },
    'sig_quartermaster',
  ),
  preset(
    'organiser',
    'Beatriz Nunes',
    'fixer',
    '10',
    'Turned a rent strike into a district in eleven days. The rota is still on the wall.',
    {
      organization: 34,
      communication: 30,
      leadership: 29,
      diplomacy: 27,
      empathy: 26,
      strength: 8,
      stealth: 9,
      cybernetics: 10,
    },
    'sig_organiser',
  ),
  preset(
    'warlord',
    'Kassim "The Hammer" Dris',
    'enforcer',
    '11',
    '"If they are talking about a fight, I have already started it." Four districts taken, none handed back.',
    {
      strength: 34,
      intimidation: 32,
      strategy: 28,
      stamina: 27,
      toughness: 27,
      empathy: 7,
      signals: 9,
      medicine: 10,
    },
    'sig_warlord',
  ),
  preset(
    'gatekeeper',
    'Halvard Stenn',
    'enforcer',
    '12',
    'Held one door for nine days. The people behind it are still alive and they still send him things.',
    {
      toughness: 35,
      resolve: 31,
      engineering: 28,
      composure: 27,
      strength: 26,
      charisma: 8,
      deception: 9,
      negotiation: 10,
    },
    'sig_gatekeeper',
  ),
  preset(
    'banner',
    'Sol Ferreira',
    'enforcer',
    '13',
    'Carries no rank and no weapon. In a fight, people drift toward her without being told to.',
    {
      charisma: 34,
      leadership: 31,
      resolve: 29,
      composure: 28,
      communication: 26,
      stealth: 8,
      cybernetics: 9,
      salvage: 10,
    },
    'sig_banner',
  ),
  preset(
    'coalition',
    'Nadia Roskova',
    'fixer',
    '14',
    'Brokered the truce on the east side, and later the war that ended it. Speaks for four crews and owes none of them anything.',
    {
      diplomacy: 34,
      negotiation: 31,
      communication: 29,
      strategy: 27,
      empathy: 26,
      strength: 8,
      toughness: 9,
      craft: 10,
    },
    'sig_coalition',
  ),
  preset(
    'vanguard',
    'Tomas Ilic',
    'enforcer',
    '15',
    'First through every door for eleven years. All his scars are on the front.',
    {
      reflexes: 33,
      speed: 31,
      strength: 29,
      stamina: 27,
      resolve: 26,
      encyclopedia: 8,
      signals: 9,
      negotiation: 10,
    },
    'sig_vanguard',
  ),
  preset(
    'industrialist',
    'Wren Achebe',
    'technocrat',
    '16',
    'Plant manager at a river smelter. Kept the line hot through two sieges and a blackout, then left with the keys.',
    {
      engineering: 33,
      logistics: 30,
      organization: 29,
      craft: 28,
      resolve: 26,
      stealth: 8,
      deception: 9,
      intimidation: 10,
    },
    'sig_industrialist',
  ),
  preset(
    'hoarder',
    'Petra Mink',
    'technocrat',
    '17',
    'Rents three lock-ups under three names. One is full of left boots, and she can tell you why.',
    {
      salvage: 35,
      organization: 30,
      encyclopedia: 28,
      intuition: 26,
      logistics: 26,
      charisma: 8,
      intimidation: 9,
      strength: 10,
    },
    'sig_hoarder',
  ),
  preset(
    'contractor',
    'Gideon Arce',
    'technocrat',
    '18',
    '"Cost, plus nothing, plus whatever falls off the truck." Has put up more scaffolding than anyone still working.',
    {
      craft: 33,
      engineering: 30,
      negotiation: 28,
      logistics: 27,
      logic: 25,
      intimidation: 8,
      stealth: 9,
      medicine: 10,
    },
    'sig_contractor',
  ),
  preset(
    'smelter',
    'Yusuf Baran',
    'technocrat',
    '19',
    'Grew up beside the slag heaps and learned to read them. Will not say what goes into his furnace.',
    {
      craft: 34,
      chemistry: 30,
      salvage: 29,
      stamina: 27,
      encyclopedia: 25,
      charisma: 8,
      deception: 9,
      signals: 10,
    },
    'sig_smelter',
  ),
  preset(
    'landlord',
    'Ivo Sarkany',
    'fixer',
    '20',
    'Bought the whole block one winter by paying everyone’s rent. The tenants still send him a card on his birthday.',
    {
      negotiation: 33,
      authority: 30,
      organization: 29,
      deception: 27,
      charisma: 26,
      strength: 8,
      medicine: 9,
      signals: 10,
    },
    'sig_landlord',
  ),
  preset(
    'instructor',
    'Kenji Aramaki',
    'technocrat',
    '21',
    'Ran the recruit course for a security firm that no longer exists. Most of his graduates still do.',
    {
      encyclopedia: 33,
      communication: 30,
      analysis: 28,
      composure: 27,
      dexterity: 25,
      intimidation: 8,
      strength: 9,
      stealth: 10,
    },
    'sig_instructor',
  ),
  preset(
    'roadwise',
    'Lark Oduya',
    'netrunner',
    '22',
    'Drove freight convoys until she found faster roads than the ones on the company maps. Still finds them.',
    {
      navigation: 35,
      speed: 30,
      intuition: 28,
      stealth: 27,
      improvisation: 26,
      strength: 8,
      intimidation: 9,
      authority: 10,
    },
    'sig_roadwise',
  ),
  preset(
    'scavenger_king',
    'Bram Teague',
    'fixer',
    '23',
    '"Everything down here belonged to somebody once. Most of them stopped asking." Runs the best salvage crew on the south side.',
    {
      salvage: 34,
      stamina: 30,
      navigation: 28,
      improvisation: 27,
      toughness: 26,
      logic: 9,
      diplomacy: 9,
      signals: 10,
    },
    'sig_scavenger_king',
  ),
  preset(
    'researcher',
    'Dr. Sunniva Lind',
    'technocrat',
    '24',
    'Former Combine archivist, dismissed for reading the archive. She left with a van full of it.',
    {
      logic: 34,
      encyclopedia: 31,
      analysis: 29,
      cryptography: 27,
      composure: 25,
      strength: 7,
      intimidation: 8,
      charisma: 10,
    },
    'sig_researcher',
  ),
  preset(
    'machinist',
    'Odile Vasquez',
    'technocrat',
    '25',
    'Learned the trade keeping a bus fleet running on parts from other buses. Calls her method persuasion and will not show anyone.',
    {
      craft: 34,
      engineering: 30,
      dexterity: 29,
      improvisation: 27,
      salvage: 26,
      diplomacy: 8,
      intimidation: 9,
      medicine: 10,
    },
    'sig_machinist',
  ),
  preset(
    'ghost',
    'Ren "Nobody" Aslan',
    'netrunner',
    '26',
    'Three crews say they have hired Ren. None of them describe the same person.',
    {
      stealth: 36,
      cryptography: 30,
      composure: 28,
      deception: 27,
      reflexes: 25,
      charisma: 7,
      strength: 8,
      authority: 9,
    },
    'sig_ghost',
  ),
  preset(
    'cartographer',
    'Esme Dalgaard',
    'netrunner',
    '27',
    'Surveyed the city for the tax office and kept a second copy of every map, including the streets the office left off.',
    {
      navigation: 34,
      analysis: 30,
      encyclopedia: 28,
      intuition: 27,
      stamina: 26,
      intimidation: 8,
      strength: 9,
      negotiation: 10,
    },
    'sig_cartographer',
  ),
  preset(
    'infiltrator',
    'Cass Moreau',
    'netrunner',
    '28',
    'Nine years as a building inspector, and she kept every set of keys.',
    {
      stealth: 34,
      dexterity: 31,
      reflexes: 29,
      deception: 27,
      speed: 26,
      strength: 8,
      authority: 9,
      medicine: 10,
    },
    'sig_infiltrator',
  ),
  preset(
    'terror',
    'Vasska Grell',
    'enforcer',
    '29',
    'Collected debts for the Combine until the Combine started paying her to stop. Speaks quietly and never repeats herself.',
    {
      intimidation: 36,
      resolve: 30,
      strength: 28,
      toughness: 27,
      authority: 26,
      empathy: 6,
      diplomacy: 8,
      medicine: 9,
    },
    'sig_terror',
  ),
  preset(
    'name_maker',
    'Dorian Vale',
    'fixer',
    '30',
    'Wrote the pamphlets that made three gang bosses famous and got one of them killed. Charges by the column.',
    {
      communication: 34,
      charisma: 31,
      deception: 29,
      negotiation: 27,
      intuition: 26,
      strength: 8,
      toughness: 9,
      craft: 10,
    },
    'sig_name_maker',
  ),
];

/**
 * A fresh Overseer from a preset.
 *
 * The seven-field copy this replaces existed twice, in `routes/overseer.ts` and `seed/index.ts`,
 * and the two are meant to produce the same person: the bot the seeder stands up is a player who
 * happens not to be one. Two literals is one edit away from a preset field that reaches the real
 * character-select screen and not the seeded rival, which is the kind of divergence nothing tests
 * because both sides still typecheck.
 *
 * The id comes in rather than being generated here, so this stays a pure function of its inputs
 * and the caller keeps whatever id policy it already has.
 */
export function overseerFromPreset(preset: OverseerPreset, id: string): Overseer {
  return {
    id,
    name: preset.name,
    archetype: preset.archetype,
    portraitId: preset.portraitId,
    bio: preset.bio,
    attributes: preset.attributes,
    perks: preset.perks,
  };
}

/** How many characters exist to be offered from. Derived, so the table is the only place to edit. */
export const OVERSEER_POOL_SIZE = OVERSEER_PRESETS.length;

export function findOverseerPreset(presetId: string): OverseerPreset | undefined {
  return OVERSEER_PRESETS.find((preset) => preset.presetId === presetId);
}

/**
 * The characters nobody holds.
 *
 * `claimed` is whatever `overseers.preset_id` holds, which after migration 0095 includes spent
 * claims of the form `enforcer:<uuid>`: a later duplicate holder whose claim was released so the
 * unique index could be built. Those match no `presetId`, so they neither hide a character from
 * the pool nor count as one being held.
 */
function unclaimedPool(claimed: Iterable<string>): readonly OverseerPreset[] {
  const taken = new Set(claimed);
  return OVERSEER_PRESETS.filter((preset) => !taken.has(preset.presetId));
}

/**
 * How many characters are still free, for the line the picker prints above the cards.
 *
 * Counted off the same pool {@link overseerOffer} draws from rather than as
 * `OVERSEER_PRESETS.length - claimed.size`. That subtraction counts migration 0095's spent claims
 * as characters held, so a save carrying duplicates understated the count by one per duplicate and,
 * on a database with more overseer rows than there are characters, printed a negative number.
 */
export function overseerRemaining(claimed: Iterable<string>): number {
  return unclaimedPool(claimed).length;
}

/**
 * The characters one account is offered: {@link OVERSEER_OFFER_SIZE} of whoever is left (§F6).
 *
 * ## Why it is a hash of the account and not a roll
 *
 * The offer is **stored**, so it is the same four every time this account asks: {@link
 * OVERSEER_HOLD_MS} of hold in the `overseer_holds` table, not a recomputed hash. It used to be a
 * pure function of the account id, and the doc here still described that walk long after the
 * caller had moved on to a fresh `randomUUID()` per batch.
 *
 * It is deliberately not a promise that the four never change. A character somebody else claims
 * leaves the pool, and the next reader is offered somebody else in their place. That is the rule
 * the maintainer asked for working as intended rather than a bug: the pool is shared and it drains.
 *
 * ## The draw
 *
 * A partial Fisher-Yates over the pool's indices, off one advancing `mulberry32` stream. Every
 * four-character subset of the pool is reachable and they are drawn evenly.
 *
 * What was here before was a walk of `(hash + step * stride) % pool.length` with the stride itself
 * derived from `hash % pool.length`. Both ends of that read the same residue, so the entire batch
 * was a function of one number in `0..pool.length`: measured on the full pool of thirty, it
 * produced **29 distinct quartets out of the 27,405** that exist, the commonest twice as likely as
 * the rarest. Two independent draws came back identical 3.55% of the time, which is what
 * `overseer-holds.test.ts` had started failing on intermittently. Drawing from a stream instead of
 * one modulus is what fixes it; the coprime-stride reasoning it replaces was sound arithmetic
 * answering a question the caller had stopped asking.
 *
 * Ordering the result by the pool's own order rather than by the draw keeps the screen's four in a
 * stable, readable order.
 */
/**
 * How long a batch of characters is held for the account it was offered to (§F6).
 *
 * Ten minutes, the maintainer's number. Long enough to read four biographies and think about it,
 * short enough that a closed tab does not take four of thirty out of the world until somebody
 * notices. The sweep is on the read, so a server that was down over the window comes back with the
 * holds already lapsed rather than owing a scheduler a tick.
 */
export const OVERSEER_HOLD_MS = 10 * 60 * 1000;

export function overseerOffer(
  claimed: Iterable<string>,
  seed: string,
  size = OVERSEER_OFFER_SIZE,
): readonly OverseerPreset[] {
  const pool = unclaimedPool(claimed);
  if (pool.length <= size) return pool;

  const next = mulberry32(seedFrom(seed));
  const indices = pool.map((_, index) => index);
  for (let at = 0; at < size; at += 1) {
    const swap = at + Math.floor(next() * (indices.length - at));
    [indices[at], indices[swap]] = [indices[swap]!, indices[at]!];
  }
  return indices
    .slice(0, size)
    .sort((a, b) => a - b)
    .map((index) => pool[index]!);
}
