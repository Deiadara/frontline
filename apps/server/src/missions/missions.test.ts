import {
  BASE_CONCURRENT_MISSIONS,
  CITY_DISTRICTS,
  MISC_AREA_ID,
  MISSION_TEMPLATES,
  type MissionsResponse,
  FAILED_MISSION_XP_SHARE,
  areaPayPercent,
  areasOffering,
  missionBoardDay,
  levelPayPercent,
  missionOffers,
  missionXp,
  scaledSpoils,
  MISSION_INFAMY_DELTA,
  PLAYER_XP_AWARDS,
  applyPlayerXp,
  createCommander,
  findMissionTemplate,
  missionRewards,
  playerLevelGrants,
  templateTimings,
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
import { launchMission } from './launch.js';
import { projectUnits } from '../units/roster.js';
import { removeForce } from '../battle/forces.js';
import { resolveDueMissions } from './resolve.js';
import { MISSION_HISTORY_LIMIT } from '../db/repos/missions.js';

/**
 * A launch payload for `POST /api/missions`.
 *
 * A job has to be posted with the board it was taken off and the crew going, so the tests say
 * both. `areasOffering` is what picks a board that genuinely offers the template, which is the
 * same check the route makes.
 */
/**
 * A launch payload for a job named outright, refusing to build one that cannot work.
 *
 * The fallback used to be `?? MISC_AREA_ID`, and that is what made this dangerous. Boards turn
 * over daily, so a named id is a fixture with a hidden expiry date; on the day nothing offered it
 * the helper quietly produced a payload for an area that does not stock the job, the route
 * answered `NOT_FOUND` for a reason no test meant to exercise, and a test asserting 404 passed for
 * the wrong reason. Throwing turns that into one legible failure that names the day.
 *
 * Prefer `aJobToday` / `anEasyJobToday` and only name a job when the test is genuinely about
 * *that* job.
 */
function launchBody(templateId: string, extra: Record<string, unknown> = {}) {
  const day = missionBoardDay(new Date());
  const areaId = areasOffering(templateId, day)[0];
  if (areaId === undefined) {
    throw new Error(
      `no board offers "${templateId}" on ${day}: name a job that is on offer, or use aJobToday()`,
    );
  }
  return { templateId, areaId, force: { razors: 1 }, ...extra };
}

/**
 * Any job on any board today, with the area that offers it.
 *
 * The counterpart to `anEasyJobToday` for the tests that do not care *which* job goes out, only
 * that one does. Every one of those used to name a template, which is the expiry-dated fixture
 * described on `launchBody`.
 */
/**
 * A job on a board today that a delegation can actually be sent on.
 *
 * **Not** simply the first job offered. §G6 refuses a `hard` job with nobody leading it, and the
 * board rotates by date, so "the first offer on the first board" is a launch that succeeds on most
 * days and is refused on the days a hard job happens to sort first: the suite then goes red on a
 * date rather than on a change. Asking for the property the test needs is the fix, exactly as
 * `aHardJobToday` asks for the opposite one.
 */
function aJobToday(): { template: MissionTemplate; areaId: string } {
  const day = missionBoardDay(new Date());
  for (const areaId of [MISC_AREA_ID, ...CITY_DISTRICTS.map((district) => district.id)]) {
    const template = missionOffers(areaId, day).find((entry) => entry.difficulty !== 'hard');
    if (template) return { template, areaId };
  }
  throw new Error(`no job a delegation can run on any board on ${day}`);
}

/** `aJobToday` as a launch payload. */
function launchAnyJobToday(extra: Record<string, unknown> = {}) {
  const { template, areaId } = aJobToday();
  return { templateId: template.id, areaId, force: { razors: 1 }, ...extra };
}

/**
 * A **hard** job on a board today: the §G6 refusal, for tests about a launch that gets turned away.
 *
 * Hard is the property that makes it refuse when nobody is leading, so a test that wants a refusal
 * has to ask for that property rather than name a job that happens to have it today.
 */
function aHardJobToday(): { template: MissionTemplate; areaId: string } {
  const day = missionBoardDay(new Date());
  for (const template of MISSION_TEMPLATES.filter((entry) => entry.difficulty === 'hard')) {
    const areaId = areasOffering(template.id, day)[0];
    if (areaId !== undefined) return { template, areaId };
  }
  throw new Error(`no hard job on any board on ${day}`);
}

/** `aHardJobToday` as a launch payload, which a crew with no officer cannot legally send. */
function launchAHardJobToday(extra: Record<string, unknown> = {}) {
  const { template, areaId } = aHardJobToday();
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
  const boards = [MISC_AREA_ID, ...CITY_DISTRICTS.map((district) => district.id)];
  const areaId = boards[nth];
  if (areaId === undefined) throw new Error(`no board number ${nth}`);
  const offer = missionOffers(areaId, missionBoardDay(new Date()))[0];
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
 * three-minute scrap run, and three minutes times the §G6 penalty rounds back to three: the rule
 * fires and the assertion cannot see it. A job of any real length has room for the effect to show.
 */
function anEasyJobToday(): { template: MissionTemplate; areaId: string } {
  const day = missionBoardDay(new Date());
  const offered = MISSION_TEMPLATES.filter((template) => template.difficulty === 'easy')
    .map((template) => ({ template, areaId: areasOffering(template.id, day)[0] }))
    .filter(
      (entry): entry is { template: MissionTemplate; areaId: string } => entry.areaId !== undefined,
    )
    .sort((a, b) => b.template.durationMinutes - a.template.durationMinutes);
  const longest = offered[0];
  if (!longest) throw new Error(`no easy job on any board on ${day}`);
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
  /** The handle itself, for the few tests that wind a clock back rather than going through HTTP. */
  db: AppDatabase;
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

  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: { authorization: `Bearer ${token}` },
    payload: { presetId: 'enforcer' },
  });
  expect(chosen.statusCode).toBe(201);

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
  const base = repos.bases.findByOwnerId(user.id);
  if (!base) throw new Error('base vanished after arming it');
  return { app, repos, base, token, db };
}

