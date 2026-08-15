import { z } from 'zod';
import { RESOURCE_KEYS, type PartialResources, type ResourceKey } from '../resources.js';

/**
 * The things inside a district that are worth taking (GDD §A4).
 *
 * A district is not a single objective any more. It is a handful of *places* — a substation, a
 * pawn shop, a war machine graveyard — each held by somebody, each takeable on its own, and each
 * worth something for as long as you keep it. Taking every place in a district takes the district.
 *
 * Everything here is hard-authored. Nothing about the city is generated: the point of a map is
 * that players learn it, and you cannot learn a map that is different every time.
 */

export const PLACE_KINDS = [
  'scrap_press',
  'chemical_plant',
  'power_station',
  'water_works',
  'foundry',
  'market',
  'pawn_shop',
  'high_ground',
  'barricade',
  'armory',
  'war_machine_graveyard',
  'university',
  'satellite_uplink',
  'gene_clinic',
  'fight_pit',
  'skate_ground',
  'hospital',
  'rail_yard',
  'broadcast_tower',
  'sewer_junction',
] as const;
export const PlaceKindSchema = z.enum(PLACE_KINDS);
export type PlaceKind = z.infer<typeof PlaceKindSchema>;

/**
 * What holding a place is worth.
 *
 * A closed union, and every member is read by something — the same rule the building catalogue
 * lives by. A place whose bonus cannot be spelled as one of these does not get written, because a
 * number on a screen that never moves is worse than no number.
 *
 * Note what is *not* here: unit unlocks. A place that gates a unit does so through the unit's own
 * requirement list (`{ kind: 'place', placeKind }`), so the gate is authored once, on the thing it
 * gates. `unitsUnlockedByPlace` reads it back for display.
 */
export type HoldBonus =
  | { kind: 'resource'; resource: ResourceKey; perHour: number }
  | { kind: 'power_supply'; amount: number }
  | { kind: 'defense_percent'; percent: number }
  | { kind: 'research_speed'; percent: number }
  | { kind: 'build_speed'; percent: number }
  | { kind: 'training_speed'; percent: number }
  | { kind: 'training_cost'; percent: number }
  | { kind: 'unit_offense'; percent: number }
  | { kind: 'unit_vitality'; percent: number }
  | { kind: 'unit_morale'; flat: number }
  | { kind: 'unit_speed'; percent: number }
  | { kind: 'unit_stealth'; percent: number }
  | { kind: 'loot_capacity'; percent: number }
  | { kind: 'intimidation'; flat: number }
  | { kind: 'travel_speed'; percent: number }
  /** Reveals this many of the nearest districts without having to walk into them. */
  | { kind: 'vision'; districts: number };

export interface PlaceKindSpec {
  label: string;
  /** One line for the map tooltip — what the place *is*. */
  blurb: string;
  /** What holding it buys, in the player's words. Derived text would read like a spreadsheet. */
  reward: string;
  bonus: HoldBonus;
  /**
   * How hard it is to take, on the same 1..10 scale district difficulty used. Multiplied by the
   * holder's own strength and by any fortification when the skirmish is resolved.
   */
  baseDefense: number;
}

