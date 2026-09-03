import {
  pagePrizeFor,
  FAILED_MISSION_XP_SHARE,
  MISC_AREA_ID,
  RESOURCE_KG,
  areaPayPercent,
  levelPayPercent,
  missionXp,
  CITY_DISTRICTS,
  isHeldBy,
  missionOffers,
  missionRewards,
  payoutSlots,
  scaledSpoils,
  missionTimings,
  hastenedMinutes,
  TRAVEL_BAND_MINUTES,
  type Base,
  type District,
  type MissionArea,
  type MissionOffer,
  type MissionTemplate,
} from '@frontline/shared';
import { cityContextFor } from '../city/view.js';
import type { Repositories } from '../db/repos/index.js';
import type { StoredMission } from '../db/repos/missions.js';

/**
 * The mission board, per area (GDD §E, §A4).
 *
 * One board for work that belongs to nobody, and one for every district this crew has scouted and
 * does not already own outright. A district with every location taken and its gate down comes off
 * the board: there is nothing left in there anybody would pay a crew to do.
 *
 * What an area offers is a pure function of the area (`missionOffers`), so the board is stable and
 * a player can plan against it. What it *pays* is the template's own mix with the ground's premium
 * on it, which is the only thing that makes pushing outwards worth the walk.
 */

/** Everything the board needs to know about a district, read once per request. */
export interface AreaState {
  scouted: boolean;
  ownedOutright: boolean;
}

/**
 * Whether this crew owns a district so completely that there is no work left in it.
 *
 * Every location held **and** the gate down. Both, because a district whose locations are all
 * taken but whose gate still stands is a district with a fight left in it, and a gate with
 * locations still in other hands is not owned at all.
 */
export function areaStatesFor(repos: Repositories, base: Base): Map<string, AreaState> {
  const context = cityContextFor(repos, base);
  const states = new Map<string, AreaState>();
  for (const district of CITY_DISTRICTS) {
    const locations = district.locations;
    const mine = locations.filter((location) => {
      const control = context.controls.get(location.id);
      return control !== undefined && isHeldBy(control, base.id);
    }).length;
    states.set(district.id, {
      scouted: context.visible.has(district.id),
      ownedOutright: locations.length > 0 && mine === locations.length,
    });
  }
  return states;
}

/**
 * One job, priced for the ground it is offered on and for the crew reading it.
 *
 * Two premiums, and they compose: the district's own (`areaPayPercent`) and the crew's level
 * (`levelPayPercent`). The odds move the other way over the same curve, which is what stops
 * levelling being a way of skipping the game.
 */
export function offerFor(
  template: MissionTemplate,
  payPercent: number,
  level: number,
  /**
   * What the crew's own standing does to the clock, off `standingEffectsFor`.
   *
   * The card used to be priced off the bare template while the launch froze the modified numbers,
   * so the two disagreed in both directions and the error grew with everything the player had
   * bought. `missionRewards` scales by `rewardScale(totalMinutes)`, which is monotonic in the
   * clock, so a crew holding the Smuggler's Tunnel finished sooner and was therefore paid *less*
   * than the card promised, and the quoted countdown was the unmodified one as well.
   *
   * What a card still cannot quote is the vehicles: `carriedSpeedPercent` is a fact about the
   * column the player has not chosen yet when they read this. That is the right side of the line,
   * because the card is a quote for the job as offered rather than for a plan.
   */
  speedPercent = 0,
  /**
   * Where and when this card is being drawn, which is what decides whether a page is on it (§F1).
   *
   * Optional because the quote is also built for a mission already under way, and a launched run
   * carries its own frozen prize rather than re-reading the board it came off.
   */
  board?: { areaId: string; day: string },
): MissionOffer {
  const timings = missionTimings({
    travelMinutes: hastenedMinutes(TRAVEL_BAND_MINUTES[template.travelBand], speedPercent),
    durationMinutes: hastenedMinutes(template.durationMinutes, speedPercent),
  });
  const rewards = scaledSpoils(
    missionRewards(template, 'success', timings.totalMinutes),
    payPercent,
  );
  const xp = missionXp(template, timings.totalMinutes, level);
  return {
    templateId: template.id,
    name: template.name,
    brief: template.brief,
    kind: template.kind,
    difficulty: template.difficulty,
    stance: template.stance,
    travelMinutes: timings.travelMinutes,
    durationMinutes: timings.durationMinutes,
    totalMinutes: timings.totalMinutes,
    rewards,
    payoutSlots: Math.round(payoutSlots(rewards, RESOURCE_KG)),
    xp,
    failedXp: Math.round(xp * FAILED_MISSION_XP_SHARE),
    pagePrize:
      board === undefined
        ? null
        : pagePrizeFor(board.areaId, board.day, template.id, template.difficulty),
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
  /** The crew reading it: what its level does to the pay and the odds. */
  level: number,
  /** The game day the boards are generated from. They turn over at midnight, Athens. */
  day: string,
  /**
   * What this crew's standing is worth on a run, so the card quotes what the launch will freeze.
   *
   * Both channels, because both are frozen at launch and neither was quoted: the ground's speed
   * (the Smuggler's Tunnel) shortens the clock, and the crew's own cut (`missionSpoilsPercent`)
   * widens the pay. Defaulted so a caller that does not have them still gets the old, bare quote
   * rather than a compile error at every call site.
   */
  standing: { speedPercent?: number; spoilsPercent?: number } = {},
): MissionArea[] {
  const runningIn = new Map(active.map((stored) => [stored.mission.areaId, stored.mission.id]));

  const board = (id: string, name: string, blurb: string, difficulty: number): MissionArea => {
    const activeMissionId = runningIn.get(id) ?? null;
    // The ground's premium and the crew's own, folded into one figure the card quotes.
    const payPercent = areaPayPercent(id) + levelPayPercent(level) + (standing.spoilsPercent ?? 0);
    return {
      id,
      name,
      blurb,
      difficulty,
      payPercent,
      offers:
        activeMissionId === null
          ? missionOffers(id, day).map((template) =>
              offerFor(template, payPercent, level, standing.speedPercent ?? 0, {
                areaId: id,
                day,
              }),
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
        return state !== undefined && state.scouted && !state.ownedOutright;
      })
      .map((district) => board(district.id, district.name, district.blurb, district.difficulty)),
  ];
}
