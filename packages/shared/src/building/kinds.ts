import { z } from 'zod';
import type { PartialResources } from '../resources.js';

/**
 * The eleven parts of a district (GDD §A1): what the crew actually builds on its own ground.
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
 * two separate rules key off it, the unlock ladder and the per-level permission table, and a
 * string literal repeated at each of them is a place to get it wrong.
 */
export const CENTRAL_BUILDING: BuildingKind = 'nexus';

/**
 * Ceiling on every structure's level. The Nexus is the only one that reaches it on its own
 * authority; see {@link NEXUS_LADDERS}, which says how far up the Nexus lets each of the others go.
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
  /** Seconds to raise level 1, before the Generator's discount. See `buildingBuildSeconds`. */
  baseSeconds: number;
}

/** Terser than writing the discriminated union out eleven times below. */
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
    role: 'Authorises every other structure. Each of them has a level it cannot pass until the Nexus is senior enough to sign for it, and new plots open as it grows.',
    requires: [],
    baseCost: { caps: 400, scrap: 200, planks: 120, oil: 60 },
    baseSeconds: 45,
  },
  quarters: {
    name: 'The Quarters',
    shortName: 'Quarters',
    description:
      'Container stacks, hot bunks and a stove that never goes out. Nobody works for a crew they cannot sleep in.',
    role: 'Raises the district population ceiling, and nothing else. Every soldier needs a bed, so this is the number that decides how big the army can be.',
    requires: [nexus(1)],
    // Supplies, alongside the timber: a bigger bunkhouse is stores laid in as much as it is beds
    // built, and it is the one structure whose whole purpose is keeping people.
    baseCost: { caps: 120, supplies: 70, scrap: 90, planks: 110, oil: 10 },
    baseSeconds: 20,
  },
  greenhouse: {
    name: 'The Greenhouse',
    shortName: 'Greenhouse',
    description:
      'Grow lamps over stacked trays, running day and night. The only food down here nobody had to fight for.',
    role: 'Grows supplies around the clock, and every level takes a little more of the supplies bill off training a unit.',
    requires: [nexus(1)],
    baseCost: { caps: 100, scrap: 70, supplies: 40, planks: 90, oil: 10 },
    baseSeconds: 20,
  },
  generator: {
    name: 'The Generator',
    shortName: 'Generator',
    description:
      'A turbine block running on whatever burns. It is loud, it is filthy, and every crane in the district turns because of it.',
    role: "Takes time off every other structure's build, by level, and sells a two-hour burn of oil that takes a quarter off the whole queue.",
    requires: [nexus(1)],
    // Mainly oil (§B4). The turbine is fed rather than built: the plant is a drum, a rotor and a
    // fuel line, and what a bigger one costs is what it swallows getting there.
    baseCost: { caps: 150, oil: 220, planks: 55, scrap: 70 },
    baseSeconds: 30,
  },
  scrapyard: {
    name: 'The Scrapyard',
    shortName: 'Scrapyard',
    description:
      'Torch work, press lines and a sorting floor. Where wreckage is taken apart and something useful is made out of it.',
    role: 'Strips salvage into scrap, fuel and the occasional length of good metal, and builds the add-ons that bolt onto a structure or a unit.',
    requires: [nexus(2), needs('generator', 1)],
    baseCost: { caps: 140, scrap: 120, planks: 60, oil: 20 },
    baseSeconds: 25,
  },
  apothecary: {
    name: 'The Apothecary',
    shortName: 'Apothecary',
    description:
      'Racks, cages and a ledger nobody else can read. Half dispensary, half the only honest warehouse in the district.',
    role: 'Sets the ceiling on how much of each resource the district can hold. Production stops there, so a full district is a district wasting its own output.',
    requires: [nexus(3), needs('scrapyard', 2), crew(3)],
    baseCost: { caps: 180, scrap: 140, planks: 80, oil: 25 },
    baseSeconds: 35,
  },
  gate: {
    name: 'The Gate',
    shortName: 'Gate',
    description:
      'Ferrocrete, razorwire and a firing step. The first thing anyone coming for this district has to get through.',
    role: 'Adds a percentage of defence to every unit holding this district, and makes the place harder to scout.',
    requires: [nexus(2), needs('scrapyard', 3)],
    baseCost: { caps: 100, scrap: 220, planks: 150, oil: 30 },
    baseSeconds: 30,
  },
  lab: {
    name: 'The Lab',
    shortName: 'Lab',
    description:
      'Clean-ish benches, a wall of borrowed datacores and three arguments running at once. Ideas, not devices.',
    role: 'The door to research, and the clock on it: every project takes less time as the Lab grows.',
    requires: [nexus(4), needs('apothecary', 2), crew(5)],
    baseCost: { caps: 260, scrap: 130, planks: 60, oil: 40, highQualityMetal: 10 },
    baseSeconds: 50,
  },
  gauntlet: {
    name: 'The Gauntlet',
    shortName: 'Gauntlet',
    description:
      'A run of welded obstacles, a mat that has seen better decades, and somebody shouting. People come out of it better than they went in.',
    role: 'Unlocks units as it grows and takes time off training every one of them, including the ones it cannot train itself.',
    requires: [nexus(2), needs('quarters', 1)],
    // Every recruit trained here eats while they do it, and the ground itself is no different.
    baseCost: { caps: 280, supplies: 90, scrap: 180, planks: 100, oil: 40, highQualityMetal: 8 },
    baseSeconds: 55,
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
    requires: [nexus(10), needs('greenhouse', 4), needs('lab', 2), crew(10)],
    // Medical stores are stores.
    baseCost: { caps: 300, supplies: 80, scrap: 160, planks: 70, oil: 45, highQualityMetal: 14 },
    baseSeconds: 60,
  },
  garage: {
    name: 'The Garage',
    shortName: 'Garage',
    description:
      'Pits, a gantry crane and a half-built rotor nobody will discuss. Motors first, vehicles after, and eventually something that flies.',
    role: 'Builds and keeps the machines. Gives nothing on its own: what it is worth is what is parked in it.',
    requires: [nexus(12), needs('scrapyard', 6), needs('generator', 6), crew(14)],
    baseCost: { caps: 340, scrap: 240, planks: 50, oil: 60, highQualityMetal: 20 },
    baseSeconds: 50,
  },
};

