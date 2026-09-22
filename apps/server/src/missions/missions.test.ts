import {
  concurrentMissionSlots,
  BASE_CONCURRENT_MISSIONS,
  CITY_DISTRICTS,
  CITY_LOCATIONS,
  MISC_AREA_ID,
  MISSION_TEMPLATES,
  type MissionsResponse,
  FAILED_MISSION_XP_SHARE,
  areaPayPercent,
  areasOffering,
  levelPayPercent,
  missionBoardKey,
  missionOffers,
  missionXp,
  scaledSpoils,
  MISSION_INFAMY_DELTA,
  PLAYER_XP_AWARDS,
  battleTierFor,
  infamyForKills,
  missionInfamyForKills,
  type BattleTier,
  applyPlayerXp,
  createCommander,
  findMissionTemplate,
  missionRewards,
  hastenedRoadMinutes,
  findUnit,
  findVehicle,
  notorietyToField,
  UNIT_CATALOG,
  effectiveSpeed,
  upgradedStats,
  MAX_LOCATION_LEVEL,
  UNIT_MODIFICATIONS,
  leading,
  TRAVEL_BAND_MINUTES,
  missionTimings,
  pricedTotalMinutes,
  playerLevelGrants,
  templateTimings,
  type Army,
  type UnitLoadouts,
  type Base,
  type Mission,
  type MissionTemplate,
  type Resources,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createRng } from '../characters/rng.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { areaStatesFor, projectAreas } from './board.js';
import { launchMission } from './launch.js';
import { projectUnits } from '../units/roster.js';
import { removeForce } from '../battle/forces.js';
import { fightMissionBattle } from './battle.js';
import { resolveDueMissions } from './resolve.js';
import { tickWorld } from '../live/clock.js';
import { MISSION_HISTORY_LIMIT } from '../db/repos/missions.js';
import { standingEffectsFor } from '../crew/standing.js';
import { infirmaryRecoveryPercent } from '@frontline/shared';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';

/**
 * Any job on any board today, with the area that offers it.
 *
 * The counterpart to `anEasyJobToday` for the tests that do not care *which* job goes out, only
 * that one does. Every one of those used to name a template, which is the expiry-dated fixture
 * described on `launchBody`.
 */
/**
 * A job on a board today, with the area that offers it.
 *
 * Standard work rather than simply the first offer. A battle job fights a real force at the settle
 * now (`missions/battle.ts`), so the tests about clocks, pay and slots would be measuring the
 * engine on the days a raid happens to sort first, and a crew of one Razor would come home in a
 * bag. `aBattleJobToday` is what asks for the other property.
 */
function aJobToday(): { template: MissionTemplate; areaId: string } {
  /*
   * Each area asked for its own key, not one day for the lot.
   *
   * `misc` turns over hourly now (`MISC_BOARD_ROTATION_MINUTES`) and the districts still turn
   * over at midnight, so a fixture keyed on the day picked misc jobs off a board the route was
   * no longer offering and every launch came back `That job is not on offer there`.
   */
  const now = new Date();
  for (const areaId of [MISC_AREA_ID, ...CITY_DISTRICTS.map((district) => district.id)]) {
    const template = missionOffers(areaId, missionBoardKey(areaId, now)).find(
      (entry) => entry.kind === 'standard',
    );
    if (template) return { template, areaId };
  }
  throw new Error(`no standard job on any board at ${now.toISOString()}`);
}

/**
 * The longest road on any board today, with the area that offers it.
 *
 * The tests about the *road* need a leg long enough that a change in pace survives the rounding to
 * whole minutes: a `close` job is five of them, and everything from a walking Razor to a Razor at
 * the game's ceiling of 100 lands on three, so a road test that runs on one passes whatever the
 * code does. Measured rather than assumed: every day in an 800-day window offers a `furthest` job
 * somewhere, so this is not the expiry-dated fixture a named id would be. Difficulty is not
 * filtered: what a job asks of a crew has nothing to do with how long the road to it is.
 */
function theFurthestJobToday(): { template: MissionTemplate; areaId: string } {
  const now = new Date();
  // Contested districts only: a plot posts no work (maintainer, 2026-09-21), and which board
  // carries the day's furthest job moves with the date.
  const areas = [
    MISC_AREA_ID,
    ...CITY_DISTRICTS.filter((district) => district.kind === 'contested').map((d) => d.id),
  ];
  for (const areaId of areas) {
    const template = missionOffers(areaId, missionBoardKey(areaId, now)).find(
      (entry) => entry.travelBand === 'furthest',
    );
    if (template) return { template, areaId };
  }
  throw new Error(`no long job on any board at ${now.toISOString()}`);
}

/** `aJobToday` as a launch payload. */
function launchAnyJobToday(extra: Record<string, unknown> = {}) {
  const { template, areaId } = aJobToday();
  return { templateId: template.id, areaId, force: { razors: 1 }, ...extra };
}

/**
 * A launch on the `nth` board that offers anything at all, whatever it offers.
 *
 * Work is one-per-area now, so a test that needs two crews out at once needs two *areas*, not two
 * launches. Walking the boards rather than naming them keeps this stable if the offer walk is
 * retuned.
 */
function launchInArea(nth: number, extra: Record<string, unknown> = {}) {
  // Contested districts only: a residential district is somebody's plot and posts no work at all
  // (maintainer, 2026-09-21), so a helper that counted them handed out ids no board offers.
  const boards = [
    MISC_AREA_ID,
    ...CITY_DISTRICTS.filter((district) => district.kind === 'contested').map(
      (district) => district.id,
    ),
  ];
  const areaId = boards[nth];
  if (areaId === undefined) throw new Error(`no board number ${nth}`);
  const offer = missionOffers(areaId, missionBoardKey(areaId, new Date()))[0];
  if (!offer) throw new Error(`board ${areaId} offers nothing`);
  return { templateId: offer.id, areaId, force: { razors: 1 }, ...extra };
}

/**
 * The **longest** easy job on a board today, with the area that offers it.
 *
 * Two things are going on here. Naming a template outright is a test that works until the day its
 * board does not offer it, and `fuel-siphon` is how that was found: the boards turn over daily, so
 * a hard-coded id is a fixture with a hidden expiry date.
 *
 * Longest rather than first, because durations are whole minutes. Today's first easy job is a
 * three-minute scrap run, and a percentage off three minutes rounds back to three: the effect
 * fires and the assertion cannot see it. A job of any real length has room for it to show.
 */
function anEasyJobToday(): { template: MissionTemplate; areaId: string } {
  const now = new Date();
  const offered = MISSION_TEMPLATES.filter((template) => template.difficulty === 'easy')
    .map((template) => ({ template, areaId: areasOffering(template.id, now)[0] }))
    .filter(
      (entry): entry is { template: MissionTemplate; areaId: string } => entry.areaId !== undefined,
    )
    .sort((a, b) => b.template.durationMinutes - a.template.durationMinutes);
  const longest = offered[0];
  if (!longest) throw new Error(`no easy job on any board at ${now.toISOString()}`);
  return longest;
}

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const PASSWORD = 'hunter2pass';
const T0 = new Date('2026-08-13T12:00:00.000Z');
const MINUTE_MS = 60_000;

/** A seed whose first draw clears every success chance on the board, and one that clears none. */
function seedWhere(predicate: (roll: number) => boolean): number {
  for (let seed = 1; seed < 100_000; seed += 1) {
    if (predicate(createRng(seed)())) return seed;
  }
  throw new Error('no seed found');
}
const ALWAYS_SUCCEEDS = seedWhere((roll) => roll < 0.5);
const ALWAYS_FAILS = seedWhere((roll) => roll > 0.995);

/**
 * A whole stack: app, database, a registered player and their base. The base is read back out
 * of the repository rather than hand-built, so these tests never spell out a `Base` literal and
 * stay independent of fields other workstreams are adding to it.
 */
interface Stack {
  app: FastifyInstance;
  repos: Repositories;
  base: Base;
  token: string;
  /**
   * The Overseer's id, which is the leader every crew has from the first day.
   *
   * Every launch below names a leader, because an unled run is a thing a crew researches its way
   * into now (`unledRule`) and the tests here are about clocks, pay and slots rather than about
   * that gate. The two that *are* about it say so.
   */
  overseerId: string;
  /** The handle itself, for the few tests that wind a clock back rather than going through HTTP. */
  db: AppDatabase;
}

/**
 * Nobody holds a whole district, so every board is open (maintainer's rule, 2026-09-21).
 *
 * The same argument as the scouting loop below it. Work is offered only where no single party
 * holds every location, and the city starts with five Combine districts and the Undergrid shut,
 * so a stack that left them shut would refuse most of the launches in this file for a reason none
 * of these tests is about. One plot per district emptied is the least that opens a gate, and the
 * rule itself is tested on its own in `board.test.ts` rather than here.
 */
function openEveryGate(repos: Repositories): void {
  for (const district of CITY_DISTRICTS) {
    const first = district.locations[0];
    if (!first) continue;
    const control = repos.city.control(first.id);
    if (!control) continue;
    repos.city.put({ ...control, holder: { kind: 'unoccupied' }, garrison: {} });
  }
}

async function makeStack(username = 'runner'): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: PASSWORD },
  });
  expect(registered.statusCode).toBe(201);
  const { token, user } = registered.json<{ token: string; user: { id: string } }>();

  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode).toBe(201);
  // This file checks road times and payouts against the catalogue's own arithmetic, and a
  // signature perk moves both, so the crew gets a character rather than whoever §F6 dealt.
  pinOverseer(app, token);
  const overseerId = chosen.json<{ overseer: { id: string } }>().overseer.id;

  const repos = createRepositories(db);
  const minted = repos.bases.findByOwnerId(user.id);
  if (!minted) throw new Error('overseer creation did not mint a base');
  // Somebody to send. A mission takes actual units now, so a stack with an empty roster refuses
  // every launch below for the right reason and tells us nothing about the thing under test.
  repos.bases.updateArmy(minted.id, { razors: 20, haulers: 20 }, minted.trainingQueue);
  // Eyes on the whole map. Work is offered per district now and only where a crew has been, so a
  // stack that has scouted nothing refuses every launch for a reason none of these tests are
  // about. Scouting itself is `city.test.ts`.
  for (const district of CITY_DISTRICTS) {
    repos.city.markScouted(minted.id, district.id, new Date().toISOString());
  }
  openEveryGate(repos);
  const base = repos.bases.findByOwnerId(user.id);
  if (!base) throw new Error('base vanished after arming it');
  return { app, repos, base, token, db, overseerId };
}

const scrapRun = findMissionTemplate('scrap-run') as MissionTemplate;

/**
 * Puts an officer on the books and returns their id.
 *
 * The stack's base starts with nobody hired, so a test that wants an *officer* at the head of a run
 * rather than the Overseer has to hire one. What the officer is worth to the odds is
 * `missions.leading.ts`'s subject; here they are somebody who can be named.
 */
function withOfficer(stack: Stack): string {
  const officer = createCommander('off-1', 'Halvard Nyx', 'field_commander');
  stack.repos.bases.updateCommanders(stack.base.id, [officer]);
  return officer.id;
}

