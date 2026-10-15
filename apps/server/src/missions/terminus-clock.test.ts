import {
  DEFAULT_CITY_ID,
  MISSION_SPEED_CEILING,
  missionSpeedCut,
  travelSpeedCut,
  MISC_AREA_ID,
  TERMINUS_CITY_ID,
  describeHoldBonus,
  missionSpeedPercentIn,
  unifiedBonusFor,
  TRAVEL_BAND_MINUTES,
  districtsOfCity,
  findMissionTemplate,
  findUnit,
  missionWalkMinutes,
  type Base,
  type MissionTemplate,
  isStation,
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
import { projectAreas } from './board.js';
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
/** A district of Ashfall's with work in it, for the boards the Blockhouse must not reach. */
const ASHFALL_WORK = districtsOfCity(DEFAULT_CITY_ID).find((one) => one.kind === 'contested')!;

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
// The road's own arithmetic, the reduction bent as `roadMinutes` bends it (2026-10-05).
const roadAt = (bandMinutes: number, speed: number, reductionPercent: number): number =>
  Math.round((bandMinutes / (1 + speed / 100)) * (1 - travelSpeedCut(reductionPercent) / 100));

async function world(
  username: string,
): Promise<{ repos: Repositories; base: Base; app: FastifyInstance; token: string }> {
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
  repos.bases.updateArmy(base.id, { razors: 8 }, base.musterQueue);
  return { repos, base: repos.bases.findById(baseId)!, app, token };
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
    const station = district.locations.find(isStation);
    if (!station) continue;
    const control = repos.city.control(station.id);
    if (!control) throw new Error(`no control row for ${station.id}`);
    repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });
    taken += 1;
  }
  return taken;
}

describe('what two Terminus districts are worth to a job', () => {
  it('pays neither on the clock: the Yards build Heavies, the Blockhouse is ANTI-COMBINE', async () => {
    const { repos, base } = await world('yardmaster');
    const bare = standingEffectsFor(repos, base);

    takeTheWhole(repos, base.id, 'marshalling-yards');
    const yardsOnly = standingEffectsFor(repos, repos.bases.findById(base.id)!);
    // Built in the Yards (maintainer, 2026-10-09): +10% damage and vitality on every Heavy, where
    // it was 12 points of mission speed.
    expect(yardsOnly.unitTierPercent.heavy).toMatchObject({ offense: 10, vitality: 10 });
    expect(yardsOnly.missionSpeedPercent).toBe(bare.missionSpeedPercent);

    takeTheWhole(repos, base.id, 'blockhouse');
    const both = standingEffectsFor(repos, repos.bases.findById(base.id)!);
    expect(both.antiCombineLevels - yardsOnly.antiCombineLevels).toBe(1);
    expect(missionSpeedPercentIn(both, 'marshalling-yards')).toBe(bare.missionSpeedPercent);
    expect(missionSpeedPercentIn(both, MISC_AREA_ID)).toBe(bare.missionSpeedPercent);
    // And nothing on the road moved with them.
    expect(both.travelSpeedPercent).toBe(yardsOnly.travelSpeedPercent);
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
    // 60 minutes of work at 37 is 60 / 1.37 = 43.8. The road is the band, plus the walk from an
    // Ashfall home across the frontier (`missionWalkMinutes`, 2026-09-29), at the column's pace
    // and then 37 per cent off that, which is the half a party's own speed reaches and the job
    // leg does not: a van gets a crew to the site sooner and does not make the work go faster.
    const road = 20 + missionWalkMinutes(base.districtId, 'marshalling-yards');
    expect(TRAVEL_BAND_MINUTES[RAID.travelBand]).toBe(20);
    expect(RAID.durationMinutes).toBe(60);
    expect(stored.mission.durationMinutes).toBe(44);
    expect(stored.mission.travelMinutes).toBe(roadAt(road, RAZOR_SPEED, 37));
    // And the figure that proves the pace is in the road at all: walking is longer than riding.
    expect(roadAt(road, 0, 37)).toBeGreaterThan(roadAt(road, RAZOR_SPEED, 37));
  });

  it('bends the job leg and the road under their ceilings', async () => {
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
    // Bent, not stopped (2026-10-05): 140 points are under 60 on the job and under 75 off the road,
    // two different curves on two different arithmetics, which is what one figure on a card hides.
    expect(missionSpeedCut(140)).toBeLessThan(MISSION_SPEED_CEILING);
    expect(stored.mission.durationMinutes).toBe(Math.round(60 / (1 + missionSpeedCut(140) / 100)));
    const road = 20 + missionWalkMinutes(base.districtId, 'blockhouse');
    expect(stored.mission.travelMinutes).toBe(roadAt(road, RAZOR_SPEED, 140));
  });
});

