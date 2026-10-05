import { RESOURCE_KEYS, type MarketResponse, type Resources } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';
import { openDoors } from '../testing/doors.js';

/**
 * Bug pass, 2026-10-02: `GET /market` drew the board off the stored row while every market write
 * settles first, so ten hours of unbanked production were missing from the caps, the bid ceiling
 * and the supply run, and the screen refused what the server would take.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const HOUR = 3_600_000;

const total = (resources: Resources) =>
  RESOURCE_KEYS.reduce((sum, key) => sum + (resources[key] ?? 0), 0);

describe('the market board', () => {
  it('counts the production the crew has made since it was last settled', async () => {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const app = await buildApp({ config, db, logger: false });
    instances.push({ app, db });

    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'stale_reader', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    await chooseOverseer(app, token);
    openDoors(app, token, 'market');

    const user = app.repos.users.findByUsername('stale_reader')!;
    const base = app.repos.bases.findByOwnerId(user.id)!;
    app.repos.bases.updateEconomy(base.id, {
      ...base.economy,
      productionSettledAt: new Date(Date.now() - 10 * HOUR).toISOString(),
    });
    const stored = total(app.repos.bases.findById(base.id)!.resources);

    const read = await app.inject({
      method: 'GET',
      url: '/api/market',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(read.statusCode).toBe(200);
    expect(total(read.json<MarketResponse>().resources)).toBeGreaterThan(stored);
  });
});
