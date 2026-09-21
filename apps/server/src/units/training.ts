import { randomUUID } from 'node:crypto';
import { tallyUnitsTrained, tallyVehicleBuilt } from '../feats/tally.js';
import {
  findVehicle,
  CITY_LOCATIONS,
  MAX_TRAINING_QUEUE,
  VEHICLES,
  buildingLevel,
  vehicleBuildSeconds,
  clampLevel,
  homeTrainingBonus,
  trainingSuppliesReduction,
  trainingTimeReduction,
  addResources,
  addToArmy,
  alreadyHolds,
  blueprintGateMet,
  canAfford,
  findUnit,
  heldPlaceKindsOf,
  isHeldBy,
  isUnitUnlocked,
  spendResources,
  splitDueTraining,
  trainingCancellable,
  trainingCost,
  trainingRefund,
  resequencedTraining,
  trainingSeconds,
  trainingStartsAt,
  xpForClock,
  type Army,
  type Base,
  type PartialResources,
  type LocationKind,
  type PlayerXpAward,
  type TrainingOrder,
  type UnitSpec,
  type UnlockContext,
  type Fleet,
  type VehicleSpec,
} from '@frontline/shared';
import { adminCost, adminSeconds, adminWaives } from '../admin/mode.js';
import { standingEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { awardPlayerXp } from '../progression/award.js';
import { districtUnitSlots } from '../district/unit-slots.js';

/**
 * Making units (GDD §A5).
 *
 * The same lazy contract as everything else: orders carry an absolute clock frozen at order time,
 * and whatever has come due is applied the next time the crew is read.
 */

/*
 * `unknown_unit` is not on this list. `queueTraining` is handed a `UnitSpec`, so by the time it runs
 * the unit exists; the route resolves the id and 404s on its own before it gets here. A refusal
 * nothing returns is a sentence a player can never be shown and a waiver nobody can classify.
 */
export const TRAINING_REFUSALS = [
  'locked',
  'queue_full',
  'already_have_one',
  'no_unit_slots',
  'cannot_afford',
] as const;
export type TrainingRefusal = (typeof TRAINING_REFUSALS)[number];

export type TrainingResult =
  | { kind: 'refused'; reason: TrainingRefusal }
  | { kind: 'queued'; base: Base; order: TrainingOrder };

/**
 * §B6: the machines the Garage could turn out today, by id.
 *
 * "Can build", not "has built": the Road Reavers' gate is that the yard *makes* motorcycles, so a
 * crew that sends its last bike out on a mission does not lose the ability to train them. Read off
 * the vehicle catalogue's own two unlock clauses, its Garage level and its blueprint document
 * (§D12c), and deliberately not off its price: being short of scrap this afternoon is not a
 * campaign gate.
 */
export function buildableVehiclesFor(base: Base): Set<string> {
  const garage = buildingLevel(base.buildings, 'garage');
  return new Set(
    VEHICLES.filter(
      (spec) =>
        garage >= spec.requiresGarageLevel && blueprintGateMet(base.inventory, 'vehicle', spec.id),
    ).map((spec) => spec.id),
  );
}

/** What this crew's territory does to unlocks: the place kinds it currently holds. */
export function unlockContextFor(repos: Repositories, base: Base): UnlockContext {
  const controls = repos.city.controls();
  return {
    buildings: base.buildings,
    heldPlaceKinds: heldPlaceKindsOf(CITY_LOCATIONS, (locationId) => {
      const control = controls.get(locationId);
      return control !== undefined && isHeldBy(control, base.id);
    }),
    buildableVehicles: buildableVehiclesFor(base),
    // §D12a: thirteen units are behind a blueprint document, and the document lives in the inventory.
    inventory: base.inventory,
  };
}

/**
 * §A4: the best level this crew holds, per location kind.
 *
 * The input to `homeTrainingBonus`, and the reason it is a map of *kinds* rather than of locations:
 * two Doghouses are one Doghouse as far as the Cyberhounds are concerned, and the one that counts
 * is the better of them. A kind nobody in this crew holds is simply absent, which is what makes
 * "somebody else's level does nothing for you" fall out rather than need saying.
 */
export function heldLocationLevels(
  repos: Repositories,
  base: Base,
): ReadonlyMap<LocationKind, number> {
  const controls = repos.city.controls();
  const levels = new Map<LocationKind, number>();
  for (const location of CITY_LOCATIONS) {
    const control = controls.get(location.id);
    if (!control || !isHeldBy(control, base.id)) continue;
    const level = clampLevel(control.level);
    if (level > (levels.get(location.kind) ?? 0)) levels.set(location.kind, level);
  }
  return levels;
}

/**
 * Everything this district takes off a training bill and a training clock.
 *
 * Folded once, here, so the roster's quoted price, `Max`, and the route's charge are by
 * construction the same numbers. The Greenhouse's is deliberately kept apart from the general
 * discount all the way down to `trainingCost`, because §B5 says it lands on the supplies line and
 * on nothing else.
 *
 * `locationLevels` rides along rather than being folded in, because what it is worth depends on
 * *which unit* is being priced: see `ratesForUnit`. Everything else here is true of every unit on
 * the roster at once.
 */
export function trainingRatesFor(
  repos: Repositories,
  base: Base,
  /**
   * The instant to price at. Defaults to now, which is every caller but a test.
   *
   * Threaded rather than left to the wall clock (2026-09-17). `standingEffectsFor` takes one
   * because §A4's raid disruption expires, and this dropped it: `projectUnits(repos, base, now)`
   * was handed an instant, priced the roster off `new Date()` instead, and so could disagree with
   * every other figure on the same response about whether a raid was still biting. In production
   * the two are the same millisecond and nothing shows; in a test with a fixed clock it is the
   * difference between a rate of 11 and a rate of 8.25, and the disagreement only appears once
   * real time has walked past the fixture's disruption window.
   */
  now: Date = new Date(),
): TrainingRates {
  const effects = standingEffectsFor(repos, base, now);
  return {
    costPercent: effects.trainingCostPercent,
    // §B5: the Greenhouse, and the modifications that grow with it.
    suppliesPercent: trainingSuppliesReduction(base.buildings),
    // §B6: the Gauntlet takes time off every unit on the roster, the ones it cannot train included.
    speedPercent: effects.trainingSpeedPercent + trainingTimeReduction(base.buildings),
    locationLevels: heldLocationLevels(repos, base),
  };
}

/**
 * The same rates as one unit sees them: the crew-wide ones plus whatever its own home adds.
 *
 * Pure, and takes the rates rather than the repositories, so the roster can price forty units off
 * one walk of the control table instead of forty.
 */
export function ratesForUnit(rates: TrainingRates, unit: UnitSpec): TrainingRates {
  const home = homeTrainingBonus(unit, rates.locationLevels);
  return {
    ...rates,
    costPercent: rates.costPercent + home.costPercent,
    speedPercent: rates.speedPercent + home.speedPercent,
  };
}

export interface TrainingRates {
  costPercent: number;
  suppliesPercent: number;
  speedPercent: number;
  /** §A4: the best level held per location kind. Read only through {@link ratesForUnit}. */
  locationLevels: ReadonlyMap<LocationKind, number>;
}

export interface TrainingSettlement {
  base: Base;
  /** §I1: one award per batch that landed. Empty on a read that finished nothing. */
  awards: PlayerXpAward[];
  /**
   * Orders that handed over their **last** unit on this read.
   *
   * Not the same thing as `delivered`: a batch trickles out one unit at a time, so a receipt per
   * unit would ring every forty-five seconds for an order of ten. `unit_trained` says "a batch has
   * finished training", and this is the set that has.
   */
  finished: TrainingOrder[];
}

/**
 * Units that have finished training join the army at home.
 *
 * §I1 pays per *unit*, at a rate priced off what that unit takes to train.
 *
 * The two halves answer each other. Per unit, because a batch hands its units over one at a time
 * and paying on whichever read caught the last one would make the reward depend on how often the
 * page was open. Priced off the unit's own clock, because per-unit at a flat rate is what would
 * make the cheapest rabble the fastest way to level: a Razor is 45 seconds and a Colossus is an
 * hour and a half, and the curve is what stops the faucet without going back to per-order.
 */
export function settleTraining(repos: Repositories, base: Base, now: Date): TrainingSettlement {
  const { delivered, pending } = splitDueTraining(base.trainingQueue, now);
  if (delivered.length === 0) return { base, awards: [], finished: [] };

  // An order only leaves the queue when it has handed over its last unit, so what is missing from
  // `pending` is exactly what finished on this read.
  const stillWaiting = new Set(pending.map((order) => order.id));
  const finished = base.trainingQueue.filter((order) => !stillWaiting.has(order.id));

  /*
   * A finished batch goes to the roster or to the yard, depending on what it was.
   *
   * One bench builds both (maintainer request, 2026-09-15), so the delivery has to branch here:
   * a unit is a count in `army` and a machine is a count in `fleet`, and they are stored in
   * different columns. `findVehicle` is the discriminator rather than a flag on the order, because
   * the id already says which catalogue it came from and a second field could disagree with it.
   */
  /*
   * Narrowed through the catalogue rather than by a cast.
   *
   * `TrainingOrder.unitId` is a union of the two id enums, and `Fleet` is keyed by the vehicle one
   * alone, so indexing it with the union does not typecheck. `findVehicle` returns the spec, whose
   * `id` **is** a `VehicleId`, which is the honest narrowing: the catalogue is what decides which
   * kind an id is, and this way a machine and its count travel together.
   */
  const machines = delivered.flatMap((batch) => {
    const spec = findVehicle(batch.unitId);
    return spec === undefined ? [] : [{ id: spec.id, count: batch.count }];
  });
  const recruits = delivered.filter((batch) => findVehicle(batch.unitId) === undefined);

  const army: Army = recruits.reduce(
    (into, batch) => addToArmy(into, batch.unitId, batch.count),
    base.army,
  );
  const fleet: Fleet = machines.reduce(
    (into, machine) => ({ ...into, [machine.id]: (into[machine.id] ?? 0) + machine.count }),
    base.fleet,
  );
  const settled: Base = { ...base, army, fleet, trainingQueue: pending };
  repos.bases.updateArmy(settled.id, settled.army, settled.trainingQueue);
  if (machines.length > 0) {
    repos.bases.updateFleet(settled.id, fleet);
    // Feats: machines built, counted here now that the yard is not what grants them. `fleet` is a
    // current count and a machine lost in a fight takes one off it, so the lifetime figure cannot
    // be read off the yard.
    for (const machine of machines) tallyVehicleBuilt(repos, settled.id, machine.count);
  }

  // Feats: per unit, for the same reason the XP below is per unit. A read that happens to catch
  // the last unit of a batch must not be worth more than the read before it.
  tallyUnitsTrained(
    repos,
    settled.id,
    recruits.reduce((total, batch) => total + batch.count, 0),
  );

  /*
   * §I1 pays per *unit*, not per order.
   *
   * A batch hands its units over one at a time now, so paying an order's worth of XP on whichever
   * read happened to catch the last one would make the reward depend on how often the page was
   * open. One award per unit delivered is the same total whatever the polling does.
   */
  let carried = settled;
  const awards: PlayerXpAward[] = [];
  for (const batch of recruits) {
    // Priced off what one of *this* unit takes on the bench, on the shared curve: a Razor is
    // 45 seconds and a Colossus is an hour and a half, and a flat table entry paid the same for
    // both. The catalogue's figure rather than the order's frozen one, deliberately: a workshop
    // discount should make the batch arrive sooner, not be worth less to have trained.
    const perUnit = xpForClock('unitTrained', findUnit(batch.unitId)?.trainSeconds ?? 0);
    for (let i = 0; i < batch.count; i += 1) {
      const { base: progressed, award } = awardPlayerXp(repos, carried, 'unitTrained', 0, perUnit);
      carried = progressed;
      awards.push(award);
    }
  }
  return { base: carried, awards, finished };
}

export interface TrainInput {
  base: Base;
  unit: UnitSpec;
  count: number;
  now: Date;
  /**
   * Testing mode: five seconds on the bench, no materials (`admin/mode.ts`).
   *
   * The unit-slot cap is *not* waived. A free army that ignores housing is not the game with the
   * waiting removed, it is a different game, and housing is one of the things a reviewer is here
   * to feel.
   */
  admin?: boolean;
}

/**
 * Puts a batch on the bench.
 *
 * Unit slots are claimed at **order** time, counting the queue as well as the standing army: a crew
 * cannot queue five Colossi against a cap that holds one and discover the problem an hour later.
 */
/**
 * Calling a batch off (§A5), inside its window.
 *
 * The refund is read off the order rather than recomputed, and the order is removed rather than
 * marked: a bench with a hole in it would break `trainingStartsAt`, which reads the tail of the
 * queue to decide when the next order begins.
 */
export type CancelRefusal = 'unknown_order' | 'window_closed';

export type CancelResult =
  | { kind: 'refused'; reason: CancelRefusal }
  | { kind: 'cancelled'; base: Base; refund: PartialResources };

export function cancelTraining(
  repos: Repositories,
  base: Base,
  orderId: string,
  now: Date,
): CancelResult {
  const order = base.trainingQueue.find((entry) => entry.id === orderId);
  if (!order) return { kind: 'refused', reason: 'unknown_order' };
  if (!trainingCancellable(order, now)) return { kind: 'refused', reason: 'window_closed' };

  const refund = trainingRefund(order);
  // Closed up, not merely shortened. Every order's clock is absolute and was frozen at the
  // completion time of the order in front of it, so taking one out of the middle left the ones
  // behind it waiting out a batch that no longer exists.
  const left = resequencedTraining(
    base.trainingQueue.filter((entry) => entry.id !== orderId),
    now,
  );
  const cancelled: Base = {
    ...base,
    resources: addResources(base.resources, refund),
    trainingQueue: left,
  };
  repos.bases.updateResources(cancelled.id, cancelled.resources);
  repos.bases.updateArmy(cancelled.id, cancelled.army, cancelled.trainingQueue);
  return { kind: 'cancelled', base: cancelled, refund };
}

/**
 * Put a machine on the same bench the units are built on (maintainer request, 2026-09-15).
 *
 * A vehicle used to land in the yard the instant it was paid for: the only thing in the game with
 * a price and no clock, and the reason every vehicle spec's `buildSeconds` was dead data. It goes
 * through the queue now, so a machine is something you wait for and can watch, the way a Razor is.
 *
 * Its own function rather than a branch inside `queueTraining`, because almost none of that
 * function's gates apply to a machine: there is no unlock ladder, no unique-unit rule, and its
 * price comes off the Garage's discount rather than the Gauntlet's rates. What the two share is
 * the bench, and the bench is exactly the queue and the clock below.
 *
 * The beds are shared as well since 2026-09-15, but the comparison is not here: a machine costs
 * one bed and `garage/routes.ts` asks for it in `blockerFor`, so the page's greyed button and this
 * door quote the same sentence. `unitSlotDraw` charges the order from the moment it is written,
 * which is what stops a crew ordering one machine at a time into a district with one bed left.
 *
 * The queue's length cap **is** shared, deliberately: it is a cap on the bench, and a bench that
 * held five orders of units and another seven of machines would not be one bench.
 */
export function queueVehicle(
  repos: Repositories,
  input: {
    base: Base;
    vehicle: VehicleSpec;
    /** Already discounted by the Garage, so a refund is against the price paid. */
    cost: PartialResources;
    now: Date;
    admin?: boolean;
  },
): { kind: 'queued'; base: Base; order: TrainingOrder } | { kind: 'refused'; reason: string } {
  const { base, vehicle, cost, now, admin = false } = input;

  if (base.trainingQueue.length >= MAX_TRAINING_QUEUE && !adminWaives('queue_full', admin)) {
    return { kind: 'refused', reason: 'The bench is full' };
  }

  const charged = adminCost(cost, admin);
  const order: TrainingOrder = {
    id: randomUUID(),
    unitId: vehicle.id,
    count: 1,
    delivered: 0,
    // Behind whatever is already on the bench, which is what makes it one bench rather than a
    // second queue that happens to be drawn in the same list.
    startedAt: trainingStartsAt(base.trainingQueue, now).toISOString(),
    // §B6: the yard's own level takes time off the build (`vehicleBuildSeconds`). The Gauntlet's
    // training cut deliberately does not reach a machine: it is built, not trained.
    durationSeconds: adminSeconds(
      vehicleBuildSeconds(vehicle, buildingLevel(base.buildings, 'garage')),
      admin,
    ),
    paid: charged,
  };

  const queued: Base = {
    ...base,
    resources: spendResources(base.resources, charged),
    trainingQueue: [...base.trainingQueue, order],
  };
  repos.bases.updateResources(queued.id, queued.resources);
  repos.bases.updateArmy(queued.id, queued.army, queued.trainingQueue);
  return { kind: 'queued', base: queued, order };
}

export function queueTraining(repos: Repositories, input: TrainInput): TrainingResult {
  const { base, unit, count, now, admin = false } = input;

  // Every gate below is stated as the rule and then filtered through `adminWaives`, so the rules
  // read the same in both modes and what the testing build actually waives is one list in
  // `admin/mode.ts` rather than an `if` on each line. `already_have_one` is not on it: a second
  // unique unit is a district that cannot be parsed, not a door.
  const refuse = (reason: TrainingRefusal): TrainingResult | null =>
    adminWaives(reason, admin) ? null : { kind: 'refused', reason };

  if (!isUnitUnlocked(unit, unlockContextFor(repos, base))) {
    const refused = refuse('locked');
    if (refused) return refused;
  }
  if (base.trainingQueue.length >= MAX_TRAINING_QUEUE) {
    const refused = refuse('queue_full');
    if (refused) return refused;
  }
  if (unit.unique && alreadyHolds(unit, base.army, base.trainingQueue) + count > 1) {
    return { kind: 'refused', reason: 'already_have_one' };
  }

  // §A4: the unit's own rates, so a worked Doghouse actually shows up on the Cyberhounds' bill.
  const rates = ratesForUnit(trainingRatesFor(repos, base, now), unit);
  // §A1: soldiers come out of the district's unit slots, alongside the officers and the placed
  // assignees. `districtUnitSlots` has already counted everything standing, garrisons and the
  // training bench included, so what this order needs is only what it adds on top.
  const slots = districtUnitSlots(repos, base);
  if (unit.unitSlots * count > slots.spare) {
    const refused = refuse('no_unit_slots');
    if (refused) return refused;
  }

  const cost = trainingCost(unit, count, rates.costPercent, rates.suppliesPercent);
  if (!canAfford(base.resources, cost)) {
    const refused = refuse('cannot_afford');
    if (refused) return refused;
  }

  const charged = adminCost(cost, admin);
  const order: TrainingOrder = {
    id: randomUUID(),
    unitId: unit.id,
    count,
    delivered: 0,
    startedAt: trainingStartsAt(base.trainingQueue, now).toISOString(),
    durationSeconds: adminSeconds(trainingSeconds(unit, count, rates.speedPercent), admin),
    // What was actually taken, so a refund is against the price paid rather than the price today.
    // A discount finished after the order was placed must not turn cancelling into a profit.
    paid: charged,
  };

  const queued: Base = {
    ...base,
    resources: spendResources(base.resources, charged),
    trainingQueue: [...base.trainingQueue, order],
  };
  repos.bases.updateResources(queued.id, queued.resources);
  repos.bases.updateArmy(queued.id, queued.army, queued.trainingQueue);

  return { kind: 'queued', base: queued, order };
}
