import { randomUUID } from 'node:crypto';
import {
  CITY_LOCATIONS,
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
  trainingCost,
  trainingSeconds,
  trainingStartsAt,
  type Army,
  type Base,
  type PlayerXpAward,
  type TrainingOrder,
  type UnitSpec,
  type UnlockContext,
} from '@frontline/shared';
import { adminCost, adminSeconds, adminWaives } from '../admin/mode.js';
import { standingEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { awardPlayerXp } from '../progression/award.js';

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
    heldPlaceKinds: heldPlaceKindsOf(CITY_LOCATIONS, (locationId) => {
      const control = controls.get(locationId);
      return control !== undefined && isHeldBy(control, base.id);
    }),
  };
}

export interface TrainingSettlement {
  base: Base;
  /** §I1 — one award per batch that landed. Empty on a read that finished nothing. */
  awards: PlayerXpAward[];
}

/**
 * Units that have finished training join the army at home.
 *
 * §I1 pays per *batch*, not per body. Paying per unit would make the cheapest rabble the fastest
 * way to level and turn the roster into an XP faucet; paying per order prices the wait rather than
 * the headcount, which is the thing the player actually spent.
 */
export function settleTraining(repos: Repositories, base: Base, now: Date): TrainingSettlement {
  const { due, pending } = splitDueTraining(base.trainingQueue, now);
  if (due.length === 0) return { base, awards: [] };

  const army: Army = due.reduce(
    (into, order) => addToArmy(into, order.unitId, order.count),
    base.army,
  );
  const settled: Base = { ...base, army, trainingQueue: pending };
  repos.bases.updateArmy(settled.id, settled.army, settled.trainingQueue);

  let carried = settled;
  const awards: PlayerXpAward[] = [];
  for (const _order of due) {
    const { base: progressed, award } = awardPlayerXp(repos, carried, 'unitTrained');
    carried = progressed;
    awards.push(award);
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
   * waiting removed, it is a different game — and supply is one of the things a reviewer is here
   * to feel.
   */
  admin?: boolean;
}

/**
 * Puts a batch on the bench.
 *
 * Supply is claimed at **order** time, counting the queue as well as the standing army — a crew
 * cannot queue five Colossi against a cap that holds one and discover the problem an hour later.
 */
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

  const effects = standingEffectsFor(repos, base);
  const cap = armyCapacity(base.buildings);
  const claimed = supplyUsed(base.army) + supplyQueued(base.trainingQueue) + unit.supply * count;
  if (claimed > cap) {
    const refused = refuse('no_supply');
    if (refused) return refused;
  }

  const cost = trainingCost(unit, count, effects.trainingCostPercent);
  if (!canAfford(base.resources, cost)) {
    const refused = refuse('cannot_afford');
    if (refused) return refused;
  }

  const order: TrainingOrder = {
    id: randomUUID(),
    unitId: unit.id,
    count,
    startedAt: trainingStartsAt(base.trainingQueue, now).toISOString(),
    durationSeconds: adminSeconds(
      trainingSeconds(unit, count, effects.trainingSpeedPercent),
      admin,
    ),
  };

  const queued: Base = {
    ...base,
    resources: spendResources(base.resources, adminCost(cost, admin)),
    trainingQueue: [...base.trainingQueue, order],
  };
  repos.bases.updateResources(queued.id, queued.resources);
  repos.bases.updateArmy(queued.id, queued.army, queued.trainingQueue);

  return { kind: 'queued', base: queued, order };
}
