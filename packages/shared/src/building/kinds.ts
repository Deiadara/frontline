import { z } from 'zod';
import type { PartialResources } from '../resources.js';

/**
 * The thirteen parts of a district (GDD §A1): what the crew actually builds on its own ground.
 *
 * This list *replaces* the MVP's six structures outright. The old names were a placeholder set
 * with no economy behind them; these are the ones the board named, and each one has exactly one
 * mechanical job (see `role` below) rather than a passive `output` nothing paid. Migration
 * `0011_district_buildings.sql` remaps the old kinds onto their successors and is destructive by
 * design, the same call §D9 made for resources.
 *
 * Ordered by the Nexus level that unlocks them, so the list reads as the build ladder.
 */
export const BUILDING_KINDS = [
  'nexus',
  'quarters',
  'greenhouse',
  'generator',
  'scrapyard',
  'cistern',
  'apothecary',
  'gate',
  'lab',
  'gauntlet',
  'infirmary',
  'garage',
] as const;
export const BuildingKindSchema = z.enum(BUILDING_KINDS);
export type BuildingKind = z.infer<typeof BuildingKindSchema>;

/**
 * The one structure every other one answers to (§A1). Named rather than spelled out at each use:
 * three separate rules key off it, the level cap, the unlock ladder and the build discount, and
 * a string literal repeated three times is three places to get it wrong.
 */
export const CENTRAL_BUILDING: BuildingKind = 'nexus';

/**
 * Ceiling on every structure's level. The Nexus is the only one allowed to reach it; see
 * `structureLevelCap`, which holds everything else at the Nexus's own level.
 */
export const BUILDING_MAX_LEVEL = 20;

/**
 * One condition on laying a structure's first level. **All** of a structure's clauses must hold.
 *
 * Deliberately the same shape as `UnitRequirement` (`units/catalog.ts`): the game already has one
 * vocabulary for "you cannot have this yet", and a second one that meant the same thing in
 * different words would be a second thing to learn and a second thing to render.
 */
export type BuildingRequirement =
  | { kind: 'building'; building: BuildingKind; level: number }
  | { kind: 'player_level'; level: number };

export interface BuildingSpec {
  name: string;
  /** Short label for the district plot: the full `name` is too wide under a sprite. */
  shortName: string;
  description: string;
  /**
   * The single mechanic this structure owns, in the player's words.
   *
   * Every entry here is *implemented*. That is the point of the field: the six structures this
   * catalogue replaces carried an `output` bundle whose own doc comment admitted nothing paid it,
   * and a number on a screen that never moves is worse than no number. If a structure's job cannot
   * be pointed at a function, it does not belong in this table.
   */
  role: string;
  /**
   * Everything that must be true before the **first** level of this may be laid (§A1, §I3).
   *
   * **All** clauses must hold. Two kinds, and having both is the point:
   *
   *   * `building`: another structure standing at a level. This is the Grepolis shape: a Gauntlet
   *     needs somewhere to put the people it trains, so it needs Quarters. The Nexus clause every
   *     structure carries is just the most important instance of this, not a separate rule.
   *   * `player_level`: the crew's own level (§I). The Nexus ladder says the *district* is ready;
   *     this says the *crew* is. A district can be a fortress run by people with no idea what to do
   *     with a Lab, and the late structures should wait for both.
   *
   * Several structures carry one clause, several carry two, and the heavy ones carry three, which
   * is what makes the build order a route through the game rather than a queue.
   */
  requires: readonly BuildingRequirement[];
  /** Cost of level 1 before the Nexus discount. Every level above scales it: see `buildingCost`. */
  baseCost: PartialResources;
  /** Seconds to raise level 1, before the Nexus discount. See `buildingBuildSeconds`. */
  baseSeconds: number;
  /**
   * Power drawn at level 1. The Generator is the only 0: it supplies rather than draws.
   *
   * Power is not a resource and is never banked: the Generator burns oil to hold the grid up, and
   * what matters is whether supply covers draw *right now*. See `power.ts`.
   */
  basePowerDraw: number;
}

/** Terser than writing the discriminated union out twelve times below. */
const needs = (building: BuildingKind, level: number): BuildingRequirement => ({
  kind: 'building',
  building,
  level,
});
const nexus = (level: number): BuildingRequirement => needs(CENTRAL_BUILDING, level);
const crew = (level: number): BuildingRequirement => ({ kind: 'player_level', level });

