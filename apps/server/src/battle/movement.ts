import { randomUUID } from 'node:crypto';
import {
  CITY_DISTRICTS,
  columnSpeed,
  emptyDeployment,
  fittedFor,
  leading,
  movementArrived,
  movementCancellable,
  movementForce,
  officerBattleStats,
  travelMinutesBetween,
  unitColumnSpeed,
  type Army,
  type Base,
  type BattleSide,
  type Commander,
  type CrewEffects,
  type Fleet,
  type Movement,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { standingEffectsFor } from '../crew/standing.js';
import { mergeArmies } from './forces.js';

/**
 * Columns on the road, and what happens when they stop walking (§A4).
 *
 * Three ends, and every one of them is a settle rather than a scheduler, the same as every other
 * clock in this game:
 *
 *   * **Arrived.** The column folds into the side's deployment and the row goes.
 *   * **Turned around.** Inside the first tenth of the walk, the units go straight back onto the
 *     roster: they have not reached anybody's ring, so nothing is owed.
 *   * **Overtaken.** The fight resolved while they were still walking, so they turn around too. A
 *     column that arrives at a finished battle is not a state the game should be able to reach.
 */

const MINUTE_MS = 60_000;

/**
 * How long it takes this crew to reach the fight, in milliseconds.
 *
 * §C3, and it is two different numbers rather than one sum. The **column's speed** is what the
 * slowest group in it moves at: every unit type on its own sheet, and everybody in a machine on
 * that machine's (`columnSpeed`). The crew's **travel reduction** is what its holdings take off
 * whatever clock that produced. A yard full of bikes and a column of four hundred is four people
 * on bikes and everybody else walking, and the column arrives when the walkers do.
 *
 * The machines are counted here rather than in `standingEffectsFor` because what a vehicle is worth
 * depends on who is in it, and that is a fact about this column rather than about the base.
 */
export function travelMsTo(
  repos: Repositories,
  base: Base,
  districtId: string,
  /** What this crew is taking to the fight, and who is in this column. */
  riding: { vehicles: Fleet; force: Army } = { vehicles: {}, force: {} },
  /**
   * §D5: whether an officer is leading this one, which shortens the road (`lead_arrival`).
   *
   * `leading()` folds that channel into `travelSpeedPercent`, and nothing on this path called it:
   * the fold was spent at settlement, where neither travel channel is read, so a perk whose whole
   * promise is "off the road while leading" paid on a mission and did nothing at all on a declared
   * fight. The same column, the same perk, two answers depending on which screen sent it.
   */
  led = false,
): number {
  const standing = standingEffectsFor(repos, base);
  const effects = led ? leading(standing) : standing;
  const speed = columnSpeed(riding.vehicles, riding.force, (unitId) =>
    unitColumnSpeed(unitId, {
      percent: effects.unitSpeedPercent,
      // The same sheet the fight will read (`battle/effects.ts`). A Neural Lace is twelve points
      // of speed and the workshop fits it to a unit type, so the road has to fold it the way the
      // engine does or the same unit is quicker in the fight than on the way to it.
      fitted: fittedFor(base.unitLoadouts, unitId),
      // The crew's `any_ride` holding, so the Colossus that used to hold the whole column to 15
      // takes a seat like everybody else (`city/locations.ts`).
      anyRide: effects.anyRide,
    }),
  );
  return roadMs(base, districtId, speed, effects);
}

/**
 * The road on its own: what a group moving at `speed` takes to cross from this crew's district.
 *
 * Split out so everybody this crew sends to a fight is clocked against the same map and the same
 * holdings, and the only thing that differs between them is how the pace was arrived at. Zero for
 * a district that is not on the map, which is what the column did before and is the honest answer:
 * there is no road to measure.
 */
/**
 * The pace of a column of this crew's, machines and cards folded in, on the standing fold: the
 * same reading `travelMsTo` makes for a road to a fight, for a road between the crew's own places
 * (`moves/moves.ts`).
 */
export function columnSpeedFor(
  repos: Repositories,
  base: Base,
  riding: { vehicles: Fleet; force: Army },
): number {
  const effects = standingEffectsFor(repos, base);
  return columnSpeed(riding.vehicles, riding.force, (unitId) =>
    unitColumnSpeed(unitId, {
      percent: effects.unitSpeedPercent,
      fitted: fittedFor(base.unitLoadouts, unitId),
      anyRide: effects.anyRide,
    }),
  );
}

function roadMs(base: Base, districtId: string, speed: number, effects: CrewEffects): number {
  const from = CITY_DISTRICTS.find((district) => district.id === base.districtId);
  const to = CITY_DISTRICTS.find((district) => district.id === districtId);
  if (!from || !to) return 0;
  return (
    travelMinutesBetween(from, to, {
      speed,
      reductionPercent: effects.travelSpeedPercent,
      flatMinutesOff: effects.roadMinutesOff,
    }) * MINUTE_MS
  );
}

/**
 * §D1: how long the officer named to lead takes to reach the fight, in whole minutes.
 *
 * A column of one, through the same two functions a column goes through. The pace is the officer's
 * own `speed` off their sheet, which is the figure a scouting run is already clocked with
 * (`scouting/scouting.ts`): sending the Head of Finance across the city is a slow night and sending
 * somebody quick is not. `columnSpeed` then offers them a seat in whatever this crew has committed
 * to this fight, so they ride when a machine is quicker than their legs and walk when it is not,
 * which is the rule the rest of the yard follows.
 *
 * They do not take a seat off the column. One officer at one unit slot against a machine that
 * carries two to thirty is not a loading decision, and charging it would make naming a leader
 * quietly slow the army down.
 */
export function officerTravelMinutesTo(
  repos: Repositories,
  base: Base,
  districtId: string,
  officer: Commander,
  vehicles: Fleet,
): number {
  const effects = standingEffectsFor(repos, base);
  const onFoot = officerBattleStats(officer.attributes).speed;
  const speed = columnSpeed(vehicles, { officer: 1 }, () => ({
    speed: onFoot,
    rides: true,
    unitSlots: 1,
  }));
  return Math.round(roadMs(base, districtId, speed, effects) / MINUTE_MS);
}

/** Puts a column on the road. Callers have already taken the units off the roster. */
export function sendColumn(
  repos: Repositories,
  input: {
    base: Base;
    battleId: string;
    side: BattleSide;
    toDistrictId: string;
    army: Record<string, number>;
    perimeter: Record<string, number>;
    now: Date;
  },
): Movement {
  /*
   * §C3: this column rides on whatever the crew has committed to this fight.
   *
   * Read off the deployment rather than off the base, because a machine that has been named for a
   * battle has left the Garage: it is not available to a second column going somewhere else, and
   * a column sent before any machine was picked walks, which is the honest answer.
   */
  const committed = repos.sieges.deployment(input.battleId, input.side, input.base.id);
  const travel = travelMsTo(
    repos,
    input.base,
    input.toDistrictId,
    {
      vehicles: committed?.vehicles ?? {},
      force: mergeArmies(input.army, input.perimeter),
    },
    // The row is already in hand, and naming an officer is what buys the shorter road.
    committed?.officerId != null,
  );
  const movement: Movement = {
    id: randomUUID(),
    baseId: input.base.id,
    battleId: input.battleId,
    side: input.side,
    fromDistrictId: input.base.districtId,
    toDistrictId: input.toDistrictId,
    army: input.army,
    perimeter: input.perimeter,
    departedAt: input.now.toISOString(),
    arrivesAt: new Date(input.now.getTime() + travel).toISOString(),
  };
  repos.movements.put(movement);
  return movement;
}

/**
 * §C3: the machines caught the column up.
 *
 * A column's clock is set when it leaves, off whatever the crew had committed to the fight by
 * then. The picker is on the same screen as the deploy and nothing orders the two, so a crew that
 * sent the column and *then* loaded the yard onto it was walking at the old pace with the machines
 * sitting on the deployment row doing nothing. Re-timed from departure rather than from now, so
 * the ground already covered counts once: a column that would have arrived by now on the new
 * clock arrives now, and a narrower set lengthens the walk the same way it would have shortened it.
 */
export function retimeColumns(
  repos: Repositories,
  base: Base,
  battleId: string,
  vehicles: Fleet,
  now: Date,
): void {
  for (const movement of repos.movements.forBattle(battleId)) {
    if (movement.baseId !== base.id || movementArrived(movement, now)) continue;
    const travel = travelMsTo(
      repos,
      base,
      movement.toDistrictId,
      { vehicles, force: movementForce(movement) },
      repos.sieges.deployment(battleId, movement.side, base.id)?.officerId != null,
    );
    const arrivesAt = Math.max(now.getTime(), Date.parse(movement.departedAt) + travel);
    repos.movements.put({ ...movement, arrivesAt: new Date(arrivesAt).toISOString() });
  }
}

/**
 * Every column that has landed, folded into the deployment it was walking to.
 *
 * Runs on the read path in front of anything that reads a deployment, which is the same contract
 * the fortification and battle settlers have: a column that arrived while nobody was looking is on
 * the ground by the time the next request reads the row.
 */
export function settleMovements(repos: Repositories, now: Date): number {
  // Counted, so the world settle can tell every open tab a column landed. See `world/settle.ts`.
  let landed = 0;
  for (const movement of repos.movements.arrivedBy(now.toISOString())) {
    if (!movementArrived(movement, now)) continue;
    landed += 1;
    const battle = repos.sieges.find(movement.battleId);
    /*
     * Overtaken: the fight is over, or the row is gone, or the column got there after the mark.
     * Send them home rather than onto a battlefield that no longer exists.
     *
     * The third case is the one a late tick opens. Deployment shuts a second before the mark, but
     * the settle that runs the fight is the *next* tick or read after it, and a server that was
     * asleep between the two folded in every column with `arrivesAt` up to `now`, including ones
     * that arrived after the hour the fight was called for. A fight is run with what was on the
     * ground at its mark and nothing that walked in afterwards.
     */
    if (
      !battle ||
      battle.resolvedAt !== null ||
      Date.parse(movement.arrivesAt) > Date.parse(battle.scheduledFor)
    ) {
      returnHome(repos, movement);
      continue;
    }
    // This crew's own row on that side, not the side as a whole: an ally's column arriving at your
    // battle joins *their* deployment, which is what sends their survivors back to them.
    const existing =
      repos.sieges.deployment(movement.battleId, movement.side, movement.baseId) ??
      emptyDeployment(movement.battleId, movement.baseId, movement.side, movement.arrivesAt);
    repos.sieges.putDeployment({
      ...existing,
      baseId: movement.baseId,
      army: mergeArmies(existing.army, movement.army),
      perimeter: mergeArmies(existing.perimeter, movement.perimeter),
      updatedAt: movement.arrivesAt,
    });
    repos.movements.remove(movement.id);
  }
  return landed;
}

/** Turn a column around: the units go back onto the roster and the row goes. */
export function returnHome(repos: Repositories, movement: Movement): void {
  const base = repos.bases.findById(movement.baseId);
  if (base) {
    const army = mergeArmies(base.army, movementForce(movement));
    repos.bases.updateArmy(base.id, army, base.trainingQueue);
  }
  repos.movements.remove(movement.id);
}

export type RecallRefusal = 'unknown_movement' | 'not_yours' | 'window_closed';

export type RecallResult =
  { kind: 'refused'; reason: RecallRefusal } | { kind: 'recalled'; movement: Movement };

/** §A4: call a column back, inside the first tenth of its walk. */
export function recallColumn(
  repos: Repositories,
  base: Base,
  movementId: string,
  now: Date,
): RecallResult {
  const movement = repos.movements.find(movementId);
  if (!movement) return { kind: 'refused', reason: 'unknown_movement' };
  if (movement.baseId !== base.id) return { kind: 'refused', reason: 'not_yours' };
  if (!movementCancellable(movement, now)) return { kind: 'refused', reason: 'window_closed' };
  returnHome(repos, movement);
  return { kind: 'recalled', movement };
}

/** Anything still walking to a fight that has just been decided comes home. */
export function recallOvertaken(repos: Repositories, battleId: string): void {
  for (const movement of repos.movements.forBattle(battleId)) returnHome(repos, movement);
}
