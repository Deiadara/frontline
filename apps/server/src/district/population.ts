import { placedAssignees, populationCapacity, type Base } from '@frontline/shared';

/**
 * Who the district is housing (GDD §A1 the Quarters, §G the assignee pool, §H the officers).
 *
 * One definition of "used", read by both gates that enforce it — hiring an officer and placing an
 * assignee. Two separate counts would drift, and the failure would be silent: a district that let
 * you hire past its beds and then refused to place anybody reads as a bug, not as a rule.
 *
 * Unplaced assignees are deliberately **not** counted. §G2 hands them over on a level-up whether
 * or not there is anywhere to put them, so counting them would make a level-up able to retroactively
 * overfill a district the player had built correctly.
 */
export function populationUsed(base: Base): number {
  return base.commanders.length + placedAssignees(base.assignees);
}

/** Beds left, floored at zero — the number both gates actually compare against. */
export function housingSpare(base: Base): number {
  return Math.max(0, populationCapacity(base.buildings) - populationUsed(base));
}
