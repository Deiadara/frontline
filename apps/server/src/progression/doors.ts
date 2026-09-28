import {
  areaName,
  describeAreaRequirement,
  isAreaUnlocked,
  type Base,
  type GatedArea,
  type UnlockFacts,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { AppError } from '../errors.js';

/**
 * The doors the client draws, held on the server as well (2026-09-28).
 *
 * `AREA_REQUIREMENTS` shut the Bar, the drills, the crew's chairs, the Market and the offers board
 * on the screen and nowhere else: a level-one crew could bid at the Bar, start a drill and buy from
 * the Runner by calling the routes the locked screens hide (found by the playthrough script). The
 * rule is the shared one, read off the same five facts the client reads, so the door and the
 * refusal cannot disagree.
 */
export function unlockFactsOf(base: Base): UnlockFacts {
  return {
    level: base.level,
    buildings: base.buildings.map((building) => building.kind),
    // Seated officers only, as on the client: a door on a Head of Research wants the chair filled.
    officers: base.commanders
      .map((officer) => officer.role)
      .filter((role): role is NonNullable<typeof role> => role !== null),
    notoriety: base.economy.notoriety,
    technologies: base.research.technologies,
  };
}

/** Refuses with `AREA_LOCKED`, in the words the locked door uses, unless `area` is open. */
export function requireArea(base: Base, area: GatedArea): void {
  if (isAreaUnlocked(area, unlockFactsOf(base))) return;
  throw new AppError(
    'AREA_LOCKED',
    `${areaName(area)} is not open to you yet. ${describeAreaRequirement(area)}`,
  );
}

/**
 * The same, for a route that has not loaded the crew yet. A player with no crew is left to the
 * route's own `NO_BASE` refusal, which says the truer thing.
 */
export function requireAreaFor(repos: Repositories, userId: string, area: GatedArea): void {
  const base = repos.bases.findByOwnerId(userId);
  if (base) requireArea(base, area);
}