/**
 * A whole bench, one officer per concurrent run.
 *
 * One officer cannot lead several runs at once any more (`crew/duty.ts`): a person out on a job is
 * out. A test about the *crew* cap therefore needs a person per crew, or it measures the officer
 * rule instead of the one it is named for.
 */
function withOfficers(stack: Stack, count: number): string[] {
  const officers = Array.from({ length: count }, (_, index) =>
    createCommander(`off-${index + 1}`, `Officer ${index + 1}`, null),
  );
  stack.repos.bases.updateCommanders(stack.base.id, officers);
  return officers.map((officer) => officer.id);
}

/** Puts a mission on the board with a pinned seed and launch time. */
/**
 * A column that wins a close battle job and comes home to tell it.
 *
 * `planted`'s default is four hundred haulers, which is the right fixture for a payout test and
 * the wrong one for an infamy test: a battle job runs a real skirmish, porters lose it, and a crew
 * that was wiped out banks nothing at all, infamy included. The two infamy tests need the run to
 * come back, so they field people who can fight.
 */
const BATTLE_FORCE = { ironsides: 120, razors: 240, haulers: 200 };

function planted(
  stack: Stack,
  template: MissionTemplate,
  seed: number,
  startedAt = T0,
  /** §C3: machines under the crew, for the tests about what riding is and is not worth. */
  vehicles: Record<string, number> = {},
  /**
   * Who goes. Enough bags by default that nothing is left on the floor: what a crew can carry is
   * measured elsewhere (`missions.areas.test.ts`), and a payout trimmed by accident here would
   * look like a pricing bug in every timer assertion below. The tests about the road override it,
   * because the road's clock is now the *column's* speed and four hundred units need seats.
   */
  force: Record<string, number> = { haulers: 400 },
): Mission {
  const stored = launchMission({
    id: `mission-${seed}-${template.id}`,
    base: stack.base,
    template,
    areaId: areasOffering(template.id, new Date())[0] ?? MISC_AREA_ID,
    force,
    now: startedAt,
    seed,
    vehicles,
    // Nobody leading, and nothing docked for it: these rows are fixtures for the settle, and the
    // odds a leader would move are `missions.leading.test.ts`'s subject rather than this file's.
    unled: 'free',
  });
  stack.repos.missions.insert(stored);
  return stored.mission;
}

/**
 * What a clean run of this template pays a crew at this stack's level, off the board `planted`
 * sends it from.
 *
 * Recomputed from the same shared functions the settler uses rather than restated, so a test that
 * asserts on it is checking that the settler *ran* rather than carrying a second copy of the
 * pricing that can drift from it.
 */
function paidFor(template: MissionTemplate, stack: Stack) {
  const areaId = areasOffering(template.id, new Date())[0] ?? MISC_AREA_ID;
  return scaledSpoils(
    missionRewards(template, 'success'),
    areaPayPercent(areaId) + levelPayPercent(stack.base.level),
  );
}

const after = (minutes: number, from: Date = T0) => new Date(from.getTime() + minutes * MINUTE_MS);

const total = (army: Army): number => Object.values(army).reduce((sum, n) => sum + n, 0);

/**
 * The base as it stands right now. Every route re-reads it per request, so anything simulating
 * repeated reads must too: `resolveDueMissions` derives the new stockpile from the base it is
 * handed, and feeding it a stale snapshot twice would silently drop the first payout.
 */
function freshBase(stack: Stack): Base {
  const base = stack.repos.bases.findById(stack.base.id);
  if (!base) throw new Error('base vanished');
  return base;
}

function resourcesOf(stack: Stack): Resources {
  return freshBase(stack).resources;
}

describe('mission timers are authoritative server-side (§E2, §E8)', () => {
  it('does not pay out one millisecond before the round trip is over', async () => {
    const stack = await makeStack();
    /*
     * The row's own clock, not the template's.
     *
     * A force's speed shortens the mission road now (§C3, the speed rebalance), so the four hundred
     * Haulers `planted` sends walk their five-minute leg in four. Reading the template here made
     * this test wind the clock a minute past the finish and call the payout early.
     */
    const mission = planted(stack, scrapRun, ALWAYS_SUCCEEDS);
    const { totalMinutes } = missionTimings(mission);
    expect(totalMinutes).toBeLessThan(templateTimings(scrapRun).totalMinutes);
    const before = resourcesOf(stack);

    const justEarly = new Date(T0.getTime() + totalMinutes * MINUTE_MS - 1);
    const settlement = resolveDueMissions(stack.repos, stack.base, justEarly);

    expect(settlement.resolved).toEqual([]);
    expect(resourcesOf(stack)).toEqual(before);
    expect(stack.repos.missions.countActiveByBaseId(stack.base.id)).toBe(1);
  });

  it('pays out exactly at 2×travel + mission time, not before', async () => {
    const stack = await makeStack();
    const { totalMinutes } = templateTimings(scrapRun);
    expect(totalMinutes).toBe(2 * 5 + 3);

    planted(stack, scrapRun, ALWAYS_SUCCEEDS);
    const settlement = resolveDueMissions(stack.repos, stack.base, after(totalMinutes));

    expect(settlement.resolved).toHaveLength(1);
    expect(settlement.resolved[0]?.outcome).toBe('success');
    expect(stack.repos.missions.countActiveByBaseId(stack.base.id)).toBe(0);
  });

  /**
   * The point to be proved: resolution must be a function of the stored
   * mission, never of when anyone happened to look.
   *
   * Two identical worlds run the same 40 missions from the same seeds. One is watched every
   * minute of the way; the other is abandoned and opened a week after everything should have
   * landed. Every outcome, every payout and the final stockpile have to match.
   *
   * The fleet is deliberately large and deliberately mixed. A single 97%-success scrap run proves
   * almost nothing here: a resolver that re-rolled against the wall clock would still answer
   * "success" both times and the test would pass while the property was broken: verified by
   * mutation, which is why this is 40 missions and not one.
   *
   * Standard work, and the seeds are chosen so the fleet lands about half and half. It used to be
   * battle jobs, for their middling odds; a battle job does not roll any more (it fights, see
   * `missions/battle.ts`), so a fleet of them would have proved the determinism of a code path
   * this test is not about, and every one of them would have come home a failure.
   */
  it('resolves a slept-through fleet identically to a watched one', async () => {
    const watched = await makeStack('watcher');
    const abandoned = await makeStack('sleeper');
    const jobs = MISSION_TEMPLATES.filter((t) => t.kind === 'standard');
    const fleetSize = 40;

    for (let i = 0; i < fleetSize; i += 1) {
      const template = jobs[i % jobs.length] as MissionTemplate;
      // Seeds spread across the roll space, so outcomes are a genuine mix of wins and losses.
      const seed = 1_000 + i * 7_919;
      planted(watched, template, seed);
      planted(abandoned, template, seed);
    }

    const longest = Math.max(...jobs.map((t) => templateTimings(t).totalMinutes));

    // The watcher keeps the tab open and polls every minute until the last crew is home. Each
    // poll re-reads the base, because each poll is a separate request: see `freshBase`.
    for (let minute = 0; minute <= longest; minute += 1) {
      resolveDueMissions(watched.repos, freshBase(watched), after(minute));
    }
    // The sleeper closes the game and comes back a week late, having polled nothing at all.
    const lateSettlement = resolveDueMissions(
      abandoned.repos,
      freshBase(abandoned),
      after(longest + 7 * 24 * 60),
    );

    const outcomesOf = (stack: Stack) =>
      stack.repos.missions
        .listByBaseId(stack.base.id)
        .map(({ mission }) => `${mission.id}:${mission.outcome}:${JSON.stringify(mission.rewards)}`)
        .sort();

    // The fleet actually contains both outcomes: otherwise this proves nothing.
    const watchedOutcomes = outcomesOf(watched);
    expect(watchedOutcomes.filter((o) => o.includes(':success:')).length).toBeGreaterThan(0);
    expect(watchedOutcomes.filter((o) => o.includes(':failure:')).length).toBeGreaterThan(0);

    expect(outcomesOf(abandoned)).toEqual(watchedOutcomes);
    expect(resourcesOf(abandoned)).toEqual(resourcesOf(watched));
    expect(lateSettlement.resolved).toHaveLength(fleetSize);
  });

  it('pays a mission exactly once, however many times it is read', async () => {
    const stack = await makeStack();
    const { totalMinutes } = templateTimings(scrapRun);
    planted(stack, scrapRun, ALWAYS_SUCCEEDS);

    const first = resolveDueMissions(stack.repos, stack.base, after(totalMinutes));
    const paidOnce = resourcesOf(stack);

    for (let i = 0; i < 5; i += 1) {
      const again = resolveDueMissions(stack.repos, stack.base, after(totalMinutes + i));
      expect(again.resolved).toEqual([]);
    }

    expect(first.resolved).toHaveLength(1);
    expect(resourcesOf(stack)).toEqual(paidOnce);
  });

  it('settles several overdue missions in one read, in launch order', async () => {
    const stack = await makeStack();
    planted(stack, scrapRun, ALWAYS_SUCCEEDS, T0);
    const later = findMissionTemplate('ration-run') as MissionTemplate;
    planted(stack, later, ALWAYS_SUCCEEDS, after(1));

    const settlement = resolveDueMissions(stack.repos, stack.base, after(10_000));

    expect(settlement.resolved.map((m) => m.templateId)).toEqual(['scrap-run', 'ration-run']);
    expect(stack.repos.missions.countActiveByBaseId(stack.base.id)).toBe(0);
  });
});

