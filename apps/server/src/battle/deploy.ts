import {
  capRating,
  effectiveSpeed,
  findUnit,
  fittedFor,
  fleetCapacity,
  ridingUnitSlots,
  upgradedStats,
  unitSlotsUsed,
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
  type LineRules,
  type ScheduledBattle,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { forceSize, isFightingForce, mergeArmies, removeForce } from './forces.js';
import { tallyDeployed } from '../feats/tally.js';
import { defendingBaseOf } from './ground.js';
import { sideForce } from './side.js';
import { sendColumn } from './movement.js';
import { standingEffectsFor } from '../crew/standing.js';

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
 * - Pulling people back is **not free** if the other side has a ring out. The maintainer asked for this
 *   explicitly: a perimeter takes anybody "pulled back after it was already deployed but taken out
 *   before combat itself". So a late withdrawal past a well-set ring costs units, and a crew that
 *   commits early is committing for real.
 *
 * The ring's toll on a withdrawal is drawn from a stream seeded on the battle *and the moment of the
 * pull-out*, so it is reproducible from the record and cannot be re-rolled by retrying the call.
 */

export const DEPLOY_REFUSALS = [
  'not_a_participant',
  'deployment_closed',
  'not_enough_units',
  /** §A5: a porter is not a soldier. The support tier may never be deployed to a battle. */
  'not_a_fighting_force',
  'needs_infamy',
  /** §C3: the machines this crew has committed cannot seat what it is trying to send. */
  'no_seats',
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
  /** Units the enemy's ring took off a withdrawal. Empty in the ordinary case. */
  lostOnTheWayOut: Army;
  /** The column that just set out, or null when this call only brought people home. */
  departed: Movement | null;
}

export type DeployResult =
  { kind: 'refused'; reason: DeployRefusal } | ({ kind: 'ok' } & DeployOutcome);

/**
 * The ring the other side currently has standing outside this fight.
 *
 * The whole other side, allies included: a perimeter is what you would have to get past, and it
 * does not matter to the crew walking into it whose name is on each unit.
 */
function enemyRing(repos: Repositories, battle: ScheduledBattle, side: BattleSide): Army {
  const other = side === 'attacker' ? 'defender' : 'attacker';
  return sideForce(repos, battle.id, other, battle.scheduledFor).perimeter;
}

export function adjustDeployment(repos: Repositories, input: DeployInput): DeployResult {
  const { base, battle, side, now } = input;

  if (!deploymentIsOpen(new Date(battle.scheduledFor), now)) {
    return { kind: 'refused', reason: 'deployment_closed' };
  }

  const at = now.toISOString();
  const existing =
    repos.sieges.deployment(battle.id, side, base.id) ??
    emptyDeployment(battle.id, base.id, side, at);
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

  /*
   * Read once, here, rather than three times further down.
   *
   * The seat check and the ring's toll each opened their own read of the same crew, and the
   * fighting-force gate below needs a third: `carriers_fight` is a crew effect, so whether a
   * porter may be sent at all is a question about this crew and not about the catalogue.
   */
  const effects = standingEffectsFor(repos, base, now);
  const lineRules: LineRules = { carriersFight: effects.carriersFight, unitMarks: {} };

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
      /*
       * A key that does not name a fighting unit is refused, whichever direction it goes.
       *
       * The check used to sit inside the `delta > 0` branch only, so a *withdrawal* naming
       * `constructor` or `toString` reached `force[unitId]`, which on a plain object is a function
       * rather than `undefined`: `Math.min(-delta, fn)` is `NaN`, the `back === 0` guard does not
       * catch `NaN`, and the roster took a `NaN` count. `DeployRequestSchema` now keys on the unit
       * id so nothing like that arrives, and this is the second lock: a handler that reads a key
       * off an object should be the one deciding which keys it will read.
       *
       * Asked through `isFightingForce` rather than `isCombatUnit` so this door reads the same
       * rule the engine's rounds do: a crew holding `carriers_fight` may send its porters.
       */
      if (!isFightingForce({ [unitId]: 1 }, lineRules)) return 'not_a_fighting_force';
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

  /*
   * §C3: the seats are the ceiling, and they are the ceiling here rather than only in the browser.
   *
   * The deploy window has capped a batch by unit slots since 2026-09-15 ("once you choose vehicles
   * you're limited up to that much"), and the route took whatever was posted: the rule was a piece
   * of the client, which is to say not a rule. Checked on the whole muster rather than on the
   * batch, because the ceiling is about what will be standing there when the clock runs out, and
   * skipped entirely when nothing is loaded, which is the walk and has no ceiling.
   *
   * Priced through `ridingUnitSlots` and `fleetCapacity`, the same two functions the window and
   * the settler use, so there is one arithmetic and not three that agree by inspection.
   */
  const seats = fleetCapacity(existing.vehicles);
  if (seats > 0) {
    const aboard = ridingUnitSlots(
      mergeArmies(mergeArmies(onTheGround, ring), mergeArmies(departing.army, departing.perimeter)),
      effects.anyRide,
    );
    if (aboard > seats) return { kind: 'refused', reason: 'no_seats' };
  }

  // The ring's bite on the way out. Seeded on the battle and the moment of the pull-out so the same
  // withdrawal always costs the same, and a retried request cannot shop for a better roll.
  let lostOnTheWayOut: Army = {};
  if (forceSize(pulled) > 0) {
    const next = mulberry32(seedFrom(`${battle.id}:withdraw:${at}`));
    /*
     * The sheet the crew actually fields, not the catalogue's.
     *
     * Speed and stealth decide who slips a ring, and `rout.ts` reads both off the effective stack
     * while this read the printed spec: a Ghost Wrap bolted on in the yard moved the odds of
     * getting away from a lost fight and nothing at all for the same units walking out of the
     * deployment a day earlier.
     */
    const { caught, escaped } = perimeterToll(
      pulled,
      enemyRing(repos, battle, side),
      next,
      (unitId: string) => {
        const printed = findUnit(unitId)?.stats;
        // Unreachable in practice: `move` refuses anything that is not a combat unit before this
        // runs. Answered rather than asserted because a sheet nobody can find is one nobody can
        // catch either, which is what `catchChance` does with it.
        if (!printed) return { speed: 0, stealth: 0 };
        const fitted = upgradedStats(printed, fittedFor(base.unitLoadouts, unitId));
        return {
          speed: effectiveSpeed(fitted.speed, { percent: effects.unitSpeedPercent }),
          stealth: capRating(Math.round(fitted.stealth * (1 + effects.unitStealthPercent / 100))),
        };
      },
    );
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
  /*
   * Feats: what this crew has ever put on the ground (maintainer request, 2026-09-13).
   *
   * `sending` is the positive half of both change sets, so pulling people back counts for nothing
   * and adding to a muster twice counts twice. Both are right: the ladder asks how much has ever
   * been committed, and a crew that withdrew and re-committed did commit twice.
   *
   * Counted here, at the muster, rather than when the fight resolves. That is when the decision
   * was made, and a fight later called off still cost the crew the days its people spent standing
   * on somebody else's street.
   */
  tallyDeployed(repos, base.id, { units: forceSize(sending), unitSlots: unitSlotsUsed(sending) });
  return { kind: 'ok', base: next, deployment, lostOnTheWayOut, departed: walking };
}

/** Which side of a fight this crew is on, or null when they are watching it. */
export function sideOf(
  repos: Repositories,
  battle: ScheduledBattle,
  baseId: string,
): BattleSide | null {
  if (battle.attackerBaseId === baseId) return 'attacker';
  /*
   * Anybody with a row on a side is on that side, which includes an ally who came to help rather
   * than only the two crews the declaration names.
   *
   * The defending half of this was here; the attacking half was not, and `/factions/reinforce`
   * puts an ally on *either* side. So a crew that sent units to a friend's attack was told "You are
   * not in that fight" by `/battles/deploy` and `/battles/withdraw`, could not take those units
   * back out through the ordinary screen (which is the route the reinforce endpoint's own comment
   * says is the way to do it), and the fight did not appear on their battle board at all.
   */
  if (repos.sieges.side(battle.id, 'attacker').some((row) => row.baseId === baseId)) {
    return 'attacker';
  }
  if (repos.sieges.side(battle.id, 'defender').some((row) => row.baseId === baseId)) {
    return 'defender';
  }
  /*
   * And the crew the call was *on*, which is not always the party on the plate.
   *
   * This read `battle.defender` alone, which for residential ground is `unoccupied`: a home
   * district holds no locations, so nobody "holds" it in the control table however plainly
   * somebody lives there. Meanwhile the settler assembles the defence from `defendingBaseOf`, the
   * red mark counts the same way, and the report names the same crew. So the one crew whose whole
   * roster was about to fight, and be written back over, was told `You are not in this one.` and
   * refused by this module's own deploy route. Asking the same question the settler asks is the
   * whole fix.
   */
  return defendingBaseOf(repos, battle)?.id === baseId ? 'defender' : null;
}
