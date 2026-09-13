import {
  missionCompletesAt,
  officerIsInjured,
  type Base,
  type Commander,
  type LeaderHold,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * Whether an officer is free to be sent somewhere.
 *
 * Three systems dispatch an officer and each used to check only its own table: `/battles/lead`
 * refused an officer already leading another unresolved battle, `/missions` checked injury and
 * nothing else, and `sendScout` checked that the *crew* had no run out rather than that the
 * *officer* was free. So one officer could hold three jobs at once: launch a six-hour mission with
 * X at 15:00, send X scouting at 15:05, name X to lead the 21:00 fight at 15:10, and at the mark
 * `leaderFor` finds X on the books, not injured, and puts their sheet and their leading perks into
 * the battle while X is out on a job and walking home from another district. The crew pays one
 * wage and collects three officers' worth of sheet.
 *
 * That is word for word the argument `leadingElsewhere`'s own doc makes about one officer at the
 * head of every declared battle, applied across systems instead of within one.
 *
 * §D4 is here too, because "injured" is the same question wearing a different hat: an officer whose
 * services and bonuses are inactive is not somebody a crew can send anywhere.
 *
 * The answer is a {@link LeaderHold}, the same four the wire hands the screen and the same four
 * `LEADER_HOLD_MESSAGES` puts into a refusal, so a name the picker draws dimmed and a name a route
 * turns away are held for the same stated reason.
 */
export interface OfficerHold {
  readonly held: LeaderHold;
  /**
   * When they are free again, or null.
   *
   * Known for three of the four: the run comes home at `missionCompletesAt`, the scouting party at
   * `returnsAt`, the injury ends at `injuredUntil`. A declared fight has no such mark, because what
   * frees the officer is the fight resolving and that is the world clock's business, not a clock
   * the crew can read off the row.
   */
  readonly until: string | null;
}

/**
 * What is already claiming this officer, or `null`.
 *
 * Asked in one order and answered with one reason: a person is in one place, so the first thing
 * that holds them is the thing that holds them. Injury first because it holds them wherever they
 * are, then the three doors in the order they came.
 *
 * `exceptBattleId` is for the lead route itself: naming the officer who is already leading *this*
 * fight is a no-op, not a double booking.
 */
export function officerDuty(
  repos: Repositories,
  base: Base,
  officer: Commander,
  now: Date,
  exceptBattleId?: string,
): OfficerHold | null {
  if (officerIsInjured(officer.injuredUntil, now)) {
    return { held: 'injury', until: officer.injuredUntil };
  }
  if (repos.sieges.leadingElsewhere(officer.id, exceptBattleId ?? '').length > 0) {
    return { held: 'fight', until: null };
  }
  const run = repos.missions
    .listActiveByBaseId(base.id)
    .find((entry) => entry.mission.officerId === officer.id);
  if (run) return { held: 'run', until: missionCompletesAt(run.mission).toISOString() };
  const scouting = repos.scouting
    .activeFor(base.id)
    .find((entry) => entry.officerId === officer.id);
  if (scouting) return { held: 'scouting', until: scouting.returnsAt };
  return null;
}
