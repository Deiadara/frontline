import { randomInt } from 'node:crypto';
import {
  TRAVEL_BAND_MINUTES,
  modifiedSuccessChance,
  type Base,
  type MissionTemplate,
  type Overseer,
} from '@frontline/shared';
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
 * GDD §F5 is applied at exactly this point, and only this point: the Overseer's Speed and Stealth
 * move the stored `successChance` on a run that risks people, and are then frozen with everything
 * else. Training the Overseer mid-flight must not re-roll the odds a crew already left under, and
 * an Overseer who is somehow absent leaves the template's authored chance untouched. The number
 * never reaches the client — `missions.test.ts` asserts the board ships no `successChance` at all.
 */
export function launchMission(args: {
  id: string;
  base: Base;
  template: MissionTemplate;
  now: Date;
  /** §F5 — whose Speed and Stealth the run rides on. Absent means no edge either way. */
  overseer?: Overseer | undefined;
  /** Overridable so tests can pin the roll. */
  seed?: number;
}): StoredMission {
  const { id, base, template, now, overseer, seed = randomInt(0, 2 ** 32) } = args;
  return {
    mission: {
      id,
      baseId: base.id,
      templateId: template.id,
      startedAt: now.toISOString(),
      travelMinutes: TRAVEL_BAND_MINUTES[template.travelBand],
      durationMinutes: template.durationMinutes,
      status: 'active',
      outcome: null,
      rewards: {},
      resolvedAt: null,
    },
    seed,
    successChance: overseer
      ? modifiedSuccessChance(template.successChance, overseer.attributes, template.kind)
      : template.successChance,
  };
}
