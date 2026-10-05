import {
  type EarlyRampBand,
  TRAVEL_BAND_MINUTES,
  offerXp,
  MISC_AREA_ID,
  RESOURCE_KG,
  areaPayPercent,
  leaningsFor,
  missionXp,
  templateTimings,
  ALL_DISTRICTS,
  areaIsOpen,
  isContested,
  isHeldBy,
  missionBoardKey,
  missionOffers,
  missionWalkMinutes,
  missionSpeedPercentIn,
  missionRewards,
  payoutSlots,
  scaledSpoils,
  withMissionCaps,
  type Base,
  type District,
  type Grade,
  type MissionArea,
  type MissionOffer,
  type MissionTemplate,
  type AreaAvailability,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import type { StoredMission } from '../db/repos/missions.js';
import { pricedTimings } from './pricing.js';

/**
 * The mission board, per area (GDD §E, §A4).
 *
 * One board for work that belongs to nobody, and one for every *contested* district this crew
 * holds at least one location in, whole or not (maintainer, 2026-09-29). A residential district
 * was never work in the first place: see `areaIsOpen` in `missions.areas.ts` for the rule.
 *
 * What an area offers is a function of the area, its key and this crew's level (`missionOffers`),
 * so the board is stable for a crew and a player can plan against it. What it *pays* is set by the
 * grade each card was dealt at, with the ground's premium on top, which is what makes pushing
 * outwards worth the walk.
 */

/**
 * How much of each district this crew holds, which is all the board needs to know about one.
 *
 * Every district in the world rather than one city's (2026-09-24). Both callers ask it about ground
 * they name: the read hands it to `projectAreas` beside the districts of the city being read, and
 * the launch route asks it about the one area a request named, which may be in any city. The whole
 * atlas is thirty-odd districts against one already-loaded control map, so the walk costs nothing.
 */
export function areaStatesFor(repos: Repositories, base: Base): Map<string, AreaAvailability> {
  const controls = repos.city.controls();
  const states = new Map<string, AreaAvailability>();
  for (const district of ALL_DISTRICTS) {
    const heldByCrew = district.locations.filter((location) => {
      const control = controls.get(location.id);
      return control !== undefined && isHeldBy(control, base.id);
    }).length;
    states.set(district.id, { heldByCrew });
  }
  return states;
}

/**
 * One job at the grade it was dealt, priced for the ground it is offered on.
 *
 * The grade sets the pay, the XP, the clock and the odds (`missions.grade.ts`), and the district's
 * premium (`areaPayPercent`) goes on top. The crew's level plays no part here: it decided which
 * grade the card was dealt at, and that is all it does (maintainer, 2026-09-28).
 */
export function offerFor(
  template: MissionTemplate,
  grade: Grade,
  /** The board it was dealt from, which the launch names back (`MissionOffer.boardKey`). */
  boardKey: string,
  payPercent: number,
  /**
   * What the crew's own standing does to the clock, off `standingEffectsFor`.
   *
   * The card used to be priced off the bare template while the launch froze the modified numbers,
   * so the two disagreed in both directions and the error grew with everything the player had
   * bought. `missionRewards` scales by `rewardScale(totalMinutes)`, which is monotonic in the
   * clock, so a crew holding the Smuggler's Tunnel finished sooner and was therefore paid *less*
   * than the card promised, and the quoted countdown was the unmodified one as well.
   *
   * What a card still cannot quote is the column: `columnSpeed` is a fact about the people and the
   * machines the player has not chosen yet when they read this. That is the right side of the line,
   * because the card is a quote for the job as offered rather than for a plan, and it is the same
   * number `launchMission` freezes into `pricedMinutes` and pays out against.
   */
  speedPercent = 0,
  /**
   * The opening band this crew is in, or null (`missions.ramp.ts`).
   *
   * The clock only. The band's pay premium is already inside `payPercent` above, folded in by
   * `projectAreas` with the ground's, because that is the figure the card prints
   * and the launch freezes.
   */
  ramp: EarlyRampBand | null = null,
  /** The walk to a job in another city (`missionWalkMinutes`), on the raw road and the price. */
  walkMinutes = 0,
  /** Cap Counter's cut of the caps (`withMissionCaps`), which the return pays off the same fold. */
  capsPercent = 0,
  /** The district's and the crew's XP bonus (`missionXpBonusPercent`, the Professor included), which the return adds. */
  xpBonusPercent = 0,
  /** What an officer leading the run adds to the pay (`leadLootPercent`), quoted as `ledRewards`. */
  leadLootPercent = 0,
): MissionOffer {
  const timings = pricedTimings(template, grade, speedPercent, ramp, walkMinutes);
  const paid = (percent: number) =>
    withMissionCaps(
      scaledSpoils(missionRewards(template, 'success', timings.totalMinutes, grade), percent),
      capsPercent,
    );
  const rewards = paid(payPercent);
  const xp = missionXp(template, timings.totalMinutes, grade);
  return {
    templateId: template.id,
    boardKey,
    name: template.name,
    brief: template.brief,
    kind: template.kind,
    grade,
    travelMinutes: timings.travelMinutes,
    durationMinutes: timings.durationMinutes,
    totalMinutes: timings.totalMinutes,
    // The same numbers before anything was taken off them, so the send dialog can run the launch's
    // own arithmetic rather than approximating it on figures already reduced and rounded once.
    rawTravelMinutes: TRAVEL_BAND_MINUTES[template.travelBand] + walkMinutes,
    rawDurationMinutes: templateTimings(template, grade).durationMinutes,
    // The band itself, so the send dialog can apply it to the figures above the way the
    // launch does. Without it the dialog quotes the bare template and a crew in the opening
    // band reads 1h 50m on a job that runs for two minutes.
    ramp,
    speedPercent,
    rewards,
    ...(leadLootPercent > 0 && { ledRewards: paid(payPercent + leadLootPercent) }),
    payoutSlots: Math.round(payoutSlots(rewards, RESOURCE_KG)),
    ...offerXp(xp, xpBonusPercent),
    // The gauge grades whichever leader the player is looking at against these and the grade,
    // through `missionOdds`, the same function the launch prices with.
    leanings: [...leaningsFor(template)],
  };
}

/**
 * Every board this crew may read, `misc` first and then the districts in map order.
 *
 * An area with a crew of this crew's already in it reports no offers at all and names the mission
 * instead: taking one job closes the other two until that crew is home, which is what makes a
 * district a commitment rather than a queue.
 */
export function projectAreas(
  districts: readonly District[],
  states: Map<string, AreaAvailability>,
  active: readonly StoredMission[],
  /**
   * The crew reading it: its level decides which grades each board deals, and its home district
   * how far away a job in another city is (`missionWalkMinutes`).
   */
  crew: Pick<Base, 'level' | 'districtId'>,
  /**
   * When the boards are being read, which is what each one's key is derived from.
   *
   * A `Date` rather than the day string it used to be, because the two boards no longer turn
   * over together: a district's key is still its game day (midnight, Athens) and `misc` carries
   * a slot within that day as well (`missionBoardKey`). Passing the day here would have made
   * that impossible to express without a second parameter nobody would remember to pass.
   */
  now: Date,
  /**
   * What this crew's standing is worth on a run, so the card quotes what the launch will freeze.
   *
   * Both channels, because both are frozen at launch and neither was quoted: the ground's speed
   * (the Smuggler's Tunnel) shortens the clock, and the crew's own cut (`missionSpoilsPercent`)
   * widens the pay. Defaulted so a caller that does not have them still gets the old, bare quote
   * rather than a compile error at every call site.
   */
  standing: {
    speedPercent?: number;
    /** Speed that pays only on one city's boards, by city id (`missionSpeedPercentByCity`). */
    citySpeedPercent?: Record<string, number>;
    spoilsPercent?: number;
    /** Cap Counter's cut of a job's caps (`missionCapsPercent`), quoted as the return pays it. */
    capsPercent?: number;
    /** The XP bonus every job is paid with (`missionXpBonusPercent`, the Professor included), quoted as the return pays it. */
    xpBonusPercent?: number;
    /** An officer's loot perks, paid only on a run an officer leads (`MissionOffer.ledRewards`). */
    leadLootPercent?: number;
    ramp?: EarlyRampBand | null;
  } = {},
): MissionArea[] {
  const runningIn = new Map(active.map((stored) => [stored.mission.areaId, stored.mission.id]));

  const board = (id: string, name: string, blurb: string, difficulty: number): MissionArea => {
    const activeMissionId = runningIn.get(id) ?? null;
    const key = missionBoardKey(id, now);
    // The ground's premium and the crew's own cut, folded into one figure the card quotes.
    const payPercent =
      areaPayPercent(id) +
      (standing.spoilsPercent ?? 0) +
      // The opening band's premium, which is what stops a two-minute first job paying two minutes
      // of loot (`missions.ramp.ts`). Zero once the crew is out of the ramp.
      (standing.ramp?.payPercent ?? 0);
    return {
      id,
      name,
      blurb,
      difficulty,
      payPercent,
      offers:
        activeMissionId === null
          ? missionOffers(id, key, crew.level).map((job) =>
              offerFor(
                job.template,
                job.grade,
                key,
                payPercent,
                missionSpeedPercentIn(
                  {
                    missionSpeedPercent: standing.speedPercent ?? 0,
                    missionSpeedPercentByCity: standing.citySpeedPercent ?? {},
                  },
                  id,
                ),
                standing.ramp ?? null,
                missionWalkMinutes(crew.districtId, id),
                standing.capsPercent ?? 0,
                standing.xpBonusPercent ?? 0,
                standing.leadLootPercent ?? 0,
              ),
            )
          : [],
      activeMissionId,
    };
  };

  return [
    board(
      MISC_AREA_ID,
      'Miscellaneous Missions',
      'Work that belongs to nobody. Hold a place in a district and its board opens too.',
      1,
    ),
    ...districts
      .filter(isContested)
      .filter((district) => {
        const state = states.get(district.id);
        return state !== undefined && areaIsOpen(district, state);
      })
      .map((district) => board(district.id, district.name, district.blurb, district.difficulty)),
  ];
}
