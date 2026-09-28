import {
  MAX_MISSION_SPEED_BONUS,
  MAX_TRAVEL_SPEED_BONUS,
  TERMINUS_CITY_ID,
  TRAVEL_BAND_MINUTES,
  districtsOfCity,
  findMissionTemplate,
  findUnit,
  type Base,
  type MissionTemplate,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { standingEffectsFor } from '../crew/standing.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { launchMission } from './launch.js';
import { sureLeader } from '../testing/leader.js';

/**
 * What Terminus is worth to a mission clock, and what it deliberately is not (2026-09-24).
 *
 * Three things arrived together and only two of them touch a job. The Blockhouse and the
 * Marshalling Yards both pay `mission_speed` as their unified bonus, which is the first time two
 * districts in the game pay the same speed channel and therefore the first time the stack can be
 * measured. The railway is the one that must **not** touch it: a train carries a unit move or a
 * battle column and nothing else (maintainer, 2026-09-24), and a mission that quietly rode would
 * be a clock nobody could explain from the card.
 *
 * The numbers below are worked out from the rules rather than read back out of the code: 37 is
 * 25 + 12 off the atlas, a divisor channel takes `minutes / (1 + 37/100)` off the job and a
 * reduction takes `minutes * (1 - 37/100)` off the road, each rounded once at the end.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const TERMINUS = districtsOfCity(TERMINUS_CITY_ID);

/** A long job with a long road, so every rounding below is a rounding of a real number. */
const RAID = findMissionTemplate('foundry-raid') as MissionTemplate;

/**
 * The pace of the column in these tests, off the catalogue rather than written down.
 *
 * A mission's road divides by the speed of the slowest group in the party before the ground's
 * percentage comes off it, so an expectation that leaves it out is an expectation about a
 * different party. Read here so a retune of the Razor's sheet moves the arithmetic below with it
 * instead of reddening a test that is about the Blockhouse.
 */
const RAZOR_SPEED = findUnit('razors')!.stats.speed;

/** The rule, written out: the pace divides, the percentage comes off what is left, round once. */
const roadAt = (bandMinutes: number, speed: number, reductionPercent: number): number =>
  Math.round((bandMinutes / (1 + speed / 100)) * (1 - reductionPercent / 100));

async function world(username: string): Promise<{ repos: Repositories; base: Base }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  pinOverseer(app, token);
  const repos = createRepositories(db);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const base = repos.bases.findById(baseId)!;
  repos.bases.updateArmy(base.id, { razors: 8 }, base.trainingQueue);
  return { repos, base: repos.bases.findById(baseId)! };
}

/** Hands this crew every location in `districtId`, which is what arms the unified bonus. */
function takeTheWhole(repos: Repositories, baseId: string, districtId: string): void {
  const district = TERMINUS.find((one) => one.id === districtId);
  if (!district) throw new Error(`no such district: ${districtId}`);
  for (const location of district.locations) {
    const control = repos.city.control(location.id);
    if (!control) throw new Error(`no control row for ${location.id}`);
    repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });
  }
}

/** Hands this crew the Station in each Terminus district that has one, and nothing else. */
function takeEveryPlatform(repos: Repositories, baseId: string): number {
  let taken = 0;
  for (const district of TERMINUS) {
    const station = district.locations.find((one) => one.kind === 'rail_station');
    if (!station) continue;
    const control = repos.city.control(station.id);
    if (!control) throw new Error(`no control row for ${station.id}`);
    repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });
    taken += 1;
  }
  return taken;
}

