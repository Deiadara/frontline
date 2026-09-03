import { createCommander } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleBase } from '../district/settle.js';

/**
 * §C2 against the settle window.
 *
 * `settleDistrict` reads the crew's `productionPercent` once and applies it to the whole elapsed
 * window, on the stated grounds that "a crew does not change halfway through a settle".
 * `/crew/reassign` was the one write route in the server that did not settle first, which made that
 * comment false: seat an officer where their best attribute pays, and the next read banks the
 * *whole* unsettled window at the new rate. Two HTTP calls buy a day of production the crew never
 * had.
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
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return app;
}

describe('reseating an officer', () => {
  it('settles the window that was earned under the old seat before the new seat applies', async () => {
    const app = await makeApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'seat_mover', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    const chosen = await app.inject({
      method: 'POST',
      url: '/api/overseer',
      headers: auth(token),
      payload: { presetId: 'enforcer' },
    });
    const baseId = chosen.json<{ base: { id: string } }>().base.id;

    // Somebody to move, and a stale settle clock: a day of production nobody has banked.
    const base = app.repos.bases.findById(baseId);
    if (!base) throw new Error('no base');
    settleBase(app.repos, base, new Date());
    const settled = app.repos.bases.findById(baseId);
    if (!settled) throw new Error('no base');

    const officer = createCommander('officer-1', 'Vasso', 'lead_engineer', { engineering: 90 });
    app.repos.bases.updateCommanders(baseId, [...settled.commanders, officer]);

    const aDayAgo = new Date(Date.now() - 24 * 3_600_000).toISOString();
    app.repos.bases.updateEconomy(baseId, {
      ...settled.economy,
      productionSettledAt: aDayAgo,
    });

    const target = 'head_of_growth';

    const reassigned = await app.inject({
      method: 'POST',
      url: '/api/crew/reassign',
      headers: auth(token),
      payload: { officerId: officer.id, role: target },
    });
    expect(reassigned.statusCode, reassigned.body).toBe(200);

    // The unsettled day must have been banked before the seat changed, so nothing of it is left
    // to be paid at the new rate.
    const after = app.repos.bases.findById(baseId);
    expect(after?.economy.productionSettledAt).not.toBe(aDayAgo);
    expect(Date.parse(after?.economy.productionSettledAt ?? '')).toBeGreaterThan(
      Date.parse(aDayAgo),
    );
  });
});