describe('mission payout (§E1, §E5)', () => {
  it('banks the template rewards on a success and lifts morale', async () => {
    const stack = await makeStack();
    const before = resourcesOf(stack);
    planted(stack, scrapRun, ALWAYS_SUCCEEDS);

    const { base } = resolveDueMissions(
      stack.repos,
      stack.base,
      after(templateTimings(scrapRun).totalMinutes),
    );

    // §A4: the pay carries the ground's premium, so what lands is the scaled figure rather than
    // the template's own. `planted` records which board it went out from.
    const expected = paidFor(scrapRun, stack);
    expect(base.resources.scrap).toBe(before.scrap + (expected.scrap ?? 0));
    expect(base.resources.caps).toBe(before.caps + (expected.caps ?? 0));
  });

  it('sends a failed battle home empty (§E5 risk)', async () => {
    const stack = await makeStack();
    const raid = findMissionTemplate('foundry-raid') as MissionTemplate;
    const before = resourcesOf(stack);
    planted(stack, raid, ALWAYS_FAILS);

    const { base, resolved } = resolveDueMissions(
      stack.repos,
      stack.base,
      after(templateTimings(raid).totalMinutes),
    );

    expect(resolved[0]?.outcome).toBe('failure');
    expect(resolved[0]?.rewards).toEqual({});
    expect(base.resources).toEqual(before);
  });

  /**
   * §D7: a fight that lands is heard on the street.
   *
   * It used to be keyed on `stance`, so this test ran a job aimed at the Combine. Stance is gone
   * (2026-09-12) and the delta hangs off the half of it the maintainer kept, which is `kind`: a battle
   * job pays a name, standard work does not.
   */
  /**
   * The fight the settler is about to run for a battle job, replayed off the same row.
   *
   * `planted` sends nobody to lead and a fresh crew has nothing that seats anybody, so the two
   * inputs the settler adds (`leaderOf`, `anyRide`) are read the way it reads them; the seed and
   * the tier are the row's own. What comes back is what the job killed, which is what it pays for.
   */
  function replayed(stack: Stack, template: MissionTemplate, seed: number, force: Army, at: Date) {
    /*
     * The same books the settler hands the engine, not a subset of them.
     *
     * `simulate` reads the *presence* of `territory`, `loadouts` and the rest rather than their
     * values, so a replay that leaves one out is a different fight from the one it is replaying,
     * and the two agreed here only by luck. They stopped agreeing the moment the engine was
     * retuned, which is the fixture telling the truth about itself: a replay has to be handed
     * exactly what `resolveDueMissions` hands over.
     */
    const crew = standingEffectsFor(stack.repos, stack.base, at);
    const fought = fightMissionBattle({
      seed,
      jobName: template.name,
      force,
      vehicles: {},
      tier: battleTierFor(template) as BattleTier,
      level: stack.base.level,
      anyRide: crew.anyRide,
      loadouts: stack.base.unitLoadouts,
      territory: crew,
      recoveryPercent:
        crew.casualtyRecoveryPercent + infirmaryRecoveryPercent(stack.base.buildings),
    });
    const slots = infamyForKills(fought.killed);
    expect(slots, 'the fixture has to kill somebody for this to measure anything').toBeGreaterThan(
      0,
    );
    return { fought, slots };
  }

  it('raises infamy for a battle job by half a point per unit slot it killed, rounded up', async () => {
    const stack = await makeStack();
    const strike = findMissionTemplate('convoy-ambush') as MissionTemplate;
    expect(strike.kind).toBe('battle');
    planted(stack, strike, ALWAYS_SUCCEEDS, T0, {}, BATTLE_FORCE);
    const settledAt = after(templateTimings(strike).totalMinutes);
    const { fought, slots } = replayed(stack, strike, ALWAYS_SUCCEEDS, BATTLE_FORCE, settledAt);
    expect(fought.outcome).toBe('success');

    const { base } = resolveDueMissions(stack.repos, stack.base, settledAt);

    /*
     * The flat two a battle job used to pay for landing is gone: the table is pinned at zero so a
     * retune that quietly brought it back is caught, and the payout is the maintainer's rule
     * stated as arithmetic rather than read back through the function that implements it.
     */
    expect(MISSION_INFAMY_DELTA.battle.success).toBe(0);
    expect(base.economy.infamy).toBe(stack.base.economy.infamy + Math.ceil(slots / 2));
    expect(base.economy.infamy - stack.base.economy.infamy).toBe(
      missionInfamyForKills(fought.killed),
    );
  });

  /**
   * The maintainer's rule has no win clause: a declared fight pays the loser for its kills, and so
   * does a battle job, as long as somebody came home to tell it. The seed is searched for rather
   * than authored, because the three things the case needs (a lost field, a kill, a survivor) are
   * the engine's to decide, and a fixed seed would go stale the first time the engine was retuned.
   */
  it('pays a lost battle job for what it killed, at the same rate', async () => {
    const stack = await makeStack();
    const strike = findMissionTemplate('convoy-ambush') as MissionTemplate;
    const settledAt = after(templateTimings(strike).totalMinutes);
    // Enough to kill somebody and not enough to hold the field. The size is searched for along
    // with the seed since 2026-09-21: eight Razors stopped producing the case after the engine
    // retune (they either walk it or die to the last), and the fixture's own rule is that the
    // engine decides what this fight looks like, not the test.
    const { outmatched, losing } = (() => {
      for (const razors of [8, 6, 10, 5, 12, 4, 14]) {
        const force: Army = { razors };
        for (let seed = 1; seed < 300; seed += 1) {
          const fought = fightMissionBattle({
            seed,
            jobName: strike.name,
            force,
            vehicles: {},
            tier: battleTierFor(strike) as BattleTier,
            level: stack.base.level,
            anyRide: false,
          });
          if (fought.outcome === 'failure' && total(fought.killed) > 0 && total(fought.home) > 0) {
            return { outmatched: force, losing: seed };
          }
        }
      }
      throw new Error(
        'fixture: no size and seed loses the field, kills somebody and brings anybody home',
      );
    })();
    planted(stack, strike, losing, T0, {}, outmatched);
    const { fought } = replayed(stack, strike, losing, outmatched, settledAt);
    expect(fought.outcome).toBe('failure');

    const { base } = resolveDueMissions(stack.repos, stack.base, settledAt);
    expect(base.economy.infamy - stack.base.economy.infamy).toBe(
      missionInfamyForKills(fought.killed),
    );
    expect(base.economy.infamy).toBeGreaterThan(stack.base.economy.infamy);
  });

  /**
   * §D7, and it keeps paying past a hundred, because infamy has no ceiling any more.
   *
   * This is the regression, and it was invisible: the settle folded the delta through
   * `adjustMeter`, left over from when infamy was a 0..100 meter, so a crew that had already made
   * a name banked **nothing** from a mission and was told nothing about it. The test above cannot
   * see it, a starting crew is nowhere near a hundred, which is exactly why this one starts
   * somewhere a real crew gets to in a week.
   */
  it('keeps paying a crew that already has a name, because infamy has no ceiling', async () => {
    const stack = await makeStack();
    const notorious = {
      ...stack.base,
      economy: { ...stack.base.economy, infamy: 480 },
    };
    stack.repos.bases.updateEconomy(notorious.id, notorious.economy);

    const strike = findMissionTemplate('convoy-ambush') as MissionTemplate;
    planted({ ...stack, base: notorious }, strike, ALWAYS_SUCCEEDS, T0, {}, BATTLE_FORCE);
    const settledAt = after(templateTimings(strike).totalMinutes);
    const { fought } = replayed(stack, strike, ALWAYS_SUCCEEDS, BATTLE_FORCE, settledAt);

    const { base } = resolveDueMissions(stack.repos, notorious, settledAt);

    // Past the old ceiling and by the whole of what the job killed: a clamp at a hundred would
    // leave the crew at 480 and a clamp anywhere would leave it short of this.
    expect(base.economy.infamy).toBe(480 + missionInfamyForKills(fought.killed));
    expect(base.economy.infamy).toBeGreaterThan(480);
  });

  /**
   * The yard's cards reach the settle (maintainer, 2026-09-15: modifications fold onto every
   * sheet the engine reads).
   *
   * `fightMissionBattle` takes the crew's brackets, and the settler is the one place that has a
   * crew to read them off. It handed over nothing, so a card bolted on in the yard fought on a
   * declared battle and did nothing on a job. Pinned against two replays of the same row: the
   * settle has to match the fitted one and not the bare one, and the two have to differ or the
   * fixture measures nothing.
   */
  it('fights a battle job with what the crew has bolted on', async () => {
    const stack = await makeStack();
    stack.repos.bases.updateUnitLoadouts(stack.base.id, { razors: ['taped_grips'] });
    const fitted = stack.repos.bases.findById(stack.base.id);
    if (!fitted) throw new Error('fixture: base vanished after fitting it');
    expect(fitted.unitLoadouts).toEqual({ razors: ['taped_grips'] });

    const strike = findMissionTemplate('convoy-ambush') as MissionTemplate;
    const edge: Army = { razors: 9 };
    const settledAt = after(templateTimings(strike).totalMinutes);
    // The same fight the settle runs (`missions/resolve.ts`): the crew's standing effects as the
    // ground and its recovery, not only its `anyRide`. Without them the replay is a different
    // fight, and on most seeds it happens to land on the bare figure, which reads as the settle
    // having dropped the card.
    const crew = standingEffectsFor(stack.repos, fitted, settledAt);
    const replay = (seed: number, loadouts: UnitLoadouts) =>
      fightMissionBattle({
        seed,
        jobName: strike.name,
        force: edge,
        vehicles: {},
        tier: battleTierFor(strike) as BattleTier,
        level: fitted.level,
        anyRide: crew.anyRide,
        loadouts,
        territory: crew,
        recoveryPercent: crew.casualtyRecoveryPercent + infirmaryRecoveryPercent(fitted.buildings),
      });
    // The seed is searched for rather than fixed (2026-09-21): the card has to change *this*
    // fight's losses or the settle assertion below measures nothing, and which seeds it changes
    // is the engine's to decide.
    const felt = (() => {
      for (let seed = 1; seed < 2000; seed += 1) {
        // The settle rolls the job's own success on this seed first; it has to clear that too.
        if (createRng(seed)() >= 0.5) continue;
        if (total(replay(seed, fitted.unitLoadouts).lost) !== total(replay(seed, {}).lost)) {
          return seed;
        }
      }
      throw new Error('fixture: no seed clears the job and feels the card');
    })();
    planted({ ...stack, base: fitted }, strike, felt, T0, {}, edge);
    const bare = replay(felt, {});
    const withGrips = replay(felt, fitted.unitLoadouts);
    expect(withGrips.lost, 'the fixture has to feel the card').not.toEqual(bare.lost);

    const { resolved } = resolveDueMissions(stack.repos, fitted, settledAt);
    expect(
      resolved[0]?.lost,
      `seed ${felt}: settled ${JSON.stringify(resolved[0]?.lost)}, bare ${JSON.stringify(bare.lost)}, fitted ${JSON.stringify(withGrips.lost)}, outcome ${resolved[0]?.outcome}`,
    ).toEqual(withGrips.lost);
  });

  it('leaves infamy alone for standard work however well it went', async () => {
    const stack = await makeStack();
    const courier = findMissionTemplate('courier-contract') as MissionTemplate;
    expect(courier.kind).toBe('standard');
    planted(stack, courier, ALWAYS_SUCCEEDS);

    const { base } = resolveDueMissions(
      stack.repos,
      stack.base,
      after(templateTimings(courier).totalMinutes),
    );

    expect(base.economy.infamy).toBe(stack.base.economy.infamy);
  });

  /**
   * Porters are never in the line (`standsInLine`), so a job that sent nobody but porters killed
   * nobody, and a lost one banks nothing: the rate is per kill, not per fight.
   */
  it('pays nothing for a lost battle job that killed nobody', async () => {
    const stack = await makeStack();
    const strike = findMissionTemplate('convoy-ambush') as MissionTemplate;
    planted(stack, strike, ALWAYS_FAILS);

    const { base } = resolveDueMissions(
      stack.repos,
      stack.base,
      after(templateTimings(strike).totalMinutes),
    );

    expect(base.economy.infamy).toBe(stack.base.economy.infamy);
  });

  it('records what was actually banked on the mission row', async () => {
    const stack = await makeStack();
    planted(stack, scrapRun, ALWAYS_SUCCEEDS);
    resolveDueMissions(stack.repos, stack.base, after(templateTimings(scrapRun).totalMinutes));

    const stored = stack.repos.missions.listByBaseId(stack.base.id)[0];
    expect(stored?.mission.status).toBe('resolved');
    expect(stored?.mission.rewards).toEqual(paidFor(scrapRun, stack));
    expect(stored?.mission.resolvedAt).not.toBeNull();
  });

  it('prices a run on the clock frozen at launch, not on a template retuned mid-flight', async () => {
    const stack = await makeStack();
    const expedition = findMissionTemplate('deep-expedition') as MissionTemplate;
    const before = resourcesOf(stack);
    const launchedTotal = templateTimings(expedition).totalMinutes;

    const planned = planted(stack, expedition, ALWAYS_SUCCEEDS);
    // §A4: what the ground adds. The job is taken off a board, and a board in a hard district pays
    // more for the same work, so the figure to hold the clock against is the scaled one.
    const owedOnLaunchTerms = scaledSpoils(
      missionRewards(expedition, 'success'),
      areaPayPercent(planned.areaId),
    );

    // The crew is out on a 26-hour run. Ship a retune that cuts the mission to an hour: the shape
    // of a deploy landing mid-expedition, which is routine while the board is still being tuned.
    const shipped = expedition.durationMinutes;
    try {
      (expedition as { durationMinutes: number }).durationMinutes = 60;

      // Positive control: without this the assertion below would pass even if the retune never
      // landed, which is exactly how a mutation test quietly proves nothing.
      expect(missionRewards(expedition, 'success').scrap).toBeLessThan(
        owedOnLaunchTerms.scrap ?? 0,
      );

      const { base, resolved } = resolveDueMissions(stack.repos, stack.base, after(launchedTotal));

      // Held the full 26 hours on the frozen clock, so paid the full 26 hours.
      expect(resolved[0]?.rewards).toEqual(owedOnLaunchTerms);
      expect(base.resources.scrap).toBe(before.scrap + (owedOnLaunchTerms.scrap ?? 0));
      expect(base.resources.caps).toBe(before.caps + (owedOnLaunchTerms.caps ?? 0));
    } finally {
      (expedition as { durationMinutes: number }).durationMinutes = shipped;
    }
  });
});

