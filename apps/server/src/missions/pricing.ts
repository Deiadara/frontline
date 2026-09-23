import {
  earlyMissionRamp,
  TRAVEL_BAND_MINUTES,
  hastenedMinutes,
  hastenedRoadMinutes,
  missionTimings,
  rampedTimings,
  type EarlyRampBand,
  type MissionTemplate,
  type MissionTimings,
  type Base,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';

/**
 * The clock a run's pay is quoted on: the card's own, and the only one the settle is allowed to
 * price against.
 *
 * One function because there are two readers and they must not be able to disagree. `offerFor`
 * draws the card off it (`missions/board.ts`) and `launchMission` freezes its total onto the row as
 * `pricedMinutes` (`missions/launch.ts`), which `resolveDueMissions` then pays and awards XP
 * against. They were two copies of the same arithmetic with different inputs, and every input that
 * was in one and not the other showed up as a crew paid something other than the number they read.
 *
 * ## What is in it, and what is deliberately not
 *
 * In: `speedPercent`, the crew's own standing (§A4's Smuggler's Tunnel and anything else on
 * `missionSpeedPercent`). It is a fact about the crew that is true when the card is drawn, so the
 * card can quote it and the settle can honour it.
 *
 * Out, and each for the same reason, that the card cannot know it and a player reading the card
 * would be told one number and paid another:
 *
 *   * **The column.** `roadMinutes` divides the travel leg by the pace of whoever is sent, and who
 *     is sent is chosen after the card is read. Speed 0 here, so the Garage buys a shorter wait
 *     rather than a smaller cheque. This half was already right and is the precedent for the rest.
 *   * **§D5's `leadArrivalPercent`.** The officer leading is picked after the card too, and
 *     `rewardScale` is monotonic in the minutes, so folding a Short Way in here paid a crew *less*
 *     for bringing their fastest leader. That is the §A4 bug this function's shape was written
 *     against, one channel along.
 *   * **Admin mode.** The card is not admin-aware and quotes the real clock, so the price is the
 *     real price. The testing build skips the wait, not the economy (`admin/mode.ts`).
 *
 * All three still shorten or lengthen the clock the crew actually runs on: see `launchMission`'s
 * `timings`, which is what the countdown and the settle's due check read.
 *
 * There was a fourth, §G6's old officerless penalty, which made an unled run half again as long.
 * Leading a job moves its odds now and not its clock (`missions.leading.ts`), so there is nothing
 * left to leave out.
 */
export function pricedTimings(
  template: MissionTemplate,
  speedPercent: number,
  /**
   * The opening band this crew is in, or null once they are out of it (`missions.ramp.ts`).
   *
   * In here rather than in the caller, and for the same reason everything else in this function
   * is: the card and the launch both read this, so a band applied in one and not the other is a
   * crew quoted one clock and run on another. It is applied *after* the crew's own speed, so a
   * Smuggler's Tunnel does not shorten a run that is already down to two minutes.
   */
  ramp: EarlyRampBand | null = null,
): MissionTimings {
  const timings = missionTimings({
    travelMinutes: hastenedRoadMinutes(TRAVEL_BAND_MINUTES[template.travelBand], 0, speedPercent),
    durationMinutes: hastenedMinutes(template.durationMinutes, speedPercent),
  });
  return ramp === null ? timings : rampedTimings(timings, ramp);
}

/**
 * The opening band a crew is in, read off the two things that decide it.
 *
 * One function because three callers need the same answer and must not be able to disagree: the
 * board that draws the cards, the board the launch answers with, and the launch itself, which
 * freezes the band's clock and premium onto the row. The count is the lifetime `missions_done`
 * tally, which is the same number the feats board reads, so a run that finished is a run that
 * counted whether or not the player has looked at the ledger.
 */
export function rampFor(repos: Repositories, base: Base): EarlyRampBand | null {
  return earlyMissionRamp(base.level, repos.feats.tallies(base.id).missions_done ?? 0);
}
