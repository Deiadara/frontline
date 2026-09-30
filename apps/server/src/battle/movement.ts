import { randomUUID } from 'node:crypto';
import {
  columnSpeed,
  emptyDeployment,
  fittedFor,
  fleetCapacity,
  leading,
  movementArrived,
  movementCancellable,
  movementForce,
  findDistrict,
  officerBattleStats,
  ridingUnitSlots,
  travelMinutesBetween,
  unitColumnSpeed,
  unitSlotsUsed,
  type Army,
  type Base,
  type BattleSide,
  type Commander,
  type CrewEffects,
  type Fleet,
  type Movement,
  type RailwayOffer,
  type ScheduledBattle,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { standingEffectsFor } from '../crew/standing.js';
import { railRideBetween } from '../city/railway.js';
import { tallyDeployed, tallyRailJourney } from '../feats/tally.js';
import { forceSize, mergeArmies } from './forces.js';
import { settleEach } from '../world/guard.js';
import { fightPlaceFor } from './alignment.js';
import { adminSeconds } from '../admin/mode.js';

/**
 * Columns on the road, and what happens when they stop walking (§A4).
 *
 * Three ends, and every one of them is a settle rather than a scheduler, the same as every other
 * clock in this game. None of them puts anybody anywhere without walking there (maintainer,
 * 2026-09-28: "Nothing sends units immediately, you need to move them"):
 *
 *   * **Arrived.** The column folds into the side's deployment and the row goes.
 *   * **Turned around.** Inside the first tenth of the walk: they walk back as far as they had
 *     come. They have not reached anybody's ring, so nothing is owed.
 *   * **Late.** The fight was run while they were still walking, or they land after its mark. They
 *     are not in it; they walk on to the place and land on whatever the fight left there
 *     (`moves/moves.ts`), which is the garrison of ground their crew now holds, a posting on an
 *     ally's, or nothing, and then home. A fight called off turns them round instead.
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
): number | null {
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

/**
 * The march, in whole minutes, or `null` for ground the map cannot price.
 *
 * The same reading `sendColumn` makes, exported so the quote and the send cannot disagree.
 *
 * `led` is why that sentence needed a parameter to stay true. `sendColumn` reads the deployment's
 * officer and folds `lead_arrival` into the road; this did not, so a crew that had named an officer
 * for the fight was quoted a march up to a tenth longer than the one its column actually walked.
 * The quote has the same row in hand, so it passes the same flag.
 */
export function columnMinutesTo(
  repos: Repositories,
  base: Base,
  toDistrictId: string,
  riding: { army: Army; vehicles: Fleet },
  led = false,
): number | null {
  const road = travelMsTo(
    repos,
    base,
    toDistrictId,
    { vehicles: riding.vehicles, force: riding.army },
    led,
  );
  return road === null ? null : Math.round(road / MINUTE_MS);
}

/**
 * The ride this column could take, or `null` when it is marching. The quote draws it; the send
 * takes it. One function, so the screen cannot offer a train the road would beat.
 */
export function railColumnOffer(
  repos: Repositories,
  base: Base,
  toDistrictId: string,
  riding: { army: Army; vehicles: Fleet },
  road: number,
  led = false,
): RailwayOffer | null {
  const standing = standingEffectsFor(repos, base);
  // The two walks at either end of a ride are roads, so the officer leading shortens them exactly
  // as they shorten the march. Left off the fold, `road` arrived here already led and the legs did
  // not, which tilted every ride-or-march comparison towards marching for the crews that had an
  // officer on the job.
  const effects = led ? leading(standing) : standing;
  const speed = columnSpeed(riding.vehicles, riding.army, (unitId) =>
    unitColumnSpeed(unitId, {
      percent: effects.unitSpeedPercent,
      fitted: fittedFor(base.unitLoadouts, unitId),
      anyRide: effects.anyRide,
    }),
  );
  return railRideBetween(
    repos,
    base,
    base.districtId,
    toDistrictId,
    riding,
    {
      speed,
      reductionPercent: effects.travelSpeedPercent,
      flatMinutesOff: effects.roadMinutesOff,
    },
    road,
  );
}

/**
 * The ride this column could take, in whole minutes, or `null` when it is marching.
 *
 * The railway carries a battle column as well as a unit move (maintainer, 2026-09-24: "moving
 * units around or to send them somewhere for battle"). Only the move path was built at first, so a
 * declared fight always walked however much of the line the crew held.
 *
 * Paced with the same fold the march is, because the two walks at either end of a ride are roads
 * like any other; only the fifteen minutes in the middle is a rule nothing speeds up. The
 * comparison against `road` is what stops a ride being offered that arrives later than the march,
 * which on two neighbouring districts it usually would.
 */
function railColumnMinutes(
  repos: Repositories,
  base: Base,
  toDistrictId: string,
  riding: { army: Army; vehicles: Fleet },
  road: number,
  led = false,
): number | null {
  return railColumnOffer(repos, base, toDistrictId, riding, road, led)?.minutes ?? null;
}

/**
 * The road on its own: what a group moving at `speed` takes to cross from this crew's district.
 *
 * Split out so everybody this crew sends to a fight is clocked against the same map and the same
 * holdings, and the only thing that differs between them is how the pace was arrived at.
 *
 * ## `null` rather than zero, for ground that is not on the map
 *
 * This returned **0** for an unknown district, and its own comment called that the honest answer
 * because there was no road to measure. It was honest only while the id was garbage. Zero is not
 * "no road", it is **instant arrival**, and the day a second city opened it would have been the
 * single worst line in the server: every column sent across the frontier would have teleported.
 *
 * It answers `null` now, and the three callers refuse rather than guessing. The lookup itself is
 * world-wide, so a real district in any city is found and priced properly (`city/geography.ts`
 * charges the frontier between two cities as a journey of its own).
 */
function roadMs(
  base: Base,
  districtId: string,
  speed: number,
  effects: CrewEffects,
): number | null {
  const from = findDistrict(base.districtId);
  const to = findDistrict(districtId);
  if (!from || !to) return null;
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
 * own `speed` off their sheet, which is the figure a spy job's walk is clocked with
 * (`spying/spying.ts`): sending the Head of Finance across the city is a slow night and sending
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
): number | null {
  const effects = standingEffectsFor(repos, base);
  const onFoot = officerBattleStats(officer.attributes).speed;
  const speed = columnSpeed(vehicles, { officer: 1 }, () => ({
    speed: onFoot,
    rides: true,
    unitSlots: 1,
  }));
  const road = roadMs(base, districtId, speed, effects);
  // The officer walks the same road the column does, so they refuse together. A leader who
  // arrived instantly at ground nothing can price was the same defect wearing a different hat.
  return road === null ? null : Math.round(road / MINUTE_MS);
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
    /** Ride Terminus's line if there is a ride to take. Optional, and marching is the default. */
    byRail?: boolean;
    /** Testing mode: the column arrives in five seconds, like every other clock (`admin/mode.ts`). */
    admin?: boolean;
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
  /*
   * Ground the map cannot price is ground no column is sent to.
   *
   * `travelMsTo` answered 0 for this and callers took it, which meant instant arrival. Throwing is
   * right here rather than returning a refusal: every caller of `sendColumn` has already checked
   * that the target district exists, so reaching this line is a bug upstream, and a column that
   * teleported into a battle is worse than a request that failed loudly.
   */
  if (travel === null) {
    throw new Error(`no road from ${input.base.districtId} to ${input.toDistrictId}`);
  }

  /*
   * The railway, if it was asked for and there is one to take (maintainer, 2026-09-24).
   *
   * The ruling put battle columns on the line beside unit moves, and only the moves were built.
   * `railColumnMinutes` answers `null` for every reason a ride is not on offer: no pair of held
   * platforms, the two ends in different cities, a party carrying machines, or a ride that would
   * arrive later than the march. Asking for a ride that is not running gets the march, which is
   * what a stale screen should get rather than a refusal.
   */
  const riding =
    input.byRail === true
      ? railColumnMinutes(
          repos,
          input.base,
          input.toDistrictId,
          {
            army: mergeArmies(input.army, input.perimeter),
            vehicles: committed?.vehicles ?? {},
          },
          travel / MINUTE_MS,
          committed?.officerId != null,
        )
      : null;
  // Admin mode flattens the march like every other clock (maintainer ruling, 2026-09-29).
  const clock =
    adminSeconds((riding === null ? travel : riding * MINUTE_MS) / 1000, input.admin === true) *
    1000;
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
    arrivesAt: new Date(input.now.getTime() + clock).toISOString(),
    byRail: riding !== null,
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
  /** Testing mode: a five-second column stays one whatever the yard adds (`sendColumn`). */
  admin = false,
): void {
  for (const movement of repos.movements.forBattle(battleId)) {
    if (movement.baseId !== base.id || movementArrived(movement, now)) continue;
    // A column on the train keeps the train's clock: machines never board (`railColumnOffer`), so
    // the yard has nothing to do with how soon it arrives, and the march clock would only delay it.
    if (movement.byRail === true) continue;
    const travel = travelMsTo(
      repos,
      base,
      movement.toDistrictId,
      { vehicles, force: movementForce(movement) },
      repos.sieges.deployment(battleId, movement.side, base.id)?.officerId != null,
    );
    // A column already on the road to ground the map cannot price is left exactly as it is.
    // Re-timing it is the only thing this does, and there is no new time to give it.
    if (travel === null) continue;
    const clock = adminSeconds(travel / 1000, admin) * 1000;
    const arrivesAt = Math.max(now.getTime(), Date.parse(movement.departedAt) + clock);
    repos.movements.put({ ...movement, arrivesAt: new Date(arrivesAt).toISOString() });
  }
}

/**
 * §C3: whether this set of machines would be sold twice over to this crew's columns still on the
 * road to the fight, which are the ones {@link retimeColumns} puts on it.
 *
 * Each column is re-timed on the whole set, so a seat one column fills is offered again to the
 * next (bug pass, 2026-09-29): a crew that sent the column in pieces and *then* loaded the yard,
 * or loaded five bikes and narrowed to one once the pieces were out, had one Scrappy at two seats
 * carry five separate one-Warden columns at its own speed. The deploy door caps a batch against
 * the seats (`battle/deploy.ts`); this is the check from the other door.
 *
 * What it counts is what the columns would *take*, each capped at the set: a single column larger
 * than the set is not refused, because it can only ever fill the seats once and the walkers left
 * over set its pace (`columnSpeed`). Only the columns still walking: whoever has landed rides
 * nothing, and a train carries its own. An empty set is the walk and has no ceiling.
 */
export function oversellsSeats(
  repos: Repositories,
  base: Base,
  battleId: string,
  side: BattleSide,
  vehicles: Fleet,
  now: Date,
): boolean {
  const seats = fleetCapacity(vehicles);
  if (seats === 0) return false;
  const { anyRide } = standingEffectsFor(repos, base, now);
  const taken = repos.movements
    .forBattle(battleId)
    .filter(
      (movement) =>
        movement.baseId === base.id &&
        movement.side === side &&
        movement.byRail !== true &&
        !movementArrived(movement, now),
    )
    .reduce(
      (total, movement) =>
        total + Math.min(seats, ridingUnitSlots(movementForce(movement), anyRide)),
      0,
    );
  return taken > seats;
}

/**
 * Every column that has landed, folded into the deployment it was walking to.
 *
 * Runs on the read path in front of anything that reads a deployment, which is the same contract
 * the location-upgrade and battle settlers have: a column that arrived while nobody was looking is on
 * the ground by the time the next request reads the row.
 */
export function settleMovements(repos: Repositories, now: Date): number {
  // Counted, so the world settle can tell every open tab a column landed. See `world/settle.ts`.
  const arrived = repos.movements
    .arrivedBy(now.toISOString())
    .filter((movement) => movementArrived(movement, now));
  // One transaction per column: its merge into the deployment and its removal are one fact, and
  // a throw between them used to land the same army again on the next tick (`world/guard.ts`).
  return settleEach(
    repos,
    'columns arriving',
    arrived,
    (movement) => movement.id,
    (movement) => {
      const battle = repos.sieges.find(movement.battleId);
      /*
       * Late: the fight is over, or the row is gone, or the column got there after the mark.
       *
       * The third case is the one a late tick opens. Deployment shuts a second before the mark, but
       * the settle that runs the fight is the *next* tick or read after it, and a server that was
       * asleep between the two folded in every column with `arrivesAt` up to `now`, including ones
       * that arrived after the hour the fight was called for. A fight is run with what was on the
       * ground at its mark and nothing that walked in afterwards. While that fight is still to be
       * run the column waits: the settle that runs it walks the column on (`carryOn`).
       */
      if (!battle) {
        turnRound(repos, movement, now);
        return;
      }
      if (battle.resolvedAt !== null) {
        carryOn(repos, movement, battle);
        return;
      }
      if (Date.parse(movement.arrivesAt) > Date.parse(battle.scheduledFor)) return;
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
      tallyColumnLanded(repos, movement);
    },
  );
}

/**
 * Feats: what this column put on the ground, counted now that it is standing there.
 *
 * Counted at the landing rather than at the muster (audit, 2026-09-28). A column can be turned
 * round in its first tenth and walks home in the time it had spent, so counting at the send let a
 * crew post two hundred Razors, recall them, and bank two hundred `bodies_deployed` (and a
 * `rail_journeys`) every few seconds without a fight anywhere. A column that arrives after the
 * mark, or whose fight is called off, never stood in the fight and adds nothing to the deployed
 * ladders; a late one that was on the train still counts its ride when it lands (`carryOn`).
 */
function tallyColumnLanded(repos: Repositories, movement: Movement): void {
  const force = movementForce(movement);
  tallyDeployed(repos, movement.baseId, {
    units: forceSize(force),
    unitSlots: unitSlotsUsed(force),
  });
  if (movement.byRail) tallyRailJourney(repos, movement.baseId);
}

/**
 * Turn a column round where it stands: it walks back as far as it had come.
 *
 * It used to go straight back onto the roster, which made calling a column off a way to bring it
 * home from halfway across the city in no time at all. Now it is a move home from the streets it
 * was heading for, on the clock of the ground it had covered. A column turned in the same instant
 * it was sent never left, and is simply home.
 */
export function turnRound(repos: Repositories, movement: Movement, now: Date): void {
  repos.movements.remove(movement.id);
  const base = repos.bases.findById(movement.baseId);
  if (!base) return;
  const force = movementForce(movement);
  const departed = Date.parse(movement.departedAt);
  const walked = Math.max(0, Math.min(Date.parse(movement.arrivesAt), now.getTime()) - departed);
  if (walked === 0) {
    repos.bases.updateArmy(base.id, mergeArmies(base.army, force), base.trainingQueue);
    return;
  }
  repos.moves.insert({
    id: randomUUID(),
    baseId: base.id,
    // The streets rather than the target: turned round again, they land somewhere with nothing to
    // stand on and walk home the whole way, rather than reaching the fight's ground in a tenth of
    // the time the road takes.
    from: { kind: 'street', districtId: movement.toDistrictId },
    to: { kind: 'district' },
    army: force,
    vehicles: {},
    departedAt: now.toISOString(),
    arrivesAt: new Date(now.getTime() + walked).toISOString(),
    travelMinutes: Math.max(1, Math.ceil(walked / MINUTE_MS)),
    recalledAt: null,
  });
}

/**
 * A column still walking when its fight was run goes on to the place and lands on what is there.
 *
 * The same walk, the same clock: it becomes an ordinary move to the fight's place
 * (`fightPlaceFor`), which lands it as any move lands (`moves/moves.ts`): on the garrison of
 * ground its crew now holds, as a posting on an ally's, on its own gate or in its own district,
 * or, on ground that will not have it, it turns and walks home from there.
 */
export function carryOn(repos: Repositories, movement: Movement, battle: ScheduledBattle): void {
  repos.movements.remove(movement.id);
  const base = repos.bases.findById(movement.baseId);
  if (!base) return;
  const departed = Date.parse(movement.departedAt);
  const arrives = Date.parse(movement.arrivesAt);
  repos.moves.insert({
    id: randomUUID(),
    baseId: base.id,
    from: { kind: 'district' },
    to: fightPlaceFor(battle, base),
    army: movementForce(movement),
    vehicles: {},
    departedAt: movement.departedAt,
    arrivesAt: movement.arrivesAt,
    travelMinutes: Math.max(1, Math.round((arrives - departed) / MINUTE_MS)),
    recalledAt: null,
    // Still on the train, so the ride is counted when this move lands (`moves/moves.ts`).
    byRail: movement.byRail === true,
  });
}

export type RecallRefusal = 'unknown_movement' | 'not_yours' | 'window_closed';

export type RecallResult =
  { kind: 'refused'; reason: RecallRefusal } | { kind: 'recalled'; movement: Movement };

/** §A4: call a column back, inside the first tenth of its walk. It walks back what it walked. */
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
  turnRound(repos, movement, now);
  return { kind: 'recalled', movement };
}

/** Anything still walking to a fight that has just been decided walks on to what it left. */
export function recallOvertaken(repos: Repositories, battle: ScheduledBattle): void {
  for (const movement of repos.movements.forBattle(battle.id)) carryOn(repos, movement, battle);
}
