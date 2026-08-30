import { z } from 'zod';
import { AttributesSchema, makeAttributes } from './attributes.js';
import { IdSchema } from './primitives.js';
import { PerksSchema } from './crew/perks.js';

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
 * The four character-select options: one per archetype (GDD §F6: the choice stays exactly as it
 * is today, restated on the new attribute model). Everything unlisted sits at the recruitment
 * mean; each Overseer starts inside the same band a recruit does (§B2a), so nothing exceeds 40.
 *
 * The listed ratings are post-trait, per `OverseerSchema`: the fixer's `negotiation: 35` already
 * contains silver_tongue's +8.
 */
export const OVERSEER_PRESETS: readonly OverseerPreset[] = [
  {
    presetId: 'enforcer',
    name: 'Marcus "Bulwark" Kane',
    archetype: 'enforcer',
    portraitId: 'overseer-1',
    bio: 'Ex-corporate security chief who turned his riot squad into a private army. Rules through discipline, fear, and an unbreakable line.',
    attributes: makeAttributes(15, {
      intimidation: 34,
      leadership: 31,
      toughness: 30,
      organization: 28,
      strength: 27,
      hacking: 6,
      cybernetics: 8,
      intuition: 9,
    }),
    perks: ['reputation'],
  },
  {
    presetId: 'netrunner',
    name: 'Yumi "Ghostwire" Tanaka',
    archetype: 'netrunner',
    portraitId: 'overseer-2',
    bio: 'Legendary intrusion specialist who once blacked out three arcology grids in a single night. Wars are won in the datastream before a shot is fired.',
    attributes: makeAttributes(15, {
      hacking: 36,
      cybernetics: 30,
      analysis: 29,
      stealth: 26,
      improvisation: 25,
      strength: 7,
      intimidation: 9,
    }),
    perks: ['wire_tap'],
  },
  {
    presetId: 'fixer',
    name: 'Silas Vex',
    archetype: 'fixer',
    portraitId: 'overseer-3',
    bio: 'Broker of favors, contraband, and loyalties across every district. Never fires first. Somebody always owes him enough to do it for him.',
    attributes: makeAttributes(15, {
      negotiation: 35,
      strategy: 30,
      deception: 29,
      charisma: 27,
      logistics: 25,
      medicine: 9,
      stamina: 10,
    }),
    perks: ['haggler'],
  },
  {
    presetId: 'technocrat',
    name: 'Dr. Adaeze Okafor',
    archetype: 'technocrat',
    portraitId: 'overseer-4',
    bio: 'Former arcology infrastructure director who believes the city is a machine that can be repaired, by force if necessary. Builds faster than anyone can destroy.',
    attributes: makeAttributes(15, {
      engineering: 35,
      fabrication: 30,
      intuition: 29,
      logistics: 27,
      analysis: 26,
      intimidation: 7,
      stealth: 9,
      deception: 10,
    }),
    perks: ['sorted_heap'],
  },
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

export function findOverseerPreset(presetId: string): OverseerPreset | undefined {
  return OVERSEER_PRESETS.find((preset) => preset.presetId === presetId);
}
