import type { MissionOffer } from './api.js';
import {
  FAILED_MISSION_XP_SHARE,
  missionBoardKey,
  missionXp,
  payoutSlots,
  scaledSpoils,
} from './missions.areas.js';
import { leaningsFor } from './missions.leading.js';
import {
  TRAVEL_BAND_MINUTES,
  missionRewards,
  missionTimings,
  pricedTotalMinutes,
  templateTimings,
  type Mission,
  type MissionTemplate,
} from './missions.js';
import { boostedXp } from './progression/state.js';
import { RESOURCE_KG } from './raid.js';

/**
 * The card a run was taken off, rebuilt from the row (maintainer, 2026-09-23).
 *
 * The Monitor shows a crew's job as the card it was chosen from, and the missions page says what
 * a run that is out is worth. Neither can re-read the board: the board has turned over, the crew
 * may have levelled, and the run keeps the terms it left under. So the card is drawn from what
 * the row froze, the clock (`missionTimings`), the priced total, the pay premium, the XP and the
 * grade, through the same functions the board priced the card with, so the two cannot disagree.
 *
 * One thing a card carries that a row cannot say exactly: the ground's cut of the clock is folded
 * into the frozen minutes rather than quoted as a percentage. It is the card's decoration, not its
 * pay. A row from before grades reads as the job's lowest.
 */
/**
 * A card's two XP figures as the return banks them: a clean run's, and a failure's share of it,
 * each with the district's and the crew's bonus on (`boostedXp`). The row freezes the job's own
 * figure and the award adds the bonus, so a card printing the frozen figure quoted 200 for a run
 * that paid 214 (bug pass, 2026-10-02).
 */
export function offerXp(xp: number, bonusPercent = 0): Pick<MissionOffer, 'xp' | 'failedXp'> {
  return {
    xp: boostedXp(xp, bonusPercent),
    failedXp: boostedXp(Math.round(xp * FAILED_MISSION_XP_SHARE), bonusPercent),
  };
}

export function offerOfMission(
  mission: Mission,
  template: MissionTemplate,
  /** `MissionsResponse.xpBonusPercent`: what the return adds to the frozen XP. */
  xpBonusPercent = 0,
): MissionOffer {
  const grade = mission.grade ?? template.grades[0];
  const timings = missionTimings(mission);
  const priced = pricedTotalMinutes(mission);
  /*
   * The area's premium, then the Bounty Wall's gold, which is the order the settle pays them in
   * (`missions/resolve.ts`). The gold was missing here until 2026-10-07: a golden run already out
   * was drawn with its gold border and "+N% bounty" on the card and quoted the plain haul beside
   * it, so the Missions page promised less than the return paid. Same failure the note on
   * `haulPercent` records, one channel along.
   */
  const rewards = scaledSpoils(
    scaledSpoils(missionRewards(template, 'success', priced, grade), mission.payPercent),
    mission.goldenPercent ?? 0,
  );
  const xp = mission.xp > 0 ? mission.xp : missionXp(template, priced, grade);
  return {
    templateId: template.id,
    // The board of the moment it left, which is the one it was taken off or the slot after it. A
    // card of a run already out is never sent back, so the key is only the card's identity.
    boardKey: missionBoardKey(mission.areaId, new Date(mission.startedAt)),
    name: template.name,
    brief: template.brief,
    kind: template.kind,
    grade,
    travelMinutes: timings.travelMinutes,
    durationMinutes: timings.durationMinutes,
    totalMinutes: timings.totalMinutes,
    rawTravelMinutes: TRAVEL_BAND_MINUTES[template.travelBand],
    // At the row's grade, as `offerFor` quotes it: a harder mark keeps the crew on site longer,
    // and the authored figure is the job's lowest grade only.
    rawDurationMinutes: templateTimings(template, grade).durationMinutes,
    /*
     * Null, because a run that is already out has nothing left to quote.
     *
     * The band shortens the clock a run is *sent* on, and this card is drawn from a row whose
     * clock was frozen at launch: `timings` above is the ramped one. The field exists for the send
     * dialog, which is the one reader that starts from the raw template.
     */
    ramp: null,
    speedPercent: 0,
    rewards,
    payoutSlots: Math.round(payoutSlots(rewards, RESOURCE_KG)),
    ...offerXp(xp, xpBonusPercent),
    leanings: [...leaningsFor(template)],
    // The Bounty Wall's gold is frozen on the run at launch; the card of a run out carries it back.
    golden: (mission.goldenPercent ?? 0) > 0,
    goldenPercent: mission.goldenPercent ?? 0,
  };
}
