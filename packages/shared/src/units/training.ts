import { z } from 'zod';
import { buildingLevel, type Building } from '../building/index.js';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import { RESOURCE_KEYS, type PartialResources } from '../resources.js';
import { UNIT_CATALOG, UnitIdSchema, findUnit, type UnitSpec } from './catalog.js';

/**
 * Making units (GDD §A5).
 *
 * Unlocking a unit and *having* one are different things. Unlocks are a statement about the
 * campaign; this is the statement about the week: every unit costs materials and takes time, and
 * the standing army has a ceiling set by the Gauntlet.
 *
 * The queue is the same shape as the build queue and settles the same way — lazily, on read, from
 * absolute timestamps frozen at order time. There is still no scheduler anywhere in this game.
 */

/** An army: how many of each unit a crew has *at home*. Garrisons are counted separately. */
export const ArmySchema = z.record(UnitIdSchema, z.number().int().nonnegative());
export type Army = z.infer<typeof ArmySchema>;

export const MAX_TRAINING_QUEUE = 5;

export const TrainingOrderSchema = z.object({
  id: IdSchema,
  unitId: UnitIdSchema,
  count: z.number().int().positive(),
  startedAt: IsoDateTimeSchema,
  /** Frozen at order time, for the whole batch — the same rule a build order follows. */
  durationSeconds: z.number().int().positive(),
});
export type TrainingOrder = z.infer<typeof TrainingOrderSchema>;

export const TrainingQueueSchema = z.array(TrainingOrderSchema).max(MAX_TRAINING_QUEUE).default([]);
export type TrainingQueue = z.infer<typeof TrainingQueueSchema>;

/**
 * Supply the Gauntlet provides before any level, and per level after.
 *
 * A crew with no Gauntlet can still field a handful of Razors — an army cap of zero would mean a
 * new player cannot fight at all until they have built a barracks, which is a worse first hour
 * than a small one.
 */
export const ARMY_SUPPLY_BASE = 8;
export const ARMY_SUPPLY_PER_GAUNTLET_LEVEL = 6;

/** The standing army this district can support. */
export function armyCapacity(buildings: readonly Building[]): number {
  return ARMY_SUPPLY_BASE + buildingLevel(buildings, 'gauntlet') * ARMY_SUPPLY_PER_GAUNTLET_LEVEL;
}

/** What an army costs against that ceiling. A Colossus is not one soldier. */
export function supplyUsed(army: Army): number {
  return Object.entries(army).reduce((total, [unitId, count]) => {
    const unit = findUnit(unitId);
    return unit ? total + unit.supply * count : total;
  }, 0);
}

export function armySize(army: Army): number {
  return Object.values(army).reduce((total, count) => total + count, 0);
}

/** Supply a queued batch will claim when it lands — counted against the cap at *order* time. */
export function supplyQueued(queue: TrainingQueue): number {
  return queue.reduce((total, order) => {
    const unit = findUnit(order.unitId);
    return unit ? total + unit.supply * order.count : total;
  }, 0);
}

/**
 * What training `count` of `unit` costs.
 *
 * `discountPercent` is everything that makes units cheaper — an Armory, a district's unified
 * bonus — already summed, so this module never has to know what a place is. Floored at 1 per line
 * so a deep discount can never make a unit free.
 */
export const MAX_TRAINING_DISCOUNT = 50;

export function trainingCost(unit: UnitSpec, count: number, discountPercent = 0): PartialResources {
  const off = Math.min(MAX_TRAINING_DISCOUNT, Math.max(0, discountPercent)) / 100;
  return Object.fromEntries(
    RESOURCE_KEYS.flatMap((key) => {
      const amount = unit.cost[key];
      if (amount === undefined) return [];
      return [[key, Math.max(1, Math.round(amount * count * (1 - off)))] as const];
    }),
  );
}

/**
 * How long training `count` of `unit` takes, in seconds.
 *
 * Batches are cheaper in time than one-at-a-time — a second Razor does not take a second full
 * training cycle — but never free, or the queue's five slots would be a formality. The first is
 * full price and every one after is {@link BATCH_TIME_FACTOR} of it.
 */
export const BATCH_TIME_FACTOR = 0.6;
export const MAX_TRAINING_SPEED_BONUS = 60;

export function trainingSeconds(unit: UnitSpec, count: number, speedPercent = 0): number {
  const bonus = Math.min(MAX_TRAINING_SPEED_BONUS, Math.max(0, speedPercent)) / 100;
  const raw = unit.trainSeconds * (1 + (count - 1) * BATCH_TIME_FACTOR);
  return Math.max(1, Math.round(raw / (1 + bonus)));
}

const SECOND_MS = 1000;

export function trainingCompletesAt(order: TrainingOrder): Date {
  return new Date(Date.parse(order.startedAt) + order.durationSeconds * SECOND_MS);
}

export function trainingRemainingMs(order: TrainingOrder, now: Date): number {
  return Math.max(0, trainingCompletesAt(order).getTime() - now.getTime());
}

export function trainingProgressAt(order: TrainingOrder, now: Date): number {
  const elapsedMs = now.getTime() - Date.parse(order.startedAt);
  return Math.min(1, Math.max(0, elapsedMs / (order.durationSeconds * SECOND_MS)));
}

/** When an order placed now would begin: after everything already queued. */
export function trainingStartsAt(queue: TrainingQueue, now: Date): Date {
  const last = queue.at(-1);
  if (!last) return now;
  const after = trainingCompletesAt(last);
  return after > now ? after : now;
}

/**
 * The leading run of orders whose clocks are up, and the rest. A prefix rather than a filter,
 * because the queue is sequential — the same reasoning the build queue's splitter documents.
 */
export function splitDueTraining(
  queue: TrainingQueue,
  now: Date,
): { due: TrainingOrder[]; pending: TrainingOrder[] } {
  let count = 0;
  while (count < queue.length) {
    const order = queue[count];
    if (!order || trainingRemainingMs(order, now) > 0) break;
    count += 1;
  }
  return { due: queue.slice(0, count), pending: queue.slice(count) };
}

/** `army` with a completed order's units added to it. */
export function addToArmy(army: Army, unitId: string, count: number): Army {
  return { ...army, [unitId]: (army[unitId] ?? 0) + count };
}

/** `army` with units taken out of it, never below zero and never leaving a zero entry behind. */
export function takeFromArmy(army: Army, unitId: string, count: number): Army {
  const left = (army[unitId] ?? 0) - count;
  const next = { ...army };
  if (left > 0) next[unitId] = left;
  else delete next[unitId];
  return next;
}

/** How many of a unique unit a crew already holds, counting the queue. Legendary units cap at 1. */
export function alreadyHolds(unit: UnitSpec, army: Army, queue: TrainingQueue): number {
  const queued = queue
    .filter((order) => order.unitId === unit.id)
    .reduce((total, order) => total + order.count, 0);
  return (army[unit.id] ?? 0) + queued;
}

/** Units this crew could train at `building`, before any unlock or affordability check. */
export function unitsTrainedAt(building: Building['kind']): UnitSpec[] {
  return UNIT_CATALOG.filter((unit) => unit.trainedAt === building);
}
