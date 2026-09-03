import { declarationWindow, type BattleTarget } from '@frontline/shared';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

/**
 * Which screen a player opens first must not decide a battle.
 *
 * The world clock only runs from `index.ts`, so a restart, a deploy gap or any test-built app
 * leaves the first request to arrive as the settler. `routes/city.ts` used to settle
 * fortifications, scouting, gates and then battles, with **no** `settleMovements`, while
 * `battle/routes.ts` settled movements and then battles with no gates and no scouting. A defender's
 * column that landed at 20:45 for a 21:00 fight was therefore in the line if the first page loaded
 * was the battle board, and not in it if the first page loaded was the city map.
 *
 * This drives the city path on purpose: it is the one that was missing the fold.
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

async function register(app: FastifyInstance, username: string) {
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
  return { token, baseId: chosen.json<{ base: { id: string } }>().base.id };
}

describe('settling the world from a city page', () => {
  it('folds in a column that landed before the mark, the way the battle page does', async () => {
    const app = await makeApp();
    const attacker = await register(app, 'the_attacker');
    app.repos.bases.updateArmy(attacker.baseId, { razors: 40 }, []);
    app.repos.city.markScouted(attacker.baseId, 'rustyard', new Date().toISOString());

    const target: BattleTarget = {
      kind: 'location',
      districtId: 'rustyard',
      locationId: 'rustyard-press',
    };
    const declared = await app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(attacker.token),
      payload: { target, scheduledFor: declarationWindow(new Date()).earliest.toISOString() },
    });
    expect(declared.statusCode, declared.body.slice(0, 300)).toBe(200);
    const battle = app.repos.sieges.pending()[0];
    if (!battle) throw new Error('fixture: the declaration produced no battle');

    // A column that set out and landed a quarter of an hour before the mark, and a mark that has
    // now passed. Written directly rather than walked, because the walk is `battle/movement.ts`'s
    // own subject and this is about the order the settle runs in.
    const mark = new Date(Date.now() - 60_000);
    app.db
      .prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?')
      .run(mark.toISOString(), battle.id);
    app.repos.movements.put({
      id: randomUUID(),
      baseId: attacker.baseId,
      battleId: battle.id,
      side: 'attacker',
      fromDistrictId: 'kettle-row',
      toDistrictId: 'rustyard',
      army: { razors: 30 },
      perimeter: {},
      departedAt: new Date(mark.getTime() - 3_600_000).toISOString(),
      arrivesAt: new Date(mark.getTime() - 900_000).toISOString(),
    });

    // The precondition: nothing has been folded in yet, so the fight would otherwise be resolved
    // from an empty attacker deployment.
    expect(app.repos.movements.forBattle(battle.id)).toHaveLength(1);
    expect(app.repos.sieges.side(battle.id, 'attacker')[0]?.army).toEqual({});

    // The city map, which is the path that was missing the fold.
    const city = await app.inject({
      method: 'GET',
      url: '/api/city',
      headers: auth(attacker.token),
    });
    expect(city.statusCode, city.body.slice(0, 200)).toBe(200);

    const resolved = app.repos.sieges.find(battle.id);
    expect(resolved?.resolvedAt, 'the fight should have been settled by this read').not.toBeNull();
    // The column is off the road, which only `settleMovements` does, and it happened before the
    // fight rather than after it: `settleMovements` sends an overtaken column home instead of
    // folding it in, so an army of 30 on the attacker's row is proof of the ordering.
    expect(app.repos.movements.forBattle(battle.id)).toHaveLength(0);
    expect(app.repos.sieges.side(battle.id, 'attacker')[0]?.army).toEqual({ razors: 30 });
  });
});
