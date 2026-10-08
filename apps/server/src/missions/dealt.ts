import { launchableBoardKeys, missionOffers, type DealtJob, type Grade } from '@frontline/shared';

/**
 * The card a launch names, if this crew may still take it; null for anything else.
 *
 * Exact card only (maintainer, 2026-09-29). The launch used to send the job and the area and let
 * the server find the first board that dealt that job, over the current and the previous misc
 * slot and the crew's level and the level below it. The client never shows two of those, and the
 * deal ships in the client bundle, so a crafted request could shop among twelve misc cards for
 * the grade and the clock it wanted. Now the request names the board's key and the grade it read,
 * and the card has to be on one of the boards the player can actually have been reading:
 *
 *   * the key of the moment, or the misc board's previous slot (`launchableBoardKeys`), for a card
 *     read at 10:59 and sent at 11:00;
 *   * the crew's level, or the level below it, for a card read just before a level-up
 *     (maintainer, 2026-09-29: "always allow previous"). It used to be open only while a level
 *     banked in the background was still unannounced; now the previous level's board is open
 *     whenever the current one is. Two levels down stays closed.
 */
export function namedCard(args: {
  areaId: string;
  templateId: string;
  boardKey: string;
  grade: Grade;
  /** The crew's level as the player read the board: before this request's own settle. */
  level: number;
  now: Date;
  /** The crew the board was dealt to (`missionDealer`). Empty is the shared deal. */
  dealer?: string;
}): DealtJob | null {
  if (!launchableBoardKeys(args.areaId, args.now).includes(args.boardKey)) return null;
  for (const level of [args.level, args.level - 1].filter((one) => one >= 1)) {
    const job = missionOffers(args.areaId, args.boardKey, level, args.dealer ?? '').find(
      (one) => one.template.id === args.templateId && one.grade === args.grade,
    );
    if (job) return job;
  }
  return null;
}
