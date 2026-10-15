import { MISC_AREA_ID, MISSION_TEMPLATES, type Base } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { launchMission } from './launch.js';
import { sureLeader } from '../testing/leader.js';
import {
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
} from '@frontline/shared';

/**
 * The Colossus walks on the road to a job, whatever the crew owns or holds (maintainer, 2026-10-15).
 *
 * The ride waiver (`any_ride`) left the game with every one of its sources, so `no_ride` is
 * absolute: a Heli Porter in the column changes nothing about a Colossus's pace, on this road as on
 * the march to a fight (`battle/movement.ts`).
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
    musterQueue: [],
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

const roadMinutes = (vehicles: Record<string, number>): number =>
  launchMission({
    id: `run-${Object.keys(vehicles).join('-') || 'walking'}`,
    base: makeBase(),
    template: TEMPLATE,
    areaId: MISC_AREA_ID,
    // One Colossus, which carries `no_ride`.
    force: { the_colossus: 1 },
    vehicles,
    now: T0,
    seed: 7,
    grade: TEMPLATE.grades[0],
    leader: sureLeader(),
  }).mission.travelMinutes;

describe('the Colossus on the road to a job', () => {
  it('walks at its own pace with the biggest machine in the yard beside it', () => {
    const walking = roadMinutes({});
    expect(walking).toBeGreaterThan(0);
    expect(roadMinutes({ heli_porter: 1 })).toBe(walking);
  });
});
