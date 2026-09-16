import { MISC_AREA_ID, MISSION_TEMPLATES, type Base } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { launchMission } from './launch.js';
import {
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
} from '@frontline/shared';

/**
 * The Tram Depot works on the road to a job, not only on the march to a fight.
 *
 * `any_ride` is a city holding whose entire purpose is that a `no_ride` sheet stops holding the
 * column to its own pace. `battle/movement.ts` read it from the day the column had a speed, and
 * this module did not, so one crew's Colossus rode to a fight and walked to a mission down the
 * same streets. The holding is bought once; it cannot be true on one road and false on the other.
 */

const T0 = new Date('2026-09-14T12:00:00.000Z');

function makeBase(): Base {
  const now = T0.toISOString();
  return {
    id: 'base-1',
    ownerId: 'owner-1',
    name: 'The Yard',
    districtId: 'kettle-row',
    level: 20,
    isBot: false,
    resources: { caps: 0, supplies: 0, oil: 0, scrap: 0, planks: 0, highQualityMetal: 0 },
    economy: startingEconomy(now),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [],
    buildQueue: [],
    army: {},
    trainingQueue: [],
    training: startingTraining(now),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: now,
  };
}

/** A run long enough that the road is a real part of the clock. */
const TEMPLATE =
  MISSION_TEMPLATES.find((one) => one.travelBand === 'furthest') ?? MISSION_TEMPLATES[0]!;

const roadMinutes = (anyRide: boolean): number =>
  launchMission({
    id: `run-${String(anyRide)}`,
    base: makeBase(),
    template: TEMPLATE,
    areaId: MISC_AREA_ID,
    // One Colossus, which carries `no_ride`, and the Heli Porter that can lift it.
    force: { the_colossus: 1 },
    vehicles: { heli_porter: 1 },
    now: T0,
    seed: 7,
    unled: 'free',
    anyRide,
  }).mission.travelMinutes;

describe('the Tram Depot on the road to a job', () => {
  it('seats a Colossus that would otherwise hold the column to fifteen', () => {
    const walking = roadMinutes(false);
    const riding = roadMinutes(true);

    // A guard on the fixture: if the Colossus ever loses `no_ride`, or the wagon stops being able
    // to carry it, both figures collapse to the same number and this test proves nothing.
    expect(walking).toBeGreaterThan(0);
    expect(riding).toBeLessThan(walking);
  });
});
