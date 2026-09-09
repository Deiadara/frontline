import {
  TRAVEL_BAND_MINUTES,
  hastenedMinutes,
  hastenedRoadMinutes,
  missionTimings,
  type MissionTemplate,
  type MissionTimings,
} from '@frontline/shared';

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
 *   * **§G6's delegation penalty.** A run with nobody in charge takes half again as long
 *     (`delegatedMinutes`), and pricing off that paid an unled crew *more* for being short-staffed.
 *     `delegation.ts` says leading is always better than not leading; this is what makes that true
 *     of the cheque as well as of the clock.
 *   * **Admin mode.** The card is not admin-aware and quotes the real clock, so the price is the
 *     real price. The testing build skips the wait, not the economy (`admin/mode.ts`).
 *
 * All four still shorten or lengthen the clock the crew actually runs on: see `launchMission`'s
 * `timings`, which is what the countdown and the settle's due check read.
 */
export function pricedTimings(template: MissionTemplate, speedPercent: number): MissionTimings {
  return missionTimings({
    travelMinutes: hastenedRoadMinutes(TRAVEL_BAND_MINUTES[template.travelBand], 0, speedPercent),
    durationMinutes: hastenedMinutes(template.durationMinutes, speedPercent),
  });
}
