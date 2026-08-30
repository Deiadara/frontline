import { z } from 'zod';

/**
 * §G6, who is allowed to run a job, and what it costs to run it without an officer.
 *
 * "Hard missions and internal processes require an officer. Easy ones can be run without one, but
 * slower and with a lower success chance."
 *
 * The GDD says "by a delegation of assignees alone"; there is no assignee pool any more, so what
 * runs an officerless job is simply the units the player sent. Both halves are real branches here,
 * and both are exercised. The difficulty is authored on the
 * job (see `MissionTemplate.difficulty`), not inferred from its kind or its length: a day-long
 * standard expedition is not "easy" just because nobody shoots at you, and the board asked for a
 * hard/easy split, not a battle/standard one.
 */

export const MissionDifficultySchema = z.enum(['easy', 'hard']);
export type MissionDifficulty = z.infer<typeof MissionDifficultySchema>;

/** §G6: hard work needs somebody in charge. Internal processes read this too. */
export function requiresOfficer(difficulty: MissionDifficulty): boolean {
  return difficulty === 'hard';
}

/**
 * §G6: what running a job with nobody in charge costs.
 *
 * The GDD says "slower and with a lower success chance" without numbers, so these are W4's, in the
 * same spirit as W6's `PLAYER_XP_AWARDS`: half again as long, and a third off the odds.
 *
 * These used to be one factor of two in a product, multiplied by whatever the assignee pool was
 * worth, which meant a big enough delegation beat an officer outright. With the pool gone they are
 * the whole of it, and the rule reads the way §G6 states it: leading a job is always better than
 * not leading it.
 */
export const OFFICERLESS_DURATION_MULTIPLIER = 1.5;
export const OFFICERLESS_SUCCESS_MULTIPLIER = 0.67;

/**
 * §G6: a hard job with nobody in charge. The only way a launch is refused on staffing.
 *
 * There was a second, `nobody_to_send`, for an easy job with neither an officer nor an assignee to
 * delegate to. It went with the pool: what a mission actually sends is *units*, and having any is a
 * separate check the launch already makes.
 */
export type DelegationRefusal = 'needs_officer';

/**
 * The terms a job runs under: whether it may launch at all, and the two multipliers §G7 applies
 * to "both time reduction and power".
 *
 * The multipliers are reported even on a refusal so a pre-commit screen can show the player what
 * the run *would* cost once they fix the crew, without a second call and a second code path.
 */
export interface DelegationTerms {
  allowed: boolean;
  refusal: DelegationRefusal | null;
  /** Multiply the authored duration by this. Below 1 is faster; above 1 is the §G6 penalty. */
  durationMultiplier: number;
  /** Multiply the authored success chance by this. */
  successMultiplier: number;
}

/**
 * §G6 as the one answer a launch needs: may this go out, and on what terms.
 *
 * Two multipliers rather than one flag, because a refusal still has to be able to say what the run
 * *would* cost once the crew is fixed, and a pre-commit screen should not need a second call to
 * find out.
 */
export function delegationTerms(args: {
  difficulty: MissionDifficulty;
  hasOfficer: boolean;
}): DelegationTerms {
  const { difficulty, hasOfficer } = args;
  const terms = {
    durationMultiplier: hasOfficer ? 1 : OFFICERLESS_DURATION_MULTIPLIER,
    successMultiplier: hasOfficer ? 1 : OFFICERLESS_SUCCESS_MULTIPLIER,
  };

  if (!hasOfficer && requiresOfficer(difficulty)) {
    return { allowed: false, refusal: 'needs_officer', ...terms };
  }
  return { allowed: true, refusal: null, ...terms };
}

/** A duration in whole minutes under `terms`, floored at one: a job always takes some time. */
export function delegatedMinutes(minutes: number, terms: DelegationTerms): number {
  return Math.max(1, Math.round(minutes * terms.durationMultiplier));
}

/** A success chance under `terms`, kept inside 0..1: §G7 can push a 0.97 job past certainty. */
export function delegatedSuccessChance(chance: number, terms: DelegationTerms): number {
  return Math.min(1, Math.max(0, chance * terms.successMultiplier));
}
