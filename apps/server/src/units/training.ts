import { randomUUID } from 'node:crypto';
import {
  CITY_PLACES,
  MAX_TRAINING_QUEUE,
  addToArmy,
  alreadyHolds,
  armyCapacity,
  canAfford,
  heldPlaceKindsOf,
  isHeldBy,
  isUnitUnlocked,
  spendResources,
  splitDueTraining,
  supplyQueued,
  supplyUsed,
  territoryEffectsFor,
  trainingCost,
  trainingSeconds,
  trainingStartsAt,
  type Army,
  type Base,
  type TrainingOrder,
  type UnitSpec,
  type UnlockContext,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

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

/** What this crew's territory does to unlocks — the place kinds it currently holds. */
export function unlockContextFor(repos: Repositories, base: Base): UnlockContext {
  const controls = repos.city.controls();
  return {
    buildings: base.buildings,
    heldPlaceKinds: heldPlaceKindsOf(CITY_PLACES, (placeId) => {
      const control = controls.get(placeId);
      return control !== undefined && isHeldBy(control, base.id);
    }),
  };
}

/** Units that have finished training join the army at home. */
export function settleTraining(repos: Repositories, base: Base, now: Date): Base {
  const { due, pending } = splitDueTraining(base.trainingQueue, now);
  if (due.length === 0) return base;

  const army: Army = due.reduce(
    (into, order) => addToArmy(into, order.unitId, order.count),
    base.army,
  );
  const settled: Base = { ...base, army, trainingQueue: pending };
  repos.bases.updateArmy(settled.id, settled.army, settled.trainingQueue);
  return settled;
}

export interface TrainInput {
  base: Base;
  unit: UnitSpec;
  count: number;
  now: Date;
}

/**
 * Puts a batch on the bench.
 *
 * Supply is claimed at **order** time, counting the queue as well as the standing army — a crew
 * cannot queue five Colossi against a cap that holds one and discover the problem an hour later.
 */
export function queueTraining(repos: Repositories, input: TrainInput): TrainingResult {
  const { base, unit, count, now } = input;

  if (!isUnitUnlocked(unit, unlockContextFor(repos, base))) {
    return { kind: 'refused', reason: 'locked' };
  }
  if (base.trainingQueue.length >= MAX_TRAINING_QUEUE) {
    return { kind: 'refused', reason: 'queue_full' };
  }
  if (unit.unique && alreadyHolds(unit, base.army, base.trainingQueue) + count > 1) {
    return { kind: 'refused', reason: 'already_have_one' };
  }

  const effects = territoryEffectsFor(base.id, CITY_PLACES, repos.city.controls());
  const cap = armyCapacity(base.buildings);
  const claimed = supplyUsed(base.army) + supplyQueued(base.trainingQueue) + unit.supply * count;
  if (claimed > cap) return { kind: 'refused', reason: 'no_supply' };

  const cost = trainingCost(unit, count, effects.trainingCostPercent);
  if (!canAfford(base.resources, cost)) return { kind: 'refused', reason: 'cannot_afford' };

  const order: TrainingOrder = {
    id: randomUUID(),
    unitId: unit.id,
    count,
    startedAt: trainingStartsAt(base.trainingQueue, now).toISOString(),
    durationSeconds: trainingSeconds(unit, count, effects.trainingSpeedPercent),
  };

  const queued: Base = {
    ...base,
    resources: spendResources(base.resources, cost),
    trainingQueue: [...base.trainingQueue, order],
  };
  repos.bases.updateResources(queued.id, queued.resources);
  repos.bases.updateArmy(queued.id, queued.army, queued.trainingQueue);

  return { kind: 'queued', base: queued, order };
}
