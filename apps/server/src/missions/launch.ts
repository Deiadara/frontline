import { randomInt } from 'node:crypto';
import {
  missionBoardDay,
  pagePrizeFor,
  carriedSpeedPercent,
  type Fleet,
  TRAVEL_BAND_MINUTES,
  delegatedMinutes,
  delegatedSuccessChance,
  modifiedSuccessChance,
  type Base,
  type Commander,
  type DelegationTerms,
  areaPayPercent,
  levelPayPercent,
  missionTimings,
  missionXp,
  scaledSuccessChance,
  type Army,
  type MissionTemplate,
  type Overseer,
  hastenedMinutes,
} from '@frontline/shared';
import { adminMinutes } from '../admin/mode.js';
import type { StoredMission } from '../db/repos/missions.js';

/*
 * How many missions one base can have in flight is `concurrentMissionSlots` now, off the player's
 * level: two, and three past the milestone. It lives in `missions.areas.ts` beside the rule that
 * they have to be in *different* areas, because the two are one constraint.
 */

/**
 * Mints the record for a launched mission.
 *
 * The clock and the success chance are copied off the template here and never re-read, so a run
 * in flight keeps the terms it launched under. The seed is drawn once, now, and decides the
 * outcome whenever the mission is finally settled: see `rollMissionOutcome`.
 *
 * Two modifiers land at exactly this point, and only this point:
 *
 *   * **§F5**: the Overseer's Speed and Stealth move the odds on a run that risks people.
 *   * **§G6**: a run with nobody leading it takes longer and is likelier to come home empty.
 *
 * They **compose**, in that order: §F5 says what the player's own character is worth to this run,
 * and §G7 then scales what the crew behind them is worth. Both are frozen onto the row with
 * everything else, so training the Overseer or moving officers mid-flight cannot re-roll, retime
 * or re-price a crew that has already left the gate. An absent Overseer or absent crew leaves the
 * template's authored value untouched rather than penalising it.
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
  /** §F5, whose Speed and Stealth the run rides on. Absent means no edge either way. */
  overseer?: Overseer | undefined;
  /** §G5/§G6: the terms the resolved crew earned. Absent means a bare run, no modifier. */
  terms?: DelegationTerms | undefined;
  /**
   * §G6: the officer leading it, absent for a delegation. Recorded on the row so the character
   * who was actually out can be paid for it when the crew comes home (INTERFACES §2 R2).
   */
  officer?: Commander | undefined;
  /**
   * §C3: the machines carrying them, taken out of the Garage for this run.
   *
   * They buy time off the road and nothing else: a mission's odds, its pay and its haul are
   * untouched by what the crew arrived in. Priced against how much of the force they can actually
   * seat (`carriedSpeedPercent`), so parking a truck in the yard is worth nothing and sending one
   * with two people in it is worth almost nothing.
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
   * §E: what the crew's own people add to the run's pay (`TerritoryEffects.missionSpoilsPercent`).
   *
   * A plain number for the same reason as the speed above: this module prices a run and has no
   * business knowing what a crew or a perk is.
   */
  missionSpoilsPercent?: number;
  /** Which board it came off (`missions.areas.ts`). The area is locked until this crew is home. */
  areaId: string;
  /** §A5: the units going. They leave `base.army` in the same transaction that writes this row. */
  force: Army;
}): StoredMission {
  const {
    id,
    base,
    template,
    now,
    overseer,
    terms,
    officer,
    admin = false,
    missionSpeedPercent = 0,
    missionSpoilsPercent = 0,
    areaId,
    force,
    vehicles = {},
    seed = randomInt(0, 2 ** 32),
  } = args;

  // §E5/§I: the crew's own level makes the same job harder, at the same rate it makes it pay
  // more. Applied before the Overseer's edge and the delegation, so the two modifiers move a
  // number that already belongs to this crew.
  const authored = scaledSuccessChance(template.successChance, base.level);

  /*
   * §C3: the road only. What a machine buys is the journey, not the job.
   *
   * Folded into `missionSpeedPercent` for the *travel* leg and deliberately not into the duration:
   * a van gets a crew to the site sooner and does not make the work there go faster, which is the
   * same rule the battle side applies to a marching column. Adding it to both would have made a
   * truck worth more on a long job than on a long road, which is backwards.
   */
  const bodies = Object.values(force).reduce((total, count) => total + count, 0);
  const carried = carriedSpeedPercent(vehicles, bodies);
  const timings = missionTimings({
    travelMinutes: admin
      ? 0
      : hastenedMinutes(TRAVEL_BAND_MINUTES[template.travelBand], missionSpeedPercent + carried),
    durationMinutes: adminMinutes(
      hastenedMinutes(
        terms ? delegatedMinutes(template.durationMinutes, terms) : template.durationMinutes,
        missionSpeedPercent,
      ),
      admin,
    ),
  });

  const afterOverseer = overseer
    ? modifiedSuccessChance(authored, overseer.attributes, template.kind)
    : authored;

  return {
    mission: {
      id,
      baseId: base.id,
      templateId: template.id,
      areaId,
      // Both frozen here, with the clock and the odds, so a crew already out keeps its terms.
      // The crew's own cut on top of the area's premium and the player's level: `missionSpoilsPercent`
      // is the perk channel for officers who negotiate the contracts (`crew/perks.ts`). Frozen here
      // with everything else, so hiring a better fixer does not retroactively repay a run already out.
      payPercent: areaPayPercent(areaId) + levelPayPercent(base.level) + missionSpoilsPercent,
      xp: missionXp(template, timings.totalMinutes, base.level),
      force,
      vehicles,
      startedAt: now.toISOString(),
      recalledAt: null,
      travelMinutes: timings.travelMinutes,
      durationMinutes: timings.durationMinutes,
      status: 'active',
      officerId: officer?.id ?? null,
      outcome: null,
      rewards: {},
      spoils: {},
      resolvedAt: null,
      /*
       * §F1b: the page category frozen with everything else the card promised.
       *
       * Read off the board this run was taken from, at the day it was taken on, rather than at the
       * day it comes home: boards turn over at midnight and a crew that is out overnight must keep
       * the terms it left under. Which page it turns out to be is decided on arrival (§F1c).
       */
      pagePrize: pagePrizeFor(areaId, missionBoardDay(now), template.id, template.difficulty),
      pageWon: null,
    },
    seed,
    successChance: terms ? delegatedSuccessChance(afterOverseer, terms) : afterOverseer,
  };
}
