import { type Base, type Commander, type CrewOfficer, type CrewResponse } from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { districtPopulation, type DistrictPopulation } from '../district/population.js';

/**
 * Reading the crew (GDD §G): who is in which chair, and everything about them.
 *
 * This was the assignee layer, and most of it was pool arithmetic derived from `Base.level`: how
 * many bodies the level had granted, how many were placed, what one more under an officer would
 * pay. None of that exists any more. What is left is a projection of the officers themselves, which
 * is the only part of the payload a player was ever reading.
 */

/** One officer as the crew screen shows them: the person, not a body count. */
export function projectCrewOfficer(officer: Commander): CrewOfficer {
  return {
    officerId: officer.id,
    name: officer.name,
    role: officer.role,
    attributes: officer.attributes,
    perks: officer.perks,
    weeklyWage: officer.weeklyWage,
  };
}

/** The §A1 pool as the screen quotes it: beds, which officers still take one of each. */
function housingOf(population: DistrictPopulation): CrewResponse['housing'] {
  return { used: population.total, capacity: population.capacity };
}

/** The whole crew screen in one payload. */
export function projectCrew(repos: Repositories, base: Base): CrewResponse {
  return {
    level: base.level,
    housing: housingOf(districtPopulation(repos, base)),
    officers: base.commanders.map(projectCrewOfficer),
  };
}
