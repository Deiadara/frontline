import { z } from 'zod';
import type { Building } from '../building/index.js';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import { PartialResourcesSchema, RESOURCE_KEYS, type PartialResources } from '../resources.js';
import { UNIT_CATALOG, UnitIdSchema, findUnit, type UnitSpec } from './catalog.js';

/**
 * Making units (GDD §A5).
 *
 * Unlocking a unit and *having* one are different things. Unlocks are a statement about the
 * campaign; this is the statement about the week: every unit costs materials and takes time, and
 * the standing army has a ceiling set by the Gauntlet.
 *
 * The queue is the same shape as the build queue and settles the same way: lazily, on read, from
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
  /**
   * How many of the batch have already walked out of the Gauntlet and joined the army.
   *
   * A batch used to land as a lump: order ten Razors and nothing at all happened for seven and a
   * half minutes, then ten appeared. That is not what training ten people looks like, and it
   * punishes the batch button the whole interface pushes you towards. They arrive **one at a
   * time** now, at the batch's own per-unit pace, and this is the count already handed over.
   *
   * Stored rather than derived, because the settle is what moves them and the settle has to be
   * idempotent: two reads a second apart must not deliver the same body twice.
   */
  delivered: z.number().int().nonnegative().default(0),
  startedAt: IsoDateTimeSchema,
  /** Frozen at order time, for the whole batch: the same rule a build order follows. */
  durationSeconds: z.number().int().positive(),
  /**
   * What this batch actually cost, after whatever discount was standing when it was ordered.
   *
   * Recorded rather than recomputed, because a refund has to be against the price *paid*. A crew
   * that ordered at full price and then finished a Lab project would otherwise get back more than
   * it spent, which turns "order, cancel" into a way of making resources. Defaulted so a row
   * written before the field existed still parses; an order with nothing recorded cannot be called
   * off, which is the honest reading of "we do not know what you paid".
   */
  paid: PartialResourcesSchema.default({}),
});
export type TrainingOrder = z.infer<typeof TrainingOrderSchema>;

/**
 * The bench, as it is **stored**, with no length cap on it.
 *
 * {@link MAX_TRAINING_QUEUE} is a gate on *ordering*, enforced by the route that appends, and it
 * has no business on the read path. A cap here can only ever do one thing: take a row that was
 * legal when it was written and make it unreadable later, which turns one bad write into a
 * permanently 500ing `GET /me` and a client that shows `UPLINK FAILED` and nothing else.
 *
 * That is not hypothetical. Testing mode waives `queue_full` (`admin/mode.ts`) so a reviewer can
 * stack orders, and the sixth one bricked the save: every subsequent read threw `too_big` out of
 * `rowToBase`, so the crew could not be loaded to *drain* the queue either. Lowering the constant
 * in a balance pass would have done the same thing to every existing save.
 *
 * The same argument applies to `BuildQueueSchema`, and for the same reason.
 */
export const TrainingQueueSchema = z.array(TrainingOrderSchema).default([]);
export type TrainingQueue = z.infer<typeof TrainingQueueSchema>;

/**
 * What an army costs against the district's population (§A1). A Colossus is not one soldier.
 *
 * There is no separate army ceiling any more. The Gauntlet used to run one and the Quarters ran a
 * second for officers and assignees, so a crew could fill both without either knowing, and "how
 * many people work here" had two answers. Everything comes out of one pool now: see
 * `building/population.ts` for what fills it and why supply is the right cost per body.
 */
export function supplyUsed(army: Army): number {
  return Object.entries(army).reduce((total, [unitId, count]) => {
    const unit = findUnit(unitId);
    return unit ? total + unit.supply * count : total;
  }, 0);
}

export function armySize(army: Army): number {
  return Object.values(army).reduce((total, count) => total + count, 0);
}

/** Supply a queued batch will claim when it lands: counted against the cap at *order* time. */
export function supplyQueued(queue: TrainingQueue): number {
  return queue.reduce((total, order) => {
    const unit = findUnit(order.unitId);
    return unit ? total + unit.supply * order.count : total;
  }, 0);
}

/**
 * What training `count` of `unit` costs.
 *
 * `discountPercent` is everything that makes units cheaper: an Armory, a district's unified
 * bonus: already summed, so this module never has to know what a place is. Floored at 1 per line
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
 * Batches are cheaper in time than one-at-a-time: a second Razor does not take a second full
 * training cycle, but never free, or the queue's five slots would be a formality. The first is
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

/**
 * Calling a batch off (§A5).
 *
 * A short window and a real cost, which is the only shape that works: with no window it is a free
 * undo and the queue stops being a commitment; with no penalty a player parks resources on the
 * bench and pulls them back the moment something better comes up.
 *
 * Ten percent of the batch's *own* clock, so a run of Razors gives seconds and a Colossus gives
 * minutes, which is right: the longer the thing takes, the longer you have to notice you clicked
 * the wrong one. Ninety-five percent back, and the missing twentieth is the material already cut
 * up before anybody said stop.
 */
export const TRAINING_CANCEL_WINDOW = 0.1;
export const TRAINING_CANCEL_REFUND = 0.95;

/**
 * Whether this order is still inside its window.
 *
 * Three conditions, and the third is the one a batch introduced: an order with a body already
 * handed over has *started*, whatever its clock says. Refunding a batch that has delivered two of
 * ten would mean paying for units the crew is keeping. An order with no recorded price is never
 * cancellable either, since there is nothing to refund against.
 */
export function trainingCancellable(order: TrainingOrder, now: Date): boolean {
  if (Object.keys(order.paid).length === 0) return false;
  if (order.delivered > 0 || trainingArrivedBy(order, now) > 0) return false;
  return trainingProgressAt(order, now) < TRAINING_CANCEL_WINDOW;
}

