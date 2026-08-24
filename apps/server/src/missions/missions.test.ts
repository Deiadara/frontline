import {
  ANTI_SYSTEMIC_ACTIONS,
  ATTRIBUTE_NAMES,
  CHARACTER_LEVEL_AUTO_POINTS,
  CHARACTER_LEVEL_PLAYER_POINTS,
  MISSION_INFAMY_DELTA,
  MISSION_TEMPLATES,
  PLAYER_XP_AWARDS,
  applyPlayerXp,
  characterXpForActivity,
  characterXpToNextLevel,
  createCommander,
  findMissionTemplate,
  missionRewards,
  playerLevelGrants,
  reputationOf,
  requiresOfficer,
  templateTimings,
  type Attributes,
  type Base,
  type Commander,
  type Mission,
  type MissionStance,
  type MissionTemplate,
  type ReputationTally,
  type Resources,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { createRng } from '../characters/rng.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { CONCURRENT_MISSION_LIMIT, launchMission } from './launch.js';
import { resolveDueMissions } from './resolve.js';

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
  const base = repos.bases.findByOwnerId(user.id);
  if (!base) throw new Error('overseer creation did not mint a base');
  return { app, repos, base, token };
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

/** Puts a mission on the board with a pinned seed and launch time. */
function planted(stack: Stack, template: MissionTemplate, seed: number, startedAt = T0): Mission {
  const stored = launchMission({
    id: `mission-${seed}-${template.id}`,
    base: stack.base,
    template,
    now: startedAt,
    seed,
  });
  stack.repos.missions.insert(stored);
  return stored.mission;
}

const after = (minutes: number, from: Date = T0) => new Date(from.getTime() + minutes * MINUTE_MS);

/** Every point on a sheet, so a level-up's auto-allocation can be counted without naming targets. */
const sheetTotal = (attributes: Attributes) =>
  ATTRIBUTE_NAMES.reduce((total, name) => total + attributes[name], 0);

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

    const expected = missionRewards(scrapRun, 'success');
    expect(base.resources.scrap).toBe(before.scrap + (expected.scrap ?? 0));
    expect(base.resources.caps).toBe(before.caps + (expected.caps ?? 0));
    expect(base.economy.morale).toBeGreaterThan(stack.base.economy.morale);
  });

  it('sends a failed battle home empty and costs morale (§E5 risk)', async () => {
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
    expect(base.economy.morale).toBeLessThan(stack.base.economy.morale);
  });

  /**
   * §D7/§A3: a blow that lands on the state is heard. Asserted on the meter rather than the
   * stance tally, which `recordMissionOutcome` already covers: the two are written side by side
   * in the same settle and one can be added without the other.
   */
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
    expect(stored?.mission.rewards).toEqual(missionRewards(scrapRun, 'success'));
    expect(stored?.mission.resolvedAt).not.toBeNull();
  });

  it('prices a run on the clock frozen at launch, not on a template retuned mid-flight', async () => {
    const stack = await makeStack();
    const expedition = findMissionTemplate('deep-expedition') as MissionTemplate;
    const before = resourcesOf(stack);
    const owedOnLaunchTerms = missionRewards(expedition, 'success');
    const launchedTotal = templateTimings(expedition).totalMinutes;

    planted(stack, expedition, ALWAYS_SUCCEEDS);

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

    const launched = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: { templateId: 'deep-expedition', officerId },
    });
    expect(launched.statusCode).toBe(200);
    expect(launched.json<{ mission: Mission }>().mission.status).toBe('active');

    const board = await app.inject({ method: 'GET', url: '/api/missions', headers: auth(token) });
    expect(board.statusCode).toBe(200);
    const body = board.json<{ missions: Mission[]; activeLimit: number; serverNow: string }>();
    expect(body.missions).toHaveLength(1);
    expect(body.missions[0]?.templateId).toBe('deep-expedition');
    expect(body.activeLimit).toBe(CONCURRENT_MISSION_LIMIT);
    expect(Date.parse(body.serverNow)).not.toBeNaN();
  });

  it('freezes the clock at launch so retuning the board cannot retime a run in flight', async () => {
    const stack = await makeStack();
    const { app, token } = stack;
    // An officer with nobody under them: §G5/§G7 both come out at 1, so this stays a test about
    // the freeze rather than a test about the assignee bonus.
    const officerId = withOfficer(stack);
    const res = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: { templateId: 'fuel-siphon', officerId },
    });

    const mission = res.json<{ mission: Mission }>().mission;
    const siphon = findMissionTemplate('fuel-siphon') as MissionTemplate;
    expect(mission.travelMinutes).toBe(templateTimings(siphon).travelMinutes);
    expect(mission.durationMinutes).toBe(siphon.durationMinutes);
  });

  it('rejects a mission that is not on the board', async () => {
    const { app, token } = await makeStack();
    const res = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: { templateId: 'not-a-mission' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NOT_FOUND');
  });

  it('refuses to launch once every crew is out, and frees a slot when one comes home', async () => {
    const stack = await makeStack();
    const { app, token } = stack;

    const officerId = withOfficer(stack);
    for (let i = 0; i < CONCURRENT_MISSION_LIMIT; i += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/missions',
        headers: auth(token),
        payload: { templateId: 'deep-expedition', officerId },
      });
      expect(res.statusCode).toBe(200);
    }

    const overflow = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: { templateId: 'scrap-run' },
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
      payload: { templateId: 'scrap-run' },
    });
    expect(afterReturn.statusCode).toBe(200);
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

    const scrapPay = missionRewards(scrapRun, 'success');
    const rationPay = missionRewards(rationRun, 'success');
    const afterBoth = resourcesOf(stack);
    expect(afterBoth.scrap).toBe(before.scrap + (scrapPay.scrap ?? 0) + (rationPay.scrap ?? 0));
    expect(afterBoth.food).toBe(before.food + (scrapPay.food ?? 0) + (rationPay.food ?? 0));
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
      payload: { templateId: 'scrap-run' },
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