describe('a district-scoped cut, on the boards', () => {
  it('says "in this district" on the card, and the Blockhouse says ANTI-COMBINE', () => {
    expect(describeHoldBonus({ kind: 'mission_speed', percent: 25, inDistrict: true })).toBe(
      '-20% mission time in this district (tapers, no hard stop)',
    );
    expect(describeHoldBonus(unifiedBonusFor('blockhouse')!.bonus)).toContain('ANTI-COMBINE');
    expect(describeHoldBonus(unifiedBonusFor('marshalling-yards')!.bonus)).not.toContain('city');
  });

  it('quotes shorter jobs on the one board the cut is scoped to and the same jobs elsewhere', async () => {
    const { base } = await world('quoted');
    const yards = TERMINUS.find((one) => one.id === 'marshalling-yards')!;
    const open = new Map([yards, ASHFALL_WORK].map((one) => [one.id, { heldWhole: true }]));
    const quote = (districtSpeedPercent: Record<string, number>) =>
      new Map(
        projectAreas([yards, ASHFALL_WORK], open, [], base, new Date(), {
          districtSpeedPercent,
        }).map((area) => [area.id, area.offers.map((offer) => offer.durationMinutes)]),
      );
    const bare = quote({});
    const held = quote({ [yards.id]: 25 });
    expect(bare.get(yards.id)!.length).toBeGreaterThan(0);
    held.get(yards.id)!.forEach((minutes, at) => {
      expect(minutes).toBeLessThan(bare.get(yards.id)![at]!);
    });
    expect(held.get(ASHFALL_WORK.id)).toEqual(bare.get(ASHFALL_WORK.id));
    expect(held.get(MISC_AREA_ID)).toEqual(bare.get(MISC_AREA_ID));
  });
});

/**
 * Coldwater Halt held whole (maintainer, 2026-10-09): +5% pay on every job worked in Terminus,
 * where it was +15% loot capacity. Scoped to the city, so the same crew's work anywhere else is
 * paid as before; the misc board is worked where the crew lives.
 */
describe('Everything Off the Train, on the pay', () => {
  const TERMINUS_HOME = 'carriage';

  it('folds into the city-scoped channel and nowhere else', async () => {
    const { repos, base } = await world('halted');
    const bare = standingEffectsFor(repos, base);
    takeTheWhole(repos, base.id, 'coldwater-halt');
    const whole = standingEffectsFor(repos, repos.bases.findById(base.id)!);
    expect(whole.missionSpoilsPercentByCity).toEqual({ [TERMINUS_CITY_ID]: 5 });
    expect(whole.missionSpoilsPercent).toBe(bare.missionSpoilsPercent);
    expect(whole.lootCapacityPercent).toBe(bare.lootCapacityPercent);
    expect(describeHoldBonus(unifiedBonusFor('coldwater-halt')!.bonus)).toBe(
      '+5% mission pay on jobs in this city',
    );
  });

  it('freezes five more points of pay on a Terminus job, and none on an Ashfall one', async () => {
    const { base } = await world('payroll');
    const launch = (home: string, areaId: string, byCity: Record<string, number>) =>
      launchMission({
        id: `mission-${home}-${areaId}`,
        base: { ...base, districtId: home },
        template: RAID,
        areaId,
        force: { razors: 4 },
        now: new Date(),
        grade: RAID.grades[0],
        leader: sureLeader(),
        ramp: null,
        missionSpoilsPercentByCity: byCity,
      }).mission.payPercent;
    const held = { [TERMINUS_CITY_ID]: 5 };
    expect(launch(TERMINUS_HOME, 'marshalling-yards', held)).toBe(
      launch(TERMINUS_HOME, 'marshalling-yards', {}) + 5,
    );
    expect(launch(TERMINUS_HOME, MISC_AREA_ID, held)).toBe(
      launch(TERMINUS_HOME, MISC_AREA_ID, {}) + 5,
    );
    expect(launch(base.districtId, ASHFALL_WORK.id, held)).toBe(
      launch(base.districtId, ASHFALL_WORK.id, {}),
    );
  });

  it('quotes the same five points on every board the crew is shown in Terminus', async () => {
    const { base } = await world('quotedpay');
    const yards = TERMINUS.find((one) => one.id === 'marshalling-yards')!;
    const open = new Map([yards, ASHFALL_WORK].map((one) => [one.id, { heldWhole: true }]));
    const pay = (home: string, citySpoilsPercent: Record<string, number>) =>
      new Map(
        projectAreas([yards, ASHFALL_WORK], open, [], { ...base, districtId: home }, new Date(), {
          citySpoilsPercent,
        }).map((area) => [area.id, area.payPercent]),
      );
    const bare = pay(TERMINUS_HOME, {});
    const held = pay(TERMINUS_HOME, { [TERMINUS_CITY_ID]: 5 });
    expect(held.get(yards.id)).toBe(bare.get(yards.id)! + 5);
    expect(held.get(MISC_AREA_ID)).toBe(bare.get(MISC_AREA_ID)! + 5);
    expect(held.get(ASHFALL_WORK.id)).toBe(bare.get(ASHFALL_WORK.id));
  });
});