export const PLACE_KIND_CATALOG: Record<PlaceKind, PlaceKindSpec> = {
  scrap_press: {
    label: 'Scrap Press',
    blurb: 'Baling presses and a sorting floor that has not stopped since before the war.',
    reward: 'Scrap, steadily, for as long as you hold it.',
    bonus: { kind: 'resource', resource: 'scrap', perHour: 24 },
    baseDefense: 2,
  },
  chemical_plant: {
    label: 'Chemical Plant',
    blurb: 'Cracking towers and a tank farm. Everything downwind of it tastes of it.',
    reward: 'Oil, cracked on site.',
    bonus: { kind: 'resource', resource: 'oil', perHour: 14 },
    baseDefense: 4,
  },
  power_station: {
    label: 'Power Station',
    blurb: 'A substation off the old grid, still fed by something nobody has switched off.',
    reward: 'Power for your own district, without burning a drop of oil for it.',
    bonus: { kind: 'power_supply', amount: 40 },
    baseDefense: 5,
  },
  water_works: {
    label: 'Water Works',
    blurb: 'Intake screens, settling beds and a pumphouse under a corrugated roof.',
    reward: 'Food, because clean water is most of what growing it takes.',
    bonus: { kind: 'resource', resource: 'food', perHour: 26 },
    baseDefense: 3,
  },
  foundry: {
    label: 'Foundry',
    blurb: 'Two cupola furnaces and a pour floor, running whenever there is fuel for it.',
    reward: 'High-quality metal — the material nothing else makes in quantity.',
    bonus: { kind: 'resource', resource: 'highQualityMetal', perHour: 3 },
    baseDefense: 4,
  },
  market: {
    label: 'Market',
    blurb: 'Awnings, arguments, and a hundred people moving goods nobody has papers for.',
    reward: 'A cut of everything that changes hands.',
    bonus: { kind: 'resource', resource: 'caps', perHour: 30 },
    baseDefense: 3,
  },
  pawn_shop: {
    label: 'Pawn Shop',
    blurb: 'A barred window, a long counter, and a back room with better stock.',
    reward: 'A smaller cut, and a fence who moves what a raid brings back.',
    bonus: { kind: 'loot_capacity', percent: 15 },
    baseDefense: 1,
  },
  high_ground: {
    label: 'High Ground',
    blurb: 'A roofline, a water tower, a spoil heap — whatever here counts as looking down.',
    reward: 'Everything you hold in this city is harder to take off you.',
    bonus: { kind: 'defense_percent', percent: 12 },
    baseDefense: 4,
  },
  barricade: {
    label: 'Barricade',
    blurb: 'Sea containers, rubble and rebar, arranged by somebody who had thought about it.',
    reward: 'A harder approach to everything behind it.',
    bonus: { kind: 'defense_percent', percent: 8 },
    baseDefense: 5,
  },
  armory: {
    label: 'Armory',
    blurb: 'Racks, a workbench, and a door that took three people to open the first time.',
    reward: 'Cheaper units, and the paperwork for some that were never on offer.',
    bonus: { kind: 'training_cost', percent: 15 },
    baseDefense: 6,
  },
  war_machine_graveyard: {
    label: 'War Machine Graveyard',
    blurb: 'A field of dead armour, half of it sunk, some of it not as dead as it looks.',
    reward: 'Hulls big enough to build something that walks.',
    bonus: { kind: 'unit_vitality', percent: 10 },
    baseDefense: 6,
  },
  university: {
    label: 'University',
    blurb: 'Lecture halls turned workshops, and a library nobody got round to burning.',
    reward: 'Every research project finishes sooner.',
    bonus: { kind: 'research_speed', percent: 12 },
    baseDefense: 3,
  },
  satellite_uplink: {
    label: 'Satellite Uplink',
    blurb: 'A dish on a mast, aligned by hand, talking to something still in orbit.',
    reward: 'You can see into districts without walking into them first.',
    bonus: { kind: 'vision', districts: 2 },
    baseDefense: 5,
  },
  gene_clinic: {
    label: 'Gene Clinic',
    blurb: 'Sealed theatres, cold storage, and a waiting room nobody waits in.',
    reward: 'Work can be done on people here that cannot be done anywhere else.',
    bonus: { kind: 'unit_vitality', percent: 8 },
    baseDefense: 6,
  },
  fight_pit: {
    label: 'Fight Pit',
    blurb: 'A sunk ring, a standing crowd, and a bookmaker who knows everyone.',
    reward: 'Your people are harder to frighten, and better for the practice.',
    bonus: { kind: 'unit_morale', flat: 8 },
    baseDefense: 2,
  },
  skate_ground: {
    label: 'Skate Ground',
    blurb: 'A drained reservoir the kids took over, and then the couriers after them.',
    reward: 'Everything you field moves faster.',
    bonus: { kind: 'unit_speed', percent: 12 },
    baseDefense: 1,
  },
  hospital: {
    label: 'Hospital',
    blurb: 'Four working theatres, a generator, and staff who stayed when the funding did not.',
    reward: 'What comes back from a fight comes back in better shape.',
    bonus: { kind: 'unit_vitality', percent: 12 },
    baseDefense: 3,
  },
  rail_yard: {
    label: 'Rail Yard',
    blurb: 'Sidings, a turntable, and rolling stock that will move if pushed hard enough.',
    reward: 'Everything reaches the far side of the city sooner.',
    bonus: { kind: 'travel_speed', percent: 20 },
    baseDefense: 4,
  },
  broadcast_tower: {
    label: 'Broadcast Tower',
    blurb: 'A mast with a working transmitter, and whoever holds it decides what the city hears.',
    reward: 'Your name arrives before your people do.',
    bonus: { kind: 'intimidation', flat: 10 },
    baseDefense: 5,
  },
  sewer_junction: {
    label: 'Sewer Junction',
    blurb: 'A brick chamber where six storm drains meet. It goes everywhere.',
    reward: 'Your people can get places without being seen getting there.',
    bonus: { kind: 'unit_stealth', percent: 15 },
    baseDefense: 2,
  },
};

