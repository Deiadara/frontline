import { z } from 'zod';
import type { PartialResources } from '../resources.js';

/**
 * The eleven parts of a district (GDD §A1): what the crew actually builds on its own ground.
 *
 * This list *replaces* the MVP's six structures outright. The old names were a placeholder set
 * with no economy behind them; these are the ones the maintainer named, and each one has exactly one
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
 * The ceiling a structure has unless its own entry in {@link BUILDING_LEVEL_CEILINGS} says
 * otherwise. The Nexus is the only one that reaches it on its own authority; see
 * {@link NEXUS_LADDERS}, which says how far up the Nexus lets each of the others go.
 *
 * Still the right number to reach for when the question is about the *game's* top level rather
 * than one structure's: the Nexus's own ceiling, the bound a stored level is parsed against, the
 * highest rung any ladder may name. When the question is "how far can this one go", ask
 * {@link levelCeilingFor}.
 */
export const BUILDING_MAX_LEVEL = 20;

/**
 * Structures that stop short of {@link BUILDING_MAX_LEVEL}, and where they stop.
 *
 * The Infirmary opens at Nexus 10 and the Garage at Nexus 12, which is most of the way through a
 * district's life, and a twenty-rung ladder started that late is a ladder nobody finishes. Ten
 * rungs each puts their last level in the same week as everybody else's twentieth instead of a
 * month behind it.
 *
 * Authored here and nowhere else. The alternative was a pair of `kind === 'garage'` tests at every
 * call site that asks about a ceiling, which is five places today and the sixth one that gets
 * forgotten. Everything else reads {@link levelCeilingFor}, including the Nexus permission table,
 * so a ladder, a build queue, an upgrade refusal and a dialog all stop at the same rung.
 */
export const BUILDING_LEVEL_CEILINGS: Partial<Record<BuildingKind, number>> = {
  infirmary: 10,
  garage: 10,
};

