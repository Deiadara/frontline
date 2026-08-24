import {
  BUILDING_MAX_LEVEL,
  buildingBuildSeconds,
  buildingCost,
  type AdminSnapshot,
  type Base,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { ADMIN_ACTION_SECONDS, adminCost, adminMinutes, adminSeconds } from './mode.js';

/**
 * Admin mode has two claims and they pull against each other, so both are pinned here:
 *
 *  - a click costs **five seconds and nothing**, and
 *  - the *rules* are untouched — refusals still refuse, and the interface is still shown the real
 *    price, which is why nothing in the response envelope changes shape.
 *
 * The second one is what makes it a testing mode rather than a different game, and it is the half
 * that would rot silently: nobody notices that a gate stopped firing until a reviewer signs off on
 * a build with no gates in it.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function makeApp(admin: boolean): Promise<{ app: FastifyInstance; db: AppDatabase }> {
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    JWT_SECRET: 'test-secret',
    ADMIN: admin ? 'true' : 'false',
  });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  const handle = { app, db };
  instances.push(handle);
  return handle;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function crew(app: FastifyInstance): Promise<{ token: string }> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'operator', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  return { token };
}

async function me(app: FastifyInstance, token: string): Promise<Base> {
  const res = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
  return res.json<{ base: Base }>().base;
}

describe('the overrides themselves', () => {
  it('flatten a clock and waive a price only while admin mode is on', () => {
    expect(adminSeconds(14_400, true)).toBe(ADMIN_ACTION_SECONDS);
    expect(adminSeconds(14_400, false)).toBe(14_400);
    expect(adminCost({ scrap: 1200 }, true)).toEqual({});
    expect(adminCost({ scrap: 1200 }, false)).toEqual({ scrap: 1200 });
  });

  it('floor a minute-resolution clock at one minute rather than at zero', () => {
    // A project of length zero completes inside the request that started it, which skips the
    // running state a reviewer is usually there to look at.
    expect(adminMinutes(240, true)).toBe(1);
    expect(adminMinutes(240, false)).toBe(240);
  });
});

describe('a build in admin mode', () => {
  it('takes five seconds and costs nothing, while the catalogue still says otherwise', async () => {
    const { app } = await makeApp(true);
    const { token } = await crew(app);
    const before = await me(app, token);

    const res = await app.inject({
      method: 'POST',
      url: '/api/base/build',
      headers: auth(token),
      payload: { kind: 'quarters' },
    });
    expect(res.statusCode).toBe(200);

    const after = await me(app, token);
    const queued = after.buildQueue.at(-1)!;
    expect(queued.durationSeconds).toBe(ADMIN_ACTION_SECONDS);
    expect(after.resources).toEqual(before.resources);

    // The price the *interface* quotes is untouched, which is the half that makes this a testing
    // mode rather than a rebalance: a reviewer is still looking at the real economy.
    const real = buildingCost('quarters', queued.level, before.buildings);
    expect(Object.values(real).some((amount) => (amount ?? 0) > 0)).toBe(true);
    expect(buildingBuildSeconds('quarters', queued.level, before.buildings)).toBeGreaterThan(
      ADMIN_ACTION_SECONDS,
    );
  });

  it('charges and waits like everybody else when admin mode is off', async () => {
    const { app } = await makeApp(false);
    const { token } = await crew(app);
    const before = await me(app, token);

    await app.inject({
      method: 'POST',
      url: '/api/base/build',
      headers: auth(token),
      payload: { kind: 'quarters' },
    });

    const after = await me(app, token);
    expect(after.buildQueue.at(-1)!.durationSeconds).toBeGreaterThan(ADMIN_ACTION_SECONDS);
    expect(after.resources).not.toEqual(before.resources);
  });

  /**
   * Admin mode opens the gates too (board — "I can do anything I want in admin mode").
   *
   * This reverses what this file used to assert. The old rule was "only the price and the clock are
   * waived; refusals still refuse", which is a defensible testing mode and is not the one that was
   * asked for: a reviewer who wants to look at the Lab cannot, because the Lab is behind Nexus
   * levels, and buying those is exactly the afternoon this mode exists to give back.
   */
  it('opens a gate a starting crew has not reached', async () => {
    const { app } = await makeApp(true);
    const { token } = await crew(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/base/build',
      headers: auth(token),
      payload: { kind: 'lab' },
    });
    expect(res.statusCode, res.body).toBe(200);

    // ...and it is the *Lab* that was queued, at its first level, rather than something the
    // waiver quietly turned into a different order.
    const after = await me(app, token);
    expect(after.buildQueue.at(-1)).toMatchObject({ kind: 'lab', level: 1 });
  });

  /**
   * ...but only the gates that are rules about progress.
   *
   * A refusal that is a statement about *reality* stands, because waiving it does not open a door —
   * it writes a district that cannot be read back. The catalogue's last level is the clearest case:
   * there is no twenty-first Nexus to queue, in any mode.
   */
  it('still refuses what is not a gate but a fact', async () => {
    const { app } = await makeApp(true);
    const { token } = await crew(app);

    // Straight to the ceiling, using the bench's own knob rather than twenty round trips. The
    // status is asserted rather than tolerated: a knob that quietly stopped working would leave
    // the Nexus at level one, the build below would succeed for the ordinary reason, and this test
    // would be measuring nothing.
    const maxed = await app.inject({
      method: 'POST',
      url: '/api/admin/knobs',
      headers: auth(token),
      payload: { structure: 'nexus', buildingLevel: BUILDING_MAX_LEVEL },
    });
    expect(maxed.statusCode, maxed.body).toBe(200);
    expect((await me(app, token)).buildings.find((b) => b.kind === 'nexus')?.level).toBe(
      BUILDING_MAX_LEVEL,
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/base/build',
      headers: auth(token),
      payload: { kind: 'nexus' },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe('the bench', () => {
  it('does not exist when admin mode is off', async () => {
    const { app } = await makeApp(false);
    const { token } = await crew(app);
    const res = await app.inject({ method: 'GET', url: '/api/admin', headers: auth(token) });
    // A 404, not a 403: a build without a bench should not advertise a door.
    expect(res.statusCode).toBe(404);

    const knobs = await app.inject({
      method: 'POST',
      url: '/api/admin/knobs',
      headers: auth(token),
      payload: { playerLevel: 20 },
    });
    expect(knobs.statusCode).toBe(404);
  });

  it('puts every structure at a level, and takes them away again', async () => {
    const { app } = await makeApp(true);
    const { token } = await crew(app);

    const up = await app.inject({
      method: 'POST',
      url: '/api/admin/knobs',
      headers: auth(token),
      payload: { buildingLevel: BUILDING_MAX_LEVEL },
    });
    expect(up.statusCode).toBe(200);
    const raised = up.json<{ admin: AdminSnapshot }>().admin;
    expect(raised.buildings.every((entry) => entry.level === BUILDING_MAX_LEVEL)).toBe(true);

    // Level zero is a real instruction — the stage before a structure exists is one a reviewer
    // needs to be able to get back to.
    const down = await app.inject({
      method: 'POST',
      url: '/api/admin/knobs',
      headers: auth(token),
      payload: { buildingLevel: 0 },
    });
    expect(down.json<{ admin: AdminSnapshot }>().admin.buildings.every((e) => e.level === 0)).toBe(
      true,
    );
    expect((await me(app, token)).buildings).toEqual([]);
  });

  it('moves one structure without disturbing the rest', async () => {
    const { app } = await makeApp(true);
    const { token } = await crew(app);
    await app.inject({
      method: 'POST',
      url: '/api/admin/knobs',
      headers: auth(token),
      payload: { buildingLevel: 5 },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/knobs',
      headers: auth(token),
      payload: { buildingLevel: 12, structure: 'nexus' },
    });
    const snapshot = res.json<{ admin: AdminSnapshot }>().admin;
    expect(snapshot.buildings.find((entry) => entry.kind === 'nexus')?.level).toBe(12);
    expect(
      snapshot.buildings.filter((entry) => entry.kind !== 'nexus').map((e) => e.level),
    ).toEqual(snapshot.buildings.filter((entry) => entry.kind !== 'nexus').map(() => 5));
  });

  it('sets the level, the stockpile and the name on the street', async () => {
    const { app } = await makeApp(true);
    const { token } = await crew(app);

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/knobs',
      headers: auth(token),
      payload: { playerLevel: 17, infamy: 4_200, resources: { scrap: 12_345 } },
    });
    expect(res.statusCode).toBe(200);

    const base = await me(app, token);
    expect(base.level).toBe(17);
    expect(base.economy.infamy).toBe(4_200);
    expect(base.resources.scrap).toBe(12_345);
    // Absent keys are left alone rather than zeroed — a knob that sets scrap must not empty the oil.
    expect(base.resources.oil).toBeGreaterThan(0);
  });

  it('empties every queue', async () => {
    const { app } = await makeApp(true);
    const { token } = await crew(app);
    await app.inject({
      method: 'POST',
      url: '/api/base/build',
      headers: auth(token),
      payload: { kind: 'quarters' },
    });
    expect((await me(app, token)).buildQueue).toHaveLength(1);

    await app.inject({
      method: 'POST',
      url: '/api/admin/knobs',
      headers: auth(token),
      payload: { clearQueues: true },
    });
    const base = await me(app, token);
    expect(base.buildQueue).toEqual([]);
    expect(base.trainingQueue).toEqual([]);
    expect(base.research.active).toBeNull();
  });

  it('refuses a request that would change nothing', async () => {
    const { app } = await makeApp(true);
    const { token } = await crew(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/knobs',
      headers: auth(token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});