describe('what two Terminus districts are worth to a job', () => {
  it('stacks the Blockhouse and the Yards to 37 on one channel', async () => {
    const { repos, base } = await world('yardmaster');
    const bare = standingEffectsFor(repos, base).missionSpeedPercent;

    takeTheWhole(repos, base.id, 'marshalling-yards');
    const yardsOnly = standingEffectsFor(repos, repos.bases.findById(base.id)!);
    expect(yardsOnly.missionSpeedPercent - bare).toBe(12);

    takeTheWhole(repos, base.id, 'blockhouse');
    const both = standingEffectsFor(repos, repos.bases.findById(base.id)!);
    expect(both.missionSpeedPercent - bare).toBe(37);
    /*
     * And nothing else on the road moved with them.
     *
     * `mission_speed` and `travel_speed` are different channels spent in different places, and a
     * unified bonus that leaked into the second would shorten a march and a scouting run as well
     * as a job. Neither district pays `travel_speed` or `road_shortcut`, and the Yards' own
     * locations pay travel inside the district, so the second hold must add nothing on top.
     */
    expect(both.travelSpeedPercent).toBe(yardsOnly.travelSpeedPercent);
    expect(both.roadMinutesOff).toBe(yardsOnly.roadMinutesOff);
  });

  it('spends 37 on the job as a divisor and on the road as a reduction', async () => {
    const { base } = await world('clockwatch');
    const stored = launchMission({
      id: 'mission-37',
      base,
      template: RAID,
      areaId: 'marshalling-yards',
      force: { razors: 4 },
      now: new Date(),
      grade: RAID.grades[0],
      leader: sureLeader(),
      ramp: null,
      missionSpeedPercent: 37,
    });
    // 60 minutes of work at 37 is 60 / 1.37 = 43.8. The road is the band at the column's pace
    // and then 37 per cent off that, which is the half a party's own speed reaches and the job
    // leg does not: a van gets a crew to the site sooner and does not make the work go faster.
    expect(TRAVEL_BAND_MINUTES[RAID.travelBand]).toBe(20);
    expect(RAID.durationMinutes).toBe(60);
    expect(stored.mission.durationMinutes).toBe(44);
    expect(stored.mission.travelMinutes).toBe(roadAt(20, RAZOR_SPEED, 37));
    // And the figure that proves the pace is in the road at all: walking is longer than riding.
    expect(roadAt(20, 0, 37)).toBeGreaterThan(roadAt(20, RAZOR_SPEED, 37));
  });

  it('caps the job leg at fifty and the road at sixty', async () => {
    const { base } = await world('overcapped');
    const stored = launchMission({
      id: 'mission-cap',
      base,
      template: RAID,
      areaId: 'blockhouse',
      force: { razors: 4 },
      now: new Date(),
      grade: RAID.grades[0],
      leader: sureLeader(),
      ramp: null,
      // Well past both ceilings, so what comes back is the ceiling and not the figure.
      missionSpeedPercent: 140,
    });
    expect(MAX_MISSION_SPEED_BONUS).toBe(50);
    expect(MAX_TRAVEL_SPEED_BONUS).toBe(60);
    // 60 / 1.5 on the job, and six tenths off the road: two different ceilings applied to two
    // different arithmetics, which is the thing one figure on a card hides.
    expect(stored.mission.durationMinutes).toBe(40);
    expect(stored.mission.travelMinutes).toBe(roadAt(20, RAZOR_SPEED, MAX_TRAVEL_SPEED_BONUS));
  });
});

describe('the railway and a mission', () => {
  it('changes no clock a job runs on, however many platforms the crew holds', async () => {
    const { repos, base } = await world('trainless');
    const before = standingEffectsFor(repos, base);
    const walked = launchMission({
      id: 'mission-walked',
      base,
      template: RAID,
      areaId: 'coldwater-halt',
      force: { razors: 4 },
      now: new Date(),
      grade: RAID.grades[0],
      leader: sureLeader(),
      ramp: null,
      missionSpeedPercent: before.missionSpeedPercent,
      travelSpeedPercent: before.travelSpeedPercent,
      roadMinutesOff: before.roadMinutesOff,
      unitSpeedPercent: before.unitSpeedPercent,
      anyRide: before.anyRide,
    });

    const platforms = takeEveryPlatform(repos, base.id);
    // A guard on the fixture: seven platforms is the whole line, and one is not a line at all.
    expect(platforms).toBe(7);
    const onTheLine = repos.bases.findById(base.id)!;
    const after = standingEffectsFor(repos, onTheLine);
    /*
     * A Station pays unit slots and the line, and the line is not a channel a clock reads: there
     * is nothing in `missions/launch.ts` that can see a platform, so the four numbers a mission's
     * clock is built out of have to be untouched by holding every one of them. The slots moving
     * is the positive control: the holds did land, they just landed somewhere else.
     */
    expect(after.missionSpeedPercent).toBe(before.missionSpeedPercent);
    expect(after.travelSpeedPercent).toBe(before.travelSpeedPercent);
    expect(after.roadMinutesOff).toBe(before.roadMinutesOff);
    expect(after.unitSpeedPercent).toBe(before.unitSpeedPercent);
    expect(after.unitSlotBonus).toBeGreaterThan(before.unitSlotBonus);

    const rode = launchMission({
      id: 'mission-rode',
      base: onTheLine,
      template: RAID,
      areaId: 'coldwater-halt',
      force: { razors: 4 },
      now: new Date(),
      grade: RAID.grades[0],
      leader: sureLeader(),
      ramp: null,
      missionSpeedPercent: after.missionSpeedPercent,
      travelSpeedPercent: after.travelSpeedPercent,
      roadMinutesOff: after.roadMinutesOff,
      unitSpeedPercent: after.unitSpeedPercent,
      anyRide: after.anyRide,
    });
    expect(rode.mission.travelMinutes).toBe(walked.mission.travelMinutes);
    expect(rode.mission.durationMinutes).toBe(walked.mission.durationMinutes);
  });
});
