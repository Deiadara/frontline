import {
  MISSION_TEMPLATES,
  PLAYER_XP_AWARDS,
  applyPlayerXp,
  createCommander,
  findMissionTemplate,
  missionRewards,
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
 * A whole stack — app, database, a registered player and their base. The base is read back out
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
 * The stack's base starts with nobody hired, which after §G6 means it can only run *easy* missions
 * — so any test about something other than the officer gate has to hire one first. No assignees are
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
   * still answer "success" both times and the test would pass while the property was broken —
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
    // poll re-reads the base, because each poll is a separate request — see `freshBase`.
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

    // The fleet actually contains both outcomes — otherwise this proves nothing.
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

    // The crew is out on a 26-hour run. Ship a retune that cuts the mission to an hour — the shape
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

    // A day-long expedition that has actually come home releases its crew.
    resolveDueMissions(stack.repos, stack.base, after(10 * 24 * 60));
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
    // The seed line is the load-bearing one: it is the only value here a client cannot already
    // derive. The chance line is not a secrecy guarantee today — `MISSION_TEMPLATES` ships
    // `successChance` to the client and `MissionCard` renders it, and launch copies it verbatim,
    // so the player already knows every in-flight run's odds. It starts meaning something once W4
    // makes the stored chance diverge from the template's (crew skill, gear); until then, read it
    // as "the row's copy stays server-side", not "the number is hidden".
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

  it('pays a crew that came home empty too — §I1 prices the run, not the win', async () => {
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
