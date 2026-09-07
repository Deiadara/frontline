import { playerXpToNextLevel, type Base, type LevelUp } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

/**
 * The shell's poll announces the level a build crossed while the player was elsewhere.
 *
 * `/me` settles the base, and the world clock does not, so a build that finished while the player
 * was on the Market is banked by this call and by nothing else. The schema said as much and the
 * handler discarded the awards: the XP landed and the level-up was never announced anywhere.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('GET /me', () => {
  it('carries the level-up of a build it settled, and only on that poll', async () => {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const app = await buildApp({ config, db, logger: false });
    instances.push({ app, db });

    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'builder', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    const chosen = await app.inject({
      method: 'POST',
      url: '/api/overseer',
      headers: auth(token),
      payload: { presetId: 'enforcer' },
    });
    expect(chosen.statusCode).toBe(201);
    const base = chosen.json<{ base: Base }>().base;

    // One point short of the next level, with a build that finished an hour ago still in the
    // queue: the next settle lands it, pays for it, and crosses.
    app.repos.bases.updateProgression(base.id, base.level, {
      ...base.progression,
      xpIntoLevel: playerXpToNextLevel(base.level) - 1,
    });
    const startedAt = new Date(Date.now() - 2 * 3_600_000).toISOString();
    app.repos.bases.updateDistrict(base.id, base.buildings, [
      { id: 'q1', kind: 'quarters', level: 1, startedAt, durationSeconds: 3_600 },
    ]);

    const first = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    expect(first.statusCode).toBe(200);
    const announced = first.json<{ base: Base; levelUp?: LevelUp }>();
    expect(announced.base.level).toBe(base.level + 1);
    expect(announced.levelUp?.level).toBe(base.level + 1);
    expect(announced.levelUp?.levelsGained).toBe(1);

    // The next poll has nothing to settle and says nothing: the shell latches the first.
    const second = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    expect(second.json<{ levelUp?: LevelUp }>().levelUp).toBeUndefined();
  });
});