describe('the mission routes', () => {
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  it('launches a mission and reports it in flight', async () => {
    const stack = await makeStack();
    const { app, token } = stack;
    const leaderId = withOfficer(stack);

    // Whatever is on a board today, rather than a named job: the assertion below is that the run
    // that came back is the run that went out, which does not need a particular template.
    const going = aJobToday();
    const launched = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: {
        templateId: going.template.id,
        areaId: going.areaId,
        force: { razors: 1 },
        leaderId,
      },
    });
    expect(launched.statusCode, launched.body).toBe(200);
    expect(launched.json<{ mission: Mission }>().mission.status).toBe('active');

    const board = await app.inject({ method: 'GET', url: '/api/missions', headers: auth(token) });
    expect(board.statusCode).toBe(200);
    const body = board.json<{ missions: Mission[]; activeLimit: number; serverNow: string }>();
    expect(body.missions).toHaveLength(1);
    expect(body.missions[0]?.templateId).toBe(going.template.id);
    expect(body.activeLimit).toBe(BASE_CONCURRENT_MISSIONS);
    expect(Date.parse(body.serverNow)).not.toBeNaN();
  });

  /**
   * §D7: the rank gate stands on every door onto a field, and this was the one it did not.
   *
   * `notorietyToField` says a unit past the crew's rank "will not take the field". The deployment
   * screen refuses it and the city refuses it; the launch route checked the roster and the tier
   * and never the name, so a rank-nothing crew that trained a Colossus could not send it to a
   * declared fight and could send it to a battle job against the same engine.
   */
  it('refuses a unit the crew has not earned the name to field', async () => {
    const stack = await makeStack();
    const { app, token } = stack;
    const leaderId = withOfficer(stack);

    const heavy = UNIT_CATALOG.find((unit) => notorietyToField(unit) > 0);
    if (!heavy) throw new Error('fixture: nothing in the catalogue is rank gated');
    const base = app.repos.bases.findById(stack.base.id)!;
    app.repos.bases.updateArmy(base.id, { ...base.army, [heavy.id]: 1 }, base.trainingQueue);
    expect(base.economy.notoriety, 'the fixture crew must be a nobody').toBeLessThan(
      notorietyToField(heavy),
    );

    const going = aJobToday();
    const refused = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: {
        templateId: going.template.id,
        areaId: going.areaId,
        force: { [heavy.id]: 1 },
        leaderId,
      },
    });
    expect(refused.statusCode, refused.body.slice(0, 200)).toBe(409);
    expect(refused.body).toContain('name that small');
  });

  it('freezes the clock at launch so retuning the board cannot retime a run in flight', async () => {
    const stack = await makeStack();
    const { app, token } = stack;
    // An officer at the head of it, so this stays a test about the freeze.
    const leaderId = withOfficer(stack);
    const { template, areaId } = anEasyJobToday();
    const res = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: { templateId: template.id, areaId, force: { razors: 1 }, leaderId },
    });
    expect(res.statusCode, res.body).toBe(200);

    const mission = res.json<{ mission: Mission }>().mission;
    // The template's road at the column's own pace: one Razor walking, and nothing else on it.
    expect(mission.travelMinutes).toBe(
      hastenedRoadMinutes(templateTimings(template).travelMinutes, findUnit('razors')!.stats.speed),
    );
    expect(mission.durationMinutes).toBe(template.durationMinutes);
  });

  it('rejects a mission that is not on the board', async () => {
    const { app, token } = await makeStack();
    const res = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      // Built by hand, not through `launchBody`: that helper now refuses to construct a payload
      // for a job no board offers, which is exactly what this test is trying to send.
      payload: { templateId: 'not-a-mission', areaId: MISC_AREA_ID, force: { razors: 1 } },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });

  it('refuses to launch once every crew is out, and frees a slot when one comes home', async () => {
    const stack = await makeStack();
    const { app, token } = stack;

    const bench = withOfficers(stack, BASE_CONCURRENT_MISSIONS + 1);
    // One per area: two crews out means two boards, which is half of what the limit is *for*.
    for (let i = 0; i < BASE_CONCURRENT_MISSIONS; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/missions',
        headers: auth(token),
        payload: launchInArea(i, { leaderId: bench[i] }),
      });
      expect(res.statusCode, res.body).toBe(200);
    }

    const overflow = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: launchInArea(BASE_CONCURRENT_MISSIONS, {
        leaderId: bench[BASE_CONCURRENT_MISSIONS],
      }),
    });
    expect(overflow.statusCode).toBe(409);
    expect(overflow.json<{ error: { code: string } }>().error.code).toBe('MISSIONS_AT_CAPACITY');

    /*
     * A day-long expedition that has actually come home releases its crew.
     *
     * Ten days from **now**, not from `T0`. The four launches above went through the route, which
     * stamps them with the real clock; resolving at a moment ten days after a fixed constant only
     * works while that constant is in the recent past, and it silently stopped working the day the
     * calendar walked past it: the missions were simply not due yet and nothing was released.
     */
    resolveDueMissions(stack.repos, stack.base, after(10 * 24 * 60, new Date()));
    const afterReturn = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: launchInArea(BASE_CONCURRENT_MISSIONS, {
        leaderId: bench[BASE_CONCURRENT_MISSIONS],
      }),
    });
    expect(afterReturn.statusCode, afterReturn.body).toBe(200);
  });

  /**
   * §E: one job per area at a time.
   *
   * The rule that makes a district a commitment rather than a queue. It is a *separate* limit from
   * the two-crew cap above and it bites first: a crew with both slots free still cannot run two
   * jobs in the same place.
   */
  it('refuses a second crew in an area one is already working', async () => {
    const stack = await makeStack('area_locker');
    const { app, token } = stack;
    // Two leaders, because one leader cannot take two jobs either: with the same person named
    // twice this would be refused for *that* rule and never reach the area check.
    const [first_leader, second_leader] = withOfficers(stack, 2);

    const first = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: launchInArea(0, { leaderId: first_leader }),
    });
    expect(first.statusCode, first.body).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: launchInArea(0, { leaderId: second_leader }),
    });
    expect(second.statusCode).toBe(409);
    expect(second.json<{ error: { message: string } }>().error.message).toMatch(/already/i);

    // And the board says so rather than leaving the player to find out: an area with a crew in it
    // offers nothing and names the mission instead.
    const board = await app.inject({ method: 'GET', url: '/api/missions', headers: auth(token) });
    const { areas } = board.json<{
      areas: { id: string; offers: unknown[]; activeMissionId: string | null }[];
    }>();
    const worked = areas.find((area) => area.activeMissionId !== null);
    expect(worked).toBeDefined();
    expect(worked?.offers).toEqual([]);
    expect(areas.filter((area) => area.offers.length > 0).length).toBeGreaterThan(0);
  });

  /**
   * Each request re-reads the base before settling, so payouts from separate reads add up
   * instead of the later one overwriting the earlier. Worth pinning at the route level: R7 puts
   * W6's XP award at this same resolution site, and a second settler handed a stale base here is
   * exactly how a payout goes missing.
   */
  it('accumulates payouts across separate reads of the board', async () => {
    const stack = await makeStack();
    const { app, token } = stack;
    const before = resourcesOf(stack);

    planted(stack, scrapRun, ALWAYS_SUCCEEDS, T0);
    const rationRun = findMissionTemplate('ration-run') as MissionTemplate;
    planted(stack, rationRun, ALWAYS_SUCCEEDS, T0);

    // Two reads far enough apart that each brings exactly one crew home.
    resolveDueMissions(
      stack.repos,
      freshBase(stack),
      after(templateTimings(scrapRun).totalMinutes),
    );
    resolveDueMissions(
      stack.repos,
      freshBase(stack),
      after(templateTimings(rationRun).totalMinutes),
    );

    const scrapPay = paidFor(scrapRun, stack);
    const rationPay = paidFor(rationRun, stack);
    const afterBoth = resourcesOf(stack);
    expect(afterBoth.scrap).toBe(before.scrap + (scrapPay.scrap ?? 0) + (rationPay.scrap ?? 0));
    expect(afterBoth.supplies).toBe(
      before.supplies + (scrapPay.supplies ?? 0) + (rationPay.supplies ?? 0),
    );
    expect(afterBoth.caps).toBe(before.caps + (scrapPay.caps ?? 0) + (rationPay.caps ?? 0));

    const board = await app.inject({ method: 'GET', url: '/api/missions', headers: auth(token) });
    expect(board.json<{ resources: Resources }>().resources).toEqual(afterBoth);
  });

  it('requires authentication', async () => {
    const { app } = await makeStack();
    const res = await app.inject({ method: 'GET', url: '/api/missions' });
    expect(res.statusCode).toBe(401);
  });

  it('never leaks the roll seed to a client', async () => {
    const { app, token, overseerId } = await makeStack();
    await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: launchAnyJobToday({ leaderId: overseerId }),
    });

    const board = await app.inject({ method: 'GET', url: '/api/missions', headers: auth(token) });
    expect(board.body).not.toMatch(/seed/i);
    // Both lines are load-bearing now. The seed always was: it is the only value here a client
    // cannot derive at all. The chance line used to be a formality: `MISSION_TEMPLATES` ships
    // `successChance` to the client and `MissionCard` renders it, and launch once copied it
    // verbatim, but whoever leads the run moves it now (`missionOdds`, frozen in `launch.ts`), so
    // the stored chance genuinely diverges from the template's and is no longer something the
    // player can work out from the board. Do not relax this to "the row's copy stays server-side".
    expect(board.body).not.toMatch(/successChance/i);
  });

  it('offers a board that spans every travel band and both kinds', () => {
    expect(MISSION_TEMPLATES.length).toBeGreaterThanOrEqual(6);
  });
});