/** How high `kind` can go. {@link BUILDING_MAX_LEVEL} unless it has a ceiling of its own. */
export function levelCeilingFor(kind: BuildingKind): number {
  return BUILDING_LEVEL_CEILINGS[kind] ?? BUILDING_MAX_LEVEL;
}

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
  /**
   * Lines this structure is only charged from `LATE_COST_FROM_LEVEL` (`building/cost.ts`) up, at the amounts
   * written here, scaling from that level rather than from the first.
   *
   * The bill a structure opens with and the bill it grows into are two different statements, and
   * `baseCost` can only make the first one: everything in it is charged at level 1 and multiplied
   * by `BUILDING_COST_GROWTH` from there. The maintainer wanted the seven ordinary structures to
   * start asking for high quality metal partway up, which is not a number you can write in
   * `baseCost` at all. A second, later-starting bundle says it in one field.
   *
   * The amount here is what the structure is charged the **first** time it is charged at all, so
   * the table reads as the price of that level rather than as a level-1 price nobody ever pays.
   * Structures that want a material from the ground up keep writing it in `baseCost`, which is why
   * the Lab, the Gauntlet, the Infirmary and the Garage are untouched.
   */
  lateCost?: PartialResources;
  /**
   * Seconds to raise level 1, before the Generator's discount. See `buildingBuildSeconds`.
   *
   * ## Why the openers are all within a whisker of each other
   *
   * The maintainer's sheet asked for two things a single growth rate cannot both give. It spread
   * the first levels over 8x (a Gate at 60 seconds, a Lab at 500) and it asked for the twentieth
   * levels to come out "similar in the final hours flat". With one `BUILDING_TIME_GROWTH` for
   * every structure, the ratio between any two of them is the same at level 1 as it is at level
   * 20: 8x apart at the bottom is 8x apart at the top, which with a 20 hour Gate would put the Lab
   * at the better part of a week.
   *
   * The flat endings won, so the openers compress. Every twenty-rung structure lands between 2
   * minutes 5 seconds and 3 minutes at its first level and between 20.7 and 29.9 hours at its
   * last, with the Nexus at the top of both bands because the maintainer asked for it to finish
   * "in the 30 hour range". Getting the 8x spread back means a per-structure growth rate, which is
   * a change to `BUILDING_TIME_GROWTH` and to everything reading it, not a retune of this column.
   *
   * The Infirmary and the Garage are off that scale on purpose. They unlock at Nexus 10 and 12 and
   * stop at level 10 ({@link BUILDING_LEVEL_CEILINGS}), so they open at about an hour and finish
   * at 23 and 24.7, inside the same band as everybody else's twentieth.
   */
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
      'A seized ex-transport hub with the maps still on the walls. Everything the district decides, it decides here.',
    role: 'It unlocks other buildings, and also caps their level. Upgrading the nexus is mandatory in order to upgrade the rest of the district.',
    requires: [],
    baseCost: { caps: 400, scrap: 200, planks: 120, oil: 60 },
    // Plate and bar, once the hub stops being a room with maps in it. The heaviest bill of the
    // seven, on the heaviest structure.
    lateCost: { highQualityMetal: 60 },
    baseSeconds: 180,
  },
  quarters: {
    name: 'The Quarters',
    shortName: 'Quarters',
    description:
      'Container stacks, hot bunks and a stove that never goes out. Changing the world requires a place to sleep at night.',
    role: 'Raises the district’s unit slots, and widens the payroll book by 2 points a level. Every soldier, officer and machine take slot units, so upgrading the quarters is required in order to grow in number.',
    requires: [nexus(1)],
    // Supplies, alongside the timber: a bigger bunkhouse is stores laid in as much as it is beds
    // built, and it is the one structure whose whole purpose is keeping people.
    baseCost: { caps: 50, supplies: 200, scrap: 40, planks: 110, oil: 20 },
    lateCost: { highQualityMetal: 30 },
    baseSeconds: 140,
  },
  greenhouse: {
    name: 'The Greenhouse',
    shortName: 'Greenhouse',
    description:
      'Grow lamps over stacked trays, running day and night. The only food down here nobody had to fight for.',
    role: 'Grows supplies and planks around the clock, and every level takes a little more of the supplies bill off training a unit.',
    requires: [nexus(3)],
    baseCost: { caps: 100, scrap: 150, planks: 200, oil: 200 },
    // Frames and ducting. Glass and trays are most of a glasshouse, so it asks for less good
    // metal than its bill would suggest.
    lateCost: { highQualityMetal: 35 },
    baseSeconds: 160,
  },
  generator: {
    name: 'The Generator',
    shortName: 'Generator',
    description:
      'A turbine block running on whatever burns. It is loud and it is filthy, but everyone in the district prays it never stops, as everything depends on it.',
    role: "Refines oil around the clock, takes time off every other structure's build by level, and sells a two-hour burn that makes upgrading other buildings faster. How much faster depends on its level.",
    requires: [nexus(1)],
    // Mainly oil (§B4). The turbine is fed rather than built: the plant is a drum, a rotor and a
    // fuel line, and what a bigger one costs is what it swallows getting there.
    baseCost: { caps: 120, oil: 270, scrap: 40 },
    // A bigger rotor is a rotor you cannot cut out of salvage.
    lateCost: { highQualityMetal: 35 },
    baseSeconds: 140,
  },
  scrapyard: {
    name: 'The Scrapyard',
    shortName: 'Scrapyard',
    description:
      "If it's not a resource you can use as is, it ends up here. What comes out depends on the district's creativity.",
    role: 'Strips components into scraps and HQ metal, and also produces them passively in small amounts. Also serves as the workstation to build modifications and traps.',
    requires: [nexus(3), needs('generator', 1)],
    baseCost: { caps: 200, scrap: 300, planks: 100, oil: 20 },
    // The yard that makes the stuff spends the most of it, after the Nexus.
    lateCost: { highQualityMetal: 45 },
    baseSeconds: 160,
  },
  apothecary: {
    name: 'The Apothecary',
    shortName: 'Apothecary',
    description:
      "Abandoned markets that now store the district's resources. The more you can store, the longer you will last.",
    role: 'Sets the ceiling on how much of each resource the district can hold. Production stops there, so a full district is a district wasting its own output.',
    requires: [nexus(1)],
    baseCost: { caps: 120, scrap: 70, planks: 200 },
    // Shelving and a door worth having. The lightest bill of the seven, and the lightest line.
    lateCost: { highQualityMetal: 25 },
    baseSeconds: 130,
  },
  gate: {
    name: 'The Gate',
    shortName: 'Gate',
    description:
      'The first thing anyone coming for this district sees. Better make sure they are scared.',
    role: 'Adds a percentage of defence to every unit holding this district, and makes the place harder to scout.',
    requires: [nexus(1)],
    baseCost: { caps: 200, scrap: 220, planks: 150, oil: 20 },
    // Armour plate. Past the fifth level the wall is metal rather than whatever was to hand.
    lateCost: { highQualityMetal: 40 },
    baseSeconds: 125,
  },
  lab: {
    name: 'The Lab',
    shortName: 'Lab',
    description:
      'Clean-ish benches, a wall of borrowed datacores and three arguments running at once. Literally re-inventing the wheel.',
    role: 'Makes research faster and unlocks a number of upgrades and projects.',
    requires: [nexus(4), needs('generator', 2), crew(5)],
    baseCost: { caps: 400, scrap: 200, planks: 200, oil: 250, highQualityMetal: 25 },
    baseSeconds: 175,
  },
  gauntlet: {
    name: 'The Gauntlet',
    shortName: 'Gauntlet',
    description:
      'When this was taken over it was obvious what it would be used for. People come out of it better than they went in, although that depends on your definition of better.',
    role: 'Unlocks units as it grows and takes time off training every one of them, including the ones it cannot train itself.',
    requires: [nexus(3), needs('quarters', 2)],
    // Every recruit trained here eats while they do it, and the ground itself is no different.
    baseCost: { caps: 300, supplies: 300, scrap: 100, planks: 100, highQualityMetal: 10 },
    baseSeconds: 170,
  },
  infirmary: {
    name: 'The Infirmary',
    shortName: 'Infirmary',
    description:
      'Four beds, a cabinet for the drugs the Combine will not sell down here, and a self-proclaimed medic to oversee it.',
    // The old line promised it softened "a missed payday or a lean week". Nothing is charged on a
    // clock any more, so there is no lean week to soften: what it does is get people off the
    // casualty list, which is what `infirmaryRecoveryPercent` has always actually paid out.
    role: 'Looks after the crew. Some of the people a fight would have cost you walk out of here instead. Allows you to deploy stitchers.',
    requires: [nexus(10), needs('greenhouse', 5), needs('lab', 5), crew(15)],
    // Medical stores are stores.
    baseCost: {
      caps: 1000,
      supplies: 200,
      scrap: 200,
      planks: 100,
      oil: 600,
      highQualityMetal: 75,
    },
    baseSeconds: 4000,
  },
  garage: {
    name: 'The Garage',
    shortName: 'Garage',
    description:
      'Anything can be called the garage as long as the goal is the same: motors first, vehicles after, and eventually something that flies.',
    role: 'Builds and keeps the machines. Upgrading it lowers the construction time of vehicles and allows you to make better ones.',
    requires: [nexus(12), needs('scrapyard', 7), needs('generator', 7), crew(20)],
    baseCost: { caps: 400, scrap: 2000, planks: 500, oil: 2000, highQualityMetal: 200 },
    baseSeconds: 4300,
  },
};

