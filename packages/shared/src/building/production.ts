import {
  RESOURCE_KEYS,
  type FractionalResources,
  type PartialResources,
  type ResourceKey,
  type Resources,
} from '../resources.js';
import { buildingEffectiveness, districtEffectiveness } from './damage.js';
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
  greenhouse: { supplies: 12 },
  // §D5b: the Scrapyard strips timber as well as metal, so it is the source of both halves of what
  // building costs. Planks come off slightly below scrap: a ruin has more steel in it than sound
  // wood, and the wood that is sound is what somebody already took.
  scrapyard: { scrap: 10, planks: 8, oil: 2, highQualityMetal: 0.25 },
  garage: { oil: 4, highQualityMetal: 1 },
};

/**
 * Note what is missing: **caps**. The currency is not farmed. It comes off missions (§E) and
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
 * One structure's hourly output, with its own `production_percent` modifications and: where it
 * drinks: the Cistern folded in. Not scaled by the grid: that is the district's business, applied
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
  // §A4: a wrecked line runs at up to half. Applied here rather than to the district total so a
  // crew that lost its Greenhouse and kept its Scrapyard sees exactly that on the readout.
  const working = buildingEffectiveness(findBuilding(buildings, kind));

  return Object.fromEntries(
    Object.entries(rates).map(([key, rate]) => [
      key,
      withBonus((rate ?? 0) * level, local + cistern) * working,
    ]),
  );
}

export interface DistrictProduction {
  /**
   * Net units per hour, brownout already applied. Oil is **net**: what the Scrapyard and Garage
   * bring in, less what the Generator burns to keep them lit.
   */
  perHour: PartialResources;
  /** Gross output before the grid took its cut: what the district would make fully powered. */
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
  // The Generator burns its fuel whether or not the grid covers the district: a browned-out
  // turbine is one running flat out and still losing, not one idling.
  perHour.oil = (perHour.oil ?? 0) - grid.oilPerHour;

  return { perHour: perHour, fullPowerPerHour, grid };
}

/** Base ceiling with no Apothecary standing: a district can always hold *something*. */
export const STORAGE_BASE = 800;
/** The Apothecary multiplies the ceiling by this per level: level 20 holds ~55x the bare floor. */
export const STORAGE_GROWTH = 1.22;

/**
 * Three shelves in the Apothecary, and caps on none of them.
 *
 * One ceiling for six resources said that a barrel of refined fuel takes the same room as a plank,
 * which is not what any of these things are. The store has a **bulk** shelf for what a district is
 * built out of, a shorter one for what it burns and eats, and a small locked one for the metal it
 * almost never sees. The shares hold at every Apothecary level, so upgrading widens all three in
 * proportion rather than changing which of them is the binding one: at a 30,000 bulk shelf that is
 * 20,000 of oil or supplies and 10,000 of high-quality metal.
 *
 * **Caps have no ceiling at all.** A currency that fills up is a currency that starts throwing away
 * what a player earned while they were not looking, and there is no version of that a player reads
 * as anything but a bug. They are absent from this table rather than set to a large number, so
 * every consumer has to decide what "no ceiling" means rather than inheriting a wall nobody chose.
 */
export const STORAGE_SHARES: Readonly<Partial<Record<ResourceKey, number>>> = {
  scrap: 1,
  planks: 1,
  oil: 2 / 3,
  supplies: 2 / 3,
  highQualityMetal: 1 / 3,
};

/** The bulk shelf: what this district can hold of scrap or planks, and the figure the rest scale off. */
export function storageCapacity(buildings: readonly Building[]): number {
  const level = buildingLevel(buildings, 'apothecary');
  const effects = districtEffects(buildings);
  return Math.round(
    withBonus(STORAGE_BASE * STORAGE_GROWTH ** level, effects.storage_percent) *
      buildingEffectiveness(findBuilding(buildings, 'apothecary')),
  );
}

/**
 * What this district can hold of one resource. `Infinity` for caps, which have no ceiling.
 *
 * `bulk` is passed in wherever a caller already has it, because the ceiling is read once per
 * resource inside a settle loop and recomputing the Apothecary six times is six walks of the
 * building list for one number.
 */
export function storageCapacityFor(
  buildings: readonly Building[],
  key: ResourceKey,
  bulk = storageCapacity(buildings),
): number {
  const share = STORAGE_SHARES[key];
  return share === undefined ? Number.POSITIVE_INFINITY : Math.round(bulk * share);
}

/**
 * Beds a district has before any Quarters go up: the founding crew sleep somewhere.
 *
 * Both figures absorbed the army pool the Gauntlet used to run separately (see
 * `building/population.ts`). The old pair was 8 beds + 4 per Quarters level for the people and 8
 * supply + 6 per Gauntlet level for the army; a crew at Quarters 10 / Gauntlet 10 therefore had
 * 48 + 68. Merged onto the Quarters alone, the same crew has 16 + 10 x 10, which is the same 116.
 * Sizing it any lower would have quietly halved every existing district on the day the pools
 * became one.
 */
export const HOUSING_BASE = 16;
export const HOUSING_PER_QUARTERS_LEVEL = 10;

/** How many people this district can house: officers, assignees and soldiers alike (§A1, §G, §H8). */
export function populationCapacity(buildings: readonly Building[]): number {
  const effects = districtEffects(buildings);
  const beds = HOUSING_BASE + buildingLevel(buildings, 'quarters') * HOUSING_PER_QUARTERS_LEVEL;
  const water = buildingLevel(buildings, 'cistern') * CISTERN_HOUSING_PER_LEVEL;
  // Weighted across the whole district: people sleep in the Quarters but a wrecked district is a
  // wrecked district, and the floor keeps the founding crew housed however bad the night was.
  return Math.max(
    HOUSING_BASE,
    Math.floor(withBonus(beds, water + effects.housing_percent) * districtEffectiveness(buildings)),
  );
}