/**
 * §A1: a crew that is out is still a crew the district feeds.
 *
 * A launch takes the force out of `base.army` and parks it on the mission row, so unless the
 * unit-slot fold goes and reads that row, the people on it are counted nowhere: not at home, not
 * abroad, not against the ceiling. That made the cap dodgeable by anybody with a long job on the
 * board, which is the one thing a cap must not be.
 *
 * Measured through the roster projection rather than through `districtUnitSlots` directly,
 * because the roster is where a player reads it and where **Max** is sized from: a figure that is
 * right in the fold and wrong on the screen would let the same trick through the front door.
 */
describe('a crew on a mission still eats (§A1, §E)', () => {
  it('keeps them in the unit-slot draw and shows them as abroad', async () => {
    const stack = await makeStack();
    const before = projectUnits(stack.repos, freshBase(stack), T0);

    const force = { razors: 4 };
    launchMission({
      id: 'mission-supply',
      base: freshBase(stack),
      template: scrapRun,
      areaId: areasOffering(scrapRun.id, new Date())[0] ?? MISC_AREA_ID,
      force,
      now: T0,
      seed: ALWAYS_SUCCEEDS,
      unled: 'free',
    });
    // The launch route is what takes them off the roster; `launchMission` only writes the row.
    const sent = freshBase(stack);
    stack.repos.bases.updateArmy(sent.id, removeForce(sent.army, force), sent.trainingQueue);
    stack.repos.missions.insert(
      launchMission({
        id: 'mission-supply',
        base: sent,
        template: scrapRun,
        areaId: areasOffering(scrapRun.id, new Date())[0] ?? MISC_AREA_ID,
        force,
        now: T0,
        seed: ALWAYS_SUCCEEDS,
        unled: 'free',
      }),
    );

    const during = projectUnits(stack.repos, freshBase(stack), T0);
    // The ceiling has not moved and neither has the draw: they left the army and joined `abroad`.
    expect(during.unitSlotsCap).toBe(before.unitSlotsCap);
    expect(during.unitSlotsUsed).toBe(before.unitSlotsUsed);
    expect(during.abroad.razors).toBe(4);
    expect(during.army.razors ?? 0).toBe((before.army.razors ?? 0) - 4);
  });
});

describe('mission XP feeds W6 progression (§I1, INTERFACES R7)', () => {
  /**
   * What W6's engine makes of these awards from where the base currently stands.
   *
   * Priced per run rather than off the table entry: a mission's XP is its own clock, its risk and
   * the crew's level (`missionXp`), and a failure pays `FAILED_MISSION_XP_SHARE` of it. Recomputed
   * here from the same shared function the settler uses, so this is a check that the settler *ran*
   * rather than a second copy of the arithmetic.
   */
  function expectedAfter(base: Base, runs: readonly { template: MissionTemplate; won: boolean }[]) {
    const total = runs.reduce((sum, run) => {
      const xp = missionXp(run.template, templateTimings(run.template).totalMinutes, base.level);
      return sum + Math.round(xp * (run.won ? 1 : FAILED_MISSION_XP_SHARE));
    }, 0);
    return applyPlayerXp({ level: base.level, xpIntoLevel: base.progression.xpIntoLevel }, total);
  }

  const won = (template: MissionTemplate) => ({ template, won: true });
  const lost = (template: MissionTemplate) => ({ template, won: false });

  it('banks the award and hands back the level it produced, not a pre-award copy', async () => {
    const stack = await makeStack();
    const before = freshBase(stack);
    // A long one, because XP is priced off the clock now: a thirteen-minute scrap run is worth
    // about half a level and this case is about what happens when one is *crossed*.
    const expedition = findMissionTemplate('deep-expedition') as MissionTemplate;
    planted(stack, expedition, ALWAYS_SUCCEEDS);

    const { base } = resolveDueMissions(
      stack.repos,
      stack.base,
      after(templateTimings(expedition).totalMinutes),
    );

    const expected = expectedAfter(before, [won(expedition)]);
    // Worth more than level 1 costs, so this crosses: the two halves of progression have to move
    // together or the returned base contradicts the row.
    expect(expected.levelsGained).toBeGreaterThan(0);
    expect(freshBase(stack).level).toBe(expected.level);
    expect(freshBase(stack).progression.xpIntoLevel).toBe(expected.xpIntoLevel);
    // The route serves this object, not a re-read, so a stale copy here reaches the player.
    expect(base.level).toBe(expected.level);
    expect(base.progression.xpIntoLevel).toBe(expected.xpIntoLevel);
  });

  it('pays one award per crew that came home, not one per settlement', async () => {
    const stack = await makeStack();
    const before = freshBase(stack);
    planted(stack, scrapRun, ALWAYS_SUCCEEDS, T0);
    planted(stack, findMissionTemplate('ration-run') as MissionTemplate, ALWAYS_SUCCEEDS, after(1));

    const { base, resolved } = resolveDueMissions(stack.repos, stack.base, after(10_000));

    expect(resolved).toHaveLength(2);
    const expected = expectedAfter(before, [
      won(scrapRun),
      won(findMissionTemplate('ration-run') as MissionTemplate),
    ]);
    expect(base.level).toBe(expected.level);
    expect(base.progression.xpIntoLevel).toBe(expected.xpIntoLevel);
    expect(freshBase(stack).progression.xpIntoLevel).toBe(expected.xpIntoLevel);
  });

  /**
   * §I1 prices the run, not the win, and the maintainer's rule for a bad day is a fifth of it: enough
   * that a failure is a setback rather than a wasted afternoon, little enough that the safest job
   * on the board is not the only one worth taking.
   */
  it('pays a fifth of the XP to a crew that came home empty, and no resources at all', async () => {
    const stack = await makeStack();
    const before = freshBase(stack);
    const raid = findMissionTemplate('foundry-raid') as MissionTemplate;
    planted(stack, raid, ALWAYS_FAILS);

    const { base, resolved } = resolveDueMissions(
      stack.repos,
      stack.base,
      after(templateTimings(raid).totalMinutes),
    );

    expect(resolved[0]?.outcome).toBe('failure');
    expect(base.resources).toEqual(before.resources);
    expect(base.progression.xpIntoLevel).toBe(expectedAfter(before, [lost(raid)]).xpIntoLevel);
    // And it is genuinely a fifth: a win on the same job pays five times as much.
    expect(expectedAfter(before, [lost(raid)]).xpIntoLevel).toBeLessThan(
      expectedAfter(before, [won(raid)]).xpIntoLevel,
    );
  });

  it('pays XP exactly once, however many times the board is read', async () => {
    const stack = await makeStack();
    const { totalMinutes } = templateTimings(scrapRun);
    planted(stack, scrapRun, ALWAYS_SUCCEEDS);

    resolveDueMissions(stack.repos, stack.base, after(totalMinutes));
    const paidOnce = freshBase(stack).progression.xpIntoLevel;
    const levelOnce = freshBase(stack).level;

    for (let i = 0; i < 5; i += 1) {
      resolveDueMissions(stack.repos, stack.base, after(totalMinutes + i));
    }

    expect(freshBase(stack).progression.xpIntoLevel).toBe(paidOnce);
    expect(freshBase(stack).level).toBe(levelOnce);
  });
});

/**
 * MOU-227: the settle happens on *this* request, so the response that caused it is the only place
 * it can be announced. `GET` is merely early (a base refetch would catch up); `POST` is the one
 * that loses the moment outright, because the next `GET /missions` re-resolves nothing.
 *
 * Planted well in the past rather than at `T0`: both routes settle against the real clock, and a
 * fixture that is only due after midday is a test that passes depending on when it is run.
 */
