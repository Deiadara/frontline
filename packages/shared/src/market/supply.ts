import { z } from 'zod';
import { MILESTONE_DEEP_POCKETS, isPlayerUnlockActive } from '../progression/unlocks.js';
import { RESOURCE_KEYS, type ResourceKey, type Resources } from '../resources.js';
import { effectiveMarketDiscount } from './discount.js';
import { traderRates } from '../crew/passives.js';
import { RESOURCE_CAP_VALUE, withoutFloatNoise } from './offers.js';

/**
 * The supply run: caps into materials, rationed by the day (market extension).
 *
 * Caps are money. Nothing produces them passively and nothing caps them: they come off missions,
 * raids and anything a crew sells, and they go out on wages, hires, research and the Runner's
 * barrow. What was missing was the thing that makes a currency behave like one: **being able to
 * buy the ordinary stuff with it**. Until now a crew that was rich and out of scrap had no way to
 * turn one into the other except the Broker, who only trades materials for materials and takes half
 * for the privilege.
 *
 * ## Why it is rationed rather than priced out of reach
 *
 * A shop with no limit and a fair price replaces the district: at some cap balance it is simply
 * better to buy scrap than to raise a Scrapyard, and every structure in §A1 becomes optional. A
 * shop with no limit and a *bad* price is a shop nobody uses. So the price is mildly bad and the
 * **quantity** is what is bounded: a day's supply run is a fraction of what the district can hold,
 * which means it tops a crew up and can never feed one.
 *
 * ## What the ration is measured against
 *
 * Storage, because storage is the one number that already says how big an operation this is. A crew
 * with a level-1 Apothecary can buy a few hundred units a day; a crew with a level-20 one can buy
 * thousands, and has built the warehouse that justifies it. And the *share* of that storage scales
 * with player level, from {@link SUPPLY_MIN_PERCENT} to {@link SUPPLY_MAX_PERCENT}, so levelling
 * widens the tap on a pipe the district decided the diameter of.
 *
 * The allowance is **pooled across resources**, not one quota per line. A day of buying is a budget
 * a player spends where the shortage actually is, which is a decision; five separate quotas are
 * five errands.
 *
 * ## Counted in worth, not in units (maintainer, 2026-09-29)
 *
 * It was a count of units, and a unit of high-quality metal is worth 12 caps where a unit of
 * supplies is worth 1.5. Buying the day's ration as metal and bartering it down at the Broker
 * fitted four or five rations of cheap goods into one day. The ration is now caps' worth of goods
 * at {@link RESOURCE_CAP_VALUE}: sized off the store in units as before, and turned into worth at
 * the cheapest material's value ({@link SUPPLY_RATION_UNIT_VALUE}), so a day of supplies is the day
 * it always was and one metal spends eight supplies' worth of it. The Broker keeps a cut on every
 * trade, so nothing bought dear and bartered down can beat buying the cheap thing directly.
 */

/** What may be bought. Every resource except the one you are paying with. */
export const SUPPLY_RESOURCES: readonly ResourceKey[] = RESOURCE_KEYS.filter(
  (key) => key !== 'caps',
);

/** The share of a full store a level-1 crew may buy in a day. */
export const SUPPLY_MIN_PERCENT = 30;
/** And the share the curve tops out at. */
export const SUPPLY_MAX_PERCENT = 100;
/** Percentage points the share widens by, per level. Reaches the top at level 36. */
export const SUPPLY_PERCENT_PER_LEVEL = 2;
/** §I3: what `MILESTONE_DEEP_POCKETS` multiplies the share by at level 70. */
export const SUPPLY_DEEP_POCKETS_MULTIPLIER = 2;
/** And what that comes to, since the curve has long since topped out by then. */
export const SUPPLY_DEEP_POCKETS_PERCENT = SUPPLY_MAX_PERCENT * SUPPLY_DEEP_POCKETS_MULTIPLIER;

/**
 * What share of a full store this crew may buy today.
 *
 * Linear rather than a curve. The number is a promise a player has to be able to make plans
 * against, "two more levels and I can buy half a warehouse a day", and a promise you need a
 * spreadsheet to read is not one.
 *
 * The milestone **multiplies the share** rather than raising a ceiling the share is clamped to. A
 * raised ceiling would have done nothing at all at level 70: the linear part does not reach 168%
 * of a store until the eighties, which is the quiet way to ship a reward nobody can feel on the
 * level it is attached to.
 */
export function supplyAllowancePercent(level: number): number {
  const at = Math.max(1, Math.trunc(level));
  const share = Math.min(
    SUPPLY_MAX_PERCENT,
    SUPPLY_MIN_PERCENT + SUPPLY_PERCENT_PER_LEVEL * (at - 1),
  );
  return isPlayerUnlockActive(MILESTONE_DEEP_POCKETS, at)
    ? share * SUPPLY_DEEP_POCKETS_MULTIPLIER
    : share;
}

