import { z } from 'zod';
import {
  FORTIFY_MAX_LEVEL,
  PLACE_KIND_CATALOG,
  fortifyBonusPercent,
  type FortifyDifficulty,
  type PlaceKind,
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
 * Contexts come off the *kind* of place rather than the individual place, so a chemical plant
 * fights like a chemical plant wherever it is on the map, and a unit sheet that says "at its best
 * indoors" means something a player can plan around.
 */

export const BattlefieldSchema = z.object({
  placeName: z.string(),
  /** Which `CombatContext`s hold here. Both sides read the same list. */
  contexts: z.array(z.enum(COMBAT_CONTEXTS)),
  /** Percentage the holder's effective toughness is raised by ground and digging in. */
  fortifyPercent: z.number().min(0),
  /** The place's own `baseDefense`, 0..10 — how defensible it is before anybody works on it. */
  baseDefense: z.number().min(0),
  /** How many bodies per side can be in contact at once. See {@link FRONTAGE_BY_CONTEXT}. */
  frontage: z.number().positive(),
});
export type Battlefield = z.infer<typeof BattlefieldSchema>;

/**
 * What each kind of place fights like.
 *
 * Hand-authored rather than derived from the blurb: a `CombatContext` is a promise to the player
 * that a modifier on a unit sheet will fire, so it has to be a decision somebody made and can
 * defend, not a keyword match. Every kind names at least one, or holding it would say nothing
 * about how to take it.
 */
export const PLACE_CONTEXTS: Record<PlaceKind, readonly CombatContext[]> = {
  scrap_press: ['urban'],
  chemical_plant: ['indoor', 'urban'],
  power_station: ['urban'],
  water_works: ['indoor'],
  foundry: ['indoor', 'urban'],
  market: ['urban'],
  pawn_shop: ['indoor', 'urban'],
  high_ground: ['open_ground'],
  barricade: ['urban'],
  armory: ['indoor'],
  war_machine_graveyard: ['open_ground'],
  university: ['indoor', 'urban'],
  satellite_uplink: ['open_ground'],
  gene_clinic: ['indoor'],
  fight_pit: ['indoor', 'urban'],
  skate_ground: ['open_ground'],
  hospital: ['indoor', 'urban'],
  rail_yard: ['open_ground'],
  broadcast_tower: ['open_ground'],
  sewer_junction: ['underground'],
};

/**
 * How many bodies a side can bring to bear at once, by what the ground is like.
 *
 * Combat width, from Hearts of Iron and every wargame before it, and the single mechanic that stops
 * "bring everything" from being the whole game. A sewer junction is a corridor: the fortieth Razor
 * behind the first ten is not fighting, they are queuing. Open ground has room for a real line.
 *
 * This is what makes the terrain a *decision* rather than a modifier. On narrow ground the answer
 * to a big army is a small good one, because the big one cannot deploy — and the roster already has
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

/** Ground with nothing to say about its shape — a home district, an unlisted place. */
export const DEFAULT_FRONTAGE = 30;

export function frontageFor(contexts: readonly CombatContext[]): number {
  const widths = contexts
    .map((context) => FRONTAGE_BY_CONTEXT[context])
    .filter((width): width is number => width !== undefined);
  return widths.length === 0 ? DEFAULT_FRONTAGE : Math.min(...widths);
}

/** The hour a raid lands decides whether the sheets that say "after dark" mean anything. */
export const NIGHT_FROM_HOUR = 21;
export const NIGHT_UNTIL_HOUR = 5;

export function isNight(at: Date): boolean {
  const hour = at.getUTCHours();
  return hour >= NIGHT_FROM_HOUR || hour < NIGHT_UNTIL_HOUR;
}

export interface BattlefieldInput {
  placeName: string;
  kind: PlaceKind;
  fortifyDifficulty: FortifyDifficulty;
  fortifyLevel: number;
  at: Date;
}

/**
 * The ground for a fight over one place.
 *
 * `vs_structure` is on the list whenever anything has been dug in, which is what makes a Demolisher
 * worth its supply against a level-5 barricade and worth nothing against bare ground. `defending`
 * is *not* here: it is a property of a side rather than of the place, and `effects.ts` adds it to
 * whichever side is holding.
 */
export function battlefieldFor(input: BattlefieldInput): Battlefield {
  const level = Math.min(FORTIFY_MAX_LEVEL, Math.max(0, Math.trunc(input.fortifyLevel)));
  const contexts: CombatContext[] = [...PLACE_CONTEXTS[input.kind]];
  if (level > 0) contexts.push('vs_structure');
  if (isNight(input.at)) contexts.push('night');

  return {
    placeName: input.placeName,
    contexts,
    fortifyPercent: fortifyBonusPercent(input.fortifyDifficulty, level),
    baseDefense: PLACE_KIND_CATALOG[input.kind].baseDefense,
    frontage: frontageFor(contexts),
  };
}

/**
 * A crew's own district under raid (GDD §A4). There is no fortification to speak of and no place
 * kind — a home district is streets and structures, so it fights urban, and at night if it is
 * night.
 */
export function homeBattlefield(placeName: string, at: Date): Battlefield {
  const contexts: CombatContext[] = isNight(at) ? ['urban', 'night'] : ['urban'];
  return {
    placeName,
    contexts,
    fortifyPercent: 0,
    baseDefense: 0,
    frontage: frontageFor(contexts),
  };
}

/** An empty field — for tests and for anything that has to fight nowhere in particular. */
export function bareBattlefield(placeName = 'open ground'): Battlefield {
  return {
    placeName,
    contexts: ['open_ground'],
    fortifyPercent: 0,
    baseDefense: 0,
    frontage: frontageFor(['open_ground']),
  };
}