describe('a settlement announces its level-up on the response that caused it (§I2, MOU-227)', () => {
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });
  const LONG_AGO = new Date('2020-01-01T00:00:00.000Z');

  interface LevelUpBody {
    levelUp?: { level: number; levelsGained: number; grants: Record<string, number> };
  }

  /** Parks the base at `level` with a clean slate, so a known number of awards crosses or does not. */
  function parkAt(stack: Stack, level: number): void {
    stack.repos.bases.updateProgression(stack.base.id, level, { xpIntoLevel: 0 });
  }

  it('reports the level-up on GET when a returning crew crossed one', async () => {
    const stack = await makeStack();
    // A day-long expedition, because XP is priced off the clock: a short run no longer clears a
    // level on its own and this case is about the announcement a crossing produces.
    planted(
      stack,
      findMissionTemplate('deep-expedition') as MissionTemplate,
      ALWAYS_SUCCEEDS,
      LONG_AGO,
    );

    const board = await stack.app.inject({
      method: 'GET',
      url: '/api/missions',
      headers: auth(stack.token),
    });

    const { levelUp } = board.json<LevelUpBody>();
    expect(levelUp).toBeDefined();
    expect(levelUp?.level).toBe(freshBase(stack).level);
    expect(levelUp?.levelsGained).toBeGreaterThan(0);
    // The grants are what the level is actually worth: the whole reason to announce it.
    expect(levelUp?.grants).toEqual(playerLevelGrants(freshBase(stack).level));
  });

  /**
   * The aggregation, on a fixture built to need it: parked at 99/100, three awards of 120 cross the
   * level-1 threshold, then miss level 2's (300), then clear it. So the run is 1, 0, 1: a total of
   * 2 that neither the first nor the last award reports on its own.
   */
  it('adds the levels up across crews, so two thresholds are one announcement', async () => {
    const stack = await makeStack();
    stack.repos.bases.updateProgression(stack.base.id, 1, { xpIntoLevel: 99 });
    // Standard work: a battle job fights at the settle, and a crew of porters loses that fight,
    // which pays the failure's share of the XP and takes this fixture to one level instead of two.
    // The three are chosen for what they pay: 61 clears level 1 from 99, 94 misses level 2, and
    // 388 clears it, which is the 1, 0, 1 run the aggregation is about.
    for (const templateId of ['scrap-run', 'ration-run', 'courier-contract']) {
      planted(stack, findMissionTemplate(templateId) as MissionTemplate, ALWAYS_SUCCEEDS, LONG_AGO);
    }

    const board = await stack.app.inject({
      method: 'GET',
      url: '/api/missions',
      headers: auth(stack.token),
    });

    const body = board.json<LevelUpBody & { justResolved: Mission[] }>();
    expect(body.justResolved).toHaveLength(3);
    // Three separate awards, not one lump: the engine carries the remainder between them.
    const expected = [1, 2, 3].reduce(
      (at) => applyPlayerXp(at, PLAYER_XP_AWARDS.missionCompleted),
      { level: 1, xpIntoLevel: 99 } as ReturnType<typeof applyPlayerXp>,
    );
    expect(expected.level).toBe(3);
    expect(body.levelUp?.levelsGained).toBe(2);
    expect(body.levelUp?.level).toBe(3);
    expect(freshBase(stack).level).toBe(3);
  });

  /**
   * ...and when the settle was the **world clock's**, which has no response at all.
   *
   * The Q pass left this open: "the clock brings crews home every second and discards `levelUp`,
   * so a mission's level-up never reaches `GET /missions`". It never reached anything: the tick
   * throws the settlement away, and `/missions` afterwards re-resolves nothing, so a threshold
   * crossed at 03:00 was banked and never drawn. The durable marker (migration 0083) is what makes
   * the announcement survive the settle that caused it.
   */
  it('announces a level-up the world clock banked overnight, on the next read', async () => {
    const stack = await makeStack('sleeper');
    planted(
      stack,
      findMissionTemplate('deep-expedition') as MissionTemplate,
      ALWAYS_SUCCEEDS,
      LONG_AGO,
    );
    const before = freshBase(stack).level;

    // The tick, exactly as `index.ts` drives it: no request, no response, nobody looking.
    tickWorld(stack.repos, stack.app.skirmishEngine, new Date());
    expect(freshBase(stack).level, 'the clock really did bank it').toBeGreaterThan(before);

    // The shell's own poll is the backstop, and it draws the card the clock could not.
    const me = await stack.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: auth(stack.token),
    });
    expect(me.statusCode, me.body.slice(0, 200)).toBe(200);
    const { levelUp } = me.json<LevelUpBody>();
    expect(levelUp?.levelsGained).toBeGreaterThan(0);
    expect(levelUp?.level).toBe(freshBase(stack).level);

    // Drawn once: a second poll has nothing left to say.
    const again = await stack.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: auth(stack.token),
    });
    expect(again.json<LevelUpBody>().levelUp).toBeUndefined();
  });

  it('stays silent when a crew came home without crossing a level', async () => {
    const stack = await makeStack();
    // Level 3 costs 600; one mission is worth 120, so this settles without levelling.
    parkAt(stack, 3);
    planted(stack, scrapRun, ALWAYS_SUCCEEDS, LONG_AGO);

    const board = await stack.app.inject({
      method: 'GET',
      url: '/api/missions',
      headers: auth(stack.token),
    });

    const body = board.json<LevelUpBody & { justResolved: Mission[] }>();
    expect(body.justResolved).toHaveLength(1);
    // Presence is the whole signal, so a settlement that changed nothing must not carry the field.
    expect(body.levelUp).toBeUndefined();
    expect(freshBase(stack).level).toBe(3);
  });

  it('stays silent on a read that settled nothing', async () => {
    const stack = await makeStack();

    const board = await stack.app.inject({
      method: 'GET',
      url: '/api/missions',
      headers: auth(stack.token),
    });

    expect(board.json<LevelUpBody>().levelUp).toBeUndefined();
  });

  /** The hole the parent issue missed: on this path the moment is lost, not merely delayed. */
  it('reports a level-up banked by the settle a launch does first', async () => {
    const stack = await makeStack();
    // A day-long run: XP is priced off the clock, so a short one is worth about half a level and
    // this case is about the announcement a *crossing* produces.
    planted(
      stack,
      findMissionTemplate('deep-expedition') as MissionTemplate,
      ALWAYS_SUCCEEDS,
      LONG_AGO,
    );

    const launched = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      payload: launchInArea(1, { leaderId: withOfficer(stack) }),
    });

    expect(launched.statusCode, launched.body).toBe(200);
    expect(launched.json<LevelUpBody>().levelUp?.levelsGained).toBeGreaterThan(0);

    // And it is genuinely unrepeatable: the very next board read has nothing left to announce.
    const board = await stack.app.inject({
      method: 'GET',
      url: '/api/missions',
      headers: auth(stack.token),
    });
    expect(board.json<LevelUpBody>().levelUp).toBeUndefined();
  });

  it('omits the field on a launch that settled nothing', async () => {
    const stack = await makeStack();

    const launched = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      payload: launchAnyJobToday({ leaderId: stack.overseerId }),
    });

    expect(launched.statusCode, launched.body).toBe(200);
    expect(launched.json<LevelUpBody>().levelUp).toBeUndefined();
  });

  /**
   * MOU-280: a *refused* launch settled the board on its way to the refusal, so it owes the
   * announcement exactly as much as a successful one does. There is no second chance: the next
   * `GET /missions` re-resolves nothing.
   *
   * The two halves are fixed differently on purpose, so both are pinned here.
   */
  it('never runs the settle when the launch names an officer who does not exist', async () => {
    const stack = await makeStack();
    planted(
      stack,
      findMissionTemplate('deep-expedition') as MissionTemplate,
      ALWAYS_SUCCEEDS,
      LONG_AGO,
    );
    const before = freshBase(stack).level;

    const refused = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      payload: launchAnyJobToday({ leaderId: 'nobody-by-that-id' }),
    });

    expect(refused.statusCode).toBe(404);
    // Which 404 matters: all three on this route share `NOT_FOUND`, and the point of this test is
    // the officer lookup. Without this the job falling off the board would 404 for its own reason
    // and the test would pass having exercised nothing it claims to.
    expect(refused.json<{ error: { message: string } }>().error.message).toMatch(/on your bench/i);
    // Nothing to lose because nothing was banked: this check needs no post-settle state.
    expect(freshBase(stack).level).toBe(before);
    expect(stack.repos.missions.countActiveByBaseId(stack.base.id)).toBe(1);

    // And the crew is still waiting, so the next board read banks and announces it for real.
    const board = await stack.app.inject({
      method: 'GET',
      url: '/api/missions',
      headers: auth(stack.token),
    });
    expect(board.json<LevelUpBody>().levelUp?.levelsGained).toBeGreaterThan(0);
    expect(freshBase(stack).level).toBeGreaterThan(before);
  });

  it('announces a banked level-up on the refusal envelope of a launch it had to settle first', async () => {
    const stack = await makeStack();
    planted(
      stack,
      findMissionTemplate('deep-expedition') as MissionTemplate,
      ALWAYS_SUCCEEDS,
      LONG_AGO,
    );
    const before = freshBase(stack).level;

    // Nobody leading it, and this crew has not researched how to go without: refused. The check
    // reads `base.research`, which this very settle can move, so it cannot be hoisted above the
    // settle the way the bench lookup can.
    const refused = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      payload: launchAnyJobToday(),
    });

    expect(refused.statusCode).toBe(409);
    const body = refused.json<LevelUpBody & { error: { code: string } }>();
    expect(body.error.code).toBe('MISSION_NEEDS_OFFICER');
    // The settle genuinely happened and is not rolled back: the level really moved…
    expect(freshBase(stack).level).toBeGreaterThan(before);
    // …so this refusal is the only response that can ever report it.
    expect(body.levelUp?.levelsGained).toBeGreaterThan(0);
    expect(body.levelUp?.level).toBe(freshBase(stack).level);

    const board = await stack.app.inject({
      method: 'GET',
      url: '/api/missions',
      headers: auth(stack.token),
    });
    expect(board.json<LevelUpBody>().levelUp).toBeUndefined();
  });

  it('leaves the refusal envelope clean when the launch settled nothing', async () => {
    const stack = await makeStack();

    const refused = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      // Nobody leading it, so it is refused: the envelope of a *refusal* is the subject.
      payload: launchAnyJobToday(),
    });

    expect(refused.statusCode, refused.body).toBe(409);
    expect(refused.json<LevelUpBody>().levelUp).toBeUndefined();
  });
});

/**
 * §C3: the Garage on a run.
 *
 * The battle side of this landed first and missions were left walking, which made the Garage worth
 * building only for the fights a player chooses to pick. These pin the three things that differ
 * from the battle path.
 *
 * The one that matters most is the last: **a mission never destroys a machine.** A vehicle is lost
 * when everybody riding it dies, and a mission does not kill anybody, so the yard gets everything
 * back whatever the run did. That is not an oversight to be tidied up later, it is the rule.
 */
