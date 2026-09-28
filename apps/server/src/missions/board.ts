import {
  type EarlyRampBand,
  TRAVEL_BAND_MINUTES,
  FAILED_MISSION_XP_SHARE,
  MISC_AREA_ID,
  RESOURCE_KG,
  areaPayPercent,
  leaningsFor,
  missionXp,
  templateTimings,
  ALL_DISTRICTS,
  areaIsOpen,
  districtHolder,
  missionBoardKey,
  missionOffers,
  missionRewards,
  payoutSlots,
  scaledSpoils,
  type Base,
  type District,
  type Grade,
  type MissionArea,
  type MissionOffer,
  type MissionTemplate,
  type AreaAvailability,
  type LocationHolder,
} from '@frontline/shared';
import { cityContextFor } from '../city/view.js';
import type { Repositories } from '../db/repos/index.js';
import type { StoredMission } from '../db/repos/missions.js';
import { pricedTimings } from './pricing.js';

/**
 * The mission board, per area (GDD §E, §A4).
 *
 * One board for work that belongs to nobody, and one for every *contested* district this crew has
 * scouted that nobody holds end to end. A district behind an armed gate comes off the board,
 * whoever armed it, and a residential district was never work in the first place: see
 * `areaIsOpen` in `missions.areas.ts` for the rule and why it moved (maintainer, 2026-09-21).
 *
 * What an area offers is a function of the area, its key and this crew's level (`missionOffers`),
 * so the board is stable for a crew and a player can plan against it. What it *pays* is set by the
 * grade each card was dealt at, with the ground's premium on top, which is what makes pushing
 * outwards worth the walk.
 */

/** Everything the board needs to know about a district, read once per request. */
export interface AreaState extends AreaAvailability {
  /**
   * Who holds it end to end, when somebody does. `null` while it is still split.
   *
   * Carried beside the boolean so the launch route can word its refusal for the party actually
   * behind the gate: "you own every inch of it" and "the Combine holds every inch of it" are the
   * same rule and very different sentences.
   */
  wholeHolder: LocationHolder | null;
}

/**
 * Whether there is work to be had in a district, read off the world and not off the reader.
 *
 * One party holding every location is what arms its gate (`city/control.ts`), and that is the
 * whole of the rule: it does not matter whether the party is the Combine, the looters, a rival or
 * this crew. `districtHolder` is the same function the §A4 unified bonus turns on, so a district
 * that pays somebody the unified bonus is exactly a district with no board, and the two cannot
 * drift apart.
 *
 * Every district in the world rather than Ashfall's twelve (2026-09-24). This is a lookup keyed by
 * district id and both its callers ask it about ground they name: the read hands it to
 * `projectAreas` beside the districts of the city being read, and the launch route asks it about
 * the one area a request named, which may be in any city the crew may enter. Taking a city
 * parameter instead would put the same "which city is this" decision at two call sites, and the
 * one that got it wrong would refuse a real Terminus district as unscouted. The whole atlas is
 * thirty-odd districts against one already-loaded control map, so the walk costs nothing.
 */
export function areaStatesFor(repos: Repositories, base: Base): Map<string, AreaState> {
  const context = cityContextFor(repos, base);
  const states = new Map<string, AreaState>();
  for (const district of ALL_DISTRICTS) {
    const holder = districtHolder(district, context.controls);
    states.set(district.id, {
      scouted: context.visible.has(district.id),
      heldWhole: holder !== null,
      wholeHolder: holder,
    });
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
): MissionOffer {
  const timings = pricedTimings(template, grade, speedPercent, ramp);
  const rewards = scaledSpoils(
    missionRewards(template, 'success', timings.totalMinutes, grade),
    payPercent,
  );
  const xp = missionXp(template, timings.totalMinutes, grade);
  return {
    templateId: template.id,
    name: template.name,
    brief: template.brief,
    kind: template.kind,
    grade,
    travelMinutes: timings.travelMinutes,
    durationMinutes: timings.durationMinutes,
    totalMinutes: timings.totalMinutes,
    // The same numbers before anything was taken off them, so the send dialog can run the launch's
    // own arithmetic rather than approximating it on figures already reduced and rounded once.
    rawTravelMinutes: TRAVEL_BAND_MINUTES[template.travelBand],
    rawDurationMinutes: templateTimings(template, grade).durationMinutes,
    // The band itself, so the send dialog can apply it to the figures above the way the
    // launch does. Without it the dialog quotes the bare template and a crew in the opening
    // band reads 1h 50m on a job that runs for two minutes.
    ramp,
    speedPercent,
    rewards,
    payoutSlots: Math.round(payoutSlots(rewards, RESOURCE_KG)),
    xp,
    failedXp: Math.round(xp * FAILED_MISSION_XP_SHARE),
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
  states: Map<string, AreaState>,
  active: readonly StoredMission[],
  /** The crew reading it: its level decides which grades each board deals. */
  level: number,
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
  standing: { speedPercent?: number; spoilsPercent?: number; ramp?: EarlyRampBand | null } = {},
): MissionArea[] {
  const runningIn = new Map(active.map((stored) => [stored.mission.areaId, stored.mission.id]));

  const board = (id: string, name: string, blurb: string, difficulty: number): MissionArea => {
    const activeMissionId = runningIn.get(id) ?? null;
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
          ? missionOffers(id, missionBoardKey(id, now), level).map((job) =>
              offerFor(
                job.template,
                job.grade,
                payPercent,
                standing.speedPercent ?? 0,
                standing.ramp ?? null,
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
      'Work that belongs to nobody. Somebody always needs a wall stripped or a bay emptied.',
      1,
    ),
    ...districts
      .filter((district) => {
        const state = states.get(district.id);
        return state !== undefined && areaIsOpen(district, state);
      })
      .map((district) => board(district.id, district.name, district.blurb, district.difficulty)),
  ];
}
