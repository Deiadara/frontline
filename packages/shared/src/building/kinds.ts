import { z } from 'zod';
import type { PartialResources } from '../resources.js';

/**
 * The thirteen parts of a district (GDD §A1) — what the crew actually builds on its own ground.
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
 * three separate rules key off it — the level cap, the unlock ladder and the build discount — and
 * a string literal repeated three times is three places to get it wrong.
 */
export const CENTRAL_BUILDING: BuildingKind = 'nexus';

/**
 * Ceiling on every structure's level. The Nexus is the only one allowed to reach it; see
 * `structureLevelCap`, which holds everything else at the Nexus's own level.
 */
export const BUILDING_MAX_LEVEL = 20;

export interface BuildingSpec {
  name: string;
  /** Short label for the district plot — the full `name` is too wide under a sprite. */
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
   * Nexus level required before the first level of this may be built (§A1 — "unlocks new buildings
   * based on its level"). The Nexus's own entry is 0: nothing gates the thing that does the gating.
   */
  requiresNexusLevel: number;
  /** Cost of level 1 before the Nexus discount. Every level above scales it — see `buildingCost`. */
  baseCost: PartialResources;
  /** Seconds to raise level 1, before the Nexus discount. See `buildingBuildSeconds`. */
  baseSeconds: number;
  /**
   * Power drawn at level 1. The Generator is the only 0 — it supplies rather than draws.
   *
   * Power is not a resource and is never banked: the Generator burns oil to hold the grid up, and
   * what matters is whether supply covers draw *right now*. See `power.ts`.
   */
  basePowerDraw: number;
}

export const BUILDING_CATALOG: Record<BuildingKind, BuildingSpec> = {
  nexus: {
    name: 'The Nexus',
    shortName: 'Nexus',
    description:
      'A commandeered transit hub with the maps still on the walls. Everything the district decides, it decides here.',
    role: 'Caps every other structure at its own level, unlocks new ones as it grows, and takes time and materials off every other upgrade.',
    requiresNexusLevel: 0,
    baseCost: { caps: 400, scrap: 200, oil: 60 },
    baseSeconds: 45,
    basePowerDraw: 4,
  },
  quarters: {
    name: 'The Quarters',
    shortName: 'Quarters',
    description:
      'Container stacks, hot bunks and a stove that never goes out. Nobody works for a crew they cannot sleep in.',
    role: 'Houses the crew. Officers and assignees both need a bed, and nobody can be placed without one.',
    requiresNexusLevel: 1,
    baseCost: { caps: 120, scrap: 90, oil: 10 },
    baseSeconds: 20,
    basePowerDraw: 2,
  },
  greenhouse: {
    name: 'The Greenhouse',
    shortName: 'Greenhouse',
    description:
      'Grow lamps over stacked trays, humming on district power. The only food down here nobody had to fight for.',
    role: 'Grows food around the clock. The Cistern raises the yield.',
    requiresNexusLevel: 1,
    baseCost: { caps: 100, scrap: 70, food: 40, oil: 10 },
    baseSeconds: 20,
    basePowerDraw: 3,
  },
  generator: {
    name: 'The Generator',
    shortName: 'Generator',
    description:
      'A turbine block running on whatever burns. It is loud, it is filthy, and the lights are on because of it.',
    role: 'Burns oil to power the district. Everything else draws on it, and a district short of power runs slow.',
    requiresNexusLevel: 1,
    baseCost: { caps: 150, scrap: 110, oil: 30 },
    baseSeconds: 30,
    basePowerDraw: 0,
  },
  scrapyard: {
    name: 'The Scrapyard',
    shortName: 'Scrapyard',
    description:
      'Torch work, press lines and a sorting floor. Where wreckage is taken apart and something useful is made out of it.',
    role: 'Strips salvage into scrap, fuel and the occasional length of good metal.',
    requiresNexusLevel: 2,
    baseCost: { caps: 140, scrap: 120, oil: 20 },
    baseSeconds: 25,
    basePowerDraw: 5,
  },
  cistern: {
    name: 'The Cistern',
    shortName: 'Cistern',
    description:
      'Settling tanks, sand filters and a UV stage bolted on last. The Combine meters the water; this crew does not.',
    role: 'Treats water for the district, which raises what the Greenhouse yields and how many the Quarters can hold.',
    requiresNexusLevel: 3,
    baseCost: { caps: 160, scrap: 130, oil: 20 },
    baseSeconds: 30,
    basePowerDraw: 4,
  },
  apothecary: {
    name: 'The Apothecary',
    shortName: 'Apothecary',
    description:
      'Racks, cages and a ledger nobody else can read. Half dispensary, half the only honest warehouse in the district.',
    role: 'Holds the stockpile. Production stops at the ceiling it sets, so a full district is a district wasting its own output.',
    requiresNexusLevel: 3,
    baseCost: { caps: 180, scrap: 140, oil: 25 },
    baseSeconds: 35,
    basePowerDraw: 2,
  },
  gate: {
    name: 'The Gate',
    shortName: 'Gate',
    description:
      'Ferrocrete, razorwire and a firing step. The first thing anyone coming for this district has to get through.',
    role: 'Defends the district. A raider has to beat what stands here before they touch anything behind it.',
    requiresNexusLevel: 4,
    baseCost: { caps: 100, scrap: 220, oil: 30 },
    baseSeconds: 30,
    basePowerDraw: 3,
  },
  lab: {
    name: 'The Lab',
    shortName: 'Lab',
    description:
      'Clean-ish benches, a wall of borrowed datacores and three arguments running at once. Ideas, not devices.',
    role: 'Cuts the time every research project takes — investigations, training and modification work alike.',
    requiresNexusLevel: 6,
    baseCost: { caps: 260, scrap: 130, oil: 40, highQualityMetal: 10 },
    baseSeconds: 50,
    basePowerDraw: 6,
  },
  gauntlet: {
    name: 'The Gauntlet',
    shortName: 'Gauntlet',
    description:
      'A run of welded obstacles, a mat that has seen better decades, and somebody shouting. People come out of it better than they went in.',
    role: 'Trains the crew. Officers earn more from every job they are sent on.',
    requiresNexusLevel: 8,
    baseCost: { caps: 280, scrap: 180, oil: 40, highQualityMetal: 8 },
    baseSeconds: 55,
    basePowerDraw: 4,
  },
  infirmary: {
    name: 'The Infirmary',
    shortName: 'Infirmary',
    description:
      'Four beds, a printer for the drugs the Combine will not sell down here, and a medic who does not ask.',
    role: 'Looks after the crew. A district with a working infirmary takes a missed payday or a lean week far better.',
    requiresNexusLevel: 10,
    baseCost: { caps: 300, scrap: 160, oil: 45, highQualityMetal: 14 },
    baseSeconds: 60,
    basePowerDraw: 5,
  },
  garage: {
    name: 'The Garage',
    shortName: 'Garage',
    description:
      'Pits, a gantry crane and a half-built rotor nobody will discuss. Motors first, vehicles after, and eventually something that flies.',
    role: 'Runs a motor pool: cracks fuel out of salvage and turns out the good metal the heavy work needs.',
    requiresNexusLevel: 12,
    baseCost: { caps: 340, scrap: 240, oil: 60, highQualityMetal: 20 },
    baseSeconds: 50,
    basePowerDraw: 7,
  },
};

/** Every kind whose first level the district may not lay until the Nexus reaches `nexusLevel`. */
export function buildingsUnlockedAt(nexusLevel: number): BuildingKind[] {
  return BUILDING_KINDS.filter(
    (kind) => BUILDING_CATALOG[kind].requiresNexusLevel === nexusLevel && kind !== CENTRAL_BUILDING,
  );
}
