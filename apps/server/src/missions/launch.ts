import { randomInt } from 'node:crypto';
import {
  rampedTimings,
  type EarlyRampBand,
  pagePrizeFor,
  missionWalkMinutes,
  columnSpeed,
  fittedFor,
  unitColumnSpeed,
  type Fleet,
  TRAVEL_BAND_MINUTES,
  composeProfile,
  leaningsFor,
  missionOdds,
  type Attributes,
  type Base,
  type Grade,
  areaPayPercent,
  missionTimings,
  missionXp,
  templateTimings,
  type Army,
  type MissionTemplate,
  hastenedMinutes,
  hastenedRoadMinutes,
} from '@frontline/shared';
import { adminMinutes } from '../admin/mode.js';
import type { StoredMission } from '../db/repos/missions.js';
import { pricedTimings } from './pricing.js';
import { pagePrizeSalt } from './prize-salt.js';

/*
 * How many missions one base can have in flight is `concurrentMissionSlots` now, off the player's
 * level: two, and three past the milestone. It lives in `missions.areas.ts` beside the rule that
 * they have to be in *different* areas, because the two are one constraint.
 */

/**
 * Mints the record for a launched mission.
 *
 * The clock and the success chance are worked out here from the grade the card was dealt and
 * never re-read, so a run in flight keeps the terms it launched under. The seed is drawn once,
 * now, and decides the outcome whenever the mission is finally settled: see `rollMissionOutcome`.
 *
 * The odds are the leader's grade for the job against the job's grade (`missionOdds`), and every
 * run has a leader (maintainer, 2026-09-28). They are frozen onto the row with everything else, so
 * training the Overseer or reshuffling officers mid-flight cannot re-roll or re-price a crew that
 * has already left the gate.
 *
 * The clock is no longer part of it. The old §G6 rule made an unled run half again as long as a
 * led one; leading is a question of odds now, and one number moving is easier to read on a card
 * than two.
 *
 * The number never reaches the client: `missions.test.ts` asserts the board ships no
 * `successChance` at all.
 *
 * Travel is deliberately *not* reduced by §G5: the bonus buys speed on "whatever the officer is
 * doing", and the ring road is the same length however many people are in the van.
 */