/**
 * How hard a place is to dig into (§A4).
 *
 * Deliberately inverted against intuition, and the board asked for it that way: an *easy* place to
 * fortify pays the most per level. The rubble-and-rebar barricade you can add to all afternoon is
 * worth more per level than the spire you can barely drill into — the hard ones are already
 * defensible, so what you can add to them is marginal.
 */
export const FORTIFY_DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export const FortifyDifficultySchema = z.enum(FORTIFY_DIFFICULTIES);
export type FortifyDifficulty = z.infer<typeof FortifyDifficultySchema>;

/** Defence percentage each fortification level is worth, by how hard the ground is to work. */
export const FORTIFY_PERCENT_PER_LEVEL: Record<FortifyDifficulty, number> = {
  easy: 5,
  medium: 4,
  hard: 3,
};

export const FORTIFY_DIFFICULTY_LABELS: Record<FortifyDifficulty, string> = {
  easy: 'Easy to fortify',
  medium: 'Medium to fortify',
  hard: 'Hard to fortify',
};

/** One authored place on the map. */
export const PlaceSchema = z.object({
  id: z.string().min(1),
  districtId: z.string().min(1),
  name: z.string().min(1),
  kind: PlaceKindSchema,
  fortifyDifficulty: FortifyDifficultySchema,
});
export type Place = z.infer<typeof PlaceSchema>;

/** The zero of {@link TerritoryEffects} — also the answer for a crew holding nothing. */
export interface TerritoryEffects {
  /** Added to whatever the district's own structures produce. */
  perHour: PartialResources;
  powerSupply: number;
  defensePercent: number;
  researchSpeedPercent: number;
  buildSpeedPercent: number;
  trainingSpeedPercent: number;
  trainingCostPercent: number;
  unitOffensePercent: number;
  unitVitalityPercent: number;
  unitMoraleFlat: number;
  unitSpeedPercent: number;
  unitStealthPercent: number;
  lootCapacityPercent: number;
  intimidationFlat: number;
  travelSpeedPercent: number;
  /** How many of the nearest districts are visible without scouting them.  */
  visionRange: number;
}

export function noTerritoryEffects(): TerritoryEffects {
  return {
    perHour: {},
    powerSupply: 0,
    defensePercent: 0,
    researchSpeedPercent: 0,
    buildSpeedPercent: 0,
    trainingSpeedPercent: 0,
    trainingCostPercent: 0,
    unitOffensePercent: 0,
    unitVitalityPercent: 0,
    unitMoraleFlat: 0,
    unitSpeedPercent: 0,
    unitStealthPercent: 0,
    lootCapacityPercent: 0,
    intimidationFlat: 0,
    travelSpeedPercent: 0,
    visionRange: 0,
  };
}

