import {
  delegationTerms,
  type Base,
  type Commander,
  type DelegationTerms,
  type MissionTemplate,
} from '@frontline/shared';

/**
 * Who goes out on a run, and on what terms (GDD §G5-§G7).
 *
 * This is the §G6 branch: a hard mission needs an officer leading it, an easy one can go out
 * without. Which of the two it is comes off `template.difficulty` and the terms come from
 * `delegationTerms`, both in `@frontline/shared`, so this file only decides *who is leading*, never
 * what that is worth.
 */

/** The crew a launch request is asking for. */
export interface CrewRequest {
  base: Base;
  template: MissionTemplate;
  /**
   * The officer leading the run, or absent for an unled one.
   *
   * This is the resolved officer, not an id: whether a *named* officer exists is the caller's
   * question, because "you asked for somebody who does not work here" is a 404 and not a quieter,
   * slower mission. Taking an id here once meant a typo'd officer silently ran unled and cost the
   * player the §G6 penalty with nothing on screen to explain it.
   */
  officer?: Commander | undefined;
}

export interface Crew {
  hasOfficer: boolean;
  terms: DelegationTerms;
}

/**
 * Resolves the crew for a run.
 *
 * Whether somebody is leading it is now the whole of it (§G6).
 *
 * It used to also count the assignees standing under that officer, or, with no officer, draw a
 * delegation from the unplaced pool. There is no pool: a run is led or it is not, and a run that is
 * not is slower and likelier to come home empty.
 */
export function resolveCrew({ template, officer }: CrewRequest): Crew {
  return {
    hasOfficer: officer !== undefined,
    terms: delegationTerms({
      difficulty: template.difficulty,
      hasOfficer: officer !== undefined,
    }),
  };
}
