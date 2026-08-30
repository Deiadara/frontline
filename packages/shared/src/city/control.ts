import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import { POPULATION_PER_LOCATION } from '../building/population.js';
import { fortifyBonusPercent } from './fortification.js';
import { findDistrict, unifiedBonusFor, type District } from './districts.js';
import {
  LOCATION_CATALOG,
  MAX_LOCATION_LEVEL,
  applyHoldBonus,
  bonusesAt,
  noTerritoryEffects,
  type Location,
  type TerritoryEffects,
} from './locations.js';

/**
 * Who holds what, and what that is worth (GDD §A4).
 *
 * Control is **world state, not player state**: a location is held by exactly one party and every
 * player sees the same answer. That is why it lives in its own table rather than inside a base:
 * two crews reading their own copy of who holds the Bonefield is how a shared map stops being
 * shared.
 */

/**
 * The parties that can hold ground.
 *
 * `unoccupied` is a real state, not the absence of one: an empty location still has to be walked into
 * and can still be taken off you afterwards, and saying so explicitly means no caller has to treat
 * `null` as a fifth case.
 */
export const LOCATION_HOLDER_KINDS = ['unoccupied', 'government', 'looters', 'faction'] as const;
export const LocationHolderKindSchema = z.enum(LOCATION_HOLDER_KINDS);
export type LocationHolderKind = z.infer<typeof LocationHolderKindSchema>;

export const LocationHolderSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unoccupied') }),
  z.object({ kind: z.literal('government') }),
  z.object({ kind: z.literal('looters') }),
  /** A crew: the base that holds it, which is also who its garrison answers to. */
  z.object({ kind: z.literal('faction'), baseId: IdSchema }),
]);
export type LocationHolder = z.infer<typeof LocationHolderSchema>;

export const HOLDER_LABELS: Record<LocationHolderKind, string> = {
  unoccupied: 'Unoccupied',
  government: 'The Combine',
  looters: 'Looters',
  faction: 'Another crew',
};

/** One location's world state. */
export const LocationControlSchema = z.object({
  locationId: z.string().min(1),
  holder: LocationHolderSchema,
  /**
   * 1..`MAX_LOCATION_LEVEL`: how far this location has been worked up (§A4).
   *
   * **Reset to 1 the moment it changes hands, for everybody.** That is the whole tension of the
   * system and it is deliberately not softened: nobody inherits the previous holder's investment,
   * so a well-developed location is a target worth taking and a liability worth garrisoning, and
   * pouring four upgrades into ground you cannot hold is a mistake the game lets you make.
   */
  level: z.number().int().min(1).max(MAX_LOCATION_LEVEL).default(1),
  /** Set while a level is being worked on; null when nothing is under way. */
  upgradingUntil: IsoDateTimeSchema.nullable().default(null),
  /** 0..`FORTIFY_MAX_LEVEL`. Reset to 0 whenever the location changes hands. */
  fortification: z.number().int().min(0),
  /** Set while a fortification level is being dug in; null when nothing is under way. */
  fortifyingUntil: IsoDateTimeSchema.nullable(),
  /** Units standing here, keyed by unit id. Belongs to whoever `holder` is. */
  garrison: z.record(z.string(), z.number().int().nonnegative()),
});
export type LocationControl = z.infer<typeof LocationControlSchema>;

export function isHeldBy(control: LocationControl, baseId: string): boolean {
  return control.holder.kind === 'faction' && control.holder.baseId === baseId;
}

/** Two holders being the same party: the question "did this actually change hands?" asks. */
export function sameHolder(a: LocationHolder, b: LocationHolder): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'faction' && b.kind === 'faction') return a.baseId === b.baseId;
  return true;
}

/** How many units are standing on a location, whoever they belong to. */
export function garrisonSize(control: LocationControl): number {
  return Object.values(control.garrison).reduce((total, count) => total + count, 0);
}

/**
 * What a raider has to beat to take this location.
 *
 * Three terms, and each is something somebody chose: the ground itself (the catalogue's
 * `baseDefense`), how deeply the holder has dug in (fortification), and how many of them are
 * standing on it. Held by nobody, it is the ground alone, which is why an unoccupied location is
 * worth walking into early.
 */