/** What one unit of the day's ration is worth: the cheapest material, so a unit of it spends one. */
export const SUPPLY_RATION_UNIT_VALUE = RESOURCE_CAP_VALUE.supplies;

/** Never less than one unit of the dearest material, so any line can be bought once. */
const SUPPLY_RATION_FLOOR = Math.ceil(
  Math.max(...SUPPLY_RESOURCES.map((key) => RESOURCE_CAP_VALUE[key])),
);

/**
 * How many caps' worth of material this crew may buy today, in total.
 *
 * Floored to whole caps. Never below one unit of anything: a crew whose warehouse has been
 * levelled to nothing can still buy a single scrap, which is the difference between a bad day and
 * a dead account.
 */
export function supplyAllowance(level: number, storageCapacity: number): number {
  const capacity = Math.max(0, Math.floor(storageCapacity));
  const units = (capacity * supplyAllowancePercent(level)) / 100;
  return Math.max(
    SUPPLY_RATION_FLOOR,
    Math.floor(withoutFloatNoise(units * SUPPLY_RATION_UNIT_VALUE)),
  );
}

/** What `units` of `key` spend of the day's ration: their worth, rounded up to whole caps. */
export function supplyRationCost(key: ResourceKey, units: number): number {
  const count = Math.max(0, Math.floor(units));
  return Math.ceil(withoutFloatNoise(count * RESOURCE_CAP_VALUE[key]));
}

/**
 * What the supplier adds on top of what a thing is worth.
 *
 * Half again. Bad enough that producing your own is always better and buying in bulk to resell is
 * never a trade, cheap enough that clearing a shortage the night before a fight is worth doing.
 */
export const SUPPLY_MARKUP = 1.5;

/**
 * What one unit of `key` costs in caps, after the crew's market discount (`market/discount.ts`).
 * The figure the stall quotes; an order is priced by {@link supplyPrice}, not by this times a count.
 */
export function supplyUnitPrice(
  key: ResourceKey,
  discountPercent = 0,
  traderPoints: number | null = null,
): number {
  return withoutFloatNoise(RESOURCE_CAP_VALUE[key] * supplyMarkup(discountPercent, traderPoints));
}

/**
 * What the supply run charges per unit of worth: the markup less the crew's discount, and then the
 * Trader's rate where it is better (`traderRates`, maintainer 2026-10-04): even at C+, and 0.8 at a
 * perfect sheet. `traderPoints` is the working Trader's seat points, or null with the chair empty.
 */
export function supplyMarkup(discountPercent = 0, traderPoints: number | null = null): number {
  const plain = SUPPLY_MARKUP * (1 - effectiveMarketDiscount(discountPercent) / 100);
  return withoutFloatNoise(traderRates(traderPoints, 0, plain).markup);
}

/**
 * What `units` of `key` costs in caps. Always a whole number, always at least one.
 *
 * Priced on the whole order and rounded once. Rounding a per-unit price instead would either make a
 * hundred supplies cost a hundred roundings of error or make single units free.
 */
export function supplyPrice(
  key: ResourceKey,
  units: number,
  discountPercent = 0,
  traderPoints: number | null = null,
): number {
  const count = Math.max(0, Math.floor(units));
  if (count === 0) return 0;
  return Math.max(
    1,
    Math.ceil(withoutFloatNoise(count * supplyUnitPrice(key, discountPercent, traderPoints))),
  );
}

/**
 * The most of `key` this crew could buy right now without wasting any, given caps, the day's
 * ration and the store.
 *
 * The store is not a refusal any more (maintainer ruling, 2026-09-28): an order past it is warned
 * about and goes through if the player agrees, with the excess thrown away at the till. This is
 * still the figure the stall offers, because an order that fills the store exactly is the one a
 * player wants, and a stall whose top button bought caps' worth of nothing would be a trap.
 *
 * `capacity` is the ceiling **for this resource**, not the bulk shelf: the Apothecary holds three
 * times as much scrap as high-quality metal, so a single figure here would have offered a crew metal
 * their store cannot take.
 */
export function supplyAffordable(
  key: ResourceKey,
  stock: Resources,
  allowanceLeft: number,
  capacity: number,
  discountPercent = 0,
  traderPoints: number | null = null,
): number {
  const room = Math.max(0, capacity - stock[key]);
  const byCaps = Math.floor(
    withoutFloatNoise(stock.caps / supplyUnitPrice(key, discountPercent, traderPoints)),
  );
  return Math.max(0, Math.min(supplyRationUnits(key, allowanceLeft), room, byCaps));
}

/**
 * How many units of `key` the rest of today's ration would carry, ignoring caps and the store.
 *
 * The ration is caps' worth, and a bare worth beside a field counted in units read as a
 * contradiction: "450 left" over a field that would take at most 37 metal (bug pass, 2026-10-01).
 * The panel prints this instead, in the units of whatever the picker is on.
 */