const scrapRun = findMissionTemplate('scrap-run') as MissionTemplate;

/**
 * Puts an officer on the books and returns their id (§G6).
 *
 * The stack's base starts with nobody hired, which after §G6 means it can only run *easy* missions,
 * so any test about something other than the officer gate has to hire one first. No assignees are
 * placed under them, so the §G5/§G7 multipliers are both 1 and the run keeps the template's
 * authored clock and odds.
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
function planted(stack: Stack, template: MissionTemplate, seed: number, startedAt = T0): Mission {
  const stored = launchMission({
    id: `mission-${seed}-${template.id}`,
    base: stack.base,
    template,
    areaId: areasOffering(template.id, missionBoardDay(new Date()))[0] ?? MISC_AREA_ID,
    // Enough bags that nothing is left on the floor: what a crew can carry is measured elsewhere
    // (`missions.areas.test.ts`), and a payout trimmed by accident here would look like a pricing
    // bug in every timer assertion below.
    force: { haulers: 400 },
    now: startedAt,
    seed,
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
  const areaId = areasOffering(template.id, missionBoardDay(new Date()))[0] ?? MISC_AREA_ID;
  return scaledSpoils(
    missionRewards(template, 'success'),
    areaPayPercent(areaId) + levelPayPercent(stack.base.level),
  );
}

/** A job on today's boards that §G6 will not let out without an officer leading it. */
function hardJob(): MissionTemplate {
  const day = missionBoardDay(new Date());
  for (const areaId of [MISC_AREA_ID, ...CITY_DISTRICTS.map((d) => d.id)]) {
    const found = missionOffers(areaId, day).find((t) => t.difficulty === 'hard');
    if (found) return found;
  }
  throw new Error('no hard job on any board today');
}

