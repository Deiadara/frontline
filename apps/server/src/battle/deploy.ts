import {
  deploymentIsOpen,
  emptyDeployment,
  mulberry32,
  perimeterToll,
  seedFrom,
  unitsBeyondNotoriety,
  type Army,
  type BattleDeployment,
  type BattleSide,
  type Base,
  type Movement,
  type ScheduledBattle,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { forceSize, mergeArmies, removeForce } from './forces.js';
import { sendColumn } from './movement.js';

/**
 * Moving people to a fight that has not happened yet (GDD §A4, battle rework).
 *
 * The board's rules, in order:
 *
 * - Anybody in the fight may send units **right up to one second before the mark**, and take them
 *   back again just as freely. Nothing is locked until the clock says so.
 * - Units on the ground have **left the roster**. That is what makes the freedom safe: a crew that
 *   promised the same twenty Razors to three fights would be discovering which one they turned up
 *   at, and the answer would be a bug rather than a decision.
 * - Pulling people back is **not free** if the other side has a ring out. The board asked for this
 *   explicitly: a perimeter takes anybody "pulled back after it was already deployed but taken out
 *   before combat itself". So a late withdrawal past a well-set ring costs bodies, and a crew that
 *   commits early is committing for real.
 *
 * The ring's toll on a withdrawal is drawn from a stream seeded on the battle *and the moment of the
 * pull-out*, so it is reproducible from the record and cannot be re-rolled by retrying the call.
 */

export const DEPLOY_REFUSALS = [
  'not_a_participant',
  'deployment_closed',
  'not_enough_units',
  'needs_infamy',
] as const;
export type DeployRefusal = (typeof DEPLOY_REFUSALS)[number];

export interface DeployInput {
  base: Base;
  battle: ScheduledBattle;
  side: BattleSide;
  /** Positive sends units to the ground; negative brings them home. */
  changes: Record<string, number>;
  perimeterChanges: Record<string, number>;
  now: Date;
}

export interface DeployOutcome {
  base: Base;
  deployment: BattleDeployment;
  /** Bodies the enemy's ring took off a withdrawal. Empty in the ordinary case. */
  lostOnTheWayOut: Army;
  /** The column that just set out, or null when this call only brought people home. */
  departed: Movement | null;
}

export type DeployResult =
  { kind: 'refused'; reason: DeployRefusal } | ({ kind: 'ok' } & DeployOutcome);

/** The ring the other side currently has standing outside this fight. */
function enemyRing(repos: Repositories, battle: ScheduledBattle, side: BattleSide): Army {
  const other = side === 'attacker' ? 'defender' : 'attacker';
  return repos.sieges.deployment(battle.id, other)?.perimeter ?? {};
}

export function adjustDeployment(repos: Repositories, input: DeployInput): DeployResult {
  const { base, battle, side, now } = input;

  if (!deploymentIsOpen(new Date(battle.scheduledFor), now)) {
    return { kind: 'refused', reason: 'deployment_closed' };
  }

  const at = now.toISOString();
  const existing =
    repos.sieges.deployment(battle.id, side) ?? emptyDeployment(battle.id, base.id, side, at);
  if (existing.baseId !== null && existing.baseId !== base.id) {
    return { kind: 'refused', reason: 'not_a_participant' };
  }

  // §D7: the heaviest things on the roster will not take a contract from a nobody. Checked across
  // both forces at once so a crew cannot slip a legend onto the ring instead of into the line.
  const sending = [input.changes, input.perimeterChanges].reduce<Army>(
    (total, changes) => ({
      ...total,
      ...Object.fromEntries(
        Object.entries(changes)
          .filter(([, delta]) => delta > 0)
          .map(([unitId, delta]) => [unitId, (total[unitId] ?? 0) + delta]),
      ),
    }),
    {},
  );
  if (unitsBeyondNotoriety(sending, base.economy.notoriety).length > 0) {
    return { kind: 'refused', reason: 'needs_infamy' };
  }

  let army = base.army;
  let onTheGround = { ...existing.army };
  let ring = { ...existing.perimeter };
  const pulled: Army = {};
  /*
   * What is *setting out* rather than what is arriving.
   *
   * A positive delta takes the units off the roster here and puts them in a column
   * (`battle/movement.ts`); they join the deployment when they get there. A negative delta is the
   * old, immediate withdrawal: those units are already standing on the ground.
   */
  const departing = { army: {} as Army, perimeter: {} as Army };

  const move = (
    changes: Record<string, number>,
    force: Army,
    outbound: 'army' | 'perimeter',
  ): Army | DeployRefusal => {
    let next = { ...force };
    for (const [unitId, delta] of Object.entries(changes)) {
      if (delta === 0) continue;
      if (delta > 0) {
        if ((army[unitId] ?? 0) < delta) return 'not_enough_units';
        army = removeForce(army, { [unitId]: delta });
        departing[outbound] = mergeArmies(departing[outbound], { [unitId]: delta });
      } else {
        const back = Math.min(-delta, next[unitId] ?? 0);
        if (back === 0) continue;
        next = removeForce(next, { [unitId]: back });
        pulled[unitId] = (pulled[unitId] ?? 0) + back;
      }
    }
    return next;
  };

  const movedArmy = move(input.changes, onTheGround, 'army');
  if (typeof movedArmy === 'string') return { kind: 'refused', reason: movedArmy };
  onTheGround = movedArmy;

  const movedRing = move(input.perimeterChanges, ring, 'perimeter');
  if (typeof movedRing === 'string') return { kind: 'refused', reason: movedRing };
  ring = movedRing;

  // The ring's bite on the way out. Seeded on the battle and the moment of the pull-out so the same
  // withdrawal always costs the same, and a retried request cannot shop for a better roll.
  let lostOnTheWayOut: Army = {};
  if (forceSize(pulled) > 0) {
    const next = mulberry32(seedFrom(`${battle.id}:withdraw:${at}`));
    const { caught, escaped } = perimeterToll(pulled, enemyRing(repos, battle, side), next);
    lostOnTheWayOut = caught;
    army = mergeArmies(army, escaped);
  }

  // On the road. Nothing joins the deployment on this request: `settleMovements` does that when
  // the column lands, which is what makes sending early a commitment and sending late a gamble.
  const walking =
    forceSize(departing.army) + forceSize(departing.perimeter) > 0
      ? sendColumn(repos, {
          base,
          battleId: battle.id,
          side,
          toDistrictId: battle.target.districtId,
          army: departing.army,
          perimeter: departing.perimeter,
          now,
        })
      : null;

  const deployment: BattleDeployment = {
    ...existing,
    baseId: base.id,
    army: onTheGround,
    perimeter: ring,
    updatedAt: at,
  };
  repos.sieges.putDeployment(deployment);

  const next: Base = { ...base, army };
  repos.bases.updateArmy(next.id, next.army, next.trainingQueue);
  return { kind: 'ok', base: next, deployment, lostOnTheWayOut, departed: walking };
}

/** Which side of a fight this crew is on, or null when they are watching it. */
export function sideOf(
  repos: Repositories,
  battle: ScheduledBattle,
  baseId: string,
): BattleSide | null {
  if (battle.attackerBaseId === baseId) return 'attacker';
  const defending = repos.sieges.deployment(battle.id, 'defender');
  if (defending?.baseId === baseId) return 'defender';
  if (battle.defender.kind === 'faction' && battle.defender.baseId === baseId) return 'defender';
  return null;
}