/**
 * How the batch on the bench is going: how many are out, and how close the next one is.
 *
 * What the bench draws. A bar across the whole order was the right readout when a batch landed as
 * a lump and is the wrong one now: what a player wants to know is when the *next* body arrives,
 * and how much of the order is already theirs.
 */
export function trainingBatchProgress(
  order: TrainingOrder,
  now: Date,
): { done: number; total: number; nextMs: number; nextProgress: number } {
  const each = (order.durationSeconds * SECOND_MS) / order.count;
  const done = trainingArrivedBy(order, now);
  if (done >= order.count)
    return { done: order.count, total: order.count, nextMs: 0, nextProgress: 1 };
  const startedAt = Date.parse(order.startedAt);
  const nextAt = startedAt + (done + 1) * each;
  const nextMs = Math.max(0, nextAt - now.getTime());
  return {
    done,
    total: order.count,
    nextMs,
    nextProgress: each <= 0 ? 1 : Math.min(1, Math.max(0, 1 - nextMs / each)),
  };
}

/** How long is left to change your mind, in milliseconds. Zero once the window has shut. */
export function trainingCancelWindowMs(order: TrainingOrder, now: Date): number {
  const shutsAt =
    Date.parse(order.startedAt) + order.durationSeconds * SECOND_MS * TRAINING_CANCEL_WINDOW;
  return Math.max(0, shutsAt - now.getTime());
}

/** What comes back: whole units of each material, rounded down, never more than was paid. */
export function trainingRefund(order: TrainingOrder): PartialResources {
  return Object.fromEntries(
    RESOURCE_KEYS.flatMap((key) => {
      const paid = order.paid[key];
      if (paid === undefined || paid <= 0) return [];
      return [[key, Math.floor(paid * TRAINING_CANCEL_REFUND)] as const];
    }),
  );
}

/**
 * The most of this unit a crew could order right now: what they can pay for, and where they can
 * put them.
 *
 * The number behind the roster's **Max** button, and it is derived here rather than on the screen
 * so the button cannot offer a batch the route will refuse. `spare` is the district's population
 * room (`building/population.ts`); a unique unit is one or nothing whatever else is true.
 */
export function maxTrainable(
  unit: UnitSpec,
  stock: PartialResources,
  spare: number,
  discountPercent = 0,
): number {
  if (unit.unique) return spare >= unit.supply ? 1 : 0;
  const byRoom = Math.floor(Math.max(0, spare) / Math.max(1, unit.supply));
  // Binary search would be neater; the batch price is linear in `count` before rounding, so the
  // straight division is exact enough and then walked back until it actually fits. `TRAINING_MAX`
  // bounds the walk at the same number the roster's own stepper allows.
  let count = Math.min(TRAINING_MAX_BATCH, byRoom);
  while (count > 0 && !affordable(trainingCost(unit, count, discountPercent), stock)) count -= 1;
  return count;
}

/** Whether a stockpile covers a price. Local rather than imported: `resources.ts` cannot see us. */
function affordable(cost: PartialResources, stock: PartialResources): boolean {
  return RESOURCE_KEYS.every((key) => (cost[key] ?? 0) <= (stock[key] ?? 0));
}

/** The most one order may hold, which is what the roster's stepper and Max both stop at. */
export const TRAINING_MAX_BATCH = 50;

/** When an order placed now would begin: after everything already queued. */
export function trainingStartsAt(queue: TrainingQueue, now: Date): Date {
  const last = queue.at(-1);
  if (!last) return now;
  const after = trainingCompletesAt(last);
  return after > now ? after : now;
}

/**
 * How many of a batch have finished by `now`: the whole point of a batch arriving in pieces.
 *
 * The batch's clock is divided evenly across its own count, so ten Razors on a 450-second order
 * hand one over every 45 seconds. Even division rather than `unit.trainSeconds` each, because
 * `trainingSeconds` gives a batch a discount ({@link BATCH_TIME_FACTOR}) and a speed bonus, and the
 * pace has to follow the clock the order was actually given.
 */
export function trainingArrivedBy(order: TrainingOrder, now: Date): number {
  const each = (order.durationSeconds * SECOND_MS) / order.count;
  const elapsed = now.getTime() - Date.parse(order.startedAt);
  if (elapsed <= 0) return 0;
  return Math.min(order.count, Math.floor(elapsed / each));
}

/** What is waiting to be handed over on this read: arrived, less whatever already was. */
export function trainingUndelivered(order: TrainingOrder, now: Date): number {
  return Math.max(0, trainingArrivedBy(order, now) - order.delivered);
}

/**
 * The queue after a settle: what to add to the army, and the orders that are left.
 *
 * A partly-delivered order stays on the bench with its `delivered` moved up; one that has handed
 * over its last body leaves. A prefix rather than a filter, because the queue is sequential: an
 * order behind an unfinished one has not started, so it cannot have delivered anything, which the
 * arithmetic above already gives for free (its `startedAt` is in the future).
 */
export function splitDueTraining(
  queue: TrainingQueue,
  now: Date,
): { delivered: { unitId: string; count: number }[]; pending: TrainingOrder[] } {
  const handed: { unitId: string; count: number }[] = [];
  const pending: TrainingOrder[] = [];
  for (const order of queue) {
    const arriving = trainingUndelivered(order, now);
    if (arriving > 0) handed.push({ unitId: order.unitId, count: arriving });
    const delivered = order.delivered + arriving;
    if (delivered < order.count) pending.push({ ...order, delivered });
  }
  return { delivered: handed, pending };
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