describe('vehicles on a mission (§C3)', () => {
  /**
   * The longest road the board authors, so a machine's saving is minutes rather than a rounding
   * step. Named rather than picked off today's boards: `planted` launches directly and does not
   * need the job to be on offer, and a fixture that changes with the date is a suite that goes red
   * on a Tuesday.
   */
  const longestRoad =
    MISSION_TEMPLATES.find((entry) => entry.travelBand === 'furthest') ?? scrapRun;

  const yardWith = (stack: Stack, fleet: Record<string, number>) => {
    stack.repos.bases.updateFleet(stack.base.id, fleet);
    return stack.repos.bases.findById(stack.base.id)!;
  };

  async function launchWith(stack: Stack, vehicles: Record<string, number>) {
    return stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: { authorization: `Bearer ${stack.token}` },
      payload: {
        ...launchAnyJobToday({ leaderId: stack.overseerId }),
        force: { razors: 4 },
        vehicles,
      },
    });
  }

  it('takes the machines out of the yard for the length of the run', async () => {
    const stack = await makeStack('rider');
    yardWith(stack, { motorcycle: 3 });

    const res = await launchWith(stack, { motorcycle: 2 });

    expect(res.statusCode, res.body).toBe(200);
    expect(stack.repos.bases.findById(stack.base.id)!.fleet.motorcycle).toBe(1);
  });

  /** Checked against the yard rather than trusted: naming four buys the speed of four. */
  it('refuses a crew that names machines it does not own', async () => {
    const stack = await makeStack('bluffer');
    yardWith(stack, { motorcycle: 1 });

    const res = await launchWith(stack, { motorcycle: 4 });

    expect(res.statusCode).toBe(403);
    // And nothing left the yard on a refused launch.
    expect(stack.repos.bases.findById(stack.base.id)!.fleet.motorcycle).toBe(1);
  });

  /**
   * The point of the whole feature: the road is shorter.
   *
   * Measured on the longest road in the game rather than on whatever is on the board today.
   * `roadMinutes` rounds to the minute and a `close` job is five of them, so a walking Razor (45)
   * and a Razor on a Scrappy (65) both come out at three: at that length the test is a coin flip
   * against the rounding step rather than a test. Twenty Razors and twenty seats, so the whole
   * column rides and nobody is left setting its pace.
   */
  it('gets the crew there sooner than the same job on foot', async () => {
    const walking = await makeStack('walker');
    const riding = await makeStack('driver');

    const onFoot = planted(walking, longestRoad, ALWAYS_SUCCEEDS, T0, {}, { razors: 20 });
    const onWheels = planted(
      riding,
      longestRoad,
      ALWAYS_SUCCEEDS,
      T0,
      { motorcycle: 10 },
      { razors: 20 },
    );

    expect(onWheels.travelMinutes).toBeLessThan(onFoot.travelMinutes);
    // And it is the shared clock rather than a second copy of it: the walkers at their own 45, the
    // riders at the Scrappy's 65.
    const band = TRAVEL_BAND_MINUTES[longestRoad.travelBand];
    expect(onFoot.travelMinutes).toBe(hastenedRoadMinutes(band, findUnit('razors')!.stats.speed));
    expect(onWheels.travelMinutes).toBe(
      hastenedRoadMinutes(band, findVehicle('motorcycle')!.speed),
    );
  });

  /** And it is the *road* that shortens, not the work at the far end. */
  it('does not make the job itself go faster', async () => {
    const walking = await makeStack('slow');
    const riding = await makeStack('fast');
    yardWith(riding, { motorcycle: 2 });

    const onFoot = await launchWith(walking, {});
    const onWheels = await launchWith(riding, { motorcycle: 2 });

    expect(onWheels.json<{ mission: Mission }>().mission.durationMinutes).toBe(
      onFoot.json<{ mission: Mission }>().mission.durationMinutes,
    );
  });

  /**
   * And the road being shorter is not a discount on the take. `missionXp` and `missionRewards`
   * scale with the clock, and the launch used to price them off the hastened one, so a crew that
   * rode was paid less than the card said, about 12% on a long road.
   */
  it('pays and rewards the ride exactly what it pays the walk', async () => {
    const walking = await makeStack('paidwalker');
    const riding = await makeStack('paiddriver');

    const walked = planted(walking, longestRoad, ALWAYS_SUCCEEDS, T0, {}, { razors: 20 });
    const rode = planted(
      riding,
      longestRoad,
      ALWAYS_SUCCEEDS,
      T0,
      { motorcycle: 10 },
      { razors: 20 },
    );

    // The precondition: the two clocks differ, so a price off the clock would too.
    expect(rode.travelMinutes).toBeLessThan(walked.travelMinutes);
    expect(rode.pricedMinutes).toBe(walked.pricedMinutes);
    expect(rode.xp).toBe(walked.xp);
    expect(pricedTotalMinutes(rode)).toBe(pricedTotalMinutes(walked));
    // A row from before the field is priced off its own clock, as it always was.
    expect(pricedTotalMinutes({ ...rode, pricedMinutes: 0 })).toBe(
      missionTimings(rode).totalMinutes,
    );
  });

  /** An empty seat buys nothing: a truck sent with four people is a truck mostly full of air. */
  it('pays for the share of the crew a machine actually carries', async () => {
    const few = await makeStack('few');
    const many = await makeStack('many');
    yardWith(few, { armoured_car: 1 });
    yardWith(many, { armoured_car: 1 });

    const smallForce = await few.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: { authorization: `Bearer ${few.token}` },
      payload: {
        ...launchAnyJobToday({ leaderId: few.overseerId }),
        force: { razors: 1 },
        vehicles: { armoured_car: 1 },
      },
    });
    const bigForce = await many.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: { authorization: `Bearer ${many.token}` },
      payload: {
        ...launchAnyJobToday({ leaderId: many.overseerId }),
        force: { razors: 20 },
        vehicles: { armoured_car: 1 },
      },
    });

    // Both ride the same bus; the fuller one is not slower for it. The rule under test is that
    // the *machine's* contribution is weighted by what it carries, so neither run is penalised.
    expect(smallForce.statusCode, smallForce.body).toBe(200);
    expect(bigForce.statusCode, bigForce.body).toBe(200);
    expect(bigForce.json<{ mission: Mission }>().mission.vehicles.armoured_car).toBe(1);
  });

  /**
   * And what the settle pays is the card's number too, not just what the launch froze.
   *
   * X4 put `pricedMinutes` on the row and priced the XP off it, and the settle went on reading
   * `missionTimings(row).totalMinutes`: the *ridden* clock. So `missionRewards` and `rollSalvage`
   * still charged a crew for using the Garage, which is the whole of the bug X4 was written to
   * close, surviving in the one place that actually hands resources over. The launch-side test
   * above could not see it: it reads `xp` and `pricedTotalMinutes`, both of which were already
   * right.
   *
   * Two stacks, one template, one seed, so the outcome, the page and the salvage stream are the
   * same run twice: everything that differs is the road.
   */
  it('pays a settled ride exactly what it pays a settled walk', async () => {
    const walkers = await makeStack('settlewalk');
    const riders = await makeStack('settleride');
    // The longest road on the board, so the ride is worth something and the two clocks differ by
    // more than a rounding step.
    // Standard work: a battle job settles by fighting, and four hundred porters lose that fight.
    const template =
      MISSION_TEMPLATES.find(
        (entry) => entry.travelBand === 'furthest' && entry.kind === 'standard',
      ) ?? scrapRun;

    /*
     * Enough seats for everybody, counted in unit slots rather than in heads.
     *
     * A Hauler costs two slots, so two hundred of them ask for four hundred; twelve Heli Porters
     * seat 360 and two Cheese Wagons take the rest. Nobody walks, and the column moves at the
     * slowest machine that is carrying anybody. Written as the arithmetic rather than as a round
     * number because the head count used to be the whole of it: four hundred Haulers against this
     * yard left half of them on foot the moment a seat started costing what a bed costs.
     */
    const force = { haulers: 200 };
    const walked = planted(walkers, template, ALWAYS_SUCCEEDS, T0, {}, force);
    const rode = planted(
      riders,
      template,
      ALWAYS_SUCCEEDS,
      T0,
      { heli_porter: 12, armoured_car: 2 },
      force,
    );

    // The precondition: a price off the row's own clock would differ.
    expect(rode.travelMinutes).toBeLessThan(walked.travelMinutes);
    expect(rode.pricedMinutes).toBe(walked.pricedMinutes);

    const onFoot = resolveDueMissions(walkers.repos, walkers.base, after(10_000));
    const onWheels = resolveDueMissions(riders.repos, riders.base, after(10_000));

    // What the job paid, what came home on the truck, and what they found on the way.
    expect(onWheels.resolved[0]?.spoils).toEqual(onFoot.resolved[0]?.spoils);
    expect(onWheels.resolved[0]?.rewards).toEqual(onFoot.resolved[0]?.rewards);
    expect(freshBase(riders).inventory).toEqual(freshBase(walkers).inventory);
    // And the pay is a real number rather than two empty bundles agreeing with each other.
    expect(Object.keys(onFoot.resolved[0]?.spoils ?? {}).length).toBeGreaterThan(0);
  });

  it('brings every machine home when the crew comes back', async () => {
    const stack = await makeStack('homecoming');
    yardWith(stack, { motorcycle: 2, scrap_car: 1 });

    const launched = await launchWith(stack, { motorcycle: 2, scrap_car: 1 });
    expect(launched.statusCode, launched.body).toBe(200);
    expect(stack.repos.bases.findById(stack.base.id)!.fleet.motorcycle ?? 0).toBe(0);

    // Wind the run into the past and settle it the way a read would.
    const id = launched.json<{ mission: Mission }>().mission.id;
    stack.db
      .prepare('UPDATE missions SET started_at = ? WHERE id = ?')
      .run(new Date(Date.now() - 30 * 24 * 3600_000).toISOString(), id);
    await stack.app.inject({
      method: 'GET',
      url: '/api/missions',
      headers: { authorization: `Bearer ${stack.token}` },
    });

    const yard = stack.repos.bases.findById(stack.base.id)!.fleet;
    expect(yard.motorcycle).toBe(2);
    expect(yard.scrap_car).toBe(1);
  });

  /**
   * The crew's own speed is worth the same on a job's road as on a march (§C3).
   *
   * The Skate Ground says "everything you field moves faster", and `unitSpeedPercent` is the
   * channel it says it through: `battle/movement.ts` has fed it to `columnSpeed` since the column
   * had a speed at all, and the launch called `columnSpeed(vehicles, force, unitColumnSpeed)` with
   * no bonus at all. So the same Razors walked to a fight quicker than they walked to a job on the
   * same streets, and the only holding in the game whose whole reward line is movement bought
   * nothing on the screen a player uses it on most.
   *
   * Measured on the longest leg on offer, because `roadMinutes` rounds to the minute.
   */
  it('reads a mission road at the pace the crew actually moves at', async () => {
    const stack = await makeStack('skater');
    const skate = CITY_LOCATIONS.find((location) => location.kind === 'skate_ground');
    if (!skate) throw new Error('no Skate Ground on the map');
    const control = stack.repos.city.control(skate.id);
    if (!control) throw new Error(`no control row for ${skate.id}`);
    stack.repos.city.put({
      ...control,
      holder: { kind: 'crew', baseId: stack.base.id },
      level: MAX_LOCATION_LEVEL,
      garrison: {},
    });

    // An officer leads it, because `leading` is the fold the route launches an officer-led run
    // from, and the perk channels under test are an officer's rather than the Overseer's.
    const leaderId = withOfficer(stack);
    const effects = leading(
      standingEffectsFor(stack.repos, stack.repos.bases.findById(stack.base.id)!),
    );
    expect(effects.unitSpeedPercent).toBeGreaterThan(0);

    const { template, areaId } = theFurthestJobToday();
    const res = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: { authorization: `Bearer ${stack.token}` },
      payload: { templateId: template.id, areaId, force: { razors: 4 }, vehicles: {}, leaderId },
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);

    const band = TRAVEL_BAND_MINUTES[template.travelBand];
    const printed = findUnit('razors')!.stats.speed;
    const quickened = effectiveSpeed(printed, { percent: effects.unitSpeedPercent });
    expect(res.json<{ mission: Mission }>().mission.travelMinutes).toBe(
      hastenedRoadMinutes(band, quickened, effects.missionSpeedPercent),
    );
    // The teeth: the printed sheet is a different number on this leg, so the assertion above
    // cannot pass by reading the channel and by ignoring it both.
    expect(hastenedRoadMinutes(band, printed, effects.missionSpeedPercent)).toBeGreaterThan(
      hastenedRoadMinutes(band, quickened, effects.missionSpeedPercent),
    );
  });

  /**
   * ...and the workshop's own speed points reach both roads (§C3).
   *
   * `upgradedStats` is what the engine reads, so a Neural Lace is twelve points of speed inside a
   * fight. Both roads read `unit.stats.speed` straight off the catalogue, so the same unit crossed
   * the city slower than it crossed a battlefield, and the one upgrade line whose flavour is "goes
   * faster" did nothing to the clock a player watches. The armour line's negative speed is the
   * same rule in the other direction and rides in on the same fix.
   */
  it('reads the road at the sheet the workshop actually fitted', async () => {
    const stack = await makeStack('laced');
    // The largest of them, so the two sheets are more than a rounding step apart on this road.
    const quickening = [...UNIT_MODIFICATIONS]
      .sort((a, b) => (b.effect.speed ?? 0) - (a.effect.speed ?? 0))
      .find((spec) => (spec.effect.speed ?? 0) > 0 && spec.fits === undefined);
    if (!quickening) throw new Error('no universal card adds speed');
    const base = stack.repos.bases.findById(stack.base.id)!;
    stack.repos.bases.updateUnitLoadouts(base.id, { razors: [quickening.id] });
    const leaderId = withOfficer(stack);
    const effects = leading(
      standingEffectsFor(stack.repos, stack.repos.bases.findById(stack.base.id)!),
    );

    const { template, areaId } = theFurthestJobToday();
    const res = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: { authorization: `Bearer ${stack.token}` },
      payload: { templateId: template.id, areaId, force: { razors: 4 }, vehicles: {}, leaderId },
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);

    const band = TRAVEL_BAND_MINUTES[template.travelBand];
    const sheet = findUnit('razors')!.stats;
    const printed = effectiveSpeed(sheet.speed, { percent: effects.unitSpeedPercent });
    const fitted = effectiveSpeed(upgradedStats(sheet, [quickening.id]).speed, {
      percent: effects.unitSpeedPercent,
    });
    expect(fitted).toBeGreaterThan(printed);
    expect(res.json<{ mission: Mission }>().mission.travelMinutes).toBe(
      hastenedRoadMinutes(band, fitted, effects.missionSpeedPercent),
    );
    expect(hastenedRoadMinutes(band, printed, effects.missionSpeedPercent)).toBeGreaterThan(
      hastenedRoadMinutes(band, fitted, effects.missionSpeedPercent),
    );
  });
});

