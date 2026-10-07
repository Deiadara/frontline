import { CHAIR_PASSIVE_CAP } from '../crew/passives.js';
import { z } from 'zod';
import { CANCEL_REFUND, CANCEL_WINDOW } from '../time/cancel.js';
import { VehicleIdSchema } from '../building/vehicles.js';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import { softCap } from '../battle/soft-cap.js';
import { musterSpeedAfterTaper } from '../time/speed.js';
import { PartialResourcesSchema, RESOURCE_KEYS, type PartialResources } from '../resources.js';
import type { LocationKind } from '../city/locations.js';
import { UnitIdSchema, findUnit, locationsMustering, type UnitSpec } from './catalog.js';

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
/** Counts capped far past any real roster, so a crafted count is refused before arithmetic sees it. */
export const ARMY_COUNT_MAX = 10_000_000;
export const ArmySchema = z.record(
  UnitIdSchema,
  z.number().int().nonnegative().max(ARMY_COUNT_MAX),
);

/**
 * An army with the units that no longer exist taken out of it.
 *
 * `UnitIdSchema` is a *key* schema over the live catalogue, which means an army naming a retired
 * unit does not fail validation with a bad field, it fails to parse at all. Every place that reads
 * a stored army therefore has the same fault line under it: retire a unit and the read throws,
 * which on the server is the row refusing to load rather than a request returning an error. That
 * has happened twice.
 *
 * A migration fixes the rows that exist when it runs and nothing else: not a backup restored from
 * before it, not a stale process writing an older shape, and not the next removal nobody writes one
 * for. So the *readers* are made forgiving and the migrations stay as the tidy path.
 *
 * Strictly a filter on unknown keys. A negative count, a null, a string where a number belongs are
 * all still errors, because those are corruption rather than history, and the schema judges them
 * exactly as it did before.
 */
export function withoutRetiredUnits(raw: unknown): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      ([unitId]) => findUnit(unitId) !== undefined,
    ),
  );
}
export type Army = z.infer<typeof ArmySchema>;

export const MAX_MUSTER_QUEUE = 5;

/**
 * Why a muster order is refused, in the player's words. One copy for the route's refusal and the
 * card's greyed Muster button (maintainer, 2026-10-06: a press the server would refuse is guarded,
 * with this sentence on hover, rather than reported after it).
 */
export const MUSTER_REFUSAL_TEXT = {
  locked: 'You cannot field those yet',
  queue_full: 'The bench is full',
  already_have_one: 'There is only ever one of those',
  at_the_cap: 'That is as many as the ground you hold can raise. Take another Mausoleum',
  no_unit_slots: 'Your district has nowhere to put any more',
  cannot_afford: 'You cannot cover the cost',
} as const;

