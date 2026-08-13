import { z } from 'zod';
import { assigneePowerMultiplier, assigneeSpeedMultiplier } from './bonus.js';

/**
 * §G6 — who is allowed to run a job, and what it costs to run it without an officer.
 *
 * "Hard missions and internal processes require an officer. Easy ones can be run by a delegation
 * of assignees alone — but slower and with a lower success chance."
 *
 * Both halves are real branches here, and both are exercised. The difficulty is authored on the
 * job (see `MissionTemplate.difficulty`), not inferred from its kind or its length: a day-long
 * standard expedition is not "easy" just because nobody shoots at you, and the board asked for a
 * hard/easy split, not a battle/standard one.
 */

export const MissionDifficultySchema = z.enum(['easy', 'hard']);
export type MissionDifficulty = z.infer<typeof MissionDifficultySchema>;

/** §G6 — hard work needs somebody in charge. Internal processes read this too. */
export function requiresOfficer(difficulty: MissionDifficulty): boolean {
  return difficulty === 'hard';
}

/**
 * §G6 — what running on assignees alone costs.
 *
 * The GDD says "slower and with a lower success chance" without numbers, so these are W4's, in the
 * same spirit as W6's `PLAYER_XP_AWARDS`: half again as long, and a third off the odds.
 *
 * What §G6 actually fixes is the comparison at a *fixed* crew — the same people are slower and
 * likelier to fail with nobody in charge — and that is the invariant the tests pin. It is not a
 * claim that an officerless run always loses to an officer-led one: twelve assignees with no
 * officer (1.5 × 0.5 = 0.75) do beat a bare officer with nobody under them (1.0), and they should.
 * Twelve people is a lot of labour, and §G3 already rations it — reaching a delegation that size
 * costs level 24, by which point the crew has officers to spare.
 */
export const OFFICERLESS_DURATION_MULTIPLIER = 1.5;
export const OFFICERLESS_SUCCESS_MULTIPLIER = 0.67;

export type DelegationRefusal =
  /** §G6 — a hard job with nobody in charge. */
  | 'needs_officer'
  /** An easy job with neither an officer nor a single assignee to send. */
  | 'nobody_to_send';

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
 * §G5/§G6/§G7 rolled into the one answer a launch needs.
 *
 * `assignees` is the number standing behind this job: those placed under the officer leading it,
 * or the size of the delegation when there is no officer.
 */
export function delegationTerms(args: {
  difficulty: MissionDifficulty;
  hasOfficer: boolean;
  assignees: number;
}): DelegationTerms {
  const { difficulty, hasOfficer, assignees } = args;
  const officerless = hasOfficer ? 1 : OFFICERLESS_DURATION_MULTIPLIER;
  const odds = hasOfficer ? 1 : OFFICERLESS_SUCCESS_MULTIPLIER;

  const terms = {
    durationMultiplier: assigneeSpeedMultiplier(assignees) * officerless,
    successMultiplier: assigneePowerMultiplier(assignees) * odds,
  };

  if (!hasOfficer && requiresOfficer(difficulty)) {
    return { allowed: false, refusal: 'needs_officer', ...terms };
  }
  if (!hasOfficer && assignees < 1) {
    return { allowed: false, refusal: 'nobody_to_send', ...terms };
  }
  return { allowed: true, refusal: null, ...terms };
}

/** A duration in whole minutes under `terms`, floored at one — a job always takes some time. */
export function delegatedMinutes(minutes: number, terms: DelegationTerms): number {
  return Math.max(1, Math.round(minutes * terms.durationMultiplier));
}

/** A success chance under `terms`, kept inside 0..1 — §G7 can push a 0.97 job past certainty. */
export function delegatedSuccessChance(chance: number, terms: DelegationTerms): number {
  return Math.min(1, Math.max(0, chance * terms.successMultiplier));
}