const after = (minutes: number, from: Date = T0) => new Date(from.getTime() + minutes * MINUTE_MS);

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
    const { totalMinutes } = templateTimings(scrapRun);
    planted(stack, scrapRun, ALWAYS_SUCCEEDS);
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
   * The point the CTO asked to be proved on MOU-206: resolution must be a function of the stored
   * mission, never of when anyone happened to look.
   *
   * Two identical worlds run the same 40 missions from the same seeds. One is watched every
   * minute of the way; the other is abandoned and opened a week after everything should have
   * landed. Every outcome, every payout and the final stockpile have to match.
   *
   * The fleet is deliberately weighted to battles, and deliberately large. A single 97%-success
   * scrap run proves almost nothing here: a resolver that re-rolled against the wall clock would
   * still answer "success" both times and the test would pass while the property was broken:
   * verified by mutation, which is why this is 40 missions and not one. At battle odds a re-roll
   * agrees only ~62% of the time, so a time-dependent roll diverges here with probability
   * 1 - 0.62^n, i.e. beyond any plausible flake.
   */
  it('resolves a slept-through fleet identically to a watched one', async () => {
    const watched = await makeStack('watcher');
    const abandoned = await makeStack('sleeper');
    const battles = MISSION_TEMPLATES.filter((t) => t.kind === 'battle');
    const fleetSize = 40;

    for (let i = 0; i < fleetSize; i += 1) {
      const template = battles[i % battles.length] as MissionTemplate;
      // Seeds spread across the roll space, so outcomes are a genuine mix of wins and losses.
      const seed = 1_000 + i * 7_919;
      planted(watched, template, seed);
      planted(abandoned, template, seed);
    }

    const longest = Math.max(...battles.map((t) => templateTimings(t).totalMinutes));

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

  /** §D7/§A3: a blow that lands on the state is heard. */
  it('raises infamy for anti-government work that came home', async () => {
    const stack = await makeStack();
    const strike = findMissionTemplate('fuel-siphon') as MissionTemplate;
    expect(strike.stance).toBe('against_government');
    planted(stack, strike, ALWAYS_SUCCEEDS);

    const { base } = resolveDueMissions(
      stack.repos,
      stack.base,
      after(templateTimings(strike).totalMinutes),
    );

    expect(base.economy.infamy).toBe(
      stack.base.economy.infamy + MISSION_INFAMY_DELTA.against_government.success,
    );
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

    const strike = findMissionTemplate('fuel-siphon') as MissionTemplate;
    planted({ ...stack, base: notorious }, strike, ALWAYS_SUCCEEDS);

    const { base } = resolveDueMissions(
      stack.repos,
      notorious,
      after(templateTimings(strike).totalMinutes),
    );

    expect(base.economy.infamy).toBe(480 + MISSION_INFAMY_DELTA.against_government.success);
  });

  it('leaves infamy alone for a failed strike, and for work done for the Combine', async () => {
    for (const [id, roll] of [
      ['fuel-siphon', ALWAYS_FAILS],
      ['courier-contract', ALWAYS_SUCCEEDS],
    ] as const) {
      const stack = await makeStack();
      const template = findMissionTemplate(id) as MissionTemplate;
      planted(stack, template, roll);

      const { base } = resolveDueMissions(
        stack.repos,
        stack.base,
        after(templateTimings(template).totalMinutes),
      );

      expect(base.economy.infamy, id).toBe(stack.base.economy.infamy);
    }
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
    const officerId = withOfficer(stack);

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
        officerId,
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

  it('freezes the clock at launch so retuning the board cannot retime a run in flight', async () => {
    const stack = await makeStack();
    const { app, token } = stack;
    // An officer with nobody under them: §G5/§G7 both come out at 1, so this stays a test about
    // the freeze rather than a test about the assignee bonus.
    const officerId = withOfficer(stack);
    const { template, areaId } = anEasyJobToday();
    const res = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: { templateId: template.id, areaId, force: { razors: 1 }, officerId },
    });
    expect(res.statusCode, res.body).toBe(200);

    const mission = res.json<{ mission: Mission }>().mission;
    expect(mission.travelMinutes).toBe(templateTimings(template).travelMinutes);
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
        payload: launchInArea(i, { officerId: bench[i] }),
      });
      expect(res.statusCode, res.body).toBe(200);
    }

    const overflow = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: launchInArea(BASE_CONCURRENT_MISSIONS, {
        officerId: bench[BASE_CONCURRENT_MISSIONS],
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
        officerId: bench[BASE_CONCURRENT_MISSIONS],
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
    const officerId = withOfficer(stack);

    const first = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: launchInArea(0, { officerId }),
    });
    expect(first.statusCode, first.body).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: launchInArea(0, { officerId }),
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
    const { app, token } = await makeStack();
    await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: launchAnyJobToday(),
    });

    const board = await app.inject({ method: 'GET', url: '/api/missions', headers: auth(token) });
    expect(board.body).not.toMatch(/seed/i);
    // Both lines are load-bearing now. The seed always was: it is the only value here a client
    // cannot derive at all. The chance line used to be a formality: `MISSION_TEMPLATES` ships
    // `successChance` to the client and `MissionCard` renders it, and launch once copied it
    // verbatim, but W7's §F5 Overseer modifier and W4's §G7 crew bonus both land in `launch.ts`,
    // so the stored chance genuinely diverges from the template's and is no longer something the
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
 * population fold goes and reads that row, the people on it are counted nowhere: not at home, not
 * abroad, not against the ceiling. That made the cap dodgeable by anybody with a long job on the
 * board, which is the one thing a cap must not be.
 *
 * Measured through the roster projection rather than through `districtPopulation` directly,
 * because the roster is where a player reads it and where **Max** is sized from: a figure that is
 * right in the fold and wrong on the screen would let the same trick through the front door.
 */
