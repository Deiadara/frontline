import { z } from 'zod';

/**
 * Who holds a place and who pays for a job: GDD §A3.
 *
 * §A3 gives NPC content exactly **one** antagonist: the Government, a tyranny. Everything the
 * player fights that is not another crew is the same enemy, so its name, its garrisons and the
 * fiction of a mission all come from here rather than being re-invented per district or per
 * mission brief. Anything that is *not* the state is `independent`: other crews, the markets,
 * scavenger ground. There is deliberately no third allegiance: a second antagonist would contradict
 * "the main enemy is the Government".
 */
export const ALLEGIANCES = ['government', 'independent'] as const;
export const AllegianceSchema = z.enum(ALLEGIANCES);
export type Allegiance = z.infer<typeof AllegianceSchema>;

export interface AllegianceIdentity {
  /** How the street refers to it, article included: `the Combine`. */
  name: string;
  /** Attributive form, for composed prose: `a Combine checkpoint`. */
  adjective: string;
  /** One line for the HUD and the intel panel. */
  description: string;
}

export const ALLEGIANCE_IDENTITIES: Readonly<Record<Allegiance, AllegianceIdentity>> = {
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
export const GOVERNMENT = ALLEGIANCE_IDENTITIES.government;

/**
 * §A3: enemy composition. What the Combine actually puts on the ground, scaled by how hard the
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

/** The composition every Combine site fields at minimum: also the fallback below the ladder. */
const LIGHTEST_GARRISON: GovernmentGarrison = {
  minDifficulty: 1,
  units: 'a thin line of Civic Levy with surplus blades',
};

/**
 * Named for the units that actually stand there now (`units/catalog.ts`, the Combine roster), so
 * the sentence on the district screen and the garrison `city/control.ts` puts on the ground say
 * the same thing. `city.test.ts` holds the two together.
 */
export const GOVERNMENT_GARRISONS: readonly GovernmentGarrison[] = [
  LIGHTEST_GARRISON,
  { minDifficulty: 2, units: 'Civic Levy with a squad of Greycoats behind them' },
  { minDifficulty: 5, units: 'Greycoats with Street Enforcers on the corners' },
  { minDifficulty: 7, units: 'Street Enforcers behind Suppressor positions' },
  {
    minDifficulty: 9,
    units: 'Suppressors, Enforcers and Greycoats, and whatever the spire can wake',
  },
];

export function governmentGarrisonFor(difficulty: number): string {
  // The ladder starts at difficulty 1 and districts are `min(1)`, so the fallback only guards a
  // caller passing something off the scale.
  const band = GOVERNMENT_GARRISONS.filter((g) => difficulty >= g.minDifficulty).at(-1);
  return (band ?? LIGHTEST_GARRISON).units;
}
