import {
  populationCapacity,
  assigneeBonusPercent,
  assigneeCapPerOfficer,
  assigneePool,
  assigneesUnder,
  canReskill,
  placedAssignees,
  pruneAssignees,
  unplacedAssignees,
  type AssigneeOfficer,
  type AssigneesResponse,
  type Base,
  type Commander,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { populationUsed } from '../district/population.js';

/**
 * Reading the assignee layer (GDD §G).
 *
 * Everything the page needs is derived here rather than stored: §G8 makes the pool a function of
 * `Base.level`, §G3 makes the cap one, and §G7 makes the bonus a lookup. The only stored fact is
 * where the player put people, and that is what `settleAssignees` keeps honest.
 */

/**
 * Returns assignees stranded under officers who have left the books, and persists the correction.
 *
 * §H5 lets a badly-aligned officer walk out, and nothing about that path knows the §G layer
 * exists. Without this sweep their placement would sit in the map forever: counted against the
 * pool by `placedAssignees`, reachable by no officer, and quietly costing the player a grant every
 * time somebody quit. Run on every read of the layer, and before every write to it, so a stale row
 * can never be the thing a placement is validated against.
 */
export function settleAssignees(repos: Repositories, base: Base): Base {
  const pruned = pruneAssignees(base.assignees, base.commanders);
  if (placedAssignees(pruned) === placedAssignees(base.assignees)) return base;

  repos.bases.updateAssignees(base.id, pruned);
  return { ...base, assignees: pruned };
}

/** One officer as the §G page shows them: who is under them, and what that is worth (§G7). */
export function projectAssigneeOfficer(base: Base, officer: Commander): AssigneeOfficer {
  const placed = assigneesUnder(base.assignees, officer.id);
  return {
    officerId: officer.id,
    name: officer.name,
    role: officer.role,
    assignees: placed,
    bonusPercent: assigneeBonusPercent(placed),
    /** What one more would be worth — the number that makes the §G7 curve legible on the page. */
    nextBonusPercent:
      placed < assigneeCapPerOfficer(base.level) ? assigneeBonusPercent(placed + 1) : null,
  };
}

/** The whole §G screen in one payload. */
export function projectAssignees(base: Base): AssigneesResponse {
  return {
    level: base.level,
    pool: assigneePool(base.level),
    placed: placedAssignees(base.assignees),
    unplaced: unplacedAssignees(base.assignees, base.level),
    capPerOfficer: assigneeCapPerOfficer(base.level),
    maxBonusPercent: assigneeBonusPercent(assigneeCapPerOfficer(base.level)),
    /** §C4/§G4 — whether the player has a Professor, and so whether they can undo a placement. */
    canReskill: canReskill(base.commanders),
    /** §A1 — the Quarters' ceiling, which is the other thing that can stop a placement. */
    housing: { used: populationUsed(base), capacity: populationCapacity(base.buildings) },
    officers: base.commanders.map((officer) => projectAssigneeOfficer(base, officer)),
  };
}
