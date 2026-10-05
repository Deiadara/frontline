import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { openDoors } from '../testing/doors.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * Admin mode charges nothing, as the console says (maintainer, 2026-10-02).
 *
 * Ranks, the supply run and the Broker still charged real infamy, caps and goods, and refused a crew
 * with none, under a console promising that nothing is charged. A crew with an empty wallet and
 * empty stores buys all three here, and nothing leaves it.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function brokeCrewInAdmin(): Promise<{
  app: FastifyInstance;
  token: string;
  baseId: string;
}> {
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    JWT_SECRET: 'test-secret',
    ADMIN: 'true',
  });
  expect(config.admin).toBe(true);
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'tester', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const baseId = (await chooseOverseer(app, token)).json<{ base: { id: string } }>().base.id;
  openDoors(app, token, 'market');
  const base = app.repos.bases.findById(baseId)!;
  const empty = { caps: 0, supplies: 0, oil: 0, scrap: 0, planks: 0, highQualityMetal: 0 };
  app.repos.bases.updateResources(baseId, empty);
  app.repos.bases.updateEconomy(baseId, { ...base.economy, infamy: 0 });
  return { app, token, baseId };
}

describe('admin mode', () => {
  it('buys a rank without infamy, and takes none', async () => {
    const { app, token, baseId } = await brokeCrewInAdmin();
    const bought = await app.inject({
      method: 'POST',
      url: '/api/battles/notoriety',
      headers: auth(token),
      payload: { fromNotoriety: 0 },
    });
    expect(bought.statusCode, bought.body.slice(0, 200)).toBe(200);
    const economy = app.repos.bases.findById(baseId)!.economy;
    expect(economy.notoriety).toBe(1);
    expect(economy.infamy).toBe(0);
  });

  it('runs the supply run without caps, and takes none', async () => {
    const { app, token, baseId } = await brokeCrewInAdmin();
    const run = await app.inject({
      method: 'POST',
      url: '/api/market/supply',
      headers: auth(token),
      payload: { key: 'scrap', units: 10 },
    });
    expect(run.statusCode, run.body.slice(0, 200)).toBe(200);
    const resources = app.repos.bases.findById(baseId)!.resources;
    expect(resources.caps).toBe(0);
    expect(resources.scrap).toBe(10);
  });

  it('lets the Broker trade goods the crew does not have, and takes none', async () => {
    const { app, token, baseId } = await brokeCrewInAdmin();
    const trade = await app.inject({
      method: 'POST',
      url: '/api/market/barter',
      headers: auth(token),
      payload: { give: 'scrap', want: 'oil', amount: 400 },
    });
    expect(trade.statusCode, trade.body.slice(0, 200)).toBe(200);
    const resources = app.repos.bases.findById(baseId)!.resources;
    expect(resources.scrap).toBe(0);
    expect(resources.oil).toBeGreaterThan(0);
  });
});