/**
 * The Bricked Arches (maintainer, 2026-10-09): points off the road legs of every job worked in
 * Terminus, 10 rising to 20, and nothing off the time on site. Spent on the running clock with the
 * road's other cuts, and on the send dialog's road, but not on the priced clock, so a faster road
 * does not pay less.
 */
describe('the Bricked Arches, on the road to a job', () => {
  const TERMINUS_HOME = 'carriage';

  it('folds into the city-scoped road channel and leaves the job clock alone', async () => {
    const { repos, base } = await world('archway');
    const bare = standingEffectsFor(repos, base);
    const arches = repos.city.control('ironmouth-arches')!;
    repos.city.put({ ...arches, holder: { kind: 'crew', baseId: base.id }, level: 5 });
    const held = standingEffectsFor(repos, repos.bases.findById(base.id)!);
    expect(held.missionTravelPercentByCity).toEqual({ [TERMINUS_CITY_ID]: 20 });
    expect(held.missionSpeedPercent).toBe(bare.missionSpeedPercent);
  });

  it('shortens the road legs of a Terminus job and nothing else', async () => {
    const { base } = await world('roadworks');
    const launch = (home: string, areaId: string, byCity: Record<string, number>) =>
      launchMission({
        id: `mission-${home}-${areaId}`,
        base: { ...base, districtId: home },
        template: RAID,
        areaId,
        force: { razors: 4 },
        now: new Date(),
        grade: RAID.grades[0],
        leader: sureLeader(),
        ramp: null,
        missionTravelPercentByCity: byCity,
      }).mission;
    const held = { [TERMINUS_CITY_ID]: 10 };
    const plain = launch(TERMINUS_HOME, 'marshalling-yards', {});
    const cut = launch(TERMINUS_HOME, 'marshalling-yards', held);
    expect(plain.travelMinutes).toBe(roadAt(20, RAZOR_SPEED, 0));
    expect(cut.travelMinutes).toBe(roadAt(20, RAZOR_SPEED, 10));
    expect(cut.travelMinutes).toBeLessThan(plain.travelMinutes);
    // Time on site and the priced clock are the job's, not the road's.
    expect(cut.durationMinutes).toBe(plain.durationMinutes);
    expect(cut.pricedMinutes).toBe(plain.pricedMinutes);
    // The misc board is worked where the crew lives; work in Ashfall is not on this road.
    expect(launch(TERMINUS_HOME, MISC_AREA_ID, held).travelMinutes).toBeLessThan(
      launch(TERMINUS_HOME, MISC_AREA_ID, {}).travelMinutes,
    );
    expect(launch(base.districtId, ASHFALL_WORK.id, held).travelMinutes).toBe(
      launch(base.districtId, ASHFALL_WORK.id, {}).travelMinutes,
    );
  });

  it('hands the send dialog the same road cut for a crew living in Terminus', async () => {
    const { app, token, base } = await world('dialog');
    const road = async () =>
      (
        await app.inject({
          method: 'GET',
          url: '/api/missions',
          headers: { authorization: `Bearer ${token}` },
        })
      ).json<{ road: { travelSpeedPercent: number } }>().road.travelSpeedPercent;
    app.db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(TERMINUS_HOME, base.id);
    const bare = await road();
    const arches = app.repos.city.control('ironmouth-arches')!;
    app.repos.city.put({ ...arches, holder: { kind: 'crew', baseId: base.id }, level: 2 });
    expect((await road()) - bare).toBe(12);
    // A crew living in Ashfall is shown Ashfall's boards, where the Arches pay nothing.
    app.db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(ASHFALL_WORK.id, base.id);
    expect(await road()).toBe(bare);
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
      unitSpeedPercent: before.unitSpeedPercent,
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
      unitSpeedPercent: after.unitSpeedPercent,
    });
    expect(rode.mission.travelMinutes).toBe(walked.mission.travelMinutes);
    expect(rode.mission.durationMinutes).toBe(walked.mission.durationMinutes);
  });
});
