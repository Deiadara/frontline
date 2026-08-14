import { RESOURCE_KEYS, type PartialResources, type Resources } from '../resources.js';
import { districtEffects, localProductionPercent, withBonus } from './effects.js';
import { powerGrid, type PowerGrid } from './power.js';
import { BUILDING_KINDS, type BuildingKind } from './kinds.js';
import { buildingLevel, findBuilding, type Building } from './state.js';

/**
 * What the district makes, holds and houses (§A1).
 *
 * Production is **lazy**, exactly like payroll (§H7), missions (§E2) and research (§B9): there is
 * no scheduler and no tick. A district nobody has looked at for three days owes three days of
 * output the moment it is next read, computed from one stored timestamp. That is the whole reason
 * the rates below are per *hour* rather than per anything the server would have to wake up for.
 */

/** Per level, per hour, before the Cistern, modifications and any brownout. */
const PRODUCTION_PER_LEVEL: Partial<Record<BuildingKind, PartialResources>> = {
  greenhouse: { food: 12 },
  scrapyard: { scrap: 10, oil: 2, highQualityMetal: 0.25 },
  garage: { oil: 4, highQualityMetal: 1 },
};

/**
 * Note what is missing: **caps**. The currency is not farmed — it comes off missions (§E) and
 * raids, and wages take it back out (§H7). A district that printed its own money would make the
 * whole §D8 alignment economy optional, so the Scrapyard sells salvage and the crew earns the rest.
 */
export const PRODUCING_BUILDINGS = BUILDING_KINDS.filter(
  (kind) => PRODUCTION_PER_LEVEL[kind] !== undefined,
);

/** Percentage points the Cistern adds to the Greenhouse's yield, per Cistern level. */
export const CISTERN_YIELD_PER_LEVEL = 3;
/** And to how many the Quarters can hold. Clean water is what puts a ceiling on a settlement. */
export const CISTERN_HOUSING_PER_LEVEL = 3;

/** Buildings whose output the Cistern's treated water multiplies. */
const CISTERN_FED: readonly BuildingKind[] = ['greenhouse'];

/**
 * One structure's hourly output, with its own `production_percent` modifications and — where it
 * drinks — the Cistern folded in. Not scaled by the grid: that is the district's business, applied
 * once in {@link districtProduction} rather than by every caller.
 */
export function buildingProduction(
  kind: BuildingKind,
  buildings: readonly Building[],
): PartialResources {
  const rates = PRODUCTION_PER_LEVEL[kind];
  const level = buildingLevel(buildings, kind);
  if (!rates || level <= 0) return {};

  const local = localProductionPercent(findBuilding(buildings, kind));
  const cistern = CISTERN_FED.includes(kind)
    ? buildingLevel(buildings, 'cistern') * CISTERN_YIELD_PER_LEVEL
    : 0;

  return Object.fromEntries(
    Object.entries(rates).map(([key, rate]) => [
      key,
      withBonus((rate ?? 0) * level, local + cistern),
    ]),
  );
}

export interface DistrictProduction {
  /**
   * Net units per hour, brownout already applied. Oil is **net**: what the Scrapyard and Garage
   * bring in, less what the Generator burns to keep them lit.
   */
  perHour: PartialResources;
  /** Gross output before the grid took its cut — what the district would make fully powered. */
  fullPowerPerHour: PartialResources;
  grid: PowerGrid;
}

export function districtProduction(buildings: readonly Building[]): DistrictProduction {
  const grid = powerGrid(buildings);

  const gross: Record<string, number> = {};
  for (const kind of PRODUCING_BUILDINGS) {
    for (const [key, rate] of Object.entries(buildingProduction(kind, buildings))) {
      gross[key] = (gross[key] ?? 0) + (rate ?? 0);
    }
  }

  const fullPowerPerHour: PartialResources = { ...(gross as PartialResources) };
  fullPowerPerHour.oil = (gross.oil ?? 0) - grid.oilPerHour;

  const perHour: Record<string, number> = {};
  for (const [key, rate] of Object.entries(gross)) {
    perHour[key] = rate * grid.ratio;
  }
  // The Generator burns its fuel whether or not the grid covers the district — a browned-out
  // turbine is one running flat out and still losing, not one idling.
  perHour.oil = (perHour.oil ?? 0) - grid.oilPerHour;

  return { perHour: perHour, fullPowerPerHour, grid };
}

/** Base ceiling with no Apothecary standing — a district can always hold *something*. */
export const STORAGE_BASE = 800;
/** The Apothecary multiplies the ceiling by this per level: level 20 holds ~55x the bare floor. */
export const STORAGE_GROWTH = 1.22;

/** How much of any one resource this district can hold. */
export function storageCapacity(buildings: readonly Building[]): number {
  const level = buildingLevel(buildings, 'apothecary');
  const effects = districtEffects(buildings);
  return Math.round(withBonus(STORAGE_BASE * STORAGE_GROWTH ** level, effects.storage_percent));
}

/** Beds a district has before any Quarters go up: the founding crew sleep somewhere. */
export const HOUSING_BASE = 8;
export const HOUSING_PER_QUARTERS_LEVEL = 4;

/** How many people this district can house — officers and assignees alike (§G, §H8). */
export function populationCapacity(buildings: readonly Building[]): number {
  const effects = districtEffects(buildings);
  const beds = HOUSING_BASE + buildingLevel(buildings, 'quarters') * HOUSING_PER_QUARTERS_LEVEL;
  const water = buildingLevel(buildings, 'cistern') * CISTERN_HOUSING_PER_LEVEL;
  return Math.floor(withBonus(beds, water + effects.housing_percent));
}

/**
 * `stock` after `hours` of production.
 *
 * Storage clamps **production only**. Mission pay and raid loot are never clawed back to fit the
 * Apothecary: losing what a crew just bled for to a warehouse ceiling is the kind of rule players
 * discover by being robbed by it. What a full district loses is its own passive output, which is
 * visible on the screen the whole time it is happening.
 *
 * Fractions are kept, not rounded. Rounding each settle would mean a player refreshing every few
 * seconds earned nothing at all, which is the oldest bug in this genre.
 */
export function accrueProduction(
  stock: Resources,
  buildings: readonly Building[],
  hours: number,
): Resources {
  if (hours <= 0) return stock;
  const { perHour } = districtProduction(buildings);
  const ceiling = storageCapacity(buildings);

  return Object.fromEntries(
    RESOURCE_KEYS.map((key) => {
      const produced = (perHour[key] ?? 0) * hours;
      if (produced === 0) return [key, stock[key]];
      // Already over the ceiling (raid loot, say) means production adds nothing, but nothing is
      // taken away either. Burning oil is the one thing allowed to draw a stock down.
      const cap = Math.max(stock[key], ceiling);
      return [key, Math.max(0, Math.min(cap, stock[key] + produced))];
    }),
  ) as Resources;
}