describe('mission XP feeds W6 progression (§I1, INTERFACES R7)', () => {
  /** What W6's engine makes of `n` mission awards from where the base currently stands. */
  function expectedAfter(base: Base, missions: number) {
    return applyPlayerXp(
      { level: base.level, xpIntoLevel: base.progression.xpIntoLevel },
      missions * PLAYER_XP_AWARDS.missionCompleted,
    );
  }

  it('banks the award and hands back the level it produced, not a pre-award copy', async () => {
    const stack = await makeStack();
    const before = freshBase(stack);
    planted(stack, scrapRun, ALWAYS_SUCCEEDS);

    const { base } = resolveDueMissions(
      stack.repos,
      stack.base,
      after(templateTimings(scrapRun).totalMinutes),
    );

    const expected = expectedAfter(before, 1);
    // One mission is worth more than level 1 costs, so this crosses a level: the two halves of
    // progression have to move together or the returned base contradicts the row.
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
    const expected = expectedAfter(before, 2);
    expect(base.level).toBe(expected.level);
    expect(base.progression.xpIntoLevel).toBe(expected.xpIntoLevel);
    expect(freshBase(stack).progression.xpIntoLevel).toBe(expected.xpIntoLevel);
  });

  it('pays a crew that came home empty too: §I1 prices the run, not the win', async () => {
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
    expect(base.progression.xpIntoLevel).toBe(expectedAfter(before, 1).xpIntoLevel);
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
    planted(stack, scrapRun, ALWAYS_SUCCEEDS, LONG_AGO);

    const board = await stack.app.inject({
      method: 'GET',
      url: '/api/missions',
      headers: auth(stack.token),
    });

    const { levelUp } = board.json<LevelUpBody>();
    // One mission (120) clears level 1 (100), so this fixture genuinely crosses.
    expect(levelUp).toBeDefined();
    expect(levelUp?.level).toBe(freshBase(stack).level);
    expect(levelUp?.levelsGained).toBe(1);
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
    planted(stack, scrapRun, ALWAYS_SUCCEEDS, LONG_AGO);

    const launched = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      payload: { templateId: 'scrap-run' },
    });

    expect(launched.statusCode).toBe(200);
    expect(launched.json<LevelUpBody>().levelUp?.levelsGained).toBe(1);

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
      payload: { templateId: 'scrap-run' },
    });

    expect(launched.statusCode).toBe(200);
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
    planted(stack, scrapRun, ALWAYS_SUCCEEDS, LONG_AGO);
    const before = freshBase(stack).level;

    const refused = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      payload: { templateId: 'scrap-run', officerId: 'nobody-by-that-id' },
    });

    expect(refused.statusCode).toBe(404);
    // Nothing to lose because nothing was banked: this check needs no post-settle state.
    expect(freshBase(stack).level).toBe(before);
    expect(stack.repos.missions.countActiveByBaseId(stack.base.id)).toBe(1);

    // And the crew is still waiting, so the next board read banks and announces it for real.
    const board = await stack.app.inject({
      method: 'GET',
      url: '/api/missions',
      headers: auth(stack.token),
    });
    expect(board.json<LevelUpBody>().levelUp?.levelsGained).toBe(1);
    expect(freshBase(stack).level).toBe(before + 1);
  });

  it('announces a banked level-up on the refusal envelope of a launch it had to settle first', async () => {
    const stack = await makeStack();
    planted(stack, scrapRun, ALWAYS_SUCCEEDS, LONG_AGO);
    const before = freshBase(stack).level;

    // §G6: a hard run with nobody on the books is refused, and `resolveCrew` reads `base.level`
    // to size the delegation. This very settle moves that level, so the check cannot be hoisted
    // above the settle the way the officer lookup can: it would refuse a crew the level-up allows.
    const refused = await stack.app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(stack.token),
      payload: { templateId: 'convoy-ambush' },
    });

    expect(refused.statusCode).toBe(409);
    const body = refused.json<LevelUpBody & { error: { code: string } }>();
    expect(body.error.code).toBe('MISSION_NEEDS_OFFICER');
    // The settle genuinely happened and is not rolled back: the level really moved…
    expect(freshBase(stack).level).toBe(before + 1);
    // …so this refusal is the only response that can ever report it.
    expect(body.levelUp?.levelsGained).toBe(1);
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
      payload: { templateId: 'convoy-ambush' },
    });

    expect(refused.statusCode).toBe(409);
    expect(refused.json<LevelUpBody>().levelUp).toBeUndefined();
  });
});