export const DEFENSE_PER_GARRISON_UNIT = 0.4;

export function locationDefense(location: Location, control: LocationControl): number {
  const ground = LOCATION_CATALOG[location.kind].baseDefense;
  const dug = fortifyBonusPercent(location.fortifyDifficulty, control.fortification);
  const standing = garrisonSize(control) * DEFENSE_PER_GARRISON_UNIT;
  return Math.round((ground + standing) * (1 + dug / 100) * 10) / 10;
}

/**
 * Who holds *all* of a district, or `null` when nobody does.
 *
 * The §A4 unified bonus turns on this and nothing else: a district split between two crews pays
 * neither of them, which is what makes finishing one worth more than farming the best location in it.
 */
export function districtHolder(
  district: District,
  controls: ReadonlyMap<string, LocationControl>,
): LocationHolder | null {
  if (district.locations.length === 0) return null;

  const first = controls.get(district.locations[0]!.id);
  if (!first || first.holder.kind === 'unoccupied') return null;

  for (const location of district.locations) {
    const control = controls.get(location.id);
    if (!control || !sameHolder(control.holder, first.holder)) return null;
  }
  return first.holder;
}

/** Every district this crew has taken outright. */
export function districtsHeldBy(
  baseId: string,
  districts: readonly District[],
  controls: ReadonlyMap<string, LocationControl>,
): District[] {
  return districts.filter((district) => {
    const holder = districtHolder(district, controls);
    return holder?.kind === 'faction' && holder.baseId === baseId;
  });
}

/**
 * Everything this crew's territory is currently worth, in one pass.
 *
 * Each location it holds contributes its own hold bonus, and each district it holds *outright*
 * contributes the unified bonus on top. Nothing here is stored: territory value is derived from
 * the control table every time it is asked, so a location changing hands takes effect immediately and
 * there is no second copy to keep in step.
 */
export function territoryEffectsFor(
  baseId: string,
  locations: readonly Location[],
  controls: ReadonlyMap<string, LocationControl>,
): TerritoryEffects {
  const effects = noTerritoryEffects();

  const held = new Set<string>();
  for (const location of locations) {
    const control = controls.get(location.id);
    if (!control || !isHeldBy(control, baseId)) continue;
    held.add(location.districtId);
    // §A1: ground you hold is ground people live on. Flat per location and deliberately not
    // scaled by its level: what houses people is the block, not how well the press in it runs.
    effects.populationBonus += POPULATION_PER_LOCATION;
    // At the level it has been worked up to (§A4): the whole reason to pour resources into
    // ground you might lose. `bonusesAt` is the only reader of `LEVEL_SCALE`, so a location's
    // worth and the number on its card cannot disagree.
    for (const bonus of bonusesAt(location.kind, control.level)) applyHoldBonus(effects, bonus);
  }

  for (const districtId of held) {
    const district = findDistrict(districtId);
    if (!district) continue;
    const holder = districtHolder(district, controls);
    if (holder?.kind !== 'faction' || holder.baseId !== baseId) continue;
    const unified = unifiedBonusFor(districtId);
    if (unified) applyHoldBonus(effects, unified.bonus);
  }

  return effects;
}

/**
 * Who is actually standing on an NPC location, and how many.
 *
 * Every location used to start with `garrison: {}`: held on paper by the Combine or the looters, and
 * defended by nobody at all. So every location on the map could be taken by one Razor, for free, and
 * the entire city layer was a formality. The fiction had said so all along: "Steelbelt being
 * full of looters is what gives a new crew something to fight that will lose."
 *
 * Derived, not authored: the size comes off the district's own difficulty and the location's
 * `baseDefense`, so a location added to the catalogue tomorrow is garrisoned without anybody
 * remembering to garrison it. Deterministic, so the world is the same for every player and a test
 * can state what is on a location rather than sample it.
 *
 * The Combine fields regulars and the looters field rabble, which is most of what makes Combine
 * ground worth being frightened of (§A3).
 */
