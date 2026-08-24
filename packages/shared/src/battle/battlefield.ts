import { z } from 'zod';
import {
  ENV_LABEL_IDS,
  FORTIFY_MAX_LEVEL,
  LOCATION_CATALOG,
  frontageFactor,
  fortifyBonusPercent,
  mergeLabels,
  weatherAt,
  weatherLabels,
  type EnvLabel,
  type FortifyDifficulty,
  type LocationKind,
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
 * Contexts come off the *kind* of location rather than the individual location, so a chemical plant
 * fights like a chemical plant wherever it is on the map, and a unit sheet that says "at its best
 * indoors" means something a player can plan around.
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
  /** Percentage the holder's effective toughness is raised by ground and digging in. */
  fortifyPercent: z.number().min(0),
  /** The location's own `baseDefense`, 0..10: how defensible it is before anybody works on it. */
  baseDefense: z.number().min(0),
  /** How many bodies per side can be in contact at once. See {@link FRONTAGE_BY_CONTEXT}. */
  frontage: z.number().positive(),
});
export type Battlefield = z.infer<typeof BattlefieldSchema>;

/**
 * What each kind of location fights like.
 *
 * Hand-authored rather than derived from the blurb: a `CombatContext` is a promise to the player
 * that a modifier on a unit sheet will fire, so it has to be a decision somebody made and can
 * defend, not a keyword match. Every kind names at least one, or holding it would say nothing
 * about how to take it.
 */
export const LOCATION_CONTEXTS: Record<LocationKind, readonly CombatContext[]> = {
  // industry and supply
  scrap_press: ['urban', 'indoor'],
  chemical_plant: ['indoor', 'urban'],
  power_station: ['urban'],
  water_works: ['indoor'],
  foundry: ['indoor', 'urban'],
  gas_station: ['open_ground', 'urban'],
  nuclear_plant: ['indoor', 'underground'],
  soup_kitchen: ['indoor', 'urban'],
  refugee_camp: ['open_ground', 'urban'],
  // money and trade
  market: ['urban'],
  downtown_market: ['indoor', 'urban'],
  pawn_shop: ['indoor', 'urban'],
  bone_market: ['urban', 'indoor'],
  revolutionist_statue: ['open_ground', 'urban'],
  // ground and defence
  high_ground: ['open_ground'],
  barricade: ['urban'],
  watchtower: ['open_ground', 'urban'],
  sewer_junction: ['underground'],
  smugglers_tunnel: ['underground'],
  // war
  armory: ['indoor'],
  war_machine_graveyard: ['open_ground'],
  construction_site: ['open_ground', 'urban'],
  fight_pit: ['indoor', 'urban'],
  gym: ['indoor', 'urban'],
  doghouse: ['urban', 'indoor'],
  rail_yard: ['open_ground'],
  tram_depot: ['indoor', 'urban'],
  // knowledge and signal
  university: ['indoor', 'urban'],
  planetarium: ['indoor'],
  satellite_uplink: ['open_ground'],
  broadcast_tower: ['open_ground'],
  broadcast_station: ['indoor', 'urban'],
  pirate_radio: ['indoor', 'urban'],
  // flesh
  gene_clinic: ['indoor'],
  hospital: ['indoor', 'urban'],
  black_clinic: ['indoor', 'underground'],
  mad_scientist_lair: ['underground', 'indoor'],
  // people
  tavern: ['indoor', 'urban'],
  cinema: ['indoor'],
  arcade: ['indoor', 'urban'],
  skate_ground: ['open_ground'],
  chapel: ['indoor'],
  graveyard: ['open_ground'],
};

/**
 * How many bodies a side can bring to bear at once, by what the ground is like.
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

/** The hour a raid lands decides whether the sheets that say "after dark" mean anything. */
export const NIGHT_FROM_HOUR = 21;
export const NIGHT_UNTIL_HOUR = 5;

export function isNight(at: Date): boolean {
  const hour = at.getUTCHours();
  return hour >= NIGHT_FROM_HOUR || hour < NIGHT_UNTIL_HOUR;
}

export interface BattlefieldInput {
  locationName: string;
  kind: LocationKind;
  fortifyDifficulty: FortifyDifficulty;
  fortifyLevel: number;
  at: Date;
  /**
   * Override the sky. Only tests and the forecast pass this: everything real reads the day out of
   * `at`, because the weather is one roll for the whole city and a caller that could choose it
   * would be a caller that could choose the fight.
   */
  weather?: WeatherKind;
}

/**
 * The ground for a fight over one location.
 *
 * `vs_structure` is on the list whenever anything has been dug in, which is what makes a Demolisher
 * worth its supply against a level-5 barricade and worth nothing against bare ground. `defending`
 * is *not* here: it is a property of a side rather than of the location, and `effects.ts` adds it to
 * whichever side is holding.
 */
export function battlefieldFor(input: BattlefieldInput): Battlefield {
  const level = Math.min(FORTIFY_MAX_LEVEL, Math.max(0, Math.trunc(input.fortifyLevel)));
  const night = isNight(input.at);
  const contexts: CombatContext[] = [...LOCATION_CONTEXTS[input.kind]];
  if (level > 0) contexts.push('vs_structure');
  if (night) contexts.push('night');

  const weather = input.weather ?? weatherAt(input.at);
  const labels = mergeLabels(LOCATION_CATALOG[input.kind].labels, weatherLabels(weather, night));

  return {
    locationName: input.locationName,
    contexts,
    labels,
    weather,
    fortifyPercent: fortifyBonusPercent(input.fortifyDifficulty, level),
    baseDefense: LOCATION_CATALOG[input.kind].baseDefense,
    frontage: frontageFor(contexts, labels),
  };
}

/**
 * A crew's own district under raid (GDD §A4). There is no fortification to speak of and no location
 * kind: a home district is streets and structures, so it fights urban, and at night if it is
 * night.
 */
export function homeBattlefield(locationName: string, at: Date): Battlefield {
  const night = isNight(at);
  const contexts: CombatContext[] = night ? ['urban', 'night'] : ['urban'];
  // A district is streets, so it has no labels of its own, but the sky is over it like everywhere
  // else, and a raid called for a snowy night is a raid in the snow.
  const weather = weatherAt(at);
  const labels = mergeLabels(weatherLabels(weather, night));
  return {
    locationName,
    contexts,
    labels,
    weather,
    fortifyPercent: 0,
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
    fortifyPercent: 0,
    baseDefense: 0,
    frontage: frontageFor(['open_ground']),
  };
}
