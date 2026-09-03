import {
  BAR_HIRES_PER_DAY,
  MAX_BUILD_QUEUE,
  createCommander,
  playerLevelGrants,
  type BarResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { WAIVED_REFUSALS } from './mode.js';
import { hireRecruit } from '../bar/hire.js';
import { barDay, barRoster } from '../bar/roster.js';

/**
 * Every gate admin mode waives, driven the way an ordinary player meets it.
 *
 * The board's decision is that the exposed admin surface stays: `ADMIN` defaults on outside the
 * test runner, and nothing is to be locked down. What that decision needs behind it is proof that
 * the *real* paths still work, because a waiver is invisible from inside the mode it applies to:
 * `adminWaives` turns thirteen refusals into a no-op, `adminCost` makes every charge zero and
 * `adminSeconds` flattens every clock to five, so a suite running in admin mode passes through any
 * pricing or capacity bug anybody introduces.
 *
 * `adminDefault` returns false under the test runner, so this file is already the ordinary path;
 * it says so explicitly anyway, because "the suite happens to run with it off" is not a thing to
 * leave implicit in the one file that is about the difference.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

async function makeApp(): Promise<FastifyInstance> {
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    JWT_SECRET: 'test-secret',
    ADMIN: 'false',
  });
  expect(config.admin, 'this whole file is about the mode being off').toBe(false);
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return app;
}

async function makePlayer(app: FastifyInstance, username: string) {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  return {
    token,
    userId: registered.json<{ user: { id: string } }>().user.id,
    baseId: chosen.json<{ base: { id: string } }>().base.id,
  };
}

const errorOf = (body: string): string => {
  try {
    return (
      (JSON.parse(body) as { error?: { code?: string; message?: string } }).error?.message ?? ''
    );
  } catch {
    return body;
  }
};

describe('the gates admin mode waives, met by an ordinary player', () => {
  it('refuses a build the crew cannot pay for', async () => {
    const app = await makeApp();
    const { token, baseId } = await makePlayer(app, 'skint');
    app.repos.bases.updateResources(baseId, {
      caps: 0,
      supplies: 0,
      oil: 0,
      scrap: 0,
      highQualityMetal: 0,
      planks: 0,
    });

    const ordered = await app.inject({
      method: 'POST',
      url: '/api/base/build',
      headers: auth(token),
      payload: { kind: 'quarters' },
    });
    expect(ordered.statusCode).toBe(409);
    expect(ordered.json<{ error: { code: string } }>().error.code).toBe('INSUFFICIENT_RESOURCES');
  });

  it('refuses a seventh build order', async () => {
    const app = await makeApp();
    const { token, baseId } = await makePlayer(app, 'eager');
    const base = app.repos.bases.findById(baseId);
    if (!base) throw new Error('no base');
    app.repos.bases.updateResources(baseId, {
      caps: 900_000,
      supplies: 900_000,
      oil: 900_000,
      scrap: 900_000,
      highQualityMetal: 900_000,
      planks: 900_000,
    });
    app.repos.bases.updateBuildings(
      baseId,
      base.buildings.map((building) =>
        building.kind === 'nexus' ? { ...building, level: 20 } : building,
      ),
    );

    for (let order = 0; order < MAX_BUILD_QUEUE; order += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/base/build',
        headers: auth(token),
        payload: { kind: 'quarters' },
      });
      expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    }
    const overflow = await app.inject({
      method: 'POST',
      url: '/api/base/build',
      headers: auth(token),
      payload: { kind: 'quarters' },
    });
    expect(overflow.statusCode).toBe(409);
    expect(errorOf(overflow.body).toLowerCase()).toContain('build slots');
  });

  it('refuses a second signing on the same day', async () => {
    const app = await makeApp();
    const { token, baseId } = await makePlayer(app, 'recruiter');
    app.repos.bases.updateResources(baseId, {
      caps: 900_000,
      supplies: 900_000,
      oil: 900_000,
      scrap: 900_000,
      highQualityMetal: 900_000,
      planks: 900_000,
    });

    const room = await app.inject({ method: 'GET', url: '/api/bar', headers: auth(token) });
    const open = room
      .json<BarResponse>()
      .recruits.filter(
        (recruit) => recruit.assessment.blockers.length === 0 && recruit.askingWage !== null,
      );
    expect(open.length, 'fixture: the room has nobody a new crew can approach').toBeGreaterThan(
      BAR_HIRES_PER_DAY,
    );

    for (let hire = 0; hire < BAR_HIRES_PER_DAY; hire += 1) {
      const recruit = open[hire];
      if (!recruit) throw new Error('fixture: not enough open recruits');
      const res = await app.inject({
        method: 'POST',
        url: '/api/bar/hire',
        headers: auth(token),
        payload: { recruitId: recruit.id, role: null, offerWage: recruit.askingWage ?? 0 },
      });
      expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    }

    const oneMore = open[BAR_HIRES_PER_DAY];
    if (!oneMore) throw new Error('fixture: not enough open recruits');
    const refused = await app.inject({
      method: 'POST',
      url: '/api/bar/hire',
      headers: auth(token),
      payload: { recruitId: oneMore.id, role: null, offerWage: oneMore.askingWage ?? 0 },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('DAILY_HIRE_LIMIT');
  });

  it('refuses two officers into one chair, which is the gate a waiver used to hide', async () => {
    const app = await makeApp();
    const { token, baseId } = await makePlayer(app, 'double_booker');
    app.repos.bases.updateResources(baseId, {
      caps: 900_000,
      supplies: 900_000,
      oil: 900_000,
      scrap: 900_000,
      highQualityMetal: 900_000,
      planks: 900_000,
    });
    const room = await app.inject({ method: 'GET', url: '/api/bar', headers: auth(token) });
    const open = room
      .json<BarResponse>()
      .recruits.filter(
        (recruit) => recruit.assessment.blockers.length === 0 && recruit.askingWage !== null,
      );
    const [first, second] = open;
    if (!first || !second) throw new Error('fixture: not enough open recruits');

    const seated = await app.inject({
      method: 'POST',
      url: '/api/bar/hire',
      headers: auth(token),
      payload: { recruitId: first.id, role: 'head_spy', offerWage: first.askingWage ?? 0 },
    });
    expect(seated.statusCode, seated.body.slice(0, 300)).toBe(200);

    const clash = await app.inject({
      method: 'POST',
      url: '/api/bar/hire',
      headers: auth(token),
      payload: { recruitId: second.id, role: 'head_spy', offerWage: second.askingWage ?? 0 },
    });
    // An ordinary player is told about the chair. (The daily limit is also true by now, which is
    // why the admin-mode case below goes at the function rather than at the route: only there can
    // both a waivable and a non-waivable reason be true of the same request.)
    expect(clash.statusCode).toBe(409);
    expect(['ROLE_TAKEN', 'DAILY_HIRE_LIMIT']).toContain(
      clash.json<{ error: { code: string } }>().error.code,
    );
  });

  /**
   * The chair rule is not waivable, and a waivable gate in front of it must not skip it.
   *
   * `refusalFor` returns the *first* reason and the caller applies the waiver to that single
   * reason, so a waived gate standing ahead of a hard one hides it completely. `no_slots` is waived
   * and `role_taken` is not. On a full roster in admin mode the hire reached `no_slots`, had it
   * waived, and never evaluated `role_taken`: two officers signed into one chair, both paid as the
   * seated officer by `crewSheetsFor` (which does not dedupe by role), both sets of perks summed
   * into the crew's channels, and the row surviving the flag being turned off.
   *
   * Driven at `hireRecruit` rather than over HTTP because this is the one case where a waivable and
   * a non-waivable reason have to be true of the same request, and the daily limit gets in the way
   * of setting that up through the route.
   */
  it('does not let admin mode waive a full roster into a double-booked chair', async () => {
    const app = await makeApp();
    const { baseId, userId } = await makePlayer(app, 'bench_stuffer');
    const base = app.repos.bases.findById(baseId);
    if (!base) throw new Error('no base');

    // A roster that is both full (`no_slots`, waived) and already holding the chair
    // (`role_taken`, not waived).
    const seated = createCommander('off-1', 'Halvard', 'head_spy');
    const filler = createCommander('off-2', 'Vasso', 'lead_engineer');
    const full = { ...base, commanders: [seated, filler] };
    expect(full.commanders.length).toBeGreaterThanOrEqual(
      playerLevelGrants(full.level).recruitSlots,
    );

    const recruit = barRoster(barDay(new Date()))[0];
    if (!recruit) throw new Error('fixture: the room is empty');

    const result = hireRecruit(app.repos, {
      base: full,
      userId,
      seat: 0,
      recruit,
      role: 'head_spy',
      offerWage: 1000,
      now: new Date(),
      admin: true,
    });
    expect(result).toEqual({ kind: 'refused', reason: 'role_taken' });
  });

  it('names every waived refusal, so a new one cannot be added without a decision', () => {
    // Not a behaviour assertion: a tripwire. The list is what admin mode *is*, and a refusal added
    // to it silently is a rule that stopped applying to the build the board runs.
    expect([...WAIVED_REFUSALS].sort()).toEqual(
      [
        'cannot_afford',
        'daily_limit',
        'level',
        'locked',
        'missing_parts',
        'modification_unavailable',
        'nexus_cap',
        'no_lead',
        'no_lead_engineer',
        'no_modification_slot',
        'no_payroll',
        'no_slots',
        'no_supply',
        'not_enough_infamy',
        'option_locked',
        'queue_full',
        'requirement',
        'standoff',
      ].sort(),
    );
  });
});
