import {
  markFromPoints,
  type Base,
  type Commander,
  type CrewOfficer,
  type CrewResponse,
  type OfficerRole,
} from '@frontline/shared';
import { roleFit } from '../roles/requirements.js';
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
    // §D4: sent as the raw clock rather than as a boolean, so the card can count down to it.
    injuredUntil: officer.injuredUntil,
    /*
     * How well they fit the chair, as a mark.
     *
     * Computed here rather than shipped as the score it comes from: `roleFit` reads the role
     * requirement table, which is server-side only (B8/B8a), and the score itself is fine grained
     * enough that a player comparing two of them could work backwards toward the weights. The mark
     * is the coarse hint the leak guard's own note allows.
     *
     * Null on the bench. A mark is a statement about a fit, and somebody with no chair has nothing
     * to fit: the same officer reads differently in two roles, which is the point of showing it.
     */
    mark: officer.role === null ? null : markFromPoints(roleFit(officer.attributes, officer.role)),
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

/**
 * The chairs that are actually taken.
 *
 * `commanders.map(o => o.role)` was the idiom everywhere and it stopped being right the day an
 * officer could have no chair: it answered a list with `null` in it, and every caller was asking
 * "which seats are filled". Named, so the question is asked once and the answer cannot drift.
 */
export function seatedRoles(commanders: readonly Commander[]): OfficerRole[] {
  return commanders
    .map((officer) => officer.role)
    .filter((role): role is OfficerRole => role !== null);
}