/** Folds one bonus into a running total. Mutates `into` — it is the accumulator of a reduce. */
export function applyHoldBonus(into: TerritoryEffects, bonus: HoldBonus): TerritoryEffects {
  switch (bonus.kind) {
    case 'resource':
      into.perHour = {
        ...into.perHour,
        [bonus.resource]: (into.perHour[bonus.resource] ?? 0) + bonus.perHour,
      };
      return into;
    case 'power_supply':
      into.powerSupply += bonus.amount;
      return into;
    case 'defense_percent':
      into.defensePercent += bonus.percent;
      return into;
    case 'research_speed':
      into.researchSpeedPercent += bonus.percent;
      return into;
    case 'build_speed':
      into.buildSpeedPercent += bonus.percent;
      return into;
    case 'training_speed':
      into.trainingSpeedPercent += bonus.percent;
      return into;
    case 'training_cost':
      into.trainingCostPercent += bonus.percent;
      return into;
    case 'unit_offense':
      into.unitOffensePercent += bonus.percent;
      return into;
    case 'unit_vitality':
      into.unitVitalityPercent += bonus.percent;
      return into;
    case 'unit_morale':
      into.unitMoraleFlat += bonus.flat;
      return into;
    case 'unit_speed':
      into.unitSpeedPercent += bonus.percent;
      return into;
    case 'unit_stealth':
      into.unitStealthPercent += bonus.percent;
      return into;
    case 'loot_capacity':
      into.lootCapacityPercent += bonus.percent;
      return into;
    case 'intimidation':
      into.intimidationFlat += bonus.flat;
      return into;
    case 'travel_speed':
      into.travelSpeedPercent += bonus.percent;
      return into;
    case 'vision':
      into.visionRange = Math.max(into.visionRange, bonus.districts);
      return into;
  }
}

/** A bonus in one line, for a place card. Authored `reward` text says *why*; this says how much. */
export function describeHoldBonus(bonus: HoldBonus): string {
  switch (bonus.kind) {
    case 'resource':
      return `+${bonus.perHour} ${RESOURCE_LABELS[bonus.resource]}/h`;
    case 'power_supply':
      return `+${bonus.amount} power`;
    case 'defense_percent':
      return `+${bonus.percent}% defence`;
    case 'research_speed':
      return `-${bonus.percent}% research time`;
    case 'build_speed':
      return `-${bonus.percent}% build time`;
    case 'training_speed':
      return `-${bonus.percent}% training time`;
    case 'training_cost':
      return `-${bonus.percent}% training cost`;
    case 'unit_offense':
      return `+${bonus.percent}% unit offense`;
    case 'unit_vitality':
      return `+${bonus.percent}% unit vitality`;
    case 'unit_morale':
      return `+${bonus.flat} unit morale`;
    case 'unit_speed':
      return `+${bonus.percent}% unit speed`;
    case 'unit_stealth':
      return `+${bonus.percent}% unit stealth`;
    case 'loot_capacity':
      return `+${bonus.percent}% loot capacity`;
    case 'intimidation':
      return `+${bonus.flat} intimidation`;
    case 'travel_speed':
      return `+${bonus.percent}% travel speed`;
    case 'vision':
      return `sees ${bonus.districts} districts`;
  }
}

/** Short resource names for the one-line bonus text. Kept here so this module stands alone. */
const RESOURCE_LABELS: Record<ResourceKey, string> = {
  caps: 'caps',
  food: 'food',
  oil: 'oil',
  scrap: 'scrap',
  highQualityMetal: 'HQ metal',
};

/** Guards the label table against a resource being added and silently going unnamed. */
for (const key of RESOURCE_KEYS) {
  if (!RESOURCE_LABELS[key]) throw new Error(`no place-bonus label for the ${key} resource`);
}
