import { z } from 'zod';
import { AttributesSchema, makeAttributes } from './attributes.js';
import { IdSchema } from './primitives.js';
import { TraitsSchema } from './traits.js';

export const OVERSEER_ARCHETYPES = ['enforcer', 'netrunner', 'fixer', 'technocrat'] as const;
export const OverseerArchetypeSchema = z.enum(OVERSEER_ARCHETYPES);
export type OverseerArchetype = z.infer<typeof OverseerArchetypeSchema>;

/** The player's avatar/commander-in-chief. Same sheet as everyone else (GDD §F1). */
export const OverseerSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  archetype: OverseerArchetypeSchema,
  portraitId: z.string().min(1),
  bio: z.string(),
  attributes: AttributesSchema,
  traits: TraitsSchema,
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
  traits: TraitsSchema,
});
export type OverseerPreset = z.infer<typeof OverseerPresetSchema>;

/**
 * The four character-select options — one per archetype (GDD §F6: the choice stays exactly as it
 * is today, restated on the new attribute model). Everything unlisted sits at the recruitment
 * mean; each Overseer starts inside the same band a recruit does (§B2a), so nothing exceeds 40.
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
      tactics: 28,
      strength: 27,
      hacking: 6,
      cybernetics: 8,
      scholarship: 9,
    }),
    traits: ['unbreakable'],
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
      imagination: 25,
      strength: 7,
      intimidation: 9,
      marksmanship: 10,
    }),
    traits: ['wired_reflexes'],
  },
  {
    presetId: 'fixer',
    name: 'Silas Vex',
    archetype: 'fixer',
    portraitId: 'overseer-3',
    bio: 'Broker of favors, contraband, and loyalties across every district. Never fires first — someone always owes him enough to do it for him.',
    attributes: makeAttributes(15, {
      negotiation: 35,
      appraisal: 30,
      deception: 29,
      charisma: 27,
      logistics: 25,
      marksmanship: 8,
      medicine: 9,
      endurance: 10,
    }),
    traits: ['silver_tongue'],
  },
  {
    presetId: 'technocrat',
    name: 'Dr. Adaeze Okafor',
    archetype: 'technocrat',
    portraitId: 'overseer-4',
    bio: 'Former arcology infrastructure director who believes the city is a machine to be repaired — by force if necessary. Builds faster than anyone can destroy.',
    attributes: makeAttributes(15, {
      engineering: 35,
      fabrication: 30,
      scholarship: 29,
      logistics: 27,
      analysis: 26,
      intimidation: 7,
      stealth: 9,
      deception: 10,
    }),
    traits: ['scrap_whisperer'],
  },
];

export function findOverseerPreset(presetId: string): OverseerPreset | undefined {
  return OVERSEER_PRESETS.find((preset) => preset.presetId === presetId);
}