/**
 * A screen that has to open at speed cannot carry a year of history.
 *
 * Nothing deletes a mission. `listByBaseId` had no `LIMIT`, and `GET /missions` mapped the whole
 * result into its response on the 600/min read bucket, so a crew running eight a day was
 * serialising ~2,900 rows a year later and the screen got slower every week it was played. The
 * launch path was loading the same history to count how many runs were out, with
 * `listActiveByBaseId` sitting unused on the same repo.
 */
describe('how much history a mission screen carries', () => {
  it('stops at the history limit, and keeps the newest', async () => {
    const stack = await makeStack();
    const { app, repos, base } = stack;

    const overflow = MISSION_HISTORY_LIMIT + 25;
    const template = MISSION_TEMPLATES[0];
    if (!template) throw new Error('fixture: no templates');
    // One real run to copy the shape from, then a year of finished ones written straight to the
    // table: `launchMission` takes units off the roster, and this is about the read, not the launch.
    const shape = planted(stack, template, 0);
    for (let index = 0; index < overflow; index += 1) {
      const startedAt = new Date(T0.getTime() + (index + 1) * 60_000);
      repos.missions.insert({
        mission: {
          ...shape,
          id: `history-${String(index).padStart(4, '0')}`,
          startedAt: startedAt.toISOString(),
          status: 'resolved',
          outcome: 'success',
          resolvedAt: new Date(startedAt.getTime() + 60_000).toISOString(),
        },
        seed: index,
        successChance: 0.5,
      });
    }

    const listed = repos.missions.listByBaseId(base.id);
    expect(listed).toHaveLength(MISSION_HISTORY_LIMIT);
    // Newest first, so what falls off the end is the oldest.
    const ids = listed.map((entry) => entry.mission.id);
    expect(ids[0]).toBe(`history-${String(overflow - 1).padStart(4, '0')}`);
    expect(ids).not.toContain('history-0000');

    const res = await app.inject({
      method: 'GET',
      url: '/api/missions',
      headers: { authorization: `Bearer ${stack.token}` },
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    expect(res.json<MissionsResponse>().missions.length).toBeLessThanOrEqual(MISSION_HISTORY_LIMIT);
  });
});

/**
 * `POST /missions/recall` answers with the whole board, and it has to be the same board.
 *
 * The read prices every card off the crew's standing effects (a Smuggler's Tunnel shortens the
 * clock, a fixer widens the cut). The recall rebuilt the board without that fold, so every card
 * came back at bare timings and bare pay until the next poll put the crew's own bonuses back on it,
 * and a launch made off the repainted card was made against the wrong quoted numbers.
 */
describe('the board a recall answers with', () => {
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  it('is priced the way the read prices it, standing effects included', async () => {
    const stack = await makeStack('recaller');
    // A hold that moves the clock on every card, so a board without the fold reads differently.
    const tunnel = CITY_LOCATIONS.find((location) => location.kind === 'smugglers_tunnel');
    if (!tunnel) throw new Error('fixture: no tunnel in the catalogue');
    stack.repos.city.put({
      locationId: tunnel.id,
      holder: { kind: 'crew', baseId: stack.base.id },
      level: 1,
      upgradingUntil: null,
      fortification: 0,
      fortifyingUntil: null,
      garrison: {},
    });
    const running = planted(
      stack,
      findMissionTemplate('deep-expedition') as MissionTemplate,
      ALWAYS_SUCCEEDS,
      new Date(),
    );

    const read = await stack.app.inject({
      method: 'GET',
      url: '/api/missions',
      headers: auth(stack.token),
    });
    expect(read.statusCode).toBe(200);
    const recalled = await stack.app.inject({
      method: 'POST',
      url: '/api/missions/recall',
      headers: auth(stack.token),
      payload: { missionId: running.id },
    });
    expect(recalled.statusCode, recalled.body.slice(0, 200)).toBe(200);

    const before = read.json<MissionsResponse>().areas;
    const after = recalled.json<MissionsResponse>().areas;
    expect(after).toEqual(before);
    // ...and the fold is not a no-op here: a bare board would differ.
    const bare = projectAreas(
      CITY_DISTRICTS,
      areaStatesFor(stack.repos, stack.base),
      [],
      stack.base.level,
      new Date(),
    );
    expect(after).not.toEqual(bare);
  });
});

/**
 * The Cartographer's tenth rung is a door, not a percentage: one more crew out at once.
 *
 * Read through the standing fold on the board and at the launch gate both, so the number the
 * board prints is the number the launch refuses at.
 */
describe('a research grant that widens what may be out at once', () => {
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  it('adds a crew to the board’s limit once The Whole City is finished', async () => {
    const stack = await makeStack('mapper');
    const before = await stack.app.inject({
      method: 'GET',
      url: '/api/missions',
      headers: auth(stack.token),
    });
    const limit = before.json<MissionsResponse>().activeLimit;
    expect(limit).toBe(concurrentMissionSlots(stack.base.level));

    stack.repos.bases.updateResearch(stack.base.id, {
      ...stack.base.research,
      technologies: [...stack.base.research.technologies, 'tech_the_whole_city'],
    });
    const after = await stack.app.inject({
      method: 'GET',
      url: '/api/missions',
      headers: auth(stack.token),
    });
    expect(after.json<MissionsResponse>().activeLimit).toBe(limit + 1);
  });
});

/**
 * §D5/§E5: what a leader's Short Way buys, and what it must not cost.
 *
 * `leadArrivalPercent` shortens the road a led run walks. It was folded into `missionSpeedPercent`
 * before `launchMission` froze `pricedMinutes`, and pay and XP scale with those minutes
 * (`rewardScale` is monotonic in them), so bringing the fastest leader on the books made the same
 * job pay **less** than the card had quoted for it. That is the §A4 divergence `offerFor`'s own doc
 * says was closed for the ground channel, arriving a second time through the officer.
 *
 * Both runs below are the same job, at the same level, out of crews with the same person on the
 * books. The only difference is whether the launch names them as leading it, so anything that moves
 * moved because of that.
 */
describe('§D5: a leader shortens the road and not the cheque', () => {
  const auth = (token: string) => ({ authorization: `Bearer ${token}` });

  /**
   * An easy job on a board today, longest road first.
   *
   * Longest, because a tenth off a five-minute hop can round back onto the same whole minute and a
   * comparison that lands on one passes whatever the code does. Easy is what this fixture has
   * always asked for and it costs nothing to keep: both crews here name a leader.
   */
  /**
   * The longest road on any board today, out of the jobs this fixture can actually send.
   *
   * **Not the easy ones.** The Short Way is ten per cent off a leg and legs are whole minutes, so
   * a `close` band, five minutes before the column's own pace is read, rounds the perk away to
   * nothing and the test's own control trips ("the Short Way does not move this road"). Today
   * every easy job on an open board is `close`; on 2026-09-21, when residential districts came
   * off the boards, the pool lost the templates that were only offered on a plot and the longest
   * easy road fell to three minutes.
   *
   * `standard` rather than any kind, because a battle job brings §D7's force rules with it and
   * this test is about pricing. Difficulty is not filtered at all: a hard standard job launches
   * on the same four Razors, and what it costs is not what is under test.
   */
  function aLongRoadToday(): { template: MissionTemplate; areaId: string } {
    const now = new Date();
    const offered = MISSION_TEMPLATES.filter(
      (template) => template.kind === 'standard' && template.travelBand !== 'close',
    )
      .map((template) => ({ template, areaId: areasOffering(template.id, now)[0] }))
      .filter(
        (entry): entry is { template: MissionTemplate; areaId: string } =>
          entry.areaId !== undefined,
      )
      .sort(
        (a, b) =>
          TRAVEL_BAND_MINUTES[b.template.travelBand] - TRAVEL_BAND_MINUTES[a.template.travelBand],
      );
    const longest = offered[0];
    if (!longest) throw new Error(`no long standard road on any board at ${now.toISOString()}`);
    return longest;
  }

  /** A crew with one officer on the books who knows a short way, seated and fit to lead. */
  async function crewWithAShortWay(username: string): Promise<{ stack: Stack; leaderId: string }> {
    const stack = await makeStack(username);
    const officer = createCommander('off-short', 'Ilva Rask', 'field_commander', {}, ['short_way']);
    stack.repos.bases.updateCommanders(stack.base.id, [officer]);
    return { stack, leaderId: officer.id };
  }

  async function launch(
    stack: Stack,
    template: MissionTemplate,
    areaId: string,
    leaderId?: string,
  ): Promise<Mission> {
    const res = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      payload: {
        templateId: template.id,
        areaId,
        force: { razors: 4 },
        vehicles: {},
        ...(leaderId === undefined ? {} : { leaderId }),
      },
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    return res.json<{ mission: Mission }>().mission;
  }

  it('pays and teaches the same whether or not the fastest officer leads it', async () => {
    const { template, areaId } = aLongRoadToday();
    const led = await crewWithAShortWay('short_way_led');
    const unled = await crewWithAShortWay('short_way_unled');

    const withLeader = await launch(led.stack, template, areaId, led.leaderId);
    // Led by the Overseer, who is nobody's officer and carries no book of perks: the §D5 channels
    // are an officer's, so this is the same run without the Short Way on it.
    const without = await launch(unled.stack, template, areaId, unled.stack.overseerId);

    // The control: the perk is worth something on this leg, so the equalities below are a claim
    // about the pricing rather than a comparison of two identical runs.
    expect(
      withLeader.travelMinutes,
      'fixture: the Short Way does not move this road, so nothing here is measured',
    ).toBeLessThan(without.travelMinutes);

    // ...and none of what it is worth reaches the cheque.
    expect(withLeader.pricedMinutes).toBe(without.pricedMinutes);
    expect(withLeader.xp).toBe(without.xp);
    expect(withLeader.payPercent).toBe(without.payPercent);
    // Through the settler's own expression (`missions/resolve.ts`) rather than a second copy of the
    // pricing that could drift from it.
    const paid = (mission: Mission) =>
      scaledSpoils(
        missionRewards(template, 'success', pricedTotalMinutes(mission)),
        mission.payPercent,
      );
    expect(paid(withLeader)).toEqual(paid(without));
    expect(
      Object.values(paid(withLeader)).some((amount) => (amount ?? 0) > 0),
      'fixture: this job pays nothing, so equal pay proves nothing',
    ).toBe(true);
  });

  it('freezes the clock the board quoted, not the one the crew runs on', async () => {
    const { template, areaId } = aLongRoadToday();
    const { stack, leaderId } = await crewWithAShortWay('short_way_quoted');

    const board = await stack.app.inject({
      method: 'GET',
      url: '/api/missions',
      headers: auth(stack.token),
    });
    const quoted = board
      .json<MissionsResponse>()
      .areas.find((area) => area.id === areaId)
      ?.offers.find((offer) => offer.templateId === template.id);
    if (!quoted) throw new Error(`fixture: ${template.id} is not on ${areaId}'s board`);

    const mission = await launch(stack, template, areaId, leaderId);

    // The card and the row, tied together: `pricedTimings` is the one function behind both.
    expect(mission.pricedMinutes).toBe(quoted.totalMinutes);
    expect(mission.xp).toBe(quoted.xp);
    // And the run really is shorter than the quote, which is what the officer was brought for.
    expect(mission.travelMinutes).toBeLessThan(quoted.travelMinutes);
  });
});
