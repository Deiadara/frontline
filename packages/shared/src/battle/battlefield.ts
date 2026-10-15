import { z } from 'zod';
import {
  ENV_LABEL_IDS,
  frontageFactor,
  mergeLabels,
  weatherAt,
  weatherLabels,
  type EnvLabel,
  type Location,
  type WeatherKind,
} from '../city/index.js';
import { COMBAT_CONTEXTS, type CombatContext } from '../units/stats.js';

/**
 * The ground a fight happens on (GDD §A4).
 *
 * Two separate things live here and they are deliberately not merged, because Wesnoth's split is
 * the one that survives contact with content: **where you are** decides which of a unit's
 * situational modifiers switch on, and **what you have built** decides how much damage the holder
 * shrugs off. A sewer junction makes Tunnel Rats worth bringing whether or not anybody dug in; a
 * level-5 barricade is worth the same to a Warden as to a Razor.
 *
 * Contexts are authored on each location (`Location.contexts`), so a unit sheet that says "at its
 * best indoors" means something a player can plan around.
 */

export const BattlefieldSchema = z.object({
  locationName: z.string(),
  /** Which `CombatContext`s hold here. Both sides read the same list. */
  contexts: z.array(z.enum(COMBAT_CONTEXTS)),
  /**
   * What the ground is *like* (`city/labels.ts`): the location's own labels folded together with
   * whatever the sky and the clock are doing. Both sides fight in the same weather.
   */
  labels: z.array(z.object({ id: z.enum(ENV_LABEL_IDS), tier: z.number().int().min(1).max(4) })),
  /** The sky over the whole city on the day of the fight. `normal` is most days and shows nothing. */
  weather: z.string(),
  /** The location's own `baseDefense`, 0..10: how defensible it is before anybody works on it. */
  baseDefense: z.number().min(0),
  /** How many units per side can be in contact at once. See {@link FRONTAGE_BY_CONTEXT}. */
  frontage: z.number().positive(),
});
export type Battlefield = z.infer<typeof BattlefieldSchema>;

/**
 * How many units a side can bring to bear at once, by what the ground is like.
 *
 * Combat width, from Hearts of Iron and every wargame before it, and the single mechanic that stops
 * "bring everything" from being the whole game. A sewer junction is a corridor: the fortieth Razor
 * behind the first ten is not fighting, they are queuing. Open ground has room for a real line.
 *
 * This is what makes the terrain a *decision* rather than a modifier. On narrow ground the answer
 * to a big army is a small good one, because the big one cannot deploy, and the roster already has
 * the units for it (`tunnel_rat`, `close_quarters`) waiting for the ground to be worth something.
 *
 * The **narrowest** applicable context wins: a corridor inside a building is a corridor.
 */
export const FRONTAGE_BY_CONTEXT: Partial<Record<CombatContext, number>> = {
  underground: 10,
  indoor: 14,
  urban: 26,
  open_ground: 48,
};

/** Ground with nothing to say about its shape: a home district, an unlisted location. */
export const DEFAULT_FRONTAGE = 30;

export function frontageFor(
  contexts: readonly CombatContext[],
  labels: readonly EnvLabel[] = [],
): number {
  const widths = contexts
    .map((context) => FRONTAGE_BY_CONTEXT[context])
    .filter((width): width is number => width !== undefined);
  const base = widths.length === 0 ? DEFAULT_FRONTAGE : Math.min(...widths);
  // `Crammed` is not only a percentage on a sheet. It is literally how many people fit. Reading
  // it into the width is what makes a smuggler's tunnel a different problem rather than the same
  // fight at a discount, and it is the one lever a big army cannot answer by being bigger.
  return Math.max(1, Math.round(base * frontageFactor(labels)));
}

/**
 * From what tier of `Dark` a location counts as low-light ground.
 *
 * This is what is left of the day/night cycle, and it is a better version of it. The clock used to
 * decide: every fight after 21:00 UTC was a night fight, wherever it was, so a Ghost was worth
 * 20% more in a floodlit yard at ten at night and nothing in a pitch-black sewer at noon. Darkness
 * is a property of the **ground** now, read off the location's own `dark` label, which the
 * catalogue has always carried: sewers, tunnels, cellars and the graveyard are dark all day, and a
 * street is not dark at any hour.
 *
 * Tier 2, not 1: `Dark I` is a room with bad lighting, and a unit kitted to work without light
 * should not get its whole bonus for a dim stairwell.
 */
export const DARK_GROUND_TIER = 2;

function isDarkGround(labels: readonly EnvLabel[]): boolean {
  return labels.some((label) => label.id === 'dark' && label.tier >= DARK_GROUND_TIER);
}

export interface BattlefieldInput {
  locationName: string;
  /** The location's own contexts, ground labels and defence. */
  ground: Pick<Location, 'contexts' | 'labels' | 'baseDefense'>;
  at: Date;
  /**
   * Override the sky. Only tests and the forecast pass this: everything real reads the day out of
   * `at`, because the weather is one roll for the whole city and a caller that could choose it
   * would be a caller that could choose the fight.
   */
  weather?: WeatherKind;
  /**
   * The ground's labels when the caller has already worked them out (`locationGroundLabels`, sky
   * included), so the dark, the frontage and the chips read the same ground the holders and the
   * lamps left. Absent, the location's own labels and the sky's.
   */
  labels?: readonly EnvLabel[];
}

/**
 * The ground for a fight over one location.
 *
 * `defending` is *not* here: it is a property of a side rather than of the location, and
 * `effects.ts` adds it to whichever side is holding. Neither is anything about the works: dug-in
 * fortification left the game (maintainer, 2026-09-26), and a gate is the holder's rather than the
 * ground's, so it arrives with their territory.
 */
export function battlefieldFor(input: BattlefieldInput): Battlefield {
  const contexts: CombatContext[] = [...input.ground.contexts];

  const weather = input.weather ?? weatherAt(input.at);
  const labels = input.labels
    ? [...input.labels]
    : mergeLabels(input.ground.labels, weatherLabels(weather));
  if (isDarkGround(labels)) contexts.push('dark');

  return {
    locationName: input.locationName,
    contexts,
    labels,
    weather,
    baseDefense: input.ground.baseDefense,
    frontage: frontageFor(contexts, labels),
  };
}

/**
 * A crew's own district under raid (GDD §A4). There is no location: a home district is streets and structures, so it fights urban.
 */
export function homeBattlefield(locationName: string, at: Date): Battlefield {
  const contexts: CombatContext[] = ['urban'];
  // A district is streets, so it has no labels of its own, but the sky is over it like everywhere
  // else, and a raid called on a snowy day is a raid in the snow.
  const weather = weatherAt(at);
  const labels = mergeLabels(weatherLabels(weather));
  return {
    locationName,
    contexts,
    labels,
    weather,
    baseDefense: 0,
    frontage: frontageFor(contexts, labels),
  };
}

/** An empty field, for tests and for anything that has to fight nowhere in particular. */
export function bareBattlefield(locationName = 'open ground'): Battlefield {
  return {
    locationName,
    contexts: ['open_ground'],
    labels: [],
    weather: 'normal',
    baseDefense: 0,
    frontage: frontageFor(['open_ground']),
  };
}