// Tuned against the opening move, not in the abstract: a new crew fields four Razors and can train
// more for nothing, so the easiest location in the city has to be takeable by a first-session force
// that has made a little effort. At 1.2/0.9 Steelbelt's press holds four and the Combine's hard
// ground holds fifteen, which is the spread the difficulty numbers were written for.
export const GARRISON_PER_DIFFICULTY = 1.2;
export const GARRISON_PER_BASE_DEFENSE = 0.9;

// Typed off the row rather than as an `Army`: `units/` imports `city/`, so naming the unit type
// here would close a cycle. The ids are still unit ids and `city.test.ts` pins that they resolve.
export function startingGarrison(
  location: Location,
  district: District,
): LocationControl['garrison'] {
  const holder = startingHolder(location, district);
  if (holder.kind === 'unoccupied' || holder.kind === 'faction') return {};

  const strength = Math.max(
    2,
    Math.round(
      district.difficulty * GARRISON_PER_DIFFICULTY +
        LOCATION_CATALOG[location.kind].baseDefense * GARRISON_PER_BASE_DEFENSE,
    ),
  );

  if (holder.kind === 'government') {
    // Combine ground: a line, not a mob. Two thirds shields, one third guns.
    const wardens = Math.max(1, Math.round(strength * 0.65));
    return { wardens, snipers: Math.max(1, strength - wardens) };
  }
  // Looters: numbers and knives.
  const razors = Math.max(1, Math.round(strength * 0.7));
  return { razors, scrapers: Math.max(1, strength - razors) };
}

/** A fresh, untouched location: whoever nominally garrisons the district, and who they left on it. */
export function startingControl(location: Location, district: District): LocationControl {
  return {
    locationId: location.id,
    holder: startingHolder(location, district),
    // Level 1, like every capture. Nobody starts the game holding somebody else's work.
    level: 1,
    upgradingUntil: null,
    fortification: 0,
    fortifyingUntil: null,
    garrison: startingGarrison(location, district),
  };
}

/**
 * How many locations the squatters hold in a district nobody has locked down.
 *
 * Two, and it is the number that decides what the opening hour of the game is like. Every location in
 * the city used to start held, which meant every district in it was **shut**: one party holding
 * all of it is exactly what arms a gate, so a new crew's only legal move anywhere was to break
 * down a door. That is the endgame move, offered on the first screen.
 *
 * Two squatted locations leaves open ground to walk onto, keeps a fight worth having in every
 * district, and still leaves somebody to take the district off later.
 */
export const SQUATTED_PLACES_PER_OPEN_DISTRICT = 2;

/**
 * Who is standing on a location before anybody has been to it (§A3, §A4).
 *
 * Two kinds of district, and the difference is the shape of the early game:
 *
 *   * **Combine ground is shut.** Every location in it is garrisoned, which arms its gate, and the
 *     only way in is through the front, which is what the Combine being the Combine should feel
 *     like, and what makes taking one of its districts an event.
 *   * **Independent ground is open, and squatted.** Looters hold the
 *     {@link SQUATTED_PLACES_PER_OPEN_DISTRICT} most defensible spots and the rest is standing
 *     empty. A crew can walk onto the open ground and then has a real fight for the good ones.
 *
 * Which spots the squatters take is *derived*: the highest `baseDefense` in the district, ties
 * broken by id: rather than authored, so a location added to the catalogue tomorrow sorts itself into
 * the right half without anybody remembering to. Deterministic for the same reason
 * `startingGarrison` is: every player gets the same city, and a test can state what is on a location
 * rather than sample it.
 */
export function startingHolder(location: Location, district: District): LocationHolder {
  if (district.faction === 'government') return { kind: 'government' };
  return squattedIn(district).includes(location.id) ? { kind: 'looters' } : { kind: 'unoccupied' };
}

/** The ids the squatters hold in an open district, worst ground first out of the running. */
function squattedIn(district: District): readonly string[] {
  return [...district.locations]
    .sort((a, b) => {
      const byDefense = LOCATION_CATALOG[b.kind].baseDefense - LOCATION_CATALOG[a.kind].baseDefense;
      return byDefense !== 0 ? byDefense : a.id.localeCompare(b.id);
    })
    .slice(0, SQUATTED_PLACES_PER_OPEN_DISTRICT)
    .map((candidate) => candidate.id);
}
