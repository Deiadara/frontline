import {
  assigneeCapPerOfficer,
  assigneesUnder,
  delegationTerms,
  unplacedAssignees,
  type Base,
  type Commander,
  type DelegationTerms,
  type MissionTemplate,
} from '@frontline/shared';

/**
 * Who goes out on a run, and on what terms (GDD §G5-§G7).
 *
 * This is the §G6 branch: a hard mission needs an officer leading it, an easy one can go out on a
 * delegation of assignees alone. Which of the two it is comes off `template.difficulty`, and the
 * multipliers the crew earns come off the §G7 table: both live in `@frontline/shared`, so this
 * file only decides *who is in the crew*, never what they are worth.
 */

/** The crew a launch request is asking for. */
export interface CrewRequest {
  base: Base;
  template: MissionTemplate;
  /**
   * The officer leading the run, or absent for a §G6 delegation.
   *
   * This is the resolved officer, not an id: whether a *named* officer exists is the caller's
   * question, because "you asked for somebody who does not work here" is a 404 and not a quieter,
   * slower mission. Taking an id here once meant a typo'd officer silently ran as an unled
   * delegation and cost the player the §G6 penalty with nothing on screen to explain it.
   */
  officer?: Commander | undefined;
}

export interface Crew {
  hasOfficer: boolean;
  /** How many assignees are behind this run. */
  assignees: number;
  terms: DelegationTerms;
}

/**
 * Resolves the crew for a run.
 *
 * With an officer, the run is backed by the assignees already standing under them (§G5): the
 * player's placement decision *is* the crew, which is what makes §G2 placement matter beyond a
 * number on a screen.
 *
 * Without one, §G6's "delegation of assignees alone" is drawn from the *unplaced* pool, bounded by
 * the same §G3 cap an officer's team obeys. Drawing from the unplaced pool rather than raiding
 * placed teams is the conservative reading: it never silently borrows people the player deliberately
 * assigned somewhere, and it keeps a delegation the same size a single officer could lead.
 */
export function resolveCrew({ base, template, officer }: CrewRequest): Crew {
  const assignees = officer
    ? assigneesUnder(base.assignees, officer.id)
    : Math.min(unplacedAssignees(base.assignees, base.level), assigneeCapPerOfficer(base.level));

  return {
    hasOfficer: officer !== undefined,
    assignees,
    terms: delegationTerms({
      difficulty: template.difficulty,
      hasOfficer: officer !== undefined,
      assignees,
    }),
  };
}
