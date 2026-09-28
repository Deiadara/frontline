import type { MissionOffer } from './api.js';
import { FAILED_MISSION_XP_SHARE, missionXp, payoutSlots, scaledSpoils } from './missions.areas.js';
import { leaningsFor } from './missions.leading.js';
import {
  TRAVEL_BAND_MINUTES,
  missionRewards,
  missionTimings,
  pricedTotalMinutes,
  type Mission,
  type MissionTemplate,
} from './missions.js';
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
export function offerOfMission(mission: Mission, template: MissionTemplate): MissionOffer {
  const grade = mission.grade ?? template.grades[0];
  const timings = missionTimings(mission);
  const priced = pricedTotalMinutes(mission);
  const rewards = scaledSpoils(
    missionRewards(template, 'success', priced, grade),
    mission.payPercent,
  );
  const xp = mission.xp > 0 ? mission.xp : missionXp(template, priced, grade);
  return {
    templateId: template.id,
    name: template.name,
    brief: template.brief,
    kind: template.kind,
    grade,
    travelMinutes: timings.travelMinutes,
    durationMinutes: timings.durationMinutes,
    totalMinutes: timings.totalMinutes,
    rawTravelMinutes: TRAVEL_BAND_MINUTES[template.travelBand],
    rawDurationMinutes: template.durationMinutes,
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
    xp,
    failedXp: Math.round(xp * FAILED_MISSION_XP_SHARE),
    leanings: [...leaningsFor(template)],
  };
}
