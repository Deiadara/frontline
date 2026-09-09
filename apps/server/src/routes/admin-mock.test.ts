import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

/**
 * The console's mock fight (board request, 2026-09-08): somebody else in the city calls a fight
 * on the reviewer's ground, through the real declaration, so the bell, the red mark and the board
 * all show what a player would see.
 */
const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function city(
  admin: boolean,
): Promise<{ app: FastifyInstance; token: string; baseId: string }> {
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    JWT_SECRET: 'test-secret',
    ADMIN: admin ? 'true' : 'false',
  });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  // Two crews: the reviewer, and somebody to call the fight.
  let token = '';
  let baseId = '';
  for (const username of ['rival', 'reviewer']) {
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username, password: 'hunter2pass' },
    });
    const t = registered.json<{ token: string }>().token;
    const chosen = await app.inject({
      method: 'POST',
      url: '/api/overseer',
      headers: auth(t),
      payload: { presetId: 'enforcer' },
    });
    token = t;
    baseId = chosen.json<{ base: { id: string } }>().base.id;
  }
  return { app, token, baseId };
}

describe('the console calls a fight on the reviewer', () => {
  it('declares through the real path, hands a landless crew ground, and lights the mark', async () => {
    const { app, token, baseId } = await city(true);
    const before = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    expect(before.json<{ unread: { fightsOnYou: number } }>().unread.fightsOnYou).toBe(0);

    const called = await app.inject({
      method: 'POST',
      url: '/api/admin/mock-battle',
      headers: auth(token),
      payload: {},
    });
    expect(called.statusCode, called.body.slice(0, 300)).toBe(200);

    // A real pending declaration, by somebody else, on ground the reviewer now holds.
    const pending = app.repos.sieges.pending();
    expect(pending).toHaveLength(1);
    const battle = pending[0]!;
    expect(battle.attackerBaseId).not.toBe(baseId);
    expect(battle.target.kind).toBe('location');
    if (battle.target.kind === 'location') {
      expect(app.repos.city.control(battle.target.locationId)?.holder).toEqual({
        kind: 'crew',
        baseId,
      });
    }

    // The mark on the bar, and the bell.
    const after = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    expect(after.json<{ unread: { fightsOnYou: number } }>().unread.fightsOnYou).toBe(1);
    const bells = app.repos.social
      .notifications(app.repos.users.findByUsername('reviewer')!.id, 20)
      .filter((entry) => entry.kind === 'district_attacked');
    expect(bells).toHaveLength(1);
    expect(bells[0]?.title).toContain('has called a fight on you');
  });

  it('is not a route at all on a build without the console', async () => {
    const { app, token } = await city(false);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/mock-battle',
      headers: auth(token),
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