export interface CrewYield {
  /** §F2: Engineering runs the line at its rated speed rather than the one it settled into. */
  productionPercent: number;
  /** §F2: Logistics finds room in a full warehouse. */
  storageCapacityPercent: number;
  /**
   * §A4: one resource going further than it should, per resource.
   *
   * The Abandoned Nuclear Plant: enough power on tap that every barrel of oil you burn does more
   * work. Deliberately *per resource* and deliberately separate from `productionPercent`, which is
   * the whole line running faster: a location that makes oil go further should not also make supplies
   * appear, and folding the two together is how a specific bonus becomes a general one nobody
   * chose.
   */
  resourceYieldPercent?: PartialResources;
}

/**
 * Output made but not yet moved, per resource: a **signed** fraction of a unit, in `(-1, 1)`.
 *
 * The whole reason a stockpile can be integral without a player losing or gaining anything they did
 * not earn. A Scrapyard makes a quarter of a high-quality metal an hour at level one; a settle
 * covering ten minutes makes a fortieth of one. Rounding that to zero is the oldest bug in this
 * genre (a client polling fast earns nothing), and rounding it to one is a printing press.
 *
 * **Signed**, and that is the important half. Oil is *net*: the Generator burns more than a bare
 * district makes, so a settle covering thirty seconds produces about `-0.0125` oil. Accumulating
 * the running total and flooring it, the obvious spelling, takes a whole barrel off the readout
 * the instant anybody looks at the district, and hands back a carry of `0.9875` to make the books
 * balance. Correct to the last decimal and wrong on screen. Carrying the **delta** instead means
 * the stockpile only ever moves when a whole unit has actually been made or actually been burned.
 *
 * Stored on the base rather than derived because there is nothing to derive it from: it is the
 * residue of a settle that has already happened.
 */
export type ProductionCarry = FractionalResources;

export interface Accrual {
  resources: Resources;
  carry: ProductionCarry;
}

/**
 * `stock` after `hours` of production, in whole units, with the part-unit carried.
 *
 * Storage clamps **production only**. Mission pay and raid loot are never clawed back to fit the
 * Apothecary: losing what a crew just bled for to a warehouse ceiling is the kind of rule players
 * discover by being robbed by it. What a full district loses is its own passive output, which is
 * visible on the screen the whole time it is happening.
 *
 * Nothing is rounded away and nothing moves early. The carry and this window's output are added
 * together and split by `Math.trunc`: whole units of *change* go to the stockpile and the part-unit
 * goes back into the carry. `trunc` rather than `floor` is what makes it symmetric: it rounds
 * towards zero, so neither a gain nor a burn moves the number until it is worth a whole unit, and
 * `stock + carry` is exactly what an unrounded accrual would have held either way.
 *
 * A clamp, the ceiling, or the floor at zero, is the one thing that discards a carry. It has to:
 * a warehouse that is full has not made half a unit it is owed, it has made nothing.
 */
export function accrueProduction(
  stock: Resources,
  buildings: readonly Building[],
  hours: number,
  crew: CrewYield = { productionPercent: 0, storageCapacityPercent: 0 },
  carry: ProductionCarry = {},
): Accrual {
  if (hours <= 0) return { resources: stock, carry };
  const { perHour } = districtProduction(buildings);
  const rate = Math.max(0, 1 + crew.productionPercent / 100);
  // The bulk shelf once, with the crew's bonus on it. Each resource takes its own share of this
  // below, and caps take none of it: production has never made caps, but a ceiling that applied to
  // them would start throwing away raid pay the moment a settle ran long.
  const bulk = Math.round(
    storageCapacity(buildings) * Math.max(1, 1 + crew.storageCapacityPercent / 100),
  );

  const resources: Record<string, number> = {};
  const rest: Record<string, number> = {};

  for (const key of RESOURCE_KEYS) {
    // The crew's share applies to what is *made*, never to what is burned: an engineer who is
    // good at their job does not make the generator drink faster.
    const gross = (perHour[key] ?? 0) * hours;
    // The crew's general rate, then this resource's own multiplier on top: both only on what is
    // *made*. Neither makes the Generator drink faster.
    const yielded = rate * (1 + Math.max(0, crew.resourceYieldPercent?.[key] ?? 0) / 100);
    const produced = gross > 0 ? gross * yielded : gross;
    const held = carry[key] ?? 0;
    if (produced === 0 && held === 0) {
      resources[key] = stock[key];
      continue;
    }

    const delta = held + produced;
    const whole = Math.trunc(delta);
    const next = stock[key] + whole;

    // Already over the ceiling (raid loot, say) means production adds nothing, but nothing is
    // taken away either. Burning oil is the one thing allowed to draw a stock down.
    const cap = Math.max(stock[key], storageCapacityFor(buildings, key, bulk));
    if (next >= cap) {
      resources[key] = cap;
      continue;
    }
    // Burned past empty. Strictly below zero, not at it: a store sitting at zero with a *gain*
    // part-made is the ordinary state of a new Scrapyard, and discarding its carry there was the
    // rounding bug in a hat: the quarter of a metal never added up to one and the yard produced
    // nothing for ever.
    if (next < 0) {
      resources[key] = 0;
      continue;
    }

    resources[key] = next;
    const remainder = delta - whole;
    if (remainder === 0) continue;
    // And nothing to burn is nothing owed: an empty store does not carry a debt it can never pay,
    // or a district left dark for a month would owe a month of fuel the moment it was refuelled.
    if (next === 0 && remainder < 0) continue;
    rest[key] = remainder;
  }

  return { resources: resources as Resources, carry: rest };
}
