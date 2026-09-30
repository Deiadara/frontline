import { sendCellsHomeFromShutDistrict } from '../city/sleepers.js';
import { randomUUID } from 'node:crypto';
import {
  EVERY_LOCATION,
  MOVE_GATE_MINUTES,
  armySize,
  cityIsOpen,
  findDistrict,
  findLocation,
  findUnit,
  isHeldBy,
  moveRecallable,
  moveRecalledReturnsAt,
  partyCanRide,
  railwayOfferBetween,
  roadMinutes,
  samePlace,
  stationDistricts,
  travelMinutesBetween,
  unitsBeyondNotoriety,
  type Army,
  type Base,
  type Fleet,
  type LineRules,
  type MoveDestination,
  type MovePlace,
  type MoveRefusal,
  type RailwayOffer,
  type UnitMove,
  type UnitMoveView,
} from '@frontline/shared';
import { isFightingForce, mergeArmies, removeForce } from '../battle/forces.js';
import { columnSpeedFor } from '../battle/movement.js';
import { fightCalledOn, placeLocked } from '../battle/lock.js';
import { putControl } from '../city/actions.js';
import { standingEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import { tallyCaptured, tallyRailJourney } from '../feats/tally.js';
import { settleEach } from '../world/guard.js';
import { adminSeconds } from '../admin/mode.js';

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
 * fight for the holder. A place that changed hands during the walk, or the streets outside
 * somebody else's gate, has nothing to stand on: the column turns and **walks** home from there
 * ({@link walkHome}; maintainer, 2026-09-28, "Nothing sends units immediately"). Vehicles carry
 * the column out and then **drive back on their own** (maintainer, 2026-09-22): the same road, an
 * empty column, and the yard has them again when it is over.
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
  /*
   * Every location in the world, not Ashfall's sixty.
   *
   * This walked `CITY_LOCATIONS`, so a crew holding ground in the second city could not select it
   * as a source or a destination, even though `forceAt` would happily have read its garrison. The
   * units were reachable by the rules and unreachable by the only screen that moves them.
   */
  for (const location of EVERY_LOCATION) {
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
  // Nobody stands in the streets: a column only ever passes through them on its way home.
  if (place.kind === 'street') return {};
  const control = repos.city.control(place.locationId);
  if (!control) return {};
  if (isHeldBy(control, base.id)) return control.garrison;
  return repos.alliedGarrisons.get(place.locationId, base.id);
}

function districtOf(base: Base, place: MovePlace): string | undefined {
  if (place.kind === 'street') return place.districtId;
  if (place.kind !== 'location') return base.districtId;
  return findLocation(place.locationId)?.districtId;
}

/** Ground outside the crew's own walls: a location, or the streets of another district. */
const outside = (place: MovePlace): boolean => place.kind === 'location' || place.kind === 'street';

export function placeName(base: Base, place: MovePlace): string {
  if (place.kind === 'district') return 'Your District';
  if (place.kind === 'gate') return 'Your Gate';
  if (place.kind === 'street') {
    return `The streets of ${findDistrict(place.districtId)?.name ?? place.districtId}`;
  }
  const location = findLocation(place.locationId);
  const district = location ? findDistrict(location.districtId) : undefined;
  return location ? `${location.name}, ${district?.name ?? location.districtId}` : 'somewhere';
}

/**
 * The platforms this crew holds, as district ids.
 *
 * Read off the live control map every time rather than cached on the crew, because losing a
 * platform has to drop that node out of the line immediately: a crew that was linked five minutes
 * ago and has just been pushed off Bond Street Halt is not linked any more.
 */
export function stationsHeldBy(repos: Repositories, base: Base): Set<string> {
  const controls = repos.city.controls();
  const held: string[] = [];
  for (const location of EVERY_LOCATION) {
    if (location.kind !== 'rail_station') continue;
    const control = controls.get(location.id);
    if (control && isHeldBy(control, base.id)) held.push(location.id);
  }
  return stationDistricts(held);
}

/**
 * The ride this crew could take for this journey, or `null` if there is none.
 *
 * Four ways there is none, and they are all silent rather than refusals: fewer than two platforms
 * held, the two ends in different cities, a party carrying machines, or simply a road that is
 * already quicker than fifteen minutes plus two walks. The caller offers whatever comes back
 * beside the walk and the player chooses (maintainer, 2026-09-24).
 */
export function railOfferFor(
  repos: Repositories,
  base: Base,
  from: MovePlace,
  to: MovePlace,
  riding: { army: Army; vehicles: Fleet },
): RailwayOffer | null {
  const offer = rawRailOffer(repos, base, from, to, riding);
  if (offer === null) return null;
  /*
   * A ride that is slower than the road it replaces is not an offer. Two neighbouring districts
   * are a nine minute hop, and fifteen minutes on a train is not a service anybody wants.
   *
   * Weighed against the **road** and not against the whole journey, because the road is the only
   * part a ride replaces: `MOVE_GATE_MINUTES` is charged on top of either one. It used to compare
   * the bare rail leg against `moveMinutes`, which already carried the door, so the door was
   * counted on one side of the comparison and not the other, and any journey whose road was under
   * fifteen minutes but whose road *and door* was over it was offered a ride that arrived later.
   * Home in the Viaduct, a column of Razors to Platform One walks in twenty minutes and rides in
   * twenty-one, and the quote drew the twenty-one as the quicker of the two.
   *
   * `null` legs covers the journeys `moveMinutes` answers with the door alone: two places that
   * are not locations, and two locations in one district. Nothing about those is a road, so there
   * is nothing for a ride to replace and the fifteen minutes would be fifteen minutes added.
   */
  const legs = journeyLegs(repos, base, from, to, riding);
  return legs === null || legs.road === null || offer.minutes >= legs.road ? null : offer;
}

/** The ride itself, with no judgement about whether it is worth taking. */
function rawRailOffer(
  repos: Repositories,
  base: Base,
  from: MovePlace,
  to: MovePlace,
  riding: { army: Army; vehicles: Fleet },
): RailwayOffer | null {
  // Vehicles and the Colossus cannot board. `no_ride` is the sheet flag the Colossus carries, and
  // reading it off the catalogue rather than naming the unit keeps a second such sheet working.
  const unridables = Object.entries(riding.army).filter(
    ([unitId, count]) => (count ?? 0) > 0 && findUnit(unitId)?.no_ride === true,
  ).length;
  const vehicles = Object.values(riding.vehicles).reduce((sum, count) => sum + (count ?? 0), 0);
  if (!partyCanRide({ vehicles, unridables })) return null;

  const fromDistrict = districtOf(base, from);
  const toDistrict = districtOf(base, to);
  if (fromDistrict === undefined || toDistrict === undefined) return null;

  const effects = standingEffectsFor(repos, base);
  const speed = columnSpeedFor(repos, base, { vehicles: riding.vehicles, force: riding.army });
  const offer = railwayOfferBetween(fromDistrict, toDistrict, stationsHeldBy(repos, base), {
    speed,
    reductionPercent: effects.travelSpeedPercent,
    flatMinutesOff: effects.roadMinutesOff,
  });
  return offer;
}

/**
 * The journey, in whole minutes, or null when either end is off the map.
 *
 * `byRail` puts the middle leg on Terminus's line when this crew can offer one. The door legs are
 * unchanged by it: a gate is still ten minutes from the district behind it whether you arrived on
 * foot or on a train.
 */
export function moveMinutes(
  repos: Repositories,
  base: Base,
  from: MovePlace,
  to: MovePlace,
  riding: { army: Army; vehicles: Fleet },
  byRail = false,
): number | null {
  const legs = journeyLegs(repos, base, from, to, riding);
  if (legs === null) return null;
  if (legs.road === null) return legs.gateLeg;
  /*
   * The railway replaces the road and nothing else.
   *
   * Computed here rather than by the caller so the door leg is added to it the same way it is
   * added to a walk. Guarded on `byRail` rather than taken whenever it is shorter, because riding
   * is the player's choice: the train leaves the machines behind.
   */
  const middle = byRail
    ? (rawRailOffer(repos, base, from, to, riding)?.minutes ?? legs.road)
    : legs.road;
  return middle + (legs.throughTheDoor ? legs.gateLeg : 0);
}

/**
 * Whether the crew actually has what it is asking to move, standing where it says it is.
 *
 * Shared by the move and its quote. The quote used to skip it and price whatever it was handed,
 * and the ride's arithmetic lays out one seat per vehicle, so a crafted quote for two billion trucks
 * held the whole server while it counted them (hardening pass, 2026-09-27).
 */
export function holdingsRefusal(
  repos: Repositories,
  base: Base,
  from: MovePlace,
  army: Army,
  vehicles: Fleet,
): 'not_yours' | 'not_enough_units' | 'not_enough_vehicles' | null {
  const standing = forceAt(repos, base, from);
  if (outside(from) && armySize(standing) === 0) return 'not_yours';
  for (const [unitId, count] of Object.entries(army)) {
    if ((standing[unitId] ?? 0) < count) return 'not_enough_units';
  }
  // The yard is at home: a column from anywhere else walks.
  const riding = Object.entries(vehicles).filter(([, count]) => (count ?? 0) > 0);
  if (riding.length > 0 && from.kind !== 'district') return 'not_enough_vehicles';
  for (const [vehicleId, count] of riding) {
    if ((base.fleet[vehicleId as keyof Fleet] ?? 0) < (count ?? 0)) return 'not_enough_vehicles';
  }
  return null;
}

/**
 * A journey broken into the two things it is made of, before anybody decides how to travel it.
 *
 * `road` is `null` for the journeys that are the door and nothing else, which is what tells the
 * ride apart from the walk: a ride replaces the road, so a journey with no road in it has nothing
 * to offer and `railOfferFor` refuses rather than adding fifteen minutes to a ten minute walk.
 *
 * One reader for both `moveMinutes` and `railOfferFor`, so the clock and the offer cannot fall out
 * of step. They were two copies of this before and the copies disagreed about the door.
 */
function journeyLegs(
  repos: Repositories,
  base: Base,
  from: MovePlace,
  to: MovePlace,
  riding: { army: Army; vehicles: Fleet },
): { gateLeg: number; road: number | null; throughTheDoor: boolean } | null {
  const effects = standingEffectsFor(repos, base);
  const speed = columnSpeedFor(repos, base, { vehicles: riding.vehicles, force: riding.army });
  const gateLeg = Math.max(1, roadMinutes(MOVE_GATE_MINUTES, speed, effects.travelSpeedPercent, 0));
  const fromDistrict = findDistrict(districtOf(base, from) ?? '');
  const toDistrict = findDistrict(districtOf(base, to) ?? '');
  if (!fromDistrict || !toDistrict) return null;
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
  const doorOnly = (!outside(from) && !outside(to)) || fromDistrict.id === toDistrict.id;
  if (doorOnly) return { gateLeg, road: null, throughTheDoor };
  return {
    gateLeg,
    road: travelMinutesBetween(fromDistrict, toDistrict, {
      speed,
      reductionPercent: effects.travelSpeedPercent,
      flatMinutesOff: effects.roadMinutesOff,
    }),
    throughTheDoor,
  };
}

export type SendMoveResult =
  { kind: 'refused'; reason: MoveRefusal } | { kind: 'sent'; move: UnitMove; base: Base };

export function sendMove(
  repos: Repositories,
  input: {
    base: Base;
    from: MovePlace;
    to: MovePlace;
    army: Army;
    vehicles: Fleet;
    now: Date;
    /** Ride Terminus's line if there is a ride to take. Optional, and walking is the default. */
    byRail?: boolean;
    /**
     * Testing mode: the column arrives in five seconds (maintainer ruling, 2026-09-29), and its
     * stored clock is the whole minutes it runs, none, so the recall window and the machines' drive
     * home agree with it.
     */
    admin?: boolean;
  },
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
  // The streets are where the game walks a column home from, never where a player sends one.
  if (to.kind === 'street') return { kind: 'refused', reason: 'no_road' };

  const unheld = holdingsRefusal(repos, base, from, army, vehicles);
  if (unheld) return { kind: 'refused', reason: unheld };
  /*
   * The last hour before a fight on the place this column leaves (`battle/lock.ts`): a location,
   * the gate before a call on it, or the district before a raid (maintainer, 2026-09-28). It read
   * only locations, so a crew could walk its whole gate garrison home a minute before the gate
   * fight and meet the attacker with an empty door.
   */
  if (placeLocked(repos, base, from, now)) return { kind: 'refused', reason: 'garrison_locked' };

  if (to.kind === 'location') {
    const location = findLocation(to.locationId);
    const control = location ? repos.city.control(location.id) : undefined;
    if (!location || !control) return { kind: 'refused', reason: 'no_road' };
    /*
     * Saltmarch's plots have control rows like anybody's, and most of the Tidewalk is empty, so a
     * column walked there claimed ground in a city no screen draws and opened its Bar, its mission
     * board and its back room to the crew (bug pass, 2026-09-29). Only the way in is shut: a column
     * already standing there may still walk home.
     */
    if (!cityIsOpen(findDistrict(location.districtId)?.cityId ?? '')) {
      return { kind: 'refused', reason: 'city_closed' };
    }
    const allies = crewsInFactionWith(repos, base);
    const holder = control.holder;
    const welcome =
      holder.kind === 'unoccupied' ||
      (holder.kind === 'crew' && (holder.baseId === base.id || allies.has(holder.baseId)));
    if (!welcome) return { kind: 'refused', reason: 'held_by_others' };
    if (holder.kind === 'unoccupied' && fightCalledOn(repos, location.id)) {
      return { kind: 'refused', reason: 'under_fire' };
    }
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

  /*
   * The ride is taken only if one was asked for and one was on offer; otherwise the column walks,
   * which is what a stale screen asking for a train that is not running should get.
   *
   * `railOfferFor` rather than `rawRailOffer`, so the send honours exactly what the quote drew.
   * The raw offer exists for journeys the offer refuses because they are quicker on foot, and a
   * screen written before the platforms changed hands could still name one: taking it would put a
   * column on the slower of two clocks it was never shown.
   *
   * One answer for the clock and the counter both. They read the same question separately before,
   * which is the shape a divergence hides in.
   */
  const rode =
    input.byRail === true && railOfferFor(repos, base, from, to, { army, vehicles }) !== null;
  const road = moveMinutes(repos, base, from, to, { army, vehicles }, rode);
  if (road === null) return { kind: 'refused', reason: 'no_road' };
  const admin = input.admin === true;
  const minutes = admin ? 0 : road;
  const clockMs = adminSeconds(road * 60, admin) * 1000;

  const paid = takeFrom(repos, base, from, army, vehicles);
  const move: UnitMove = {
    id: randomUUID(),
    baseId: base.id,
    from,
    to,
    army,
    vehicles,
    departedAt: now.toISOString(),
    arrivesAt: new Date(now.getTime() + clockMs).toISOString(),
    travelMinutes: minutes,
    recalledAt: null,
    byRail: rode,
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
  if (from.kind === 'street') return base;
  const control = repos.city.control(from.locationId);
  if (control && isHeldBy(control, base.id)) {
    repos.city.setGarrison(from.locationId, removeForce(control.garrison, army));
  } else {
    const posted = repos.alliedGarrisons.get(from.locationId, base.id);
    repos.alliedGarrisons.set(from.locationId, base.id, removeForce(posted, army));
  }
  return base;
}

/** Put the column down where it landed, or walk it home when the ground is no longer welcoming. */
function landAt(repos: Repositories, base: Base, to: MovePlace, army: Army, now: Date): void {
  if (to.kind === 'district') {
    repos.bases.updateArmy(base.id, mergeArmies(base.army, army), base.trainingQueue);
    return;
  }
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
      // Claimed on arrival, unless a fight was called on it while the column walked: then they
      // turn round and come home, the way a column to ground nobody will have them on does.
      if (control.holder.kind === 'unoccupied' && !fightCalledOn(repos, to.locationId)) {
        // Claimed on arrival: no fight, the level as it stands. `putControl` settles the crew's
        // production first, so the ground pays from the moment they stood on it and not before.
        putControl(
          repos,
          {
            ...control,
            holder: { kind: 'crew', baseId: base.id },
            upgradingUntil: null,
            garrison: army,
          },
          now,
        );
        tallyCaptured(repos, base.id);
        // A claim that closes the district sends every Sleeper cell in it home (2026-09-29).
        const claimed = findLocation(to.locationId);
        if (claimed) sendCellsHomeFromShutDistrict(repos, claimed.districtId, now);
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
  /*
   * Nothing here will have them, so they turn for home, on foot (maintainer, 2026-09-28). This used
   * to write them onto the district roster in the same instant, which is a column that reached the
   * far side of the city and was home a second later.
   */
  walkHome(repos, base, to, army, {}, now);
}

/**
 * Walks units home from wherever they are standing, on the same clock as any other move.
 *
 * The one door for every trip home the game starts on a crew's behalf: a column that reached
 * ground that would not have it, units pulled out of a fight, a posting whose alliance ended, a
 * crew that is on no side of a fight it is standing in. Each of those used to write the units
 * straight back onto the roster, which put a column from the far side of the city at home in the
 * same second. Already home is the one case with no walk: the district is where they are going.
 *
 * An ordinary move in every other respect, so it shows on the Monitor, draws its unit slots, and
 * can be turned round in its first tenth, back to where it set out from.
 */
export function walkHome(
  repos: Repositories,
  base: Base,
  from: MovePlace,
  army: Army,
  vehicles: Fleet,
  now: Date,
): UnitMove | null {
  const people: Army = Object.fromEntries(Object.entries(army).filter(([, count]) => count > 0));
  const machines: Fleet = Object.fromEntries(
    Object.entries(vehicles).filter(([, count]) => (count ?? 0) > 0),
  );
  if (armySize(people) === 0 && Object.keys(machines).length === 0) return null;
  const home = repos.bases.findById(base.id) ?? base;
  if (from.kind === 'district') {
    repos.bases.updateArmy(home.id, mergeArmies(home.army, people), home.trainingQueue);
    returnVehicles(repos, home, machines);
    return null;
  }
  // A place the map cannot price is still not zero minutes away: the door's own leg at least.
  const minutes =
    moveMinutes(repos, home, from, { kind: 'district' }, { army: people, vehicles: machines }) ??
    MOVE_GATE_MINUTES;
  const move: UnitMove = {
    id: randomUUID(),
    baseId: home.id,
    from,
    to: { kind: 'district' },
    army: people,
    vehicles: machines,
    departedAt: now.toISOString(),
    arrivesAt: new Date(now.getTime() + minutes * MINUTE_MS).toISOString(),
    travelMinutes: minutes,
    /*
     * Machines on their own are not recallable, the rule `driveVehiclesHome` already follows: an
     * empty column has no decision left in it, and a recall measures its return off the ground
     * covered, which would bring a truck home from across the city in a few seconds.
     */
    recalledAt: armySize(people) === 0 ? now.toISOString() : null,
  };
  repos.moves.insert(move);
  return move;
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
  return settleEach(
    repos,
    'moves',
    due,
    (move) => move.id,
    (move) => {
      /*
       * One column, one transaction.
       *
       * A landing is three writes: the row is marked settled, the units are put down where they
       * arrived, and the machines are sent back to the yard. Unwrapped, a throw between the first
       * and the second left the column **marked settled with its units nowhere**, which is the one
       * outcome the rules do not describe and the one nothing can recover from: the row will never
       * come due again. Every other settler in `settleWorld` already wraps per row, and per column
       * rather than per sweep so one bad row cannot roll back the landings beside it. The transaction
       * is `settleEach`'s, which also catches a row that throws and leaves it for the next tick.
       */
      const base = repos.bases.findById(move.baseId);
      if (!base) {
        repos.moves.markSettled(move.id, now.toISOString());
        return;
      }
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
      /*
       * A fight is run with what stood on the ground at its mark (`battle/lock.ts`), and a column
       * that gets there after the mark was not standing there. This stage runs before the battles
       * in `settleWorld`, so after a late tick or a restart a column due at 15:20 landed on a
       * garrison fighting at 15:00 and fought with it. It waits instead: the fight runs further
       * down this same tick and the column lands on whatever the fight left, on the next one.
       * The twin of the check `settleMovements` makes for a column walking to a fight.
       */
      if (armySize(move.army) > 0 && fightDueBefore(repos, base, landed, move.arrivesAt)) return;
      repos.moves.markSettled(move.id, now.toISOString());
      landAt(repos, base, landed, move.army, now);
      driveVehiclesHome(repos, repos.bases.findById(base.id) ?? base, move, landed, now);
      // A ride counts once it has reached where it was going (audit, 2026-09-28): counted at the
      // send, a train taken and turned round in its first tenth was a journey for nothing.
      if (move.byRail === true && landed === move.to) tallyRailJourney(repos, base.id);
    },
  );
}

/** Whether a fight still to be run on this place had its mark before `arrivesAt`. */
function fightDueBefore(
  repos: Repositories,
  base: Base,
  place: MovePlace,
  arrivesAt: string,
): boolean {
  const arriving = Date.parse(arrivesAt);
  // The streets are only ever passed through on the way home, and no fight is held on them.
  if (place.kind === 'street') return false;
  return repos.sieges.pending().some((battle) => {
    if (Date.parse(battle.scheduledFor) >= arriving) return false;
    const { target } = battle;
    if (place.kind === 'location') {
      return target.kind === 'location' && target.locationId === place.locationId;
    }
    // The gate garrison meets a call on the door, the district army a raid behind it.
    return (
      target.kind === (place.kind === 'gate' ? 'gate' : 'district') &&
      target.districtId === base.districtId
    );
  });
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