/**
 * The Nexus's permission table (§B1): how far up each structure the Nexus will sign, per level.
 *
 * The Nexus used to be a single rule, "nothing outgrows the Nexus", which is one number doing
 * eleven jobs: a Gate and a Lab were held at exactly the same rung, so the build order was a
 * straight line and the Nexus was a toll rather than a decision. The maintainer asked for the opposite:
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
 *
 * A ladder runs to the structure's own {@link levelCeilingFor}, not to
 * {@link BUILDING_MAX_LEVEL}: the two ten-rung structures fit their four breakpoints into ten
 * levels rather than naming rungs nobody can order.
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
    [1, 3],
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
    [1, 3],
    [5, 4],
    [9, 7],
    [13, 10],
    [17, 14],
  ],
  // The warehouse is the least interesting thing to be stopped by, and the most annoying: it is
  // the ceiling every other structure's output runs into.
  apothecary: [
    [1, 1],
    [6, 5],
    [11, 9],
    [16, 13],
  ],
  // The board's own example: a Gate going to 5 needs Nexus 2 while a Lab going to 5 needs Nexus 4.
  // Defence is what a crew reaches for when it is losing, and a crew that is losing has a small
  // Nexus, so this is the shallowest ladder in the table by a wide margin.
  gate: [
    [1, 1],
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
    [1, 3],
    [5, 4],
    [9, 7],
    [13, 10],
    [17, 14],
  ],
  // Ten rungs rather than twenty ({@link BUILDING_LEVEL_CEILINGS}), so the four breakpoints sit
  // closer together than everybody else's and the last one still wants a near-finished Nexus.
  infirmary: [
    [1, 10],
    [4, 12],
    [7, 15],
    [10, 18],
  ],
  // The last plot, and the steepest ladder: a motor pool is the end of a district rather than a
  // part of one.
  garage: [
    [1, 12],
    [4, 14],
    [7, 16],
    [10, 19],
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
  // The structure's own ceiling, so a Garage under a finished Nexus answers 10 and every caller
  // that asks "can this go higher" gets the right no without knowing which structures are short.
  for (let level = 1; level <= levelCeilingFor(kind); level += 1) {
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
    ? `District level ${clause.level}`
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
    if (clause.level > levelCeilingFor(clause.building)) {
      throw new Error(`${kind} needs ${clause.building} at ${clause.level}, past its ceiling`);
    }
  }
}

/**
 * And guards the permission table (§B1), which has four ways of locking a structure out of the
 * game and none of them shows up on a screen.
 *
 * A ladder that steps *down* would let a level be legal and the one below it not; a breakpoint past
 * the structure's own {@link levelCeilingFor} is a rung nobody reaches; a first breakpoint that
 * disagrees with the structure's own Nexus clause is two answers to "when does this open"; and a
 * Nexus requirement above {@link BUILDING_MAX_LEVEL} would make the top level of that structure
 * unreachable, because the Nexus can only ever be {@link BUILDING_MAX_LEVEL}.
 *
 * The rung bound is the per-structure one on purpose. The Garage and the Infirmary both used to
 * name breakpoints at 11 and 16, which were legal under a flat ceiling of 20 and are two dead rungs
 * each under a ceiling of 10.
 */
