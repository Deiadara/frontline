import { randomUUID } from 'node:crypto';
import {
  CITY_LOCATIONS,
  MAX_TRAINING_QUEUE,
  VEHICLES,
  buildingLevel,
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
} from '@frontline/shared';
import { adminCost, adminSeconds, adminWaives } from '../admin/mode.js';
import { standingEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { awardPlayerXp } from '../progression/award.js';
import { districtPopulation } from '../district/population.js';

/**
 * Making units (GDD §A5).
 *
 * The same lazy contract as everything else: orders carry an absolute clock frozen at order time,
 * and whatever has come due is applied the next time the crew is read.
 */

export const TRAINING_REFUSALS = [
  'unknown_unit',
  'locked',
  'queue_full',
  'already_have_one',
  'no_supply',
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
    // §D12a: thirteen units are behind a blueprint document, and the document lives in the satchel.
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
export function trainingRatesFor(repos: Repositories, base: Base): TrainingRates {
  const effects = standingEffectsFor(repos, base);
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
}

/**
 * Units that have finished training join the army at home.
 *
 * §I1 pays per *body*, at a rate priced off what that body takes to train.
 *
 * The two halves answer each other. Per body, because a batch hands its units over one at a time
 * and paying on whichever read caught the last one would make the reward depend on how often the
 * page was open. Priced off the unit's own clock, because per-body at a flat rate is what would
 * make the cheapest rabble the fastest way to level: a Razor is 45 seconds and a Colossus is an
 * hour and a half, and the curve is what stops the faucet without going back to per-order.
 */
export function settleTraining(repos: Repositories, base: Base, now: Date): TrainingSettlement {
  const { delivered, pending } = splitDueTraining(base.trainingQueue, now);
  if (delivered.length === 0) return { base, awards: [] };

  const army: Army = delivered.reduce(
    (into, batch) => addToArmy(into, batch.unitId, batch.count),
    base.army,
  );
  const settled: Base = { ...base, army, trainingQueue: pending };
  repos.bases.updateArmy(settled.id, settled.army, settled.trainingQueue);

  /*
   * §I1 pays per *body*, not per order.
   *
   * A batch hands its units over one at a time now, so paying an order's worth of XP on whichever
   * read happened to catch the last one would make the reward depend on how often the page was
   * open. One award per unit delivered is the same total whatever the polling does.
   */
  let carried = settled;
  const awards: PlayerXpAward[] = [];
  for (const batch of delivered) {
    // Priced off what one body of *this* unit takes on the bench, on the shared curve: a Razor is
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
  return { base: carried, awards };
}

export interface TrainInput {
  base: Base;
  unit: UnitSpec;
  count: number;
  now: Date;
  /**
   * Testing mode: five seconds on the bench, no materials (`admin/mode.ts`).
   *
   * The supply cap is *not* waived. A free army that ignores supply is not the game with the
   * waiting removed, it is a different game, and supply is one of the things a reviewer is here
   * to feel.
   */
  admin?: boolean;
}

/**
 * Puts a batch on the bench.
 *
 * Supply is claimed at **order** time, counting the queue as well as the standing army: a crew
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
  const rates = ratesForUnit(trainingRatesFor(repos, base), unit);
  // §A1: soldiers come out of the district's population, alongside the officers and the placed
  // assignees. `districtPopulation` has already counted everything standing, garrisons and the
  // training bench included, so what this order needs is only what it adds on top.
  const population = districtPopulation(repos, base);
  if (unit.supply * count > population.spare) {
    const refused = refuse('no_supply');
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
