import { RESOURCE_KEYS, type PartialResources } from '../resources.js';
import { districtEffects, MAX_EFFECT_REDUCTION, withReduction } from './effects.js';
import { BUILDING_CATALOG, CENTRAL_BUILDING, type BuildingKind } from './kinds.js';
import { buildingLevel, type Building } from './state.js';

/**
 * What a level costs and how long it takes (§A1, §D3: oil is what building consumes).
 *
 * Two separate curves on purpose. Materials climb gently enough that a level-20 structure is a
 * campaign rather than a wall; the clock climbs much harder, because *time* is what paces a
 * base-builder and materials are only what paces the first hour of it.
 */

/** Materials multiply by this per level: level 20 costs ~100x level 1. */
export const BUILDING_COST_GROWTH = 1.28;

/**
 * The clock multiplies by this per level: level 20 takes ~1050x level 1.
 *
 * With the catalogue's 20-70 second first levels that is the ladder the board asked for: seconds
 * at the start, a few minutes by level 10, and the better part of a working day at the top before
 * the Nexus takes its cut.
 */
export const BUILDING_TIME_GROWTH = 1.4;

/** Percentage points off every *other* structure's materials, per Nexus level above the first. */
export const NEXUS_COST_DISCOUNT_PER_LEVEL = 1.5;
/** And off their clock. Time is the discount players feel, so the Nexus buys more of it. */
export const NEXUS_TIME_DISCOUNT_PER_LEVEL = 2.5;

/**
 * How much the Nexus is worth to a build, in percentage points off materials and off the clock.
 *
 * Zero for the Nexus itself: §A1 says it lowers the cost and time of *other* upgrades, and a
 * structure that discounts its own next level compounds into itself.
 */
export function nexusDiscountFor(
  kind: BuildingKind,
  buildings: readonly Building[],
): { costPercent: number; timePercent: number } {
  if (kind === CENTRAL_BUILDING) return { costPercent: 0, timePercent: 0 };
  const levelsAbleToHelp = Math.max(0, buildingLevel(buildings, CENTRAL_BUILDING) - 1);
  return {
    costPercent: levelsAbleToHelp * NEXUS_COST_DISCOUNT_PER_LEVEL,
    timePercent: levelsAbleToHelp * NEXUS_TIME_DISCOUNT_PER_LEVEL,
  };
}

/** Everything taking percentage points off this build: the Nexus, plus installed modifications. */
export function buildDiscountFor(
  kind: BuildingKind,
  buildings: readonly Building[],
): { costPercent: number; timePercent: number } {
  const nexus = nexusDiscountFor(kind, buildings);
  const effects = districtEffects(buildings);
  return {
    costPercent: Math.min(MAX_EFFECT_REDUCTION, nexus.costPercent + effects.build_cost_reduction),
    timePercent: Math.min(MAX_EFFECT_REDUCTION, nexus.timePercent + effects.build_time_reduction),
  };
}

/** The undiscounted price of raising `kind` **to** `level`: level 1 being the first construction. */
export function baseBuildingCost(kind: BuildingKind, level: number): PartialResources {
  const growth = BUILDING_COST_GROWTH ** (level - 1);
  const { baseCost } = BUILDING_CATALOG[kind];
  const scaled = RESOURCE_KEYS.flatMap((key) => {
    const amount = baseCost[key];
    return amount === undefined ? [] : [[key, Math.round(amount * growth)] as const];
  });
  return Object.fromEntries(scaled);
}

/**
 * What this district actually pays to raise `kind` to `level`.
 *
 * The whole bundle scales, not just the oil, so a structure never gets cheaper in any one resource
 * as it climbs. Rounded to whole units, resources are counted, not measured, and floored at 1 for
 * any line the catalogue charges at all, so a deep discount can never make a material free.
 */
export function buildingCost(
  kind: BuildingKind,
  level: number,
  buildings: readonly Building[],
): PartialResources {
  const { costPercent } = buildDiscountFor(kind, buildings);
  const base = baseBuildingCost(kind, level);
  const discounted = Object.entries(base).map(([key, amount]) => [
    key,
    Math.max(1, Math.round(withReduction(amount ?? 0, costPercent))),
  ]);
  return Object.fromEntries(discounted) as PartialResources;
}

/** The undiscounted clock for raising `kind` to `level`, in seconds. */
export function baseBuildSeconds(kind: BuildingKind, level: number): number {
  return Math.round(BUILDING_CATALOG[kind].baseSeconds * BUILDING_TIME_GROWTH ** (level - 1));
}

/**
 * How long this district takes to raise `kind` to `level`, in seconds.
 *
 * Floored at one second: a build that resolves in the same instant it is ordered has no queue
 * position to occupy and would make the six-slot queue meaningless at the bottom of the tree.
 */
export function buildingBuildSeconds(
  kind: BuildingKind,
  level: number,
  buildings: readonly Building[],
): number {
  const { timePercent } = buildDiscountFor(kind, buildings);
  return Math.max(1, Math.round(withReduction(baseBuildSeconds(kind, level), timePercent)));
}