export const BUILDING_CATALOG: Record<BuildingKind, BuildingSpec> = {
  nexus: {
    name: 'The Nexus',
    shortName: 'Nexus',
    description:
      'A commandeered transit hub with the maps still on the walls. Everything the district decides, it decides here.',
    role: 'Caps every other structure at its own level, unlocks new ones as it grows, and takes time and materials off every other upgrade.',
    requires: [],
    baseCost: { caps: 400, scrap: 200, planks: 120, oil: 60 },
    baseSeconds: 45,
    basePowerDraw: 4,
  },
  quarters: {
    name: 'The Quarters',
    shortName: 'Quarters',
    description:
      'Container stacks, hot bunks and a stove that never goes out. Nobody works for a crew they cannot sleep in.',
    role: 'Houses the crew. Officers and assignees both need a bed, and nobody can be placed without one.',
    requires: [nexus(1)],
    // Supplies, alongside the timber: a bigger bunkhouse is stores laid in as much as it is beds
    // built, and it is the one structure whose whole purpose is keeping people.
    baseCost: { caps: 120, supplies: 70, scrap: 90, planks: 110, oil: 10 },
    baseSeconds: 20,
    basePowerDraw: 2,
  },
  greenhouse: {
    name: 'The Greenhouse',
    shortName: 'Greenhouse',
    description:
      'Grow lamps over stacked trays, humming on district power. The only food down here nobody had to fight for.',
    role: 'Grows supplies around the clock. The Cistern raises the yield.',
    requires: [nexus(1)],
    baseCost: { caps: 100, scrap: 70, supplies: 40, planks: 90, oil: 10 },
    baseSeconds: 20,
    basePowerDraw: 3,
  },
  generator: {
    name: 'The Generator',
    shortName: 'Generator',
    description:
      'A turbine block running on whatever burns. It is loud, it is filthy, and the lights are on because of it.',
    role: 'Burns oil to power the district. Everything else draws on it, and a district short of power runs slow.',
    requires: [nexus(1)],
    baseCost: { caps: 150, scrap: 110, planks: 40, oil: 30 },
    baseSeconds: 30,
    basePowerDraw: 0,
  },
  scrapyard: {
    name: 'The Scrapyard',
    shortName: 'Scrapyard',
    description:
      'Torch work, press lines and a sorting floor. Where wreckage is taken apart and something useful is made out of it.',
    role: 'Strips salvage into scrap, fuel and the occasional length of good metal.',
    requires: [nexus(2), needs('generator', 1)],
    baseCost: { caps: 140, scrap: 120, planks: 60, oil: 20 },
    baseSeconds: 25,
    basePowerDraw: 5,
  },
  cistern: {
    name: 'The Cistern',
    shortName: 'Cistern',
    description:
      'Settling tanks, sand filters and a UV stage bolted on last. The Combine meters the water; this crew does not.',
    role: 'Treats water for the district, which raises what the Greenhouse yields and how many the Quarters can hold.',
    requires: [nexus(3), needs('greenhouse', 2)],
    baseCost: { caps: 160, scrap: 130, planks: 70, oil: 20 },
    baseSeconds: 30,
    basePowerDraw: 4,
  },
  apothecary: {
    name: 'The Apothecary',
    shortName: 'Apothecary',
    description:
      'Racks, cages and a ledger nobody else can read. Half dispensary, half the only honest warehouse in the district.',
    role: 'Holds the stockpile. Production stops at the ceiling it sets, so a full district is a district wasting its own output.',
    requires: [nexus(3), needs('scrapyard', 2), crew(3)],
    baseCost: { caps: 180, scrap: 140, planks: 80, oil: 25 },
    baseSeconds: 35,
    basePowerDraw: 2,
  },
  gate: {
    name: 'The Gate',
    shortName: 'Gate',
    description:
      'Ferrocrete, razorwire and a firing step. The first thing anyone coming for this district has to get through.',
    role: 'Defends the district. A raider has to beat what stands here before they touch anything behind it.',
    requires: [nexus(4), needs('scrapyard', 3)],
    baseCost: { caps: 100, scrap: 220, planks: 150, oil: 30 },
    baseSeconds: 30,
    basePowerDraw: 3,
  },
  lab: {
    name: 'The Lab',
    shortName: 'Lab',
    description:
      'Clean-ish benches, a wall of borrowed datacores and three arguments running at once. Ideas, not devices.',
    role: 'Cuts the time every research project takes. Investigations, training and modification work all move faster.',
    requires: [nexus(6), needs('apothecary', 2), crew(5)],
    baseCost: { caps: 260, scrap: 130, planks: 60, oil: 40, highQualityMetal: 10 },
    baseSeconds: 50,
    basePowerDraw: 6,
  },
  gauntlet: {
    name: 'The Gauntlet',
    shortName: 'Gauntlet',
    description:
      'A run of welded obstacles, a mat that has seen better decades, and somebody shouting. People come out of it better than they went in.',
    role: 'Trains the crew. Officers earn more from every job they are sent on.',
    requires: [nexus(8), needs('quarters', 4), needs('gate', 2), crew(7)],
    // Every recruit trained here eats while they do it, and the ground itself is no different.
    baseCost: { caps: 280, supplies: 90, scrap: 180, planks: 100, oil: 40, highQualityMetal: 8 },
    baseSeconds: 55,
    basePowerDraw: 4,
  },
  infirmary: {
    name: 'The Infirmary',
    shortName: 'Infirmary',
    description:
      'Four beds, a printer for the drugs the Combine will not sell down here, and a medic who does not ask.',
    // The old line promised it softened "a missed payday or a lean week". Nothing is charged on a
    // clock any more, so there is no lean week to soften: what it does is get people off the
    // casualty list, which is what `infirmaryRecoveryPercent` has always actually paid out.
    role: 'Looks after the crew. Some of the people a fight would have cost you walk out of here instead.',
    requires: [nexus(10), needs('cistern', 4), needs('lab', 2), crew(10)],
    // Medical stores are stores.
    baseCost: { caps: 300, supplies: 80, scrap: 160, planks: 70, oil: 45, highQualityMetal: 14 },
    baseSeconds: 60,
    basePowerDraw: 5,
  },
  garage: {
    name: 'The Garage',
    shortName: 'Garage',
    description:
      'Pits, a gantry crane and a half-built rotor nobody will discuss. Motors first, vehicles after, and eventually something that flies.',
    role: 'Runs a motor pool: cracks fuel out of salvage and turns out the good metal the heavy work needs.',
    requires: [nexus(12), needs('scrapyard', 6), needs('generator', 6), crew(14)],
    baseCost: { caps: 340, scrap: 240, planks: 50, oil: 60, highQualityMetal: 20 },
    baseSeconds: 50,
    basePowerDraw: 7,
  },
};