export function launchMission(args: {
  id: string;
  base: Base;
  template: MissionTemplate;
  now: Date;
  /**
   * The grade the card was dealt (`missionOffers`). Frozen on the row; it sets the odds, the clock,
   * what a fight fields and what either kind pays.
   */
  grade: Grade;
  /**
   * Who is leading it (maintainer, 2026-09-10). Every run has somebody (2026-09-28).
   *
   * The Overseer and an officer reach this the same way and are scored the same way; which of the
   * two it was is recorded on the row, because the Overseer is not on the books and cannot be
   * named by `officerId`.
   */
  leader: { kind: 'overseer' | 'officer'; id: string; attributes: Attributes };
  /**
   * §C3: the machines carrying them, taken out of the Garage for this run.
   *
   * They buy time off the road and nothing else: a mission's odds, its pay and its haul are
   * untouched by what the crew arrived in. What the road is worth is `columnSpeed`, so parking a
   * truck in the yard is worth nothing and a machine that leaves half the crew walking is worth
   * exactly what the walkers are worth.
   */
  vehicles?: Fleet;
  /** Overridable so tests can pin the roll. */
  seed?: number;
  /**
   * Testing mode (`admin/mode.ts`): the run is over in a minute and the van does not travel.
   *
   * A minute rather than the five seconds everything else gets, because a mission's clock is stored
   * in whole minutes and one is the floor. The odds, the crew requirement and the officer gate are
   * all untouched: what is being skipped is the wait, not the mission.
   */
  admin?: boolean;
  /**
   * §A4: what the crew's ground takes off the clock (`TerritoryEffects.missionSpeedPercent`).
   *
   * The Smuggler's Tunnel. Applied to the travel *and* the run, because both are time on the
   * road: a shorter way across the city is shorter in both directions and while you are there.
   */
  missionSpeedPercent?: number;
  /**
   * §C3: what the crew's people and ground take off **any** road (`travelSpeedPercent`).
   *
   * Every other walk in the game has read these since they existed: a march (`battle/movement.ts`),
   * a move between districts, a spy job, and the city's own travel estimate. A mission's road
   * did not, which made Stamina and Navigation, both labelled "Time on the road", worth nothing on
   * the road a player uses most (maintainer, 2026-09-23: "speed should affect every walk, missions
   * too").
   *
   * On the run's own clock and **not** on the priced one, like the column's pace and the leader's
   * Short Way beside it. `rewardScale` is monotonic in the minutes, so pricing a crew's speed into
   * the card would pay a faster crew less for being faster, which is the §A4 bug `pricedTimings`
   * was written against.
   */
  travelSpeedPercent?: number;
  /** The Cartographer's cut off the road's base (`roadMinutes`, 2026-10-04). */
  roadBaseCutPercent?: number;
  /**
   * The opening band this crew is in, or null once they are past it (`missions.ramp.ts`).
   *
   * It moves both clocks and the pay. The priced clock, because the card quoted the band and the
   * settle has to pay the same one; the run's own clock, because the wait is the whole point of
   * the ramp; and `payPercent`, because a compressed clock pays compressed loot and the first two
   * bands exist to cancel exactly that.
   */
  ramp?: EarlyRampBand | null;
  /**
   * §D5: what the officer *leading this run* takes off the road (`leadArrivalPercent`), or 0.
   *
   * The travel legs only, never the job's own clock (maintainer, 2026-10-01): the card says "off
   * the road", and a declared fight's march spends it the same way (`battle/movement.ts`).
   *
   * Separate from `missionSpeedPercent` above, and the separation is the whole point. That one is a
   * fact about the crew, true when the card is drawn, so the card quotes it and the pay is priced
   * on it. This one is a fact about a decision the player makes *after* reading the card, so it
   * shortens the clock the run actually keeps and touches nothing the run is paid.
   *
   * Folded in the other order it paid a crew less for bringing their best leader: `rewardScale` is
   * monotonic in the minutes, so a Short Way on the priced clock is a smaller cheque. See
   * `pricedTimings`.
   */
  leadSpeedPercent?: number;
  /**
   * §A4: what the crew's own people and ground add to how fast its **units** move
   * (`TerritoryEffects.unitSpeedPercent`, the Skate Ground and the officers' Speed).
   *
   * A separate number from `missionSpeedPercent` because the two are spent differently and always
   * were: this one raises the column's pace and divides, that one is a percentage off whatever
   * clock the pace produced. The battle road has read this channel since the column had a speed at
   * all, and a crew whose people move faster to a fight moves faster to a job on the same streets.
   */
  unitSpeedPercent?: number;
  /**
   * §A4: the crew's `any_ride` holding, which is the Tram Depot's whole reason to exist.
   *
   * `battle/movement.ts` has read this since the column had a speed, and this module did not, so
   * the same crew's Colossus took a seat on the march to a fight and held the column to fifteen on
   * the road to a job. The holding is bought once and paid for once; it cannot be true on one road
   * and false on the other.
   */
  anyRide?: boolean;
  /**
   * §E: what the crew's own people add to the run's pay (`TerritoryEffects.missionSpoilsPercent`).
   *
   * A plain number for the same reason as the speed above: this module prices a run and has no
   * business knowing what a crew or a perk is.
   */
  missionSpoilsPercent?: number;
  /** The Bounty Wall's premium on this card (`golden.ts`), frozen on the row; 0 for a plain job. */
  goldenPercent?: number;
  /** Which board it came off (`missions.areas.ts`). The area is locked until this crew is home. */
  areaId: string;
  /**
   * A fight's chance, as the practice fights read it for this leader (`fight-leaders.ts`).
   *
   * A battle job never rolls against its chance, but the row carries one and the report prints
   * it as what the leader was worth. Graded on attributes it was a number about the wrong thing;
   * the route hands in the share of practice fights this leader won instead. Absent, the
   * attribute grade stands, which is what a scrap run gets and what an old test expects.
   */
  fightChance?: number | undefined;
  /** §A5: the units going. They leave `base.army` in the same transaction that writes this row. */
  force: Army;
}): StoredMission {
  const {
    id,
    base,
    template,
    now,
    leader,
    grade,
    admin = false,
    missionSpeedPercent = 0,
    travelSpeedPercent = 0,
    roadBaseCutPercent = 0,
    ramp = null,
    leadSpeedPercent = 0,
    missionSpoilsPercent = 0,
    goldenPercent = 0,
    unitSpeedPercent = 0,
    anyRide = false,
    areaId,
    force,
    vehicles = {},
    seed = randomInt(0, 2 ** 32),
  } = args;

  /*
   * §C3: the road only. What a machine buys is the journey, not the job.
   *
   * The column's pace shortens the *travel* leg and deliberately not the duration: a van gets a
   * crew to the site sooner and does not make the work there go faster, which is the same rule the
   * battle side applies to a marching column. Adding it to both would have made a truck worth more
   * on a long job than on a long road, which is backwards.
   *
   * The ground's `missionSpeedPercent` is a reduction on top of that pace rather than another term
   * added into it: `roadMinutes` divides by the speed and then takes the percentage off what is
   * left. It stays a divisor on the job leg, where there is no column to have a speed.
   */
  const pace = columnSpeed(vehicles, force, (unitId) =>
    unitColumnSpeed(unitId, {
      percent: unitSpeedPercent,
      fitted: fittedFor(base.unitLoadouts, unitId),
      anyRide,
    }),
  );
  // The job's own clock: the ground's cut and nothing else. Short Way is "off the road", and the
  // maintainer's ruling (2026-10-01) is that it is spent on the road alone, as it is on a march.
  const durationMinutes = adminMinutes(
    hastenedMinutes(templateTimings(template, grade).durationMinutes, missionSpeedPercent),
    admin,
  );
  // A job in another city is that far further away, each way (`missionWalkMinutes`).
  const walk = missionWalkMinutes(base.districtId, areaId);
  const walked = missionTimings({
    travelMinutes: admin
      ? 0
      : hastenedRoadMinutes(
          TRAVEL_BAND_MINUTES[template.travelBand] + walk,
          pace,
          // The road's own cuts, summed the way every other road in the game sums them: the
          // leader's Short Way and the crew's own pace off `travelSpeedPercent`. `roadMinutes`
          // bends the total under `TRAVEL_SPEED_CEILING`, so this cannot run away.
          missionSpeedPercent + Math.max(0, leadSpeedPercent) + Math.max(0, travelSpeedPercent),
          roadBaseCutPercent,
        ),
    durationMinutes,
  });
  /*
   * The wait the crew actually runs on, with the opening band applied last.
   *
   * Admin mode is left alone: it has already flattened the run to a minute, and a band would only
   * ever lengthen that back out. Outside admin the band is the point of the ramp, so it lands here
   * as well as on the priced clock below.
   */
  const timings = ramp === null || admin ? walked : rampedTimings(walked, ramp);
  /*
   * ...and the clock the pay is priced on, which is the card's and nobody else's.
   *
   * The same function `offerFor` draws the card with, called with the same crew figure, so the two
   * cannot come apart: see `pricedTimings` for the four things it leaves out and why each of them
   * would otherwise mean a player is quoted one number and paid another. Frozen on the row here
   * (`MissionSchema.pricedMinutes`) so a retune landing mid-flight cannot re-price a crew already
   * out.
   */
  const priced = pricedTimings(template, grade, missionSpeedPercent, ramp, walk);

  /*
   * The odds the run goes out with, from the one function the card and the gauge also read.
   *
   * A battle job carries a chance like everything else and never rolls against it: `resolve.ts`
   * fights it. The figure is still frozen here, because it is what the leader was worth to the
   * job and the report has nothing else to say it with.
   */
  const odds = missionOdds({
    grade,
    leader: leader.attributes,
    profile: composeProfile(leaningsFor(template)),
  });

  return {
    mission: {
      id,
      baseId: base.id,
      templateId: template.id,
      areaId,
      // Both frozen here, with the clock and the odds, so a crew already out keeps its terms.
      // The crew's own cut on top of the area's premium: `missionSpoilsPercent`
      // is the perk channel for officers who negotiate the contracts (`crew/perks.ts`). Frozen here
      // with everything else, so hiring a better fixer does not retroactively repay a run already out.
      payPercent:
        areaPayPercent(areaId) +
        missionSpoilsPercent +
        // The opening band's premium, the same figure the card printed (`missions.ramp.ts`).
        (ramp?.payPercent ?? 0),
      xp: missionXp(template, priced.totalMinutes, grade),
      // Apart from `payPercent` rather than folded into it, so the report can say the gold was
      // the gold and nothing else is multiplied by it (the return pays it, `missions/resolve.ts`).
      ...(goldenPercent > 0 && { goldenPercent }),
      grade,
      force,
      vehicles,
      pricedMinutes: priced.totalMinutes,
      startedAt: now.toISOString(),
      recalledAt: null,
      travelMinutes: timings.travelMinutes,
      durationMinutes: timings.durationMinutes,
      status: 'active',
      officerId: leader.kind === 'officer' ? leader.id : null,
      overseerLed: leader.kind === 'overseer',
      // Filled in by the settler, and only on a battle job: nobody dies on a standard run.
      lost: {},
      reported: true,
      outcome: null,
      rewards: {},
      spoils: {},
      resolvedAt: null,
      /*
       * §F1b: whether this run brings a page home, rolled for this launch alone off its own seed
       * (maintainer, 2026-09-29). It was keyed on the card, so a card that paid once paid on every
       * run of it until the board turned over. Frozen here so the settle reads it; which page it
       * turns out to be is decided on arrival (§F1c).
       */
      pagePrize: pagePrizeFor(pagePrizeSalt(), seed, grade),
      pageWon: null,
      found: {},
    },
    seed,
    successChance:
      template.kind === 'battle' && args.fightChance !== undefined ? args.fightChance : odds.chance,
  };
}
