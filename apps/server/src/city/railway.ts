import {
  EVERY_LOCATION,
  isStation,
  findUnit,
  partyCanRide,
  railwayOfferBetween,
  stationDistricts,
  type Army,
  type Base,
  type Fleet,
  type RailwayOffer,
  type RoadPace,
  type StationLevels,
  shortcutMinutes,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { alliesOf } from './holding.js';

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
 * The districts in which this crew or a mate at its table holds a Station, with each platform's
 * level (maintainer, 2026-10-13: the line is the table's).
 *
 * Read off the live control map every time rather than cached on the crew, because losing a
 * platform has to drop that node out of the line immediately: a crew that was linked five minutes
 * ago and has just been pushed off Bond Street Halt is not linked any more. The level comes off
 * the same row, because it sets how long the rails out of that platform take
 * (`railLinkMinutes`), and both the move and the battle column read it here.
 */
export function stationsHeldBy(repos: Repositories, base: Base): StationLevels {
  const controls = repos.city.controls();
  const table = new Set([base.id, ...alliesOf(repos, base.id)]);
  const held = new Map<string, number>();
  for (const location of EVERY_LOCATION) {
    if (!isStation(location)) continue;
    const control = controls.get(location.id);
    // The table's platforms as well as the crew's own (maintainer, 2026-10-13): a mate's Station
    // is a platform you may board at or get off at.
    if (control && control.holder.kind === 'crew' && table.has(control.holder.baseId)) {
      held.set(location.id, control.level);
    }
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
 * cities, a party carrying machines, or a road that is already quicker than the rails plus the
 * two walks. The caller offers whatever comes back beside the march and the player chooses.
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
  // SHORTCUT halves the ride's own clock, the road it is weighed against already halved.
  const ride = { ...offer, minutes: shortcutMinutes(offer.minutes, riding.army) };
  // A ride that arrives no sooner than the march is not an offer. Two neighbouring districts are a
  // short hop and a quarter of an hour on a train is not a service anybody wants.
  return ride.minutes >= road ? null : ride;
}