describe('what a mission says about the Combine (§A3, §D8)', () => {
  const templateWith = (stance: MissionStance): MissionTemplate => {
    const found = MISSION_TEMPLATES.find((t) => t.stance === stance);
    if (!found) throw new Error(`fixture error: no ${stance} mission on the board`);
    return found;
  };

  /** Settles one planted run and hands back the tally the base was left holding. */
  async function tallyAfter(
    template: MissionTemplate,
    seed: number,
  ): Promise<{ before: ReputationTally; after: ReputationTally }> {
    const stack = await makeStack();
    if (requiresOfficer(template.difficulty)) withOfficer(stack);
    planted(stack, template, seed);

    const { base } = resolveDueMissions(
      stack.repos,
      stack.base,
      after(templateTimings(template).totalMinutes),
    );
    // Read back through the repository, not off the returned object: the counters have to survive
    // the JSON round trip and `ReputationTallySchema`, or they are only true in memory.
    const persisted = stack.repos.bases.findById(base.id);
    if (!persisted) throw new Error('base vanished mid-settlement');
    return { before: stack.base.economy.reputationTally, after: persisted.economy.reputationTally };
  }

  it('books a successful anti-Combine run as action against the state', async () => {
    const { before, after: tally } = await tallyAfter(
      templateWith('against_government'),
      ALWAYS_SUCCEEDS,
    );

    expect(tally.governmentSitesTaken).toBe(before.governmentSitesTaken + 1);
    expect(tally.governmentContracts).toBe(before.governmentContracts);
    // Only a raid can take a seat of power: a mission never does (§A3).
    expect(tally.governmentSeatsTaken).toBe(before.governmentSeatsTaken);
  });

  it('books a completed Combine contract as collaboration', async () => {
    const { before, after: tally } = await tallyAfter(
      templateWith('for_government'),
      ALWAYS_SUCCEEDS,
    );

    expect(tally.governmentContracts).toBe(before.governmentContracts + 1);
    expect(tally.governmentSitesTaken).toBe(before.governmentSitesTaken);
  });

  it('books nothing for unaligned work or for a run that failed', async () => {
    const unaligned = await tallyAfter(templateWith('unaligned'), ALWAYS_SUCCEEDS);
    expect(unaligned.after.governmentSitesTaken).toBe(unaligned.before.governmentSitesTaken);
    expect(unaligned.after.governmentContracts).toBe(unaligned.before.governmentContracts);

    const failed = await tallyAfter(templateWith('against_government'), ALWAYS_FAILS);
    expect(failed.after.governmentSitesTaken).toBe(failed.before.governmentSitesTaken);
  });

  it('turns the run that crosses the threshold into the Anti-systemic word the HUD reads', async () => {
    // The whole §D8 path end to end: the counters exist to produce a *word*, so this asserts on
    // `reputationOf`, the one function the HUD and the Bar both call, over the base as the
    // repository hands it back, and it does so on the exact run that tips the threshold.
    const template = templateWith('against_government');
    const stack = await makeStack();
    if (requiresOfficer(template.difficulty)) withOfficer(stack);

    const settledAt = after(templateTimings(template).totalMinutes);
    // Stamped at the settlement instant, not at T0: the §D8 drift is continuous, so a tally aged
    // even half an hour leaves an integer threshold a fraction out of reach. The drift itself is
    // covered by the shared unit tests: what this one is about is the write path.
    const oneShort = {
      ...stack.base.economy,
      reputationTally: {
        ...stack.base.economy.reputationTally,
        updatedAt: settledAt.toISOString(),
        governmentSitesTaken: ANTI_SYSTEMIC_ACTIONS - 1,
      },
    };
    stack.repos.bases.updateEconomy(stack.base.id, oneShort);
    expect(reputationOf(oneShort, settledAt)).toBe('Cautious');

    planted({ ...stack, base: freshBase(stack) }, template, ALWAYS_SUCCEEDS);
    resolveDueMissions(stack.repos, freshBase(stack), settledAt);

    const persisted = freshBase(stack);
    expect(persisted.economy.reputationTally.governmentSitesTaken).toBeGreaterThanOrEqual(
      ANTI_SYSTEMIC_ACTIONS,
    );
    expect(reputationOf(persisted.economy, settledAt)).toBe('Anti-systemic');
  });
});

