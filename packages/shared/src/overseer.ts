import { z } from 'zod';
import { IdSchema } from './primitives.js';
import { SkillsSchema } from './skills.js';

export const OVERSEER_ARCHETYPES = ['enforcer', 'netrunner', 'fixer', 'technocrat'] as const;
export const OverseerArchetypeSchema = z.enum(OVERSEER_ARCHETYPES);
export type OverseerArchetype = z.infer<typeof OverseerArchetypeSchema>;

/** The player's avatar/commander-in-chief. */
export const OverseerSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  archetype: OverseerArchetypeSchema,
  portraitId: z.string().min(1),
  bio: z.string(),
  skills: SkillsSchema,
});
export type Overseer = z.infer<typeof OverseerSchema>;

/** A selectable template. The server mints a fresh Overseer (new id) from a preset. */
export const OverseerPresetSchema = z.object({
  presetId: IdSchema,
  name: z.string().min(1),
  archetype: OverseerArchetypeSchema,
  portraitId: z.string().min(1),
  bio: z.string(),
  skills: SkillsSchema,
});
export type OverseerPreset = z.infer<typeof OverseerPresetSchema>;

/** The four character-select options — one per archetype. */
export const OVERSEER_PRESETS: readonly OverseerPreset[] = [
  {
    presetId: 'enforcer',
    name: 'Marcus "Bulwark" Kane',
    archetype: 'enforcer',
    portraitId: 'overseer-1',
    bio: 'Ex-corporate security chief who turned his riot squad into a private army. Rules through discipline, fear, and an unbreakable line.',
    skills: {
      leadership: 17,
      tactics: 15,
      hacking: 3,
      logistics: 9,
      intimidation: 18,
      engineering: 7,
      medicine: 5,
      negotiation: 8,
    },
  },
  {
    presetId: 'netrunner',
    name: 'Yumi "Ghostwire" Tanaka',
    archetype: 'netrunner',
    portraitId: 'overseer-2',
    bio: 'Legendary intrusion specialist who once blacked out three arcology grids in a single night. Wars are won in the datastream before a shot is fired.',
    skills: {
      leadership: 8,
      tactics: 12,
      hacking: 19,
      logistics: 7,
      intimidation: 5,
      engineering: 14,
      medicine: 6,
      negotiation: 9,
    },
  },
  {
    presetId: 'fixer',
    name: 'Silas Vex',
    archetype: 'fixer',
    portraitId: 'overseer-3',
    bio: 'Broker of favors, contraband, and loyalties across every district. Never fires first — someone always owes him enough to do it for him.',
    skills: {
      leadership: 12,
      tactics: 9,
      hacking: 8,
      logistics: 16,
      intimidation: 10,
      engineering: 5,
      medicine: 4,
      negotiation: 19,
    },
  },
  {
    presetId: 'technocrat',
    name: 'Dr. Adaeze Okafor',
    archetype: 'technocrat',
    portraitId: 'overseer-4',
    bio: 'Former arcology infrastructure director who believes the city is a machine to be repaired — by force if necessary. Builds faster than anyone can destroy.',
    skills: {
      leadership: 11,
      tactics: 8,
      hacking: 12,
      logistics: 15,
      intimidation: 4,
      engineering: 19,
      medicine: 13,
      negotiation: 10,
    },
  },
];

export function findOverseerPreset(presetId: string): OverseerPreset | undefined {
  return OVERSEER_PRESETS.find((preset) => preset.presetId === presetId);
}