export function supplyRationUnits(key: ResourceKey, allowanceLeft: number): number {
  return Math.max(0, Math.floor(withoutFloatNoise(allowanceLeft / RESOURCE_CAP_VALUE[key])));
}

export const SUPPLY_REFUSALS = [
  'not_a_resource',
  'nothing_ordered',
  'over_allowance',
  'cannot_afford',
] as const;
export type SupplyRefusal = (typeof SUPPLY_REFUSALS)[number];

export const SUPPLY_REFUSAL_TEXT: Readonly<Record<SupplyRefusal, string>> = {
  not_a_resource: 'Caps are what you are paying with, not what you are buying',
  nothing_ordered: 'Say how much you want',
  over_allowance: 'That is more than today’s run will carry',
  cannot_afford: 'You do not have the caps for that',
};

export interface SupplyOrder {
  key: ResourceKey;
  units: number;
  stock: Resources;
  /** Caps' worth of the day's ration still unspent. */
  allowanceLeft: number;
  /** The crew's market discount, which the price is quoted after. */
  discountPercent?: number;
  /** The working Trader's seat points, or null with the chair empty (`supplyMarkup`). */
  traderPoints?: number | null;
}

/**
 * The first reason this order cannot go through, or `null`.
 *
 * Ordered so the answer is the most useful one: what you asked for before what you can pay for.
 * The warehouse is not on the list: an order past it is warned about rather than refused, at the
 * till (`market/board.ts`), where the ceiling is read with everything folded into it.
 */
export function supplyRefusal(order: SupplyOrder): SupplyRefusal | null {
  if (order.key === 'caps') return 'not_a_resource';
  const units = Math.floor(order.units);
  if (units <= 0) return 'nothing_ordered';
  if (supplyRationCost(order.key, units) > order.allowanceLeft) return 'over_allowance';
  if (supplyPrice(order.key, units, order.discountPercent, order.traderPoints) > order.stock.caps) {
    return 'cannot_afford';
  }
  return null;
}

/** One line of the supply board, as the screen reads it. */
/**
 * The keys the supply run deals in, as a schema, derived from {@link SUPPLY_RESOURCES}.
 *
 * It was a hand-written `z.enum` listing four resources, and adding a fifth is what found it: the
 * board built a line for planks off `SUPPLY_RESOURCES` and the schema then refused the payload it
 * had just built, so the whole market screen hung on its loading state. Every parse of a supply
 * key goes through this, so the domain list and the wire contract cannot come apart again.
 */
export const SupplyResourceSchema = z.enum(SUPPLY_RESOURCES);

export const SupplyLineSchema = z.object({
  key: SupplyResourceSchema,
  /**
   * Caps for one unit, as quoted, after the crew's market discount. The order price is
   * `supplyPrice`, not this times the count.
   */
  capsPerUnit: z.number().positive(),
  /** The most the crew could take right now, all three limits considered. */
  most: z.number().int().nonnegative(),
  /** This resource's own shelf in the store, which is not the same size for all of them. */
  capacity: z.number().int().nonnegative(),
});
export type SupplyLine = z.infer<typeof SupplyLineSchema>;

/** The day's supply run, as the screen reads it. */
export const SupplyBoardSchema = z.object({
  /** Caps' worth of material the ration allows today (see "Counted in worth" above). */
  allowance: z.number().int().nonnegative(),
  /** How much of it is already spent, in the same caps' worth. */
  used: z.number().int().nonnegative(),
  /** The share of a full store the ration is, at this level. */
  percent: z.number().int().positive(),
  /** The bulk shelf, which is what the day's ration is measured against. Per-line room is on the line. */
  storageCapacity: z.number().int().nonnegative(),
  lines: z.array(SupplyLineSchema),
});
export type SupplyBoard = z.infer<typeof SupplyBoardSchema>;

/** The whole board for a crew: one function both sides of the wire call. */
export function supplyBoard(
  level: number,
  stock: Resources,
  bulkCapacity: number,
  used: number,
  capacityFor: (key: ResourceKey) => number,
  discountPercent = 0,
  traderPoints: number | null = null,
): SupplyBoard {
  const allowance = supplyAllowance(level, bulkCapacity);
  const left = Math.max(0, allowance - Math.max(0, Math.floor(used)));
  return {
    allowance,
    used: Math.max(0, Math.floor(used)),
    percent: supplyAllowancePercent(level),
    storageCapacity: Math.max(0, Math.floor(bulkCapacity)),
    lines: SUPPLY_RESOURCES.map((key) => {
      const capacity = Math.max(0, Math.floor(capacityFor(key)));
      return {
        // No cast: `SupplyLine['key']` is derived from this very list now, so the two agree by
        // construction. The cast that used to sit here is what let the enum drift narrow unnoticed.
        key,
        capsPerUnit: supplyUnitPrice(key, discountPercent, traderPoints),
        most: supplyAffordable(key, stock, left, capacity, discountPercent, traderPoints),
        capacity,
      };
    }),
  };
}