/**
 * The Nexus level in a structure's clause list, or 0 for the Nexus itself.
 *
 * The ladder is still the spine of the build order, so it stays readable as a number even though it
 * is stored as one clause among several. Derived rather than duplicated: a structure whose Nexus
 * clause is retuned cannot end up with two different answers to "when does this open".
 */
export function nexusLevelFor(kind: BuildingKind): number {
  for (const clause of BUILDING_CATALOG[kind].requires) {
    if (clause.kind === 'building' && clause.building === CENTRAL_BUILDING) return clause.level;
  }
  return 0;
}

/** Every kind whose first level the district may not lay until the Nexus reaches `nexusLevel`. */
export function buildingsUnlockedAt(nexusLevel: number): BuildingKind[] {
  return BUILDING_KINDS.filter(
    (kind) => nexusLevelFor(kind) === nexusLevel && kind !== CENTRAL_BUILDING,
  );
}

/**
 * One clause, in the player's words: the line the district's hover note is built out of.
 *
 * Written as what is *needed* rather than as what is missing, so the same sentence serves a locked
 * plot ("The Nexus at 6") and a satisfied one on a card that lists both.
 */
export function describeBuildingRequirement(clause: BuildingRequirement): string {
  return clause.kind === 'player_level'
    ? `Crew level ${clause.level}`
    : `${BUILDING_CATALOG[clause.building].name} at ${clause.level}`;
}

/**
 * Guards the ladder at module load.
 *
 * Three ways to write a structure nobody can ever build, all of them easy to type and none of them
 * visible on a screen: a clause naming a structure that does not exist, a structure that requires
 * itself, and a Nexus clause above the level ceiling.
 */
for (const kind of BUILDING_KINDS) {
  for (const clause of BUILDING_CATALOG[kind].requires) {
    if (clause.kind !== 'building') continue;
    if (!BUILDING_KINDS.includes(clause.building)) {
      throw new Error(`${kind} needs ${clause.building}, which is not a structure`);
    }
    if (clause.building === kind) throw new Error(`${kind} requires itself`);
    if (clause.level > BUILDING_MAX_LEVEL) {
      throw new Error(`${kind} needs ${clause.building} at ${clause.level}, past the ceiling`);
    }
  }
}
