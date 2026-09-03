import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

/**
 * One base per account, with something durable behind it.
 *
 * The rule lived in exactly one `!==` against `request.currentUser`, a snapshot the `authenticate`
 * preHandler filled in before an await and outside the transaction that does the writing, and no
 * unique index anywhere in the schema backed it. A second base is not a duplicate a player can see:
 * `findByOwnerId` is a single-row read, so one of the two is playable and the other is a permanent
 * ghost that no route can reach and nothing will ever settle, while still sitting on the
 * leaderboard, counting in the city-level average that prices the Bar and the black market, and
 * occupying a district.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

async function makeApp(): Promise<{ app: FastifyInstance; db: AppDatabase }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return { app, db };
}

describe('choosing an overseer', () => {
  it('refuses a second one, and leaves exactly one base behind', async () => {
    const { app } = await makeApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'twice_over', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;

    const first = await app.inject({
      method: 'POST',
      url: '/api/overseer',
      headers: auth(token),
      payload: { presetId: 'enforcer' },
    });
    expect(first.statusCode, first.body.slice(0, 200)).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/api/overseer',
      headers: auth(token),
      payload: { presetId: 'fixer' },
    });
    expect(second.statusCode).toBe(409);
    expect(app.repos.bases.listSummaries()).toHaveLength(1);
  });

  it('cannot hold two bases for one account even with the guards bypassed', async () => {
    // The guards are the half that was already there. This is the half that was not: a second row
    // written straight past every check has to be refused by the database itself.
    const { app, db } = await makeApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'twice_over', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    const chosen = await app.inject({
      method: 'POST',
      url: '/api/overseer',
      headers: auth(token),
      payload: { presetId: 'enforcer' },
    });
    const base = app.repos.bases.findById(chosen.json<{ base: { id: string } }>().base.id);
    if (!base) throw new Error('no base');

    expect(() => app.repos.bases.insert({ ...base, id: 'a-second-base' })).toThrow(/UNIQUE/i);
    expect(db.prepare('SELECT COUNT(*) AS n FROM bases').get()).toEqual({ n: 1 });
  });

  it('cannot hold two overseers for one account either', async () => {
    const { app, db } = await makeApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'twice_over', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    await app.inject({
      method: 'POST',
      url: '/api/overseer',
      headers: auth(token),
      payload: { presetId: 'enforcer' },
    });
    const userId = (db.prepare('SELECT id FROM users').get() as { id: string }).id;
    expect(() =>
      db
        .prepare(
          `INSERT INTO overseers (id, user_id, preset_id, name, archetype, portrait_id, bio,
             attributes_json, perks_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'a-second-overseer',
          userId,
          'fixer',
          'Nobody',
          'fixer',
          'overseer-3',
          '',
          '{}',
          '[]',
          new Date().toISOString(),
        ),
    ).toThrow(/UNIQUE/i);
  });
});
