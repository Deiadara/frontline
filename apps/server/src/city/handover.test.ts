import { EVERY_LOCATION, type Base } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleBase } from '../district/settle.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { putControl } from './actions.js';

/**
 * Ground pays whoever held it for the hours they held it (audit, 2026-09-28).
 *
 * Production is lazy, so a change of holder written without a settle was priced at each crew's
 * next read against what it held *then*: the taker was paid for the hours before the capture and
 * the loser lost the hours before it. Measured on a Market, because caps come from nowhere else
 * in these worlds and have no store to hit.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const HOUR = 3_600_000;

async function register(app: FastifyInstance, username: string): Promise<Base> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  pinOverseer(app, token);
  const base = app.repos.bases.findById(chosen.json<{ base: { id: string } }>().base.id);
  if (!base) throw new Error('fixture: no base');
  return base;
}

describe('a location changing hands', () => {
  it('pays the old holder up to the change and the new one only from it', async () => {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const app = await buildApp({ config, db, logger: false });
    instances.push({ app, db });

    const market = EVERY_LOCATION.find((location) => location.kind === 'market');
    if (!market) throw new Error('fixture: no Market anywhere');
    const now = new Date();
    const [loser, taker] = [await register(app, 'loser'), await register(app, 'taker')];
    for (const crew of [loser, taker]) {
      app.repos.bases.updateResources(crew.id, { ...crew.resources, caps: 0 });
      app.repos.bases.updateEconomy(crew.id, {
        ...crew.economy,
        productionSettledAt: new Date(now.getTime() - 10 * HOUR).toISOString(),
      });
    }
    const control = app.repos.city.control(market.id)!;
    app.repos.city.put({ ...control, holder: { kind: 'crew', baseId: loser.id }, garrison: {} });

    putControl(app.repos, { ...control, holder: { kind: 'crew', baseId: taker.id } }, now);

    const caps = (id: string) => app.repos.bases.findById(id)!.resources.caps;
    const held = caps(loser.id);
    expect(held, 'the loser was not paid for the ten hours it held the Market').toBeGreaterThan(
      100,
    );
    expect(caps(taker.id)).toBe(0);

    // Ten hours on, each crew is paid for its own ten hours and nobody for the other's.
    const later = new Date(now.getTime() + 10 * HOUR);
    for (const id of [loser.id, taker.id]) {
      settleBase(app.repos, app.repos.bases.findById(id)!, later);
    }
    expect(caps(loser.id)).toBe(held);
    expect(Math.abs(caps(taker.id) - held)).toBeLessThanOrEqual(1);
  });
});
