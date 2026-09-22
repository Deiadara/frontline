import { randomUUID } from 'node:crypto';
import {
  CITY_LOCATIONS,
  MOVE_GATE_MINUTES,
  armySize,
  findDistrict,
  findLocation,
  isHeldBy,
  moveRecallable,
  moveRecalledReturnsAt,
  roadMinutes,
  samePlace,
  travelMinutesBetween,
  unitsBeyondNotoriety,
  type Army,
  type Base,
  type Fleet,
  type LineRules,
  type MoveDestination,
  type MovePlace,
  type MoveRefusal,
  type UnitMove,
  type UnitMoveView,
} from '@frontline/shared';
import { isFightingForce, mergeArmies, removeForce } from '../battle/forces.js';
import { columnSpeedFor } from '../battle/movement.js';
import { visibleDistricts } from '../city/view.js';
import { standingEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { tallyCaptured } from '../feats/tally.js';

/**
 * Moving units between the crew's places (maintainer ruling, 2026-09-22). The rules are in
 * `@frontline/shared`'s `moves/moves.ts`; this module is the save's side of them.
 *
 * ## The clock
 *
 * District to gate, or back: `MOVE_GATE_MINUTES` at base, cut by the column's speed and the
 * crew's road bonuses the way any road is. From a location to the gate: the road between its
 * district and home. To the district: the road and then the gate leg, because the door is on
 * the way in. Between two locations: the road between their districts, and the gate leg at
 * least when they share one, so a move is never free.
 *
 * ## Landing
 *
 * At the district or the gate the column joins that roster. At a location the crew holds it
 * joins the garrison. At a location nobody holds it **claims** the ground: the holder becomes
 * this crew and the column is the garrison, with no fight and the level as it stands. At a
 * faction ally's location it is **posted** (`allied_garrisons`): the units stay this crew's and
 * fight for the holder. A place that changed hands during the walk sends the column home to the
 * district. Vehicles carry the column out and then **drive back on their own** (maintainer,
 * 2026-09-22): the same road, an empty column, and the yard has them again when it is over.
 */

const MINUTE_MS = 60_000;

export function crewsInFactionWith(repos: Repositories, base: Base): Set<string> {
  const membership = repos.factions.membershipOf(base.ownerId);
  if (!membership) return new Set();
  const allies = new Set<string>();
  for (const member of repos.factions.members(membership.factionId)) {
    if (member.userId === base.ownerId) continue;
    const theirs = repos.bases.findByOwnerId(member.userId);
    if (theirs) allies.add(theirs.id);
  }
  return allies;
}

/** Every place a column could be walked to: the crew's own, then the faction's. */
export function moveDestinationsFor(repos: Repositories, base: Base): MoveDestination[] {
  const controls = repos.city.controls();
  const allies = crewsInFactionWith(repos, base);
  const out: MoveDestination[] = [
    {
      place: { kind: 'district' },
      label: 'Your District',
      districtName: null,
      group: 'yours',
      holderName: null,
    },
    {
      place: { kind: 'gate' },
      label: 'Your Gate',
      districtName: null,
      group: 'yours',
      holderName: null,
    },
  ];
  for (const location of CITY_LOCATIONS) {
    const control = controls.get(location.id);
    if (!control || control.holder.kind !== 'crew') continue;
    const district = findDistrict(location.districtId);
    if (isHeldBy(control, base.id)) {
      out.push({
        place: { kind: 'location', locationId: location.id },
        label: location.name,
        districtName: district?.name ?? null,
        group: 'yours',
        holderName: null,
      });
    } else if (allies.has(control.holder.baseId)) {
      out.push({
        place: { kind: 'location', locationId: location.id },
        label: location.name,
        districtName: district?.name ?? null,
        group: 'faction',
        holderName: repos.bases.findById(control.holder.baseId)?.name ?? null,
      });
    }
  }
  return out;
}

/** What this crew has standing at a place: its own roster there, or its posting on an ally's. */
export function forceAt(repos: Repositories, base: Base, place: MovePlace): Army {
  if (place.kind === 'district') return base.army;
  if (place.kind === 'gate') return base.gateArmy ?? {};
  const control = repos.city.control(place.locationId);
  if (!control) return {};
  if (isHeldBy(control, base.id)) return control.garrison;
  return repos.alliedGarrisons.get(place.locationId, base.id);
}

function districtOf(base: Base, place: MovePlace): string | undefined {
  if (place.kind !== 'location') return base.districtId;
  return findLocation(place.locationId)?.districtId;
}

export function placeName(base: Base, place: MovePlace): string {
  if (place.kind === 'district') return 'Your District';
  if (place.kind === 'gate') return 'Your Gate';
  const location = findLocation(place.locationId);
  const district = location ? findDistrict(location.districtId) : undefined;
  return location ? `${location.name}, ${district?.name ?? location.districtId}` : 'somewhere';
}

/** The walk, in whole minutes, or null when either end is off the map. */
export function moveMinutes(
  repos: Repositories,
  base: Base,
  from: MovePlace,
  to: MovePlace,
  riding: { army: Army; vehicles: Fleet },
): number | null {
  const effects = standingEffectsFor(repos, base);
  const speed = columnSpeedFor(repos, base, { vehicles: riding.vehicles, force: riding.army });
  const gateLeg = Math.max(1, roadMinutes(MOVE_GATE_MINUTES, speed, effects.travelSpeedPercent, 0));
  const fromDistrict = findDistrict(districtOf(base, from) ?? '');
  const toDistrict = findDistrict(districtOf(base, to) ?? '');
  if (!fromDistrict || !toDistrict) return null;
  const road = travelMinutesBetween(fromDistrict, toDistrict, {
    speed,
    reductionPercent: effects.travelSpeedPercent,
    flatMinutesOff: effects.roadMinutesOff,
  });
  /*
   * The door is on the way in, and only on the way in (maintainer's timings).
   *
   * - District to gate or back, and anything else that touches neither a location: the door's
   *   own leg, ten minutes at base.
   * - Inside the crew's own district: the same leg. The road between a district and itself is
   *   the map's two-minute floor, which is not what walking across your own ground costs.
   * - From outside to the **gate**: the road, and nothing else. The gate is the outside of the
   *   district.
   * - From outside to the **district**: the road and then the door.
   */
  const throughTheDoor = from.kind === 'district' || to.kind === 'district';
  if (from.kind !== 'location' && to.kind !== 'location') return gateLeg;
  if (fromDistrict.id === toDistrict.id) return gateLeg;
  return road + (throughTheDoor ? gateLeg : 0);
}

export type SendMoveResult =
  { kind: 'refused'; reason: MoveRefusal } | { kind: 'sent'; move: UnitMove; base: Base };

export function sendMove(
  repos: Repositories,
  input: { base: Base; from: MovePlace; to: MovePlace; army: Army; vehicles: Fleet; now: Date },
): SendMoveResult {
  const { base, from, to, now } = input;
  const army: Army = Object.fromEntries(
    Object.entries(input.army).filter(([, count]) => count > 0),
  );
  const vehicles: Fleet = Object.fromEntries(
    Object.entries(input.vehicles).filter(([, count]) => (count ?? 0) > 0),
  );
  if (samePlace(from, to)) return { kind: 'refused', reason: 'same_place' };
  if (armySize(army) === 0) return { kind: 'refused', reason: 'nobody_sent' };

  const standing = forceAt(repos, base, from);
  if (from.kind === 'location' && armySize(standing) === 0) {
    return { kind: 'refused', reason: 'not_yours' };
  }
  for (const [unitId, count] of Object.entries(army)) {
    if ((standing[unitId] ?? 0) < count) return { kind: 'refused', reason: 'not_enough_units' };
  }
  // The yard is at home: a column from anywhere else walks.
  if (Object.keys(vehicles).length > 0 && from.kind !== 'district') {
    return { kind: 'refused', reason: 'not_enough_vehicles' };
  }
  for (const [vehicleId, count] of Object.entries(vehicles)) {
    if ((base.fleet[vehicleId as keyof Fleet] ?? 0) < (count ?? 0)) {
      return { kind: 'refused', reason: 'not_enough_vehicles' };
    }
  }

  if (to.kind === 'location') {
    const location = findLocation(to.locationId);
    const control = location ? repos.city.control(location.id) : undefined;
    if (!location || !control) return { kind: 'refused', reason: 'no_road' };
    const visible = visibleDistricts(
      repos,
      base,
      repos.city.controls(),
      standingEffectsFor(repos, base),
    );
    if (!visible.has(location.districtId)) return { kind: 'refused', reason: 'unscouted' };
    const allies = crewsInFactionWith(repos, base);
    const holder = control.holder;
    const welcome =
      holder.kind === 'unoccupied' ||
      (holder.kind === 'crew' && (holder.baseId === base.id || allies.has(holder.baseId)));
    if (!welcome) return { kind: 'refused', reason: 'held_by_others' };
    // A garrison is a line, and a legend will not stand on it for a nobody (§D7).
    const lineRules: LineRules = {
      carriersFight: standingEffectsFor(repos, base).carriersFight,
      unitMarks: {},
    };
    if (!isFightingForce(army, lineRules))
      return { kind: 'refused', reason: 'not_a_fighting_force' };
    if (unitsBeyondNotoriety(army, base.economy.notoriety).length > 0) {
      return { kind: 'refused', reason: 'needs_infamy' };
    }
  }

  const minutes = moveMinutes(repos, base, from, to, { army, vehicles });
  if (minutes === null) return { kind: 'refused', reason: 'no_road' };

  const paid = takeFrom(repos, base, from, army, vehicles);
  const move: UnitMove = {
    id: randomUUID(),
    baseId: base.id,
    from,
    to,
    army,
    vehicles,
    departedAt: now.toISOString(),
    arrivesAt: new Date(now.getTime() + minutes * MINUTE_MS).toISOString(),
    travelMinutes: minutes,
    recalledAt: null,
  };
  repos.moves.insert(move);
  return { kind: 'sent', move, base: paid };
}

/** Lift the column off its source. */
function takeFrom(
  repos: Repositories,
  base: Base,
  from: MovePlace,
  army: Army,
  vehicles: Fleet,
): Base {
  if (from.kind === 'district') {
    const fleet = { ...base.fleet };
    for (const [vehicleId, count] of Object.entries(vehicles)) {
      const key = vehicleId as keyof Fleet;
      const left = Math.max(0, (fleet[key] ?? 0) - (count ?? 0));
      // Deleted rather than zeroed: `FleetSchema` counts are positive, so a `0` left behind is a
      // row the crew cannot be read back out of the database with.
      if (left === 0) delete fleet[key];
      else fleet[key] = left;
    }
    const next: Base = { ...base, army: removeForce(base.army, army), fleet };
    repos.bases.updateArmy(next.id, next.army, next.trainingQueue);
    repos.bases.updateFleet(next.id, next.fleet);
    return next;
  }
  if (from.kind === 'gate') {
    const next: Base = { ...base, gateArmy: removeForce(base.gateArmy ?? {}, army) };
    repos.bases.updateGateArmy(next.id, next.gateArmy ?? {});
    return next;
  }
  const control = repos.city.control(from.locationId);
  if (control && isHeldBy(control, base.id)) {
    repos.city.setGarrison(from.locationId, removeForce(control.garrison, army));
  } else {
    const posted = repos.alliedGarrisons.get(from.locationId, base.id);
    repos.alliedGarrisons.set(from.locationId, base.id, removeForce(posted, army));
  }
  return base;
}

/** Put the column down where it landed, or at home when the ground is no longer welcoming. */
function landAt(repos: Repositories, base: Base, to: MovePlace, army: Army): void {
  if (to.kind === 'gate') {
    repos.bases.updateGateArmy(base.id, mergeArmies(base.gateArmy ?? {}, army));
    return;
  }
  if (to.kind === 'location') {
    const control = repos.city.control(to.locationId);
    if (control) {
      if (isHeldBy(control, base.id)) {
        repos.city.setGarrison(to.locationId, mergeArmies(control.garrison, army));
        return;
      }
      if (control.holder.kind === 'unoccupied') {
        // Claimed on arrival: no fight, the level as it stands, nothing dug in.
        repos.city.put({
          ...control,
          holder: { kind: 'crew', baseId: base.id },
          upgradingUntil: null,
          fortification: 0,
          fortifyingUntil: null,
          garrison: army,
        });
        tallyCaptured(repos, base.id, 'location');
        return;
      }
      if (
        control.holder.kind === 'crew' &&
        crewsInFactionWith(repos, base).has(control.holder.baseId)
      ) {
        const posted = repos.alliedGarrisons.get(to.locationId, base.id);
        repos.alliedGarrisons.set(to.locationId, base.id, mergeArmies(posted, army));
        return;
      }
    }
  }
  repos.bases.updateArmy(base.id, mergeArmies(base.army, army), base.trainingQueue);
}

function returnVehicles(repos: Repositories, base: Base, vehicles: Fleet): void {
  if (Object.keys(vehicles).length === 0) return;
  const fleet = { ...base.fleet };
  for (const [vehicleId, count] of Object.entries(vehicles)) {
    const key = vehicleId as keyof Fleet;
    fleet[key] = (fleet[key] ?? 0) + (count ?? 0);
  }
  repos.bases.updateFleet(base.id, fleet);
}

/** Every column whose mark has passed lands where it was going, or back where it came from. */
export function settleMoves(repos: Repositories, now: Date): number {
  const due = repos.moves.due(now.toISOString());
  for (const move of due) {
    repos.moves.markSettled(move.id, now.toISOString());
    const base = repos.bases.findById(move.baseId);
    if (!base) continue;
    /*
     * Where it actually ends up: a column turned round walks back to where it set out from,
     * and everything else arrives.
     *
     * The empty case is the machines driving themselves home, which are put on the road already
     * carrying the recall mark so that nobody can turn them round again. They are still *going*
     * somewhere, so the mark alone cannot decide this: a column with nobody in it lands at its
     * destination whatever the mark says, or the yard would send them out and back for ever.
     */
    const landed = move.recalledAt !== null && armySize(move.army) > 0 ? move.from : move.to;
    landAt(repos, base, landed, move.army);
    driveVehiclesHome(repos, repos.bases.findById(base.id) ?? base, move, landed, now);
  }
  return due.length;
}

/**
 * The machines go back on their own (maintainer, 2026-09-22).
 *
 * They used to reappear in the yard the moment the column landed, which is a truck teleporting
 * home. What happens instead is the other half of the journey: an empty column, the same
 * machines, the same road, and the yard gets them back when it is over. A player watching the
 * Monitor sees the trucks driving home, and the unit slots those machines draw stay drawn until
 * they are actually parked (`vehiclesAbroad` reads live moves).
 *
 * Nothing to do when the column landed at the district, because that is where the yard is: a
 * turned-round move walks back to where it set out from, and vehicles may only set out from
 * home (`sendMove` refuses them anywhere else), so a recall always ends here.
 */
function driveVehiclesHome(
  repos: Repositories,
  base: Base,
  move: UnitMove,
  landed: MovePlace,
  now: Date,
): void {
  if (Object.keys(move.vehicles).length === 0) return;
  if (landed.kind === 'district') {
    returnVehicles(repos, base, move.vehicles);
    return;
  }
  repos.moves.insert({
    id: randomUUID(),
    baseId: base.id,
    from: landed,
    to: { kind: 'district' },
    // Empty: the people they carried are standing where they were dropped.
    army: {},
    vehicles: move.vehicles,
    departedAt: now.toISOString(),
    arrivesAt: new Date(now.getTime() + move.travelMinutes * MINUTE_MS).toISOString(),
    travelMinutes: move.travelMinutes,
    /*
     * Not recallable, and that is what the mark says rather than a second flag: a column with
     * nobody in it has no decision left in it, and `moveRecallable` reads `recalledAt` first.
     * Stamped at the send so the window is shut from the first tick.
     */
    recalledAt: now.toISOString(),
  });
}

export type RecallMoveResult =
  | { kind: 'refused'; reason: 'unknown_move' | 'not_yours' | 'window_closed' }
  | { kind: 'recalled'; move: UnitMove };

export function recallMove(
  repos: Repositories,
  base: Base,
  moveId: string,
  now: Date,
): RecallMoveResult {
  const move = repos.moves.find(moveId);
  if (!move) return { kind: 'refused', reason: 'unknown_move' };
  if (move.baseId !== base.id) return { kind: 'refused', reason: 'not_yours' };
  if (!moveRecallable(move, now)) return { kind: 'refused', reason: 'window_closed' };
  const returnsAt = moveRecalledReturnsAt(move, now).toISOString();
  repos.moves.markRecalled(move.id, now.toISOString(), returnsAt);
  return {
    kind: 'recalled',
    move: { ...move, recalledAt: now.toISOString(), arrivesAt: returnsAt },
  };
}

export function moveViews(repos: Repositories, base: Base): UnitMoveView[] {
  return repos.moves.activeFor(base.id).map((move) => ({
    id: move.id,
    from: move.from,
    to: move.to,
    fromName: placeName(base, move.from),
    toName: placeName(base, move.to),
    army: move.army,
    vehicles: move.vehicles,
    size: armySize(move.army),
    departedAt: move.departedAt,
    arrivesAt: move.arrivesAt,
    travelMinutes: move.travelMinutes,
    recalledAt: move.recalledAt,
  }));
}

/** Units this crew has posted on allies' ground, summed: still its people, still eating. */
export function postedUnits(repos: Repositories, base: Base): Army {
  return repos.alliedGarrisons
    .forBase(base.id)
    .reduce<Army>((all, row) => mergeArmies(all, row.army), {});
}