/**
 * The Nexus's permission table (§B1): how far up each structure the Nexus will sign, per level.
 *
 * The Nexus used to be a single rule, "nothing outgrows the Nexus", which is one number doing
 * eleven jobs: a Gate and a Lab were held at exactly the same rung, so the build order was a
 * straight line and the Nexus was a toll rather than a decision. The board asked for the opposite:
 * a **per-building, per-level** requirement that is deliberately **asymmetric**, so a district can
 * be a fortress at Nexus 5 and a laboratory at Nexus 5 but not both.
 *
 * ## The shape, and why it is a table rather than a formula
 *
 * A ladder is a list of breakpoints, `[targetLevel, nexusLevel]`, ascending in both. The
 * requirement for target level *L* is the last breakpoint at or below *L*, so a run of levels that
 * ask for the same Nexus is written once. That is the whole authoring surface: eleven short lists
 * a designer reads down a column and retunes without touching a line of code. A formula with a
 * per-building coefficient would have looked tidier and would have made asymmetry impossible to
 * express, which is the one thing this is for.
 *
 * The first breakpoint is always the structure's own `requires` clause and is asserted to be, at
 * module load: two numbers for "when does this plot open" is two answers to one question.
 */
export type NexusLadder = readonly (readonly [targetLevel: number, nexusLevel: number])[];

export const NEXUS_LADDERS: Readonly<Record<BuildingKind, NexusLadder>> = {
  // The Nexus answers to nobody. Empty rather than a run of zeroes, so the exception is visible.
  nexus: [],
  // Beds. The one thing a crew always wants more of, so the Nexus barely stands in its way: this
  // is the ladder every other one is read against.
  quarters: [
    [1, 1],
    [5, 3],
    [9, 5],
    [13, 8],
    [17, 11],
  ],
  // Food, on much the same terms as beds until the top, where a glasshouse the size of a district
  // needs the district to be one.
  greenhouse: [
    [1, 1],
    [5, 3],
    [9, 6],
    [13, 9],
    [17, 13],
  ],
  // The Generator paces everybody else's clock, so it is allowed to run a little ahead of them.
  generator: [
    [1, 1],
    [4, 3],
    [8, 6],
    [12, 9],
    [16, 13],
  ],
  scrapyard: [
    [1, 2],
    [5, 4],
    [9, 7],
    [13, 10],
    [17, 14],
  ],
  // The warehouse is the least interesting thing to be stopped by, and the most annoying: it is
  // the ceiling every other structure's output runs into.
  apothecary: [
    [1, 3],
    [6, 5],
    [11, 9],
    [16, 13],
  ],
  // The board's own example: a Gate going to 5 needs Nexus 2 while a Lab going to 5 needs Nexus 4.
  // Defence is what a crew reaches for when it is losing, and a crew that is losing has a small
  // Nexus, so this is the shallowest ladder in the table by a wide margin.
  gate: [
    [1, 2],
    [9, 5],
    [13, 8],
    [17, 12],
  ],
  // And the other half of the example. The Lab is the deep end of the game: it is allowed to open
  // early and then it wants a district behind it.
  lab: [
    [1, 4],
    [5, 4],
    [9, 8],
    [13, 12],
    [17, 16],
  ],
  // The Gauntlet is the unit ladder (§B6), so it opens almost immediately and climbs steadily:
  // holding it back would be holding the roster back, which is the game.
  gauntlet: [
    [1, 2],
    [5, 4],
    [9, 7],
    [13, 10],
    [17, 14],
  ],
  infirmary: [
    [1, 10],
    [6, 12],
    [11, 15],
    [16, 18],
  ],
  // The last plot, and the steepest ladder: a motor pool is the end of a district rather than a
  // part of one.
  garage: [
    [1, 12],
    [6, 14],
    [11, 16],
    [16, 19],
  ],
};

