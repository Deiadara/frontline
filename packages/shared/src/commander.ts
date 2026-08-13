import { z } from 'zod';
import { AttributesSchema, DEFAULT_ATTRIBUTES, type Attributes } from './attributes.js';
import {
  AlignmentSchema,
  ALIGNMENT_START,
  AmbitionSchema,
  MoralCompassSchema,
  type Ambition,
  type MoralCompass,
} from './bar/disposition.js';
import { CHARACTER_LEVEL_MIN } from './bar/level.js';
import { IdSchema, IsoDateTimeSchema } from './primitives.js';
import { OfficerRoleSchema, type OfficerRole } from './roles.js';
import { TraitsSchema, type TraitId } from './traits.js';

/** A character hired into one of the officer positions in GDD §C1. */
export const CommanderSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  role: OfficerRoleSchema,
  attributes: AttributesSchema,
  traits: TraitsSchema,
  /** §H4 — what they want and how far they will go for it. Every character carries both. */
  ambition: AmbitionSchema,
  moralCompass: MoralCompassSchema,
  /** §H5 — how much they agree with what this crew does, 0..100. */
  alignment: AlignmentSchema,
  /** When `alignment` was last settled — the anchor for the §H5 drift. */
  alignmentUpdatedAt: IsoDateTimeSchema,
  /**
   * §H6 — this character's own level (INTERFACES R1). Not player progression: `Base.level` is
   * that, it is owned by W6, and nothing here mirrors it.
   */
  level: z.number().int().min(CHARACTER_LEVEL_MIN),
  /** XP banked towards this character's next level. */
  xpIntoLevel: z.number().int().nonnegative(),
  /** §H6a — level-up points still waiting for the player to assign. */
  unspentPoints: z.number().int().nonnegative(),
});
export type Commander = z.infer<typeof CommanderSchema>;

export interface CommanderOptions {
  ambition?: Ambition;
  moralCompass?: MoralCompass;
  /** Anchors the §H5 drift; an officer minted now has not drifted anywhere yet. */
  now?: string;
}

/**
 * Example factory: unlisted attributes default to the recruitment mean, and an officer built this
 * way starts fresh — neutral alignment, level 1, nothing banked. Recruits hired at the Bar are
 * built by the server from a rolled sheet instead (§H2).
 */
export function createCommander(
  id: string,
  name: string,
  role: OfficerRole,
  attributes: Partial<Attributes> = {},
  traits: readonly TraitId[] = [],
  options: CommanderOptions = {},
): Commander {
  return {
    id,
    name,
    role,
    attributes: { ...DEFAULT_ATTRIBUTES, ...attributes },
    traits: [...traits],
    ambition: options.ambition ?? 'wealth',
    moralCompass: options.moralCompass ?? 'pragmatist',
    alignment: ALIGNMENT_START,
    alignmentUpdatedAt: options.now ?? new Date().toISOString(),
    level: CHARACTER_LEVEL_MIN,
    xpIntoLevel: 0,
    unspentPoints: 0,
  };
}