for (const kind of BUILDING_KINDS) {
  let lastTarget = 0;
  let lastNexus = 0;
  for (const [target, needed] of NEXUS_LADDERS[kind]) {
    if (target <= lastTarget && lastTarget !== 0) {
      throw new Error(`${kind}'s ladder revisits level ${target}`);
    }
    if (needed < lastNexus) throw new Error(`${kind}'s ladder steps down at level ${target}`);
    if (target > levelCeilingFor(kind) || needed > BUILDING_MAX_LEVEL) {
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
  if (levelCapForNexus(kind, BUILDING_MAX_LEVEL) !== levelCeilingFor(kind)) {
    throw new Error(`${kind} cannot reach level ${levelCeilingFor(kind)} at any Nexus level`);
  }
}

/**
 * And guards the ceiling table, which has two ways of writing a structure out of the game.
 *
 * A ceiling of zero or less is a plot that can be laid and never stands; one above
 * {@link BUILDING_MAX_LEVEL} is a level no stored structure could hold, because `BuildingSchema`
 * parses levels against the global bound. An entry equal to the global ceiling is not an error,
 * only noise, and is left alone.
 */
for (const [kind, ceiling] of Object.entries(BUILDING_LEVEL_CEILINGS)) {
  if (ceiling < 1 || ceiling > BUILDING_MAX_LEVEL) {
    throw new Error(`${kind}'s ceiling of ${ceiling} is outside 1..${BUILDING_MAX_LEVEL}`);
  }
}