/**
 * The Nexus level that has to be standing before `kind` may be raised **to** `level`.
 *
 * Zero for the Nexus itself and for anything below the first breakpoint. The answer a refusal is
 * written out of, so it is a number rather than a boolean: "raise the Nexus first" is only advice
 * when it says how far.
 */
export function nexusLevelForUpgrade(kind: BuildingKind, level: number): number {
  let needed = 0;
  for (const [targetLevel, nexusLevel] of NEXUS_LADDERS[kind]) {
    if (targetLevel > level) break;
    needed = nexusLevel;
  }
  return needed;
}

/**
 * The highest level `kind` may be raised to with the Nexus standing at `nexusLevel`.
 *
 * The read side of the same table. Walks the ladder rather than inverting it, because the ladder
 * is at most five entries long and an inversion is a second thing to keep in step.
 */
export function levelCapForNexus(kind: BuildingKind, nexusLevel: number): number {
  if (kind === CENTRAL_BUILDING) return BUILDING_MAX_LEVEL;
  let cap = 0;
  for (let level = 1; level <= BUILDING_MAX_LEVEL; level += 1) {
    if (nexusLevelForUpgrade(kind, level) > nexusLevel) break;
    cap = level;
  }
  return cap;
}

/**
 * The Nexus level a structure's **first** level needs, or 0 for the Nexus itself.
 *
 * Read off the ladder rather than off the clause list, so there is one source for it. The clause
 * list still carries the same number because that is what `unmetRequirements` renders, and the
 * guard at the bottom of this file holds the two together.
 */
export function nexusLevelFor(kind: BuildingKind): number {
  return nexusLevelForUpgrade(kind, 1);
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

/**
 * And guards the permission table (§B1), which has four ways of locking a structure out of the
 * game and none of them shows up on a screen.
 *
 * A ladder that steps *down* would let a level be legal and the one below it not; a breakpoint past
 * the ceiling is a rung nobody reaches; a first breakpoint that disagrees with the structure's own
 * Nexus clause is two answers to "when does this open"; and a Nexus requirement at the ceiling
 * itself would make the top level of that structure unreachable, because the Nexus can only ever be
 * {@link BUILDING_MAX_LEVEL}.
 */
for (const kind of BUILDING_KINDS) {
  let lastTarget = 0;
  let lastNexus = 0;
  for (const [target, needed] of NEXUS_LADDERS[kind]) {
    if (target <= lastTarget && lastTarget !== 0) {
      throw new Error(`${kind}'s ladder revisits level ${target}`);
    }
    if (needed < lastNexus) throw new Error(`${kind}'s ladder steps down at level ${target}`);
    if (target > BUILDING_MAX_LEVEL || needed > BUILDING_MAX_LEVEL) {
      throw new Error(`${kind}'s ladder asks for ${needed} at level ${target}, past the ceiling`);
    }
    lastTarget = target;
    lastNexus = needed;
  }
  if (kind === CENTRAL_BUILDING) continue;
  const clause = BUILDING_CATALOG[kind].requires.find(
    (need): need is { kind: 'building'; building: BuildingKind; level: number } =>
      need.kind === 'building' && need.building === CENTRAL_BUILDING,
  );
  if ((clause?.level ?? 0) !== nexusLevelForUpgrade(kind, 1)) {
    throw new Error(
      `${kind} opens at Nexus ${clause?.level ?? 0} in its clauses and at ${nexusLevelForUpgrade(kind, 1)} on its ladder`,
    );
  }
  if (levelCapForNexus(kind, BUILDING_MAX_LEVEL) !== BUILDING_MAX_LEVEL) {
    throw new Error(`${kind} cannot reach level ${BUILDING_MAX_LEVEL} at any Nexus level`);
  }
}
