import {
  CITY_LOCATIONS,
  BUILDING_CATALOG,
  districtHolder,
  findDistrict,
  findLocation,
  gateArmed,
  gateIsBroken,
  type BattleTarget,
  type Base,
  type District,
  type DistrictStanding,
  type LocationControl,
  type LocationHolder,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * Reading the ground a declaration names (GDD §A4, battle rework).
 *
 * One module, because the three questions a declaration asks — *is this district shut*, *is its gate
 * currently down*, and *who am I actually calling out* — are all read off the same two tables and
 * were going to be answered three times over otherwise: once by the route that validates a call,
 * once by the settler that runs it, and once by the screen that draws it. Three readings of the
 * control table is three chances for the map and the rules to disagree.
 */

/** The whole state of a district, as the declaration rules need it. */
export function districtStandingFor(
  repos: Repositories,
  district: District,
  now: Date,
): DistrictStanding {
  const controls = repos.city.controls();
  const holder = districtHolder(district, controls);
  const resident = repos.bases
    .listSummaries()
    .find((summary) => summary.districtId === district.id);

  return {
    shut: gateArmed(holder),
    breached: gateIsBroken(repos.sieges.gate(district.id), now),
    inhabited: resident !== undefined,
  };
}

/**
 * Who a declaration is actually calling out.
 *
 * For a location, whoever holds it. For a gate or a structure behind one, whoever holds the district —
 * which, since a gate is only armed when one party holds all of it, is a single answer rather than a
 * committee.
 */
export function defenderOf(
  repos: Repositories,
  target: BattleTarget,
  district: District,
): LocationHolder {
  if (target.kind === 'location') {
    return repos.city.control(target.locationId)?.holder ?? { kind: 'unoccupied' };
  }
  return districtHolder(district, repos.city.controls()) ?? { kind: 'unoccupied' };
}

/** Every control row in a district, in map order. */
export function controlsIn(
  repos: Repositories,
  districtId: string,
): { locationId: string; control: LocationControl }[] {
  const controls = repos.city.controls();
  return CITY_LOCATIONS.filter((location) => location.districtId === districtId).flatMap(
    (location) => {
      const control = controls.get(location.id);
      return control ? [{ locationId: location.id, control }] : [];
    },
  );
}

/** The ground's name, in the words the map uses. */
export function targetName(target: BattleTarget, resident?: Base): string {
  switch (target.kind) {
    case 'location':
      return findLocation(target.locationId)?.name ?? 'somewhere';
    case 'gate':
      return `the gate at ${findDistrict(target.districtId)?.name ?? 'somewhere'}`;
    case 'building': {
      const building = resident?.buildings.find((candidate) => candidate.id === target.buildingId);
      return building ? BUILDING_CATALOG[building.kind].name : 'a structure';
    }
  }
}

/** The crew living in a district, if one does. Null for contested ground. */
export function residentOf(repos: Repositories, districtId: string): Base | undefined {
  const summary = repos.bases
    .listSummaries()
    .find((candidate) => candidate.districtId === districtId);
  return summary ? repos.bases.findById(summary.id) : undefined;
}
