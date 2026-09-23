import {
  type EarlyRampBand,
  TRAVEL_BAND_MINUTES,
  pagePrizeFor,
  FAILED_MISSION_XP_SHARE,
  MISC_AREA_ID,
  RESOURCE_KG,
  areaPayPercent,
  dealBattleTier,
  leaningsFor,
  levelPayPercent,
  missionXp,
  scaledSuccessChance,
  CITY_DISTRICTS,
  areaIsOpen,
  districtHolder,
  missionBoardKey,
  missionOffers,
  missionRewards,
  payoutSlots,
  scaledSpoils,
  type Base,
  type District,
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
 * What an area offers is a pure function of the area (`missionOffers`), so the board is stable and
 * a player can plan against it. What it *pays* is the template's own mix with the ground's premium
 * on it, which is the only thing that makes pushing outwards worth the walk.
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
 */
export function areaStatesFor(repos: Repositories, base: Base): Map<string, AreaState> {
  const context = cityContextFor(repos, base);
  const states = new Map<string, AreaState>();
  for (const district of CITY_DISTRICTS) {
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
   * What a card still cannot quote is the column: `columnSpeed` is a fact about the people and the
   * machines the player has not chosen yet when they read this. That is the right side of the line,
   * because the card is a quote for the job as offered rather than for a plan, and it is the same
   * number `launchMission` freezes into `pricedMinutes` and pays out against.
   */
  speedPercent = 0,
  /**
   * Where and when this card is being drawn, which is what decides whether a page is on it (§F1).
   *
   * Optional because the quote is also built for a mission already under way, and a launched run
   * carries its own frozen prize rather than re-reading the board it came off.
   */
  board?: { areaId: string; day: string },
  /**
   * The opening band this crew is in, or null (`missions.ramp.ts`).
   *
   * The clock only. The band's pay premium is already inside `payPercent` above, folded in by
   * `projectAreas` with the ground's and the level's, because that is the figure the card prints
   * and the launch freezes.
   */
  ramp: EarlyRampBand | null = null,
): MissionOffer {
  const timings = pricedTimings(template, speedPercent, ramp);
  /*
   * A fight's tier is dealt on the card off the crew's level (maintainer, 2026-09-23), seeded on
   * the board the card is on, and it moves the pay and the XP the card quotes. A quote with no
   * board behind it (a bare template) prices as a Fight I, the bottom of the ladder.
   */
  const battleTier =
    template.kind !== 'battle'
      ? null
      : board === undefined
        ? 'fight_1'
        : dealBattleTier(board.areaId, board.day, template.id, level);
  const rewards = scaledSpoils(
    missionRewards(template, 'success', timings.totalMinutes, battleTier),
    payPercent,
  );
  const xp = missionXp(template, timings.totalMinutes, level, battleTier);
  return {
    templateId: template.id,
    name: template.name,
    brief: template.brief,
    kind: template.kind,
    difficulty: template.difficulty,
    travelMinutes: timings.travelMinutes,
    durationMinutes: timings.durationMinutes,
    totalMinutes: timings.totalMinutes,
    // The same numbers before anything was taken off them, so the send dialog can run the launch's
    // own arithmetic rather than approximating it on figures already reduced and rounded once.
    rawTravelMinutes: TRAVEL_BAND_MINUTES[template.travelBand],
    rawDurationMinutes: template.durationMinutes,
    speedPercent,
    rewards,
    payoutSlots: Math.round(payoutSlots(rewards, RESOURCE_KG)),
    xp,
    failedXp: Math.round(xp * FAILED_MISSION_XP_SHARE),
    pagePrize:
      board === undefined
        ? null
        : pagePrizeFor(board.areaId, board.day, template.id, template.difficulty),
    /*
     * What the gauge starts from, before anybody is put at the head of the crew.
     *
     * The odds themselves are still not on the card: this is the authored figure at this crew's
     * level, and the screen adds whichever leader the player is looking at through `missionOdds`,
     * the same function the launch prices with. So the needle the player watches while they scroll
     * the bench and the number frozen onto the row cannot disagree.
     */
    authoredChance: scaledSuccessChance(template.successChance, level),
    leanings: [...leaningsFor(template)],
    battleTier,
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
    // The ground's premium and the crew's own, folded into one figure the card quotes.
    const payPercent =
      areaPayPercent(id) +
      levelPayPercent(level) +
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
          ? ((key) =>
              missionOffers(id, key).map((template) =>
                offerFor(
                  template,
                  payPercent,
                  level,
                  standing.speedPercent ?? 0,
                  { areaId: id, day: key },
                  standing.ramp ?? null,
                ),
              ))(missionBoardKey(id, now))
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