export const MusterOrderSchema = z.object({
  id: IdSchema,
  /**
   * What is being built: a unit off the roster, or a machine out of the Garage.
   *
   * One queue for both (maintainer request, 2026-09-15). A vehicle used to appear in the yard the
   * instant it was paid for, which made it the only thing in the game with a cost and no clock,
   * and left `buildSeconds` on every vehicle spec doing nothing at all. It is the same question a
   * player is asking in both cases, what is on the bench and when is it mine, so it is one bench.
   *
   * A union rather than a loose `z.string()`, so a typo in either catalogue is still a parse
   * error. Rows written before vehicles joined carry a unit id and keep parsing unchanged, which
   * is the property that matters: see the note on `MusterQueueSchema` for what a schema that
   * rejects an already-written row costs.
   */
  unitId: z.union([UnitIdSchema, VehicleIdSchema]),
  count: z.number().int().positive(),
  /**
   * How many of the batch have already walked out of the Gauntlet and joined the army.
   *
   * A batch used to land as a lump: order ten Razors and nothing at all happened for seven and a
   * half minutes, then ten appeared. That is not what mustering ten people looks like, and it
   * punishes the batch button the whole interface pushes you towards. They arrive **one at a
   * time** now, at the batch's own per-unit pace, and this is the count already handed over.
   *
   * Stored rather than derived, because the settle is what moves them and the settle has to be
   * idempotent: two reads a second apart must not deliver the same unit twice.
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
export type MusterOrder = z.infer<typeof MusterOrderSchema>;

/**
 * The bench, as it is **stored**, with no length cap on it.
 *
 * {@link MAX_MUSTER_QUEUE} is a gate on *ordering*, enforced by the route that appends, and it
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
export const MusterQueueSchema = z.array(MusterOrderSchema).default([]);
export type MusterQueue = z.infer<typeof MusterQueueSchema>;

/**
 * What an army costs against the district's unit slots (§A1). A Colossus is not one soldier.
 *
 * There is no separate army ceiling any more. The Gauntlet used to run one and the Quarters ran a
 * second for the officers, so a crew could fill both without either knowing, and "how many people
 * work here" had two answers. Everything comes out of one pool now: see
 * `building/unit-slots.ts` for what fills it and why a sheet's own slots are the right cost.
 */
export function unitSlotsUsed(army: Army): number {
  return Object.entries(army).reduce((total, [unitId, count]) => {
    const unit = findUnit(unitId);
    // A sheet the catalogue has forgotten still has to sit somewhere, and one slot is the floor
    // every other reader of a missing sheet already used (`ridingUnitSlots`, `unitColumnSpeed`).
    // It used to return zero here, so a stored row of a retired unit was billed no bed by the
    // district and a full seat by the machines carrying it: the same army, two sizes.
    return total + (unit?.unitSlots ?? 1) * count;
  }, 0);
}

export function armySize(army: Army): number {
  return Object.values(army).reduce((total, count) => total + count, 0);
}

/**
 * Unit slots a queued batch has still to claim: counted against the cap at *order* time.
 *
 * `order.count - order.delivered`, not `order.count`. A batch lands one unit at a time
 * (`splitDueMuster` leaves the order on the bench with `delivered` moved up and `count`
 * unchanged), and each delivered unit joins `base.army`. Reading the whole `count` therefore
 * counted the delivered part twice, in `army` and again here: nine of ten Razors landed read as
 * a draw of 19 for ten units, and at `MUSTER_MAX_BATCH` a crew was charged up to 99 slots for
 * 50 units. That total is what gates further orders and what the roster prints as free beds, so a
 * crew mid-batch was told it had less room than it had, until the batch finished and the phantom
 * cleared.
 */
export function unitSlotsQueued(queue: MusterQueue): number {
  return queue.reduce((total, order) => {
    const unit = findUnit(order.unitId);
    const outstanding = Math.max(0, order.count - order.delivered);
    return unit ? total + unit.unitSlots * outstanding : total;
  }, 0);
}

/**
 * What mustering `count` of `unit` costs.
 *
 * `discountPercent` is everything that makes units cheaper across the board: an Armory, a
 * district's unified bonus: already summed, so this module never has to know what a place is.
 *
 * `suppliesPercent` is §B5's Greenhouse, and it is a **separate argument rather than a bigger
 * number** because it lands on one line of the bill and no other. A Greenhouse grows food, so what
 * it makes cheaper is what a recruit eats while they learn, not the scrap their armour is cut
 * from. Folding it into `discountPercent` would have been one fewer parameter and would have made
 * the Greenhouse quietly pay for ammunition.
 *
 * The general cut stops at {@link MAX_MUSTER_DISCOUNT}, which is a price floor: half price is as
 * cheap as a unit gets. The supplies line takes the general cut and the supplies-only cut together
 * on one taper ({@link suppliesLineCut}). Every line is floored at 1, so no depth of discount ever
 * makes a unit free.
 */
export const MAX_MUSTER_DISCOUNT = 50;

/** The general cut as the bill takes it, on every line: never below nothing, never past half. */
export function generalMusterCut(discountPercent: number): number {
  return Math.min(MAX_MUSTER_DISCOUNT, Math.max(0, discountPercent));
}

/**
 * What the supplies line of a bill can be cut by at most, approached and never reached.
 *
 * Maintainer, 2026-10-01: "go up to about 70% off and generally nerf the supply reduction bonuses
 * so that it's hard to get there and a mid game crew is expected to have reduced it by about 20%".
 * The line used to add the general cut (up to 50) to the supplies-only cut (up to 40, then a taper
 * toward 50), so a late crew paid a tenth of its supplies or less.
 */
export const SUPPLIES_LINE_CEILING = 70;

/**
 * The percent off the supplies line: the general cut and the supplies-only cut on one taper.
 *
 * The knee is the general cut itself. The general cut pays in full on this line as on every other
 * (it is not the supplies-only sources' to nerf), and the Greenhouse and the supplies cards
 * taper from their first point toward {@link SUPPLIES_LINE_CEILING}: `g + (70 - g) x (1 -
 * e^(-s / (70 - g)))`. The first point pays nearly in full, every point pays something, and the
 * room left shrinks as the general cut grows, so a crew already at half price buys less with a
 * card than a crew at nothing. Measured after the general cuts were cut too (2026-10-01): a
 * typical mid-game crew (general 9, a Greenhouse 10 and Mess Rota, 9 points) is 17.4; a strong one
 * built for cheap supplies (general 20.6, 13 points) is 32.0; a late one (general 28.9, 28 points)
 * is 49.2; the deepest stack, at the floor price with the district's card ceiling, is 69.6.
 */
export function suppliesLineCut(discountPercent: number, suppliesPercent: number): number {
  const general = generalMusterCut(discountPercent);
  return softCap(general + Math.max(0, suppliesPercent), general, SUPPLIES_LINE_CEILING);
}

/** What the supplies-only sources add on the supplies line, over the general cut. */
export function suppliesOnlyCut(discountPercent: number, suppliesPercent: number): number {
  return suppliesLineCut(discountPercent, suppliesPercent) - generalMusterCut(discountPercent);
}

export function musterCost(
  unit: UnitSpec,
  count: number,
  discountPercent = 0,
  suppliesPercent = 0,
  /**
   * The Veteran's passive (`passives.ts`, maintainer 2026-10-04): up to half off every line, on
   * top of the other cuts rather than inside their ceiling, so a crew at the floor price still
   * feels a better Veteran.
   */
  veteranPercent = 0,
): PartialResources {
  const general = generalMusterCut(discountPercent);
  const suppliesLine = suppliesLineCut(discountPercent, suppliesPercent);
  const veteran = 1 - Math.max(0, Math.min(CHAIR_PASSIVE_CAP.muster_cost, veteranPercent)) / 100;
  return Object.fromEntries(
    RESOURCE_KEYS.flatMap((key) => {
      const amount = unit.cost[key];
      if (amount === undefined) return [];
      const off = (key === 'supplies' ? suppliesLine : general) / 100;
      return [[key, Math.max(1, Math.round(amount * count * (1 - off) * veteran))] as const];
    }),
  );
}

/**
 * §A4: what the ground a unit comes from does to its bill and its clock, per level above 1.
 *
 * The Doghouse is where the Cyberhounds are bred, so working the Doghouse up has to show in the
 * Cyberhounds and nowhere else. One point off the price and three off the clock per level, so a
 * location at the ceiling is 9% cheaper and 27% quicker on its own unit: real, and still well
 * under {@link MAX_MUSTER_DISCOUNT} and the knee of the speed taper, which every other source of
 * muster discount is already competing for. The price half was two a level until every general
 * muster cut was cut (maintainer, 2026-10-01).
 *
 * Deliberately narrow. A location that musters nothing changes no price at all, and a location
 * somebody else holds changes no price for you: this is the *held* level or it is nothing.
 */
// Two and seven a level since the ladder went to five levels (2026-10-06): 8 and 28 at the top,
// where 9 and 27 stood at the old level 10.
export const MUSTER_COST_PER_LOCATION_LEVEL = 2;
export const MUSTER_SPEED_PER_LOCATION_LEVEL = 7;

/**
 * What the crew's own ground takes off this unit, in percentage points.
 *
 * `heldLevels` is the best level held *per location kind*, and it is the caller's job to have
 * built it from locations this crew actually holds. A kind that is missing from it is a kind
 * somebody else has, or nobody has, and either way it is worth nothing here: a unit whose only
 * home is a Doghouse the crew does not hold is a unit the crew cannot muster at all.
 *
 * The best of the kinds rather than the sum of them, for the two units gated on more than one
 * place: what a unit gets is the best home it has, not one bonus per gate it happens to carry.
 */
export function homeMusterBonus(
  unit: UnitSpec,
  heldLevels: ReadonlyMap<LocationKind, number>,
): { costPercent: number; speedPercent: number } {
  const home = homeMusterSource(unit, heldLevels);
  if (home === null) return { costPercent: 0, speedPercent: 0 };
  return { costPercent: home.costPercent, speedPercent: home.speedPercent };
}

/** Which home paid a unit's own muster bonus, and what it was worth. */
export interface HomeMusterSource {
  kind: LocationKind;
  level: number;
  costPercent: number;
  speedPercent: number;
}

/**
 * The same bonus as {@link homeMusterBonus}, keeping which kind of ground paid it.
 *
 * Split out rather than worked out twice (maintainer, 2026-09-17: each unit should carry a tag
 * saying what it is given, "including the global ones and its private ones"). The private half is
 * this, and a page that names the Doghouse has to agree with the figure the route charges: one
 * walk, two readers, the way `crewSheetSources` is split from `crewSheet`.
 *
 * Null when this crew holds none of the ground this unit calls home, which is also the case where
 * the bonus is zero: there is nothing to name and nothing to print.
 */
export function homeMusterSource(
  unit: UnitSpec,
  heldLevels: ReadonlyMap<LocationKind, number>,
): HomeMusterSource | null {
  let best: { kind: LocationKind; level: number } | null = null;
  for (const kind of locationsMustering(unit)) {
    const level = heldLevels.get(kind) ?? 0;
    if (level > (best?.level ?? 0)) best = { kind, level };
  }
  if (best === null) return null;
  // The first level of a home is worth nothing: what pays is the work put into it above level one.
  const levels = Math.max(0, best.level - 1);
  if (levels === 0) return null;
  return {
    kind: best.kind,
    level: best.level,
    costPercent: levels * MUSTER_COST_PER_LOCATION_LEVEL,
    speedPercent: levels * MUSTER_SPEED_PER_LOCATION_LEVEL,
  };
}

/**
 * How long mustering `count` of `unit` takes, in seconds.
 *
 * Batches are cheaper in time than one-at-a-time: a second Razor does not take a second full
 * muster cycle, but never free, or the queue's five slots would be a formality. The first is
 * full price and every one after is {@link BATCH_TIME_FACTOR} of it.
 *
 * `speedPercent` is the summed speed, every source added; the taper (`musterSpeedAfterTaper`) is
 * applied here, so a caller never curves it first.
 */
export const BATCH_TIME_FACTOR = 0.6;

export function musterSecondsFor(unit: UnitSpec, count: number, speedPercent = 0): number {
  const bonus = musterSpeedAfterTaper(speedPercent) / 100;
  const raw = unit.musterSeconds * (1 + (count - 1) * BATCH_TIME_FACTOR);
  return Math.max(1, Math.round(raw / (1 + bonus)));
}

/**
 * A yard order of `count` machines, on the units' batch rule (maintainer, 2026-10-07: "make the
 * vehicle Build it section be the same as the units").
 *
 * The price is linear, every line times the count, off the discounted price of one. The clock is
 * `musterSecondsFor`'s shape with the Garage's own figure for one machine in place of the sheet's:
 * the first at full price and every one after at {@link BATCH_TIME_FACTOR}. No speed bonus: the
 * Gauntlet's cuts do not reach a machine, which is built rather than mustered.
 */
export function vehicleBatchCost(perOne: PartialResources, count: number): PartialResources {
  const batch = Math.max(1, Math.trunc(count));
  return Object.fromEntries(
    RESOURCE_KEYS.flatMap((key) => {
      const amount = perOne[key];
      return amount === undefined ? [] : [[key, amount * batch] as const];
    }),
  );
}

export function vehicleBatchSeconds(perOne: number, count: number): number {
  const batch = Math.max(1, Math.trunc(count));
  return Math.max(1, Math.round(perOne * (1 + (batch - 1) * BATCH_TIME_FACTOR)));
}

/**
 * How many of one machine the yard would take an order for today: the room under the per-kind
 * cap and the beds, whichever is smaller, walked back until the stockpile covers the batch. What
 * the card's **Max** offers and what the route checks, so the one can never offer what the other
 * refuses.
 */
export function maxVehiclesBuildable(
  perOne: PartialResources,
  stock: PartialResources,
  room: number,
): number {
  let count = Math.max(0, Math.trunc(room));
  while (count > 0 && !affordable(vehicleBatchCost(perOne, count), stock)) count -= 1;
  return count;
}

const SECOND_MS = 1000;

export function musterCompletesAt(order: MusterOrder): Date {
  return new Date(Date.parse(order.startedAt) + order.durationSeconds * SECOND_MS);
}

export function musterRemainingMs(order: MusterOrder, now: Date): number {
  return Math.max(0, musterCompletesAt(order).getTime() - now.getTime());
}

export function musterProgressAt(order: MusterOrder, now: Date): number {
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
export const MUSTER_CANCEL_WINDOW = CANCEL_WINDOW;
/** Ninety, not the ninety-five it was: one refund for everything (`time/cancel.ts`). */
export const MUSTER_CANCEL_REFUND = CANCEL_REFUND;

/**
 * Whether this order is still inside its window.
 *
 * Three conditions, and the third is the one a batch introduced: an order with a unit already
 * handed over has *started*, whatever its clock says. Refunding a batch that has delivered two of
 * ten would mean paying for units the crew is keeping. An order with no recorded price is never
 * cancellable either, since there is nothing to refund against.
 */
export function musterCancellable(order: MusterOrder, now: Date): boolean {
  if (Object.keys(order.paid).length === 0) return false;
  if (order.delivered > 0 || musterArrivedBy(order, now) > 0) return false;
  return musterProgressAt(order, now) < MUSTER_CANCEL_WINDOW;
}

/**
 * How the batch on the bench is going: how many are out, and how close the next one is.
 *
 * What the bench draws. A bar across the whole order was the right readout when a batch landed as
 * a lump and is the wrong one now: what a player wants to know is when the *next* unit arrives,
 * and how much of the order is already theirs.
 */
export function musterBatchProgress(
  order: MusterOrder,
  now: Date,
): { done: number; total: number; nextMs: number; nextProgress: number } {
  const each = (order.durationSeconds * SECOND_MS) / order.count;
  const done = musterArrivedBy(order, now);
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
export function musterCancelWindowMs(order: MusterOrder, now: Date): number {
  const shutsAt =
    Date.parse(order.startedAt) + order.durationSeconds * SECOND_MS * MUSTER_CANCEL_WINDOW;
  return Math.max(0, shutsAt - now.getTime());
}

/** What comes back: whole units of each material, rounded down, never more than was paid. */
export function musterRefund(order: MusterOrder): PartialResources {
  return Object.fromEntries(
    RESOURCE_KEYS.flatMap((key) => {
      const paid = order.paid[key];
      if (paid === undefined || paid <= 0) return [];
      return [[key, Math.floor(paid * MUSTER_CANCEL_REFUND)] as const];
    }),
  );
}

/**
 * The most of this unit a crew could order right now: what they can pay for, and where they can
 * put them.
 *
 * The number behind the roster's **Max** button, and it is derived here rather than on the screen
 * so the button cannot offer a batch the route will refuse. `spare` is the district's unit-slot
 * room (`building/unit-slots.ts`); a unique unit is one or nothing whatever else is true.
 */
export function maxMusterable(
  unit: UnitSpec,
  stock: PartialResources,
  spare: number,
  discountPercent = 0,
  suppliesPercent = 0,
  veteranPercent = 0,
): number {
  /*
   * A legendary is one or none, and it still has to be paid for.
   *
   * This used to return on the beds alone, which skipped the affordability walk below entirely:
   * **Max** offered a Colossus to a crew holding a single cap, and the server refused it with
   * `cannot_afford`. Uniques are the five most expensive things in the game, so they were exactly
   * the units the button lied about most often.
   */
  if (unit.unique) {
    const room = spare >= unit.unitSlots;
    return room &&
      affordable(musterCost(unit, 1, discountPercent, suppliesPercent, veteranPercent), stock)
      ? 1
      : 0;
  }
  const byRoom = Math.floor(Math.max(0, spare) / Math.max(1, unit.unitSlots));
  // Binary search would be neater; the batch price is linear in `count` before rounding, so the
  // straight division is exact enough and then walked back until it actually fits. `MUSTER_MAX_BATCH`
  // bounds the walk at the same number the roster's own stepper allows.
  let count = Math.min(MUSTER_MAX_BATCH, byRoom);
  while (
    count > 0 &&
    !affordable(musterCost(unit, count, discountPercent, suppliesPercent, veteranPercent), stock)
  ) {
    count -= 1;
  }
  return count;
}

/** Whether a stockpile covers a price. Local rather than imported: `resources.ts` cannot see us. */
function affordable(cost: PartialResources, stock: PartialResources): boolean {
  return RESOURCE_KEYS.every((key) => (cost[key] ?? 0) <= (stock[key] ?? 0));
}

/** The most one order may hold, which is what the roster's stepper and Max both stop at. */
export const MUSTER_MAX_BATCH = 50;

/** When an order placed now would begin: after everything already queued. */
export function musterStartsAt(queue: MusterQueue, now: Date): Date {
  const last = queue.at(-1);
  if (!last) return now;
  const after = musterCompletesAt(last);
  return after > now ? after : now;
}

/**
 * The bench closed up after an order was taken out of the middle of it.
 *
 * Every order's `startedAt` is absolute and frozen when it is queued, at the completion time of the
 * order in front. Removing one therefore left a hole: cancel 50 Razors twenty seconds in and the 5
 * Wardens behind them sat doing nothing for the remaining twenty-two minutes, because their clock
 * still pointed at the end of a batch that no longer existed. Nothing stated that cost, and the
 * module's own doc frames cancelling as exactly two things, the window and the 5%.
 *
 * Pull forward only, never push back: `Math.min` against a cursor that only grows. An order that
 * has already begun keeps its own clock, because units have been priced and possibly handed over
 * against it and re-timing it would re-time deliveries that already happened.
 */
export function resequencedMuster(queue: MusterQueue, now: Date): MusterQueue {
  let cursor = now.getTime();
  return queue.map((order) => {
    const moved = {
      ...order,
      startedAt: new Date(Math.min(Date.parse(order.startedAt), cursor)).toISOString(),
    };
    cursor = Math.max(cursor, musterCompletesAt(moved).getTime());
    return moved;
  });
}

/**
 * How many of a batch have finished by `now`: the whole point of a batch arriving in pieces.
 *
 * The batch's clock is divided evenly across its own count, so ten Razors on a 450-second order
 * hand one over every 45 seconds. Even division rather than `unit.musterSeconds` each, because
 * `musterSecondsFor` gives a batch a discount ({@link BATCH_TIME_FACTOR}) and a speed bonus, and the
 * pace has to follow the clock the order was actually given.
 */
export function musterArrivedBy(order: MusterOrder, now: Date): number {
  const each = (order.durationSeconds * SECOND_MS) / order.count;
  const elapsed = now.getTime() - Date.parse(order.startedAt);
  if (elapsed <= 0) return 0;
  return Math.min(order.count, Math.floor(elapsed / each));
}

/** What is waiting to be handed over on this read: arrived, less whatever already was. */
export function musterUndelivered(order: MusterOrder, now: Date): number {
  return Math.max(0, musterArrivedBy(order, now) - order.delivered);
}

/**
 * The queue after a settle: what to add to the army, and the orders that are left.
 *
 * A partly-delivered order stays on the bench with its `delivered` moved up; one that has handed
 * over its last unit leaves. A prefix rather than a filter, because the queue is sequential: an
 * order behind an unfinished one has not started, so it cannot have delivered anything, which the
 * arithmetic above already gives for free (its `startedAt` is in the future).
 */
export function splitDueMuster(
  queue: MusterQueue,
  now: Date,
): { delivered: { unitId: string; count: number }[]; pending: MusterOrder[] } {
  const handed: { unitId: string; count: number }[] = [];
  const pending: MusterOrder[] = [];
  for (const order of queue) {
    const arriving = musterUndelivered(order, now);
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

/**
 * How many of any one legendary a crew may hold. One, and it is the whole rule.
 *
 * Written down here rather than as a bare `1` at the three doors that read it, because the
 * maintainer asked for it as a *general* rule of the game on 2026-09-19 rather than as a check on
 * the muster queue: "you can have up to 1 of each legendary unit, no more". `musterUnits` has
 * enforced it since uniques existed; what had not was the console, which handed out a dozen of
 * every sheet in the catalogue including all seven legendaries.
 */
export const LEGENDARY_CAP = 1;

/**
 * An army with every legendary in it brought back to {@link LEGENDARY_CAP}.
 *
 * For the doors that *grant* rather than muster. The muster queue refuses a second one at the
 * gate and never needs this; a grant has no gate, so it gets one here.
 *
 * Deliberately not applied inside `mergeArmies`, which is what a fight uses to hand a crew its
 * survivors back: a clamp on that path would silently eat a unit whenever some other bug produced
 * an over-count, and the place to catch that is where the over-count is made.
 */
export function capLegendaries(army: Army): Army {
  const out: Army = {};
  for (const [unitId, count] of Object.entries(army)) {
    if ((count ?? 0) <= 0) continue;
    const unique = findUnit(unitId)?.unique === true;
    out[unitId] = unique ? Math.min(LEGENDARY_CAP, count) : count;
  }
  return out;
}

/**
 * How many of a capped unit a crew already holds, counting the queue: a legendary's one, the Death
 * Cloaks' fifty a Mausoleum.
 *
 * The queue's *outstanding* part only, as in `unitSlotsQueued` below: delivered units are already
 * in `army`, and reading the whole `count` counted them twice (bug pass, 2026-10-06), so a crew
 * ten into a batch of thirty was told it had ten Death Cloaks of room when it had twenty.
 */
export function alreadyHolds(unit: UnitSpec, army: Army, queue: MusterQueue): number {
  const queued = queue
    .filter((order) => order.unitId === unit.id)
    .reduce((total, order) => total + Math.max(0, order.count - order.delivered), 0);
  return (army[unit.id] ?? 0) + queued;
}
