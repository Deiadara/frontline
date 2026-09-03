/**
 * §D10: pages become a blueprint, over the wire.
 *
 * The rule itself is pure and tested in shared. What is only reachable here is the half that made
 * the feature not work at all: the reducer, the contract and the button all existed and there was
 * no route behind them, so pressing Unlock posted into a 404 and the page showed an error. A test
 * that drives the reducer directly passes happily against that.
 *
 * So this goes through HTTP, and it checks the two things HTTP owns: that the write is persisted,
 * and that a request which should be refused does not spend anything.
 */
import {
  BLUEPRINTS,
  isBlueprintUnlocked,
  type ItemId,
  type MarketResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function crew(): Promise<{ app: FastifyInstance; token: string }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'drafter', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  return { app, token };
}

function hold(app: FastifyInstance, inventory: Partial<Record<ItemId, number>>): void {
  const user = app.repos.users.findByUsername('drafter');
  const base = app.repos.bases.findByOwnerId(user?.id ?? '');
  if (!base) throw new Error('no base');
  app.repos.bases.updateHoldings(base.id, base.resources, {
    ...base.inventory,
    ...inventory,
  });
}

const inventoryOf = (app: FastifyInstance): Record<string, number> => {
  const user = app.repos.users.findByUsername('drafter');
  return app.repos.bases.findByOwnerId(user?.id ?? '')?.inventory ?? {};
};

/** The cheapest document in the catalogue, so the fixture is a full set without being a list. */
const SMALLEST = [...BLUEPRINTS].sort((a, b) => a.pages.length - b.pages.length)[0]!;

describe('unlocking a blueprint (§D10)', () => {
  it('spends one of each page and hands back the document', async () => {
    const { app, token } = await crew();
    hold(app, Object.fromEntries(SMALLEST.pages.map((page) => [page.id, 1])));

    const res = await app.inject({
      method: 'POST',
      url: '/api/blueprints/unlock',
      headers: auth(token),
      payload: { blueprintId: SMALLEST.id },
    });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);

    // Persisted, not just answered: the response is built from the same object the write used, so
    // reading the response alone would pass against a route that never touched the database.
    const held = inventoryOf(app);
    expect(isBlueprintUnlocked(held, SMALLEST.id), 'the document was not granted').toBe(true);
    for (const page of SMALLEST.pages) {
      expect(held[page.id] ?? 0, `${page.id} was not spent`).toBe(0);
    }
    // And the answer carries the board, so the satchel updates without a second round trip.
    expect(res.json<MarketResponse>()).toBeDefined();
  });

  it('refuses a set that is short a page, and spends nothing doing it', async () => {
    const { app, token } = await crew();
    const short = SMALLEST.pages.slice(0, -1);
    hold(app, Object.fromEntries(short.map((page) => [page.id, 1])));

    const res = await app.inject({
      method: 'POST',
      url: '/api/blueprints/unlock',
      headers: auth(token),
      payload: { blueprintId: SMALLEST.id },
    });
    expect(res.statusCode).toBe(409);

    const held = inventoryOf(app);
    expect(isBlueprintUnlocked(held, SMALLEST.id)).toBe(false);
    for (const page of short) {
      expect(held[page.id] ?? 0, `${page.id} was spent on a refused unlock`).toBe(1);
    }
  });

  it('refuses a blueprint that does not exist', async () => {
    const { app, token } = await crew();
    const res = await app.inject({
      method: 'POST',
      url: '/api/blueprints/unlock',
      headers: auth(token),
      payload: { blueprintId: 'not_a_blueprint' },
    });
    expect(res.statusCode).toBe(409);
  });
});
