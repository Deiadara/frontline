import {
  EVERY_LOCATION,
  findUnit,
  isHeldBy,
  partyCanRide,
  railwayOfferBetween,
  stationDistricts,
  type Army,
  type Base,
  type Fleet,
  type RailwayOffer,
  type RoadPace,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * Who is on Terminus's line, and whether a given party may board it.
 *
 * Its own module because two different journeys ask: a unit move between the crew's own places
 * (`moves/moves.ts`) and a battle column on its way to a declared fight (`battle/movement.ts`).
 * Those two already depend on each other in one direction, so the shared half cannot live in
 * either of them without closing a loop.
 *
 * The rule itself is in `packages/shared/src/city/rails.ts`. This is the part that needs the
 * database: which platforms this crew is actually standing on right now.
 */

/**
 * The districts in which this crew holds a Station.
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
 * Whether this party may board at all.
 *
 * Vehicles and the Colossus cannot ride (maintainer, 2026-09-24), and it is a refusal rather than
 * a penalty: there is no flat bed on this railway, so a column taking its machines is a column
 * walking. `no_ride` is read off the catalogue rather than the Colossus being named, so a second
 * such sheet needs no edit here.
 */
export function partyRides(army: Army, vehicles: Fleet): boolean {
  const unridables = Object.entries(army).filter(
    ([unitId, count]) => (count ?? 0) > 0 && findUnit(unitId)?.no_ride === true,
  ).length;
  const machines = Object.values(vehicles).reduce((sum, count) => sum + (count ?? 0), 0);
  return partyCanRide({ vehicles: machines, unridables });
}

/**
 * The ride this crew could take between two districts, or `null` when there is none to take.
 *
 * Four silent noes rather than refusals: fewer than two platforms held, the two ends in different
 * cities, a party carrying machines, or a road that is already quicker than fifteen minutes plus
 * the two walks. The caller offers whatever comes back beside the march and the player chooses.
 */
export function railRideBetween(
  repos: Repositories,
  base: Base,
  fromDistrictId: string,
  toDistrictId: string,
  riding: { army: Army; vehicles: Fleet },
  pace: RoadPace,
  road: number,
): RailwayOffer | null {
  if (!partyRides(riding.army, riding.vehicles)) return null;
  const offer = railwayOfferBetween(
    fromDistrictId,
    toDistrictId,
    stationsHeldBy(repos, base),
    pace,
  );
  if (offer === null) return null;
  // A ride that arrives no sooner than the march is not an offer. Two neighbouring districts are a
  // short hop and fifteen minutes on a train is not a service anybody wants.
  return offer.minutes >= road ? null : offer;
}
