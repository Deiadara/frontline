import { z } from 'zod';
import { MILESTONE_DEEP_POCKETS, isPlayerUnlockActive } from '../progression/unlocks.js';
import { RESOURCE_KEYS, type ResourceKey, type Resources } from '../resources.js';
import { RESOURCE_CAP_VALUE } from './offers.js';

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

/**
 * How many units of material this crew may buy today, in total.
 *
 * Floored, because it is a count of things and the stockpile that receives it is whole units. Never
 * below one: a crew whose warehouse has been levelled to nothing can still buy a single scrap,
 * which is the difference between a bad day and a dead account.
 */
export function supplyAllowance(level: number, storageCapacity: number): number {
  const capacity = Math.max(0, Math.floor(storageCapacity));
  return Math.max(1, Math.floor((capacity * supplyAllowancePercent(level)) / 100));
}

/**
 * What the supplier adds on top of what a thing is worth.
 *
 * Half again. Bad enough that producing your own is always better and buying in bulk to resell is
 * never a trade, cheap enough that clearing a shortage the night before a fight is worth doing.
 */
export const SUPPLY_MARKUP = 1.5;

/**
 * What `units` of `key` costs in caps. Always a whole number, always at least one.
 *
 * Priced on the whole order and rounded once. Rounding a per-unit price instead would either make a
 * hundred food cost a hundred roundings of error or make single units free.
 */
export function supplyPrice(key: ResourceKey, units: number): number {
  const count = Math.max(0, Math.floor(units));
  if (count === 0) return 0;
  return Math.max(1, Math.ceil(count * RESOURCE_CAP_VALUE[key] * SUPPLY_MARKUP));
}

/** The most of `key` this crew could buy right now, given caps, the day's ration and the store. */
export function supplyAffordable(
  key: ResourceKey,
  stock: Resources,
  allowanceLeft: number,
  storageCapacity: number,
): number {
  const room = Math.max(0, storageCapacity - stock[key]);
  const perUnit = RESOURCE_CAP_VALUE[key] * SUPPLY_MARKUP;
  const byCaps = Math.floor(stock.caps / perUnit);
  return Math.max(0, Math.min(allowanceLeft, room, byCaps));
}

export const SUPPLY_REFUSALS = [
  'not_a_resource',
  'nothing_ordered',
  'over_allowance',
  'cannot_afford',
  'no_room',
] as const;
export type SupplyRefusal = (typeof SUPPLY_REFUSALS)[number];

export const SUPPLY_REFUSAL_TEXT: Readonly<Record<SupplyRefusal, string>> = {
  not_a_resource: 'Caps are what you are paying with, not what you are buying',
  nothing_ordered: 'Say how much you want',
  over_allowance: 'That is more than today’s run will carry',
  cannot_afford: 'You do not have the caps for that',
  no_room: 'Your store will not hold that much',
};

export interface SupplyOrder {
  key: ResourceKey;
  units: number;
  stock: Resources;
  /** Units of the day's ration still unspent. */
  allowanceLeft: number;
  /** How much of any one resource the district can hold. */
  storageCapacity: number;
}

/**
 * The first reason this order cannot go through, or `null`.
 *
 * Ordered so the answer is the most useful one: what you asked for before what you can pay for, and
 * the ration before the warehouse, because a player over the ration comes back tomorrow and a
 * player out of room has something to build.
 */
export function supplyRefusal(order: SupplyOrder): SupplyRefusal | null {
  if (order.key === 'caps') return 'not_a_resource';
  const units = Math.floor(order.units);
  if (units <= 0) return 'nothing_ordered';
  if (units > order.allowanceLeft) return 'over_allowance';
  if (order.stock[order.key] + units > order.storageCapacity) return 'no_room';
  if (supplyPrice(order.key, units) > order.stock.caps) return 'cannot_afford';
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
  /** Caps for one unit, as quoted. The order price is `supplyPrice`, not this times the count. */
  capsPerUnit: z.number().positive(),
  /** The most the crew could take right now, all three limits considered. */
  most: z.number().int().nonnegative(),
});
export type SupplyLine = z.infer<typeof SupplyLineSchema>;

/** The day's supply run, as the screen reads it. */
export const SupplyBoardSchema = z.object({
  /** Units of material the ration allows today. */
  allowance: z.number().int().nonnegative(),
  /** How many of them are already spent. */
  used: z.number().int().nonnegative(),
  /** The share of a full store the ration is, at this level. */
  percent: z.number().int().positive(),
  /** What one resource's store holds, which the share is measured against. */
  storageCapacity: z.number().int().nonnegative(),
  lines: z.array(SupplyLineSchema),
});
export type SupplyBoard = z.infer<typeof SupplyBoardSchema>;

/** The whole board for a crew: one function both sides of the wire call. */
export function supplyBoard(
  level: number,
  stock: Resources,
  storageCapacity: number,
  used: number,
): SupplyBoard {
  const allowance = supplyAllowance(level, storageCapacity);
  const left = Math.max(0, allowance - Math.max(0, Math.floor(used)));
  return {
    allowance,
    used: Math.max(0, Math.floor(used)),
    percent: supplyAllowancePercent(level),
    storageCapacity: Math.max(0, Math.floor(storageCapacity)),
    lines: SUPPLY_RESOURCES.map((key) => ({
      // No cast: `SupplyLine['key']` is derived from this very list now, so the two agree by
      // construction. The cast that used to sit here is what let the enum drift narrow unnoticed.
      key,
      capsPerUnit: RESOURCE_CAP_VALUE[key] * SUPPLY_MARKUP,
      most: supplyAffordable(key, stock, left, storageCapacity),
    })),
  };
}
