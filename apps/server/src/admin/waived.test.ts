import { MAX_BUILD_QUEUE, MAX_OPEN_AUCTIONS, type BarResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { WAIVED_REFUSALS } from './mode.js';
import { committedWage } from '../bar/hire.js';
import { crewEffectsFor } from '../crew/standing.js';

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

/**
 * The Bar's tests bid, and a bid is refused outside the open phase, so the clock is pinned.
 *
 * Only `Date` is faked: Fastify's own timers have to keep running or `app.inject` never settles.
 */
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-13T09:00:00.000Z'));
});

afterAll(() => {
  vi.useRealTimers();
});

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

  /**
   * §H7a: two tables at once, and the third is refused.
   *
   * The daily hire limit this replaced was waived by admin mode; the cap on tables is not, and it
   * is checked here as an ordinary player meets it: three bids, the last one refused.
   */
  it('refuses a third table at once', async () => {
    const app = await makeApp();
    const { token } = await makePlayer(app, 'recruiter');

    const room = await app.inject({ method: 'GET', url: '/api/bar', headers: auth(token) });
    const bar = room.json<BarResponse>();
    const open = bar.recruits
      .filter((recruit) => recruit.assessment.blockers.length === 0)
      .map((recruit) => bar.auctions.find((auction) => auction.recruitId === recruit.id))
      .filter((auction) => auction !== undefined);
    expect(open.length, 'fixture: the room has nobody a new crew can approach').toBeGreaterThan(
      MAX_OPEN_AUCTIONS,
    );

    const bid = (recruitId: string, amount: number) =>
      app.inject({
        method: 'POST',
        url: '/api/bar/bid',
        headers: auth(token),
        payload: { recruitId, amount },
      });

    for (let table = 0; table < MAX_OPEN_AUCTIONS; table += 1) {
      const auction = open[table];
      if (!auction) throw new Error('fixture: not enough open tables');
      const res = await bid(auction.recruitId, auction.nextBid);
      expect(res.statusCode, res.body.slice(0, 300)).toBe(200);
    }

    const oneMore = open[MAX_OPEN_AUCTIONS];
    if (!oneMore) throw new Error('fixture: not enough open tables');
    const refused = await bid(oneMore.recruitId, oneMore.nextBid);
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('TOO_MANY_AUCTIONS');
  });

  /** §H7: the payroll book still refuses a fee it cannot hold, which admin mode would waive. */
  it('refuses a bid the payroll book will not stretch to', async () => {
    const app = await makeApp();
    const { token, baseId } = await makePlayer(app, 'overcommitted');
    const base = app.repos.bases.findById(baseId);
    if (!base) throw new Error('no base');

    const room = await app.inject({ method: 'GET', url: '/api/bar', headers: auth(token) });
    const bar = room.json<BarResponse>();
    const target = bar.auctions.find((auction) =>
      bar.recruits.some(
        (recruit) => recruit.id === auction.recruitId && recruit.assessment.interested,
      ),
    );
    if (!target) throw new Error('fixture: nobody to bid on');

    // Over the ceiling *after* this crew's own negotiators have talked the contract down, which is
    // the figure the gate reads (§H7, `committedWage`). A bid one cap over the raw capacity fits.
    const discount = crewEffectsFor(app.repos, base).wageDiscountPercent;
    const amount = Math.ceil((bar.payroll.capacity + 1) / (1 - discount / 100)) + 1;
    expect(committedWage(amount, discount)).toBeGreaterThan(bar.payroll.capacity);

    const refused = await app.inject({
      method: 'POST',
      url: '/api/bar/bid',
      headers: auth(token),
      payload: { recruitId: target.recruitId, amount },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('NO_PAYROLL');
  });

  it('names every waived refusal, so a new one cannot be added without a decision', () => {
    // Not a behaviour assertion: a tripwire. The list is what admin mode *is*, and a refusal added
    // to it silently is a rule that stopped applying to the build the board runs.
    expect([...WAIVED_REFUSALS].sort()).toEqual(
      [
        'cannot_afford',
        'level',
        'locked',
        'missing_parts',
        'nexus_cap',
        'no_payroll',
        'no_slots',
        'no_supply',
        'not_enough_infamy',
        'not_interested',
        'queue_full',
        'requirement',
      ].sort(),
    );
  });
});
