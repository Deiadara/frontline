import type { MissionOffer } from './api.js';
import { BLUEPRINT_CATEGORIES } from './blueprints/index.js';
import {
  FAILED_MISSION_XP_SHARE,
  missionXp,
  payoutSlots,
  scaledSpoils,
  scaledSuccessChance,
} from './missions.areas.js';
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
 * tier, through the same functions the board priced the card with, so the two cannot disagree.
 *
 * Two things a card carries that a row cannot say exactly. The odds are read at the crew's level
 * *now*, since the row keeps the rolled chance rather than the authored one; and the ground's
 * cut of the clock is folded into the frozen minutes rather than quoted as a percentage. Both
 * are the card's decoration, not its pay.
 */
export function offerOfMission(
  mission: Mission,
  template: MissionTemplate,
  level: number,
): MissionOffer {
  const timings = missionTimings(mission);
  const priced = pricedTotalMinutes(mission);
  const rewards = scaledSpoils(
    missionRewards(template, 'success', priced, mission.battleTier),
    mission.payPercent,
  );
  const xp = mission.xp > 0 ? mission.xp : missionXp(template, priced, level, mission.battleTier);
  return {
    templateId: template.id,
    name: template.name,
    brief: template.brief,
    kind: template.kind,
    difficulty: template.difficulty,
    travelMinutes: timings.travelMinutes,
    durationMinutes: timings.durationMinutes,
    totalMinutes: timings.totalMinutes,
    rawTravelMinutes: TRAVEL_BAND_MINUTES[template.travelBand],
    rawDurationMinutes: template.durationMinutes,
    speedPercent: 0,
    rewards,
    payoutSlots: Math.round(payoutSlots(rewards, RESOURCE_KG)),
    xp,
    failedXp: Math.round(xp * FAILED_MISSION_XP_SHARE),
    pagePrize:
      mission.pagePrize !== null &&
      (BLUEPRINT_CATEGORIES as readonly string[]).includes(mission.pagePrize)
        ? mission.pagePrize
        : null,
    authoredChance: scaledSuccessChance(template.successChance, level),
    leanings: [...leaningsFor(template)],
    battleTier: mission.battleTier,
  };
}
