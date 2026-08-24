import { randomInt } from 'node:crypto';
import {
  TRAVEL_BAND_MINUTES,
  delegatedMinutes,
  delegatedSuccessChance,
  modifiedSuccessChance,
  type Base,
  type Commander,
  type DelegationTerms,
  type MissionTemplate,
  type Overseer,
  hastenedMinutes,
} from '@frontline/shared';
import { adminMinutes } from '../admin/mode.js';
import type { StoredMission } from '../db/repos/missions.js';

/**
 * How many missions one base can have in flight at once.
 *
 * §E2 says the crew is *away* while a mission runs, which is the only thing stopping a player
 * from launching the board a thousand times over and printing resources. The real bound is the
 * size of the assignee pool (§G1–G3, W4) — this single constant is the seam it replaces, not a
 * guess at W4's numbers.
 */
export const CONCURRENT_MISSION_LIMIT = 4;

/**
 * Mints the record for a launched mission.
 *
 * The clock and the success chance are copied off the template here and never re-read, so a run
 * in flight keeps the terms it launched under. The seed is drawn once, now, and decides the
 * outcome whenever the mission is finally settled — see `rollMissionOutcome`.
 *
 * Two modifiers land at exactly this point, and only this point:
 *
 *   * **§F5** — the Overseer's Speed and Stealth move the odds on a run that risks people.
 *   * **§G5/§G7** — the crew's assignee bonus cuts the duration *and* lifts the odds.
 *
 * They **compose**, in that order: §F5 says what the player's own character is worth to this run,
 * and §G7 then scales what the crew behind them is worth. Both are frozen onto the row with
 * everything else, so training the Overseer or moving assignees mid-flight cannot re-roll, retime
 * or re-price a crew that has already left the gate. An absent Overseer or absent crew leaves the
 * template's authored value untouched rather than penalising it.
 *
 * The number never reaches the client — `missions.test.ts` asserts the board ships no
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
  /** §F5 — whose Speed and Stealth the run rides on. Absent means no edge either way. */
  overseer?: Overseer | undefined;
  /** §G5/§G6 — the terms the resolved crew earned. Absent means a bare run, no modifier. */
  terms?: DelegationTerms | undefined;
  /**
   * §G6 — the officer leading it, absent for a delegation. Recorded on the row so the character
   * who was actually out can be paid for it when the crew comes home (INTERFACES §2 R2).
   */
  officer?: Commander | undefined;
  /** Overridable so tests can pin the roll. */
  seed?: number;
  /**
   * Testing mode (`admin/mode.ts`): the run is over in a minute and the van does not travel.
   *
   * A minute rather than the five seconds everything else gets, because a mission's clock is stored
   * in whole minutes and one is the floor. The odds, the crew requirement and the officer gate are
   * all untouched — what is being skipped is the wait, not the mission.
   */
  admin?: boolean;
  /**
   * §A4 — what the crew's ground takes off the clock (`TerritoryEffects.missionSpeedPercent`).
   *
   * The Smuggler's Tunnel. Applied to the travel *and* the run, because both are time on the
   * road: a shorter way across the city is shorter in both directions and while you are there.
   */
  missionSpeedPercent?: number;
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
    seed = randomInt(0, 2 ** 32),
  } = args;

  const afterOverseer = overseer
    ? modifiedSuccessChance(template.successChance, overseer.attributes, template.kind)
    : template.successChance;

  return {
    mission: {
      id,
      baseId: base.id,
      templateId: template.id,
      startedAt: now.toISOString(),
      recalledAt: null,
      travelMinutes: admin
        ? 0
        : hastenedMinutes(TRAVEL_BAND_MINUTES[template.travelBand], missionSpeedPercent),
      durationMinutes: adminMinutes(
        hastenedMinutes(
          terms ? delegatedMinutes(template.durationMinutes, terms) : template.durationMinutes,
          missionSpeedPercent,
        ),
        admin,
      ),
      status: 'active',
      officerId: officer?.id ?? null,
      outcome: null,
      rewards: {},
      resolvedAt: null,
    },
    seed,
    successChance: terms ? delegatedSuccessChance(afterOverseer, terms) : afterOverseer,
  };
}
