import { officerIsInjured, type Base, type Commander } from '@frontline/shared';
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
 */
export type OfficerDuty = 'injured' | 'battle' | 'mission' | 'scouting';

/**
 * What is already claiming this officer, or `null`.
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
): OfficerDuty | null {
  if (officerIsInjured(officer.injuredUntil, now)) return 'injured';
  if (repos.sieges.leadingElsewhere(officer.id, exceptBattleId ?? '').length > 0) return 'battle';
  if (
    repos.missions.listActiveByBaseId(base.id).some((run) => run.mission.officerId === officer.id)
  ) {
    return 'mission';
  }
  if (repos.scouting.activeFor(base.id).some((run) => run.officerId === officer.id)) {
    return 'scouting';
  }
  return null;
}

/** The same answer in the player's words, for a route that has to say why. */
export const OFFICER_DUTY_MESSAGES: Record<OfficerDuty, string> = {
  injured: 'is still laid up',
  battle: 'is already leading another fight. Stand them down there first',
  mission: 'is already out on a job',
  scouting: 'is already out scouting',
};