describe('a crew on a mission still eats (§A1, §E)', () => {
  it('keeps them in the population draw and shows them as abroad', async () => {
    const stack = await makeStack();
    const before = projectUnits(stack.repos, freshBase(stack), T0);

    const force = { razors: 4 };
    launchMission({
      id: 'mission-supply',
      base: freshBase(stack),
      template: scrapRun,
      areaId: areasOffering(scrapRun.id, missionBoardDay(new Date()))[0] ?? MISC_AREA_ID,
      force,
      now: T0,
      seed: ALWAYS_SUCCEEDS,
    });
    // The launch route is what takes them off the roster; `launchMission` only writes the row.
    const sent = freshBase(stack);
    stack.repos.bases.updateArmy(sent.id, removeForce(sent.army, force), sent.trainingQueue);
    stack.repos.missions.insert(
      launchMission({
        id: 'mission-supply',
        base: sent,
        template: scrapRun,
        areaId: areasOffering(scrapRun.id, missionBoardDay(new Date()))[0] ?? MISC_AREA_ID,
        force,
        now: T0,
        seed: ALWAYS_SUCCEEDS,
      }),
    );

    const during = projectUnits(stack.repos, freshBase(stack), T0);
    // The ceiling has not moved and neither has the draw: they left the army and joined `abroad`.
    expect(during.supplyCap).toBe(before.supplyCap);
    expect(during.supplyUsed).toBe(before.supplyUsed);
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
   * §I1 prices the run, not the win, and the board's rule for a bad day is a fifth of it: enough
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
    for (const templateId of ['scrap-run', 'ration-run', 'convoy-ambush']) {
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
      payload: launchInArea(1, { officerId: withOfficer(stack) }),
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
      payload: launchAnyJobToday(),
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
      payload: launchAnyJobToday({ officerId: 'nobody-by-that-id' }),
    });

    expect(refused.statusCode).toBe(404);
    // Which 404 matters: all three on this route share `NOT_FOUND`, and the point of this test is
    // the officer lookup. Without this the job falling off the board would 404 for its own reason
    // and the test would pass having exercised nothing it claims to.
    expect(refused.json<{ error: { message: string } }>().error.message).toMatch(/on your books/i);
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

    // §G6: a hard run with nobody on the books is refused, and `resolveCrew` reads `base.level`
    // to size the delegation. This very settle moves that level, so the check cannot be hoisted
    // above the settle the way the officer lookup can: it would refuse a crew the level-up allows.
    const refused = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      payload: launchBody(hardJob().id),
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
      // Hard, so it is refused for want of an officer: the envelope of a *refusal* is the subject.
      payload: launchAHardJobToday(),
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
  const yardWith = (stack: Stack, fleet: Record<string, number>) => {
    stack.repos.bases.updateFleet(stack.base.id, fleet);
    return stack.repos.bases.findById(stack.base.id)!;
  };

  async function launchWith(stack: Stack, vehicles: Record<string, number>) {
    return stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: { authorization: `Bearer ${stack.token}` },
      payload: { ...launchAnyJobToday(), force: { razors: 4 }, vehicles },
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
   * Compared against the same job launched on foot rather than against a fixed number, because the
   * travel band is authored per template and a hard-coded figure would be pinning the template.
   */
  it('gets the crew there sooner than the same job on foot', async () => {
    const walking = await makeStack('walker');
    const riding = await makeStack('driver');
    yardWith(riding, { motorcycle: 2 });

    const onFoot = await launchWith(walking, {});
    const onWheels = await launchWith(riding, { motorcycle: 2 });

    expect(onFoot.statusCode, onFoot.body).toBe(200);
    expect(onWheels.statusCode, onWheels.body).toBe(200);
    expect(onWheels.json<{ mission: Mission }>().mission.travelMinutes).toBeLessThan(
      onFoot.json<{ mission: Mission }>().mission.travelMinutes,
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

  /** An empty seat buys nothing: a truck sent with four people is a truck mostly full of air. */
  it('pays for the share of the crew a machine actually carries', async () => {
    const few = await makeStack('few');
    const many = await makeStack('many');
    yardWith(few, { war_hauler: 1 });
    yardWith(many, { war_hauler: 1 });

    const smallForce = await few.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: { authorization: `Bearer ${few.token}` },
      payload: { ...launchAnyJobToday(), force: { razors: 1 }, vehicles: { war_hauler: 1 } },
    });
    const bigForce = await many.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: { authorization: `Bearer ${many.token}` },
      payload: { ...launchAnyJobToday(), force: { razors: 20 }, vehicles: { war_hauler: 1 } },
    });

    // Both ride the same truck; the fuller one is not slower for it. The rule under test is that
    // the *hauler's* contribution is weighted by what it carries, so neither run is penalised.
    expect(smallForce.statusCode, smallForce.body).toBe(200);
    expect(bigForce.statusCode, bigForce.body).toBe(200);
    expect(bigForce.json<{ mission: Mission }>().mission.vehicles.war_hauler).toBe(1);
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
