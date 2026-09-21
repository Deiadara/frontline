import { COMBINE_UNITS, isCombineUnit } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * The Combine's sheets are met, never ordered (`UnitSpec.faction`).
 *
 * `POST /units/train` takes a unit id off the wire and `findUnit` resolves the regime's ids as
 * readily as the player's, because the engine and the garrisons need it to. The only thing
 * standing between that id and the bench was `queueTraining`'s `isUnitUnlocked` gate, whose
 * refusal is `locked`, and `locked` is the first entry on `admin/mode.ts`'s `WAIVED_REFUSALS`.
 * Admin mode is on by default outside the test runner (`adminDefault`), so on any dev or staging
 * server `{"unitId":"directive_xero","count":1}` answered 200 and put a Combine legendary on a
 * player's roster five seconds later, for nothing.
 *
 * Run in **admin mode on purpose**: that is the configuration the hole needed, and a suite that
 * only ever built the strict one would go on passing through it. Every sheet is tried rather than
 * one, so a Combine unit added tomorrow is covered without an edit here.
 */

const PASSWORD = 'hunter2pass';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function adminPlayer(): Promise<{ app: FastifyInstance; token: string; baseId: string }> {
  const config = {
    ...loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' }),
    admin: true,
  };
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'the_defector', password: PASSWORD },
  });
  const token = registered.json<{ token: string }>().token;
  const baseId = (await chooseOverseer(app, token)).json<{ base: { id: string } }>().base.id;
  return { app, token, baseId };
}

describe('the Combine roster, from the training door', () => {
  it('refuses every Combine sheet even where admin mode waives the unlock', async () => {
    const { app, token, baseId } = await adminPlayer();
    expect(COMBINE_UNITS.length, 'no Combine sheets to try').toBeGreaterThan(0);

    for (const unit of COMBINE_UNITS) {
      const sent = await app.inject({
        method: 'POST',
        url: '/api/units/train',
        headers: { authorization: `Bearer ${token}` },
        payload: { unitId: unit.id, count: 1 },
      });
      expect(sent.statusCode, `${unit.id} was accepted: ${sent.body.slice(0, 200)}`).toBe(404);
    }

    // The bench, not just the answer: a refusal that still wrote the order would read as a 404.
    const base = app.repos.bases.findById(baseId);
    expect(base, 'the fixture crew has no base').toBeDefined();
    expect(base!.trainingQueue.filter((order) => isCombineUnit(order.unitId))).toEqual([]);
    expect(Object.keys(base!.army).filter((unitId) => isCombineUnit(unitId))).toEqual([]);
  });

  it('still takes an order for a sheet the crew can actually field', async () => {
    const { app, token, baseId } = await adminPlayer();
    const sent = await app.inject({
      method: 'POST',
      url: '/api/units/train',
      headers: { authorization: `Bearer ${token}` },
      payload: { unitId: 'razors', count: 1 },
    });
    expect(sent.statusCode, sent.body.slice(0, 200)).toBe(200);
    expect(app.repos.bases.findById(baseId)!.trainingQueue.map((order) => order.unitId)).toEqual([
      'razors',
    ]);
  });
});