/**
 * INTERFACES §2 R2 / GDD §H6: the officer who led a run is paid for the time it kept them engaged.
 *
 * Every assertion reads the officer back out of the *repository* rather than off the returned base:
 * the sheet is persisted inside `bases.commanders_json`, and an award applied to the in-memory copy
 * but never written would satisfy a check on the return value alone.
 */
describe('character XP for a run (§H6, INTERFACES R2)', () => {
  const OFFICER_ID = 'off-1';

  /** Puts an officer on the books and hands back the base that actually knows about them. */
  function stackWithOfficer(stack: Stack): { officer: Commander; base: Base } {
    const officer = createCommander(OFFICER_ID, 'Halvard Nyx', 'field_commander');
    stack.repos.bases.updateCommanders(stack.base.id, [officer]);
    return { officer, base: freshBase(stack) };
  }

  /** Plants a mission with a named officer leading it (§G6). */
  function plantedUnder(
    stack: Stack,
    template: MissionTemplate,
    seed: number,
    officer: Commander,
    startedAt = T0,
  ): Mission {
    const stored = launchMission({
      id: `mission-${seed}-${template.id}`,
      base: stack.base,
      template,
      now: startedAt,
      officer,
      seed,
    });
    stack.repos.missions.insert(stored);
    return stored.mission;
  }

  function officerOf(stack: Stack): Commander {
    const found = freshBase(stack).commanders.find((c) => c.id === OFFICER_ID);
    if (!found) throw new Error('officer vanished');
    return found;
  }

  it('records who led the run on the mission row, and null for a delegation', async () => {
    const stack = await makeStack();
    const { officer } = stackWithOfficer(stack);

    expect(plantedUnder(stack, scrapRun, ALWAYS_SUCCEEDS, officer).officerId).toBe(OFFICER_ID);
    expect(planted(stack, scrapRun, ALWAYS_FAILS).officerId).toBeNull();
  });

  it('pays the officer for the minutes the run kept them engaged', async () => {
    const stack = await makeStack();
    const { officer, base } = stackWithOfficer(stack);
    plantedUnder(stack, scrapRun, ALWAYS_SUCCEEDS, officer);

    resolveDueMissions(stack.repos, base, after(templateTimings(scrapRun).totalMinutes));

    expect(officerOf(stack).xpIntoLevel).toBe(
      characterXpForActivity(templateTimings(scrapRun).totalMinutes),
    );
  });

  it('pays a losing crew too: the time was spent either way', async () => {
    const stack = await makeStack();
    const { officer, base } = stackWithOfficer(stack);
    const raid = findMissionTemplate('foundry-raid') as MissionTemplate;
    plantedUnder(stack, raid, ALWAYS_FAILS, officer);

    const settlement = resolveDueMissions(
      stack.repos,
      base,
      after(templateTimings(raid).totalMinutes),
    );

    expect(settlement.resolved[0]?.outcome).toBe('failure');
    expect(officerOf(stack).xpIntoLevel).toBeGreaterThan(0);
  });

  it('pays nobody for a §G6 delegation that went out unled', async () => {
    const stack = await makeStack();
    const { base } = stackWithOfficer(stack);
    planted(stack, scrapRun, ALWAYS_SUCCEEDS);

    resolveDueMissions(stack.repos, base, after(templateTimings(scrapRun).totalMinutes));

    expect(officerOf(stack)).toMatchObject({ level: 1, xpIntoLevel: 0, unspentPoints: 0 });
  });

  it('levels an officer up and banks the §H6a points the player must assign', async () => {
    const stack = await makeStack();
    const { officer, base } = stackWithOfficer(stack);
    // 130 minutes clears the 120 needed for level 2 with 10 to spare.
    const long = findMissionTemplate('courier-contract') as MissionTemplate;
    plantedUnder(stack, long, ALWAYS_SUCCEEDS, officer);

    resolveDueMissions(stack.repos, base, after(templateTimings(long).totalMinutes));

    const levelled = officerOf(stack);
    expect(levelled.level).toBe(2);
    expect(levelled.xpIntoLevel).toBe(
      characterXpForActivity(templateTimings(long).totalMinutes) - characterXpToNextLevel(1),
    );
    expect(levelled.unspentPoints).toBe(CHARACTER_LEVEL_PLAYER_POINTS);
    // The auto-allocated points landed on the sheet, so the character actually got better (§H6a).
    expect(sheetTotal(levelled.attributes)).toBe(
      sheetTotal(officer.attributes) + CHARACTER_LEVEL_AUTO_POINTS,
    );
  });

  /**
   * The reason `awardCharacterXp` folds per officer before it writes anything.
   *
   * Two 600-XP runs are worth three levels together but only two apiece, so an implementation that
   * applied each award to the sheet as it was read, rather than to the running total, would land
   * on level 3 and lose one. Verified by mutation: this pair of numbers is chosen because folded
   * (level 4) and per-award-on-a-stale-sheet (level 3) actually disagree here.
   */
  it('folds two runs by the same officer into one award', async () => {
    const stack = await makeStack();
    const { officer, base } = stackWithOfficer(stack);
    const long = findMissionTemplate('refinery-assault') as MissionTemplate;
    plantedUnder(stack, long, ALWAYS_SUCCEEDS, officer);
    plantedUnder(stack, long, ALWAYS_FAILS, officer);

    resolveDueMissions(stack.repos, base, after(templateTimings(long).totalMinutes));

    const each = characterXpForActivity(templateTimings(long).totalMinutes);
    const levelled = officerOf(stack);
    expect(each * 2).toBe(
      characterXpToNextLevel(1) + characterXpToNextLevel(2) + characterXpToNextLevel(3),
    );
    expect(levelled.level).toBe(4);
    expect(levelled.xpIntoLevel).toBe(0);
    expect(levelled.unspentPoints).toBe(3 * CHARACTER_LEVEL_PLAYER_POINTS);
  });

  it('settles normally when the officer was dismissed while the run was out', async () => {
    const stack = await makeStack();
    const { officer } = stackWithOfficer(stack);
    plantedUnder(stack, scrapRun, ALWAYS_SUCCEEDS, officer);
    stack.repos.bases.updateCommanders(stack.base.id, []);

    const settlement = resolveDueMissions(
      stack.repos,
      freshBase(stack),
      after(templateTimings(scrapRun).totalMinutes),
    );

    expect(settlement.resolved).toHaveLength(1);
    expect(freshBase(stack).commanders).toEqual([]);
  });

  it('leaves an officer who stayed home untouched', async () => {
    const stack = await makeStack();
    const led = createCommander(OFFICER_ID, 'Halvard Nyx', 'field_commander');
    const idle = createCommander('off-2', 'Wren Sable', 'salvager');
    stack.repos.bases.updateCommanders(stack.base.id, [led, idle]);
    plantedUnder(stack, scrapRun, ALWAYS_SUCCEEDS, led);

    resolveDueMissions(
      stack.repos,
      freshBase(stack),
      after(templateTimings(scrapRun).totalMinutes),
    );

    expect(freshBase(stack).commanders.find((c) => c.id === 'off-2')).toEqual(idle);
    expect(officerOf(stack).xpIntoLevel).toBeGreaterThan(0);
  });
});
