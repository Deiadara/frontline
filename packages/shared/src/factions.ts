import { z } from 'zod';

/**
 * Who holds a place and who pays for a job — GDD §A3.
 *
 * §A3 gives NPC content exactly **one** antagonist: the Government, a tyranny. Everything the
 * player fights that is not another crew is the same enemy, so its name, its garrisons and the
 * fiction of a mission all come from here rather than being re-invented per district or per
 * mission brief. Anything that is *not* the state is `independent` — other crews, the markets,
 * scavenger ground. There is deliberately no third faction: a second antagonist would contradict
 * "the main enemy is the Government".
 */
export const FACTIONS = ['government', 'independent'] as const;
export const FactionSchema = z.enum(FACTIONS);
export type Faction = z.infer<typeof FactionSchema>;

export interface FactionIdentity {
  /** How the street refers to it, article included: `the Combine`. */
  name: string;
  /** Attributive form, for composed prose: `a Combine checkpoint`. */
  adjective: string;
  /** One line for the HUD and the intel panel. */
  description: string;
}

export const FACTION_IDENTITIES: Readonly<Record<Faction, FactionIdentity>> = {
  government: {
    name: 'the Combine',
    adjective: 'Combine',
    description:
      'The government. A tyranny that rules from the surface spires, meters the air in the undercity and answers a question with a curfew.',
  },
  independent: {
    name: 'the undercity',
    adjective: 'undercity',
    description: 'Nobody the Combine speaks for: rival crews, market cartels and open scrap.',
  },
};

/** The §A3 antagonist, named once. Read this rather than hard-coding the word anywhere. */
export const GOVERNMENT = FACTION_IDENTITIES.government;

/**
 * Which way a job points at the state (§A3, §D8).
 *
 * One field rather than a faction plus a direction, so "a job *for* the undercity in general" and
 * other combinations that mean nothing cannot be written down. `against_government` is what §D8
 * reads as anti-systemic action; `for_government` is what it reads as collaboration.
 */
export const MISSION_STANCES = ['against_government', 'for_government', 'unaligned'] as const;
export const MissionStanceSchema = z.enum(MISSION_STANCES);
export type MissionStance = z.infer<typeof MissionStanceSchema>;

export interface MissionStanceSpec {
  /** Board badge, short enough for a mission card. */
  label: string;
  /** What taking the job says about you. */
  description: string;
}

export const MISSION_STANCE_SPECS: Readonly<Record<MissionStance, MissionStanceSpec>> = {
  against_government: {
    label: 'Anti-Combine',
    description: 'A blow against the government. The street keeps score, and so does the Combine.',
  },
  for_government: {
    label: 'Combine Contract',
    description: 'Combine work, Combine pay. Somebody in the undercity is going to hear about it.',
  },
  unaligned: {
    label: 'Unaligned',
    description: 'Nothing the government has an opinion about.',
  },
};

/**
 * §A3 — enemy composition. What the Combine actually puts on the ground, scaled by how hard the
 * site is: it answers a hydroponics fence with a patrol and its own spire with the household
 * guard. Ordered by `minDifficulty` ascending; `governmentGarrisonFor` takes the last band a
 * difficulty reaches, so the table stays readable as a ladder.
 */
export interface GovernmentGarrison {
  /** District/mission difficulty at which this composition starts turning up (1..10). */
  minDifficulty: number;
  /** Named units, as the narration says them. */
  units: string;
}

/** The composition every Combine site fields at minimum — also the fallback below the ladder. */
const LIGHTEST_GARRISON: GovernmentGarrison = {
  minDifficulty: 1,
  units: 'a Combine sanitation patrol and a pair of drone spotters',
};

export const GOVERNMENT_GARRISONS: readonly GovernmentGarrison[] = [
  LIGHTEST_GARRISON,
  { minDifficulty: 3, units: 'a Combine enforcer squad behind riot plate' },
  { minDifficulty: 5, units: 'an enforcer column with rolling counter-ICE support' },
  { minDifficulty: 7, units: 'a Directorate rifle company dug into hardened ferrocrete' },
  { minDifficulty: 9, units: 'the Directorate household guard, and whatever the spire can wake' },
];

export function governmentGarrisonFor(difficulty: number): string {
  // The ladder starts at difficulty 1 and districts are `min(1)`, so the fallback only guards a
  // caller passing something off the scale.
  const band = GOVERNMENT_GARRISONS.filter((g) => difficulty >= g.minDifficulty).at(-1);
  return (band ?? LIGHTEST_GARRISON).units;
}
