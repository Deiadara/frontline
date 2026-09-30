import { missionBoardKey, missionOffers, type Grade } from '@frontline/shared';

/**
 * What a launch names its card by (maintainer, 2026-09-29): the key of the board it was read off
 * and the grade it was dealt at. For a fixture that dealt the job itself off the board of the
 * moment, rather than reading an offer off the wire, which carries both.
 */
export function cardOn(
  areaId: string,
  grade: Grade,
  now: Date = new Date(),
): { boardKey: string; grade: Grade } {
  return { boardKey: missionBoardKey(areaId, now), grade };
}

/** {@link cardOn} for a job named by its template, found on the board a crew at `level` reads. */
export function cardFor(
  areaId: string,
  templateId: string,
  level: number,
  now: Date = new Date(),
): { boardKey: string; grade: Grade } {
  const boardKey = missionBoardKey(areaId, now);
  const job = missionOffers(areaId, boardKey, level).find((one) => one.template.id === templateId);
  if (!job) throw new Error(`fixture: ${templateId} is not on ${areaId}'s board at ${level}`);
  return { boardKey, grade: job.grade };
}
