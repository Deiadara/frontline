import { GAME_TIMEZONE, type SettingsResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

/**
 * Settings is the one screen that can lock a player out of their own account, so the tests here
 * are mostly about the ways it must refuse: a username somebody else holds, a passphrase change
 * without the old passphrase, a timezone that is an offset rather than a zone.
 *
 * The defaults are pinned too. A row written before this feature existed has three NULL columns,
 * and the schema is what turns those into a shield, a username and the house clock, if that
 * default ever moves to the database, every account created before the move silently keeps the old
 * one and there is no way to tell the two groups apart.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function makeApp(): Promise<{ app: FastifyInstance; db: AppDatabase }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  const handle = { app, db };
  instances.push(handle);
  return handle;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });
const PASSWORD = 'hunter2pass';

async function register(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: PASSWORD },
  });
  expect(res.statusCode).toBe(201);
  return res.json<{ token: string }>().token;
}

async function settings(app: FastifyInstance, token: string): Promise<SettingsResponse> {
  const res = await app.inject({ method: 'GET', url: '/api/settings', headers: auth(token) });
  expect(res.statusCode).toBe(200);
  return res.json<SettingsResponse>();
}

describe('GET /api/settings', () => {
  it('opens on the house defaults and never carries password material', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'operator');
    const current = await settings(app, token);

    expect(current.user.displayName).toBeNull();
    expect(current.user.icon).toBe('shield');
    expect(current.user.timezone).toBe(GAME_TIMEZONE);
    expect(current.gameTimezone).toBe(GAME_TIMEZONE);
    expect(current.icons.length).toBeGreaterThan(1);
    expect(current.user).not.toHaveProperty('passwordHash');
  });
});

describe('PATCH /api/settings/profile', () => {
  it('changes a name, a display name and a glyph, and they persist', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'operator');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: auth(token),
      payload: { username: 'renamed', displayName: 'The Ninth Street Crew', icon: 'sword' },
    });
    expect(res.statusCode).toBe(200);

    // Read back through a fresh request, not out of the write's own answer.
    const after = await settings(app, token);
    expect(after.user.username).toBe('renamed');
    expect(after.user.displayName).toBe('The Ninth Street Crew');
    expect(after.user.icon).toBe('sword');

    // The token carries only `{sub}`, so a rename must not log anybody out.
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    expect(me.statusCode).toBe(200);
  });

  it('leaves alone what it was not sent', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'operator');
    await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: auth(token),
      payload: { displayName: 'Somebody' },
    });
    await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: auth(token),
      payload: { icon: 'eye' },
    });

    const after = await settings(app, token);
    expect(after.user.displayName).toBe('Somebody');
    expect(after.user.icon).toBe('eye');
    expect(after.user.username).toBe('operator');
  });

  it('refuses a username somebody else already holds', async () => {
    const { app } = await makeApp();
    await register(app, 'taken');
    const token = await register(app, 'operator');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: auth(token),
      payload: { username: 'taken' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('USERNAME_TAKEN');
    expect((await settings(app, token)).user.username).toBe('operator');
  });

  it('lets a player resend their own name without calling it a collision', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'operator');
    // A form that sends every field would otherwise be unable to change the icon.
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: auth(token),
      payload: { username: 'operator', icon: 'flask' },
    });
    expect(res.statusCode).toBe(200);
    expect((await settings(app, token)).user.icon).toBe('flask');
  });

  it('takes an IANA zone and refuses an offset', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'operator');

    const good = await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: auth(token),
      payload: { timezone: 'America/New_York' },
    });
    expect(good.statusCode).toBe(200);
    expect((await settings(app, token)).user.timezone).toBe('America/New_York');

    // An offset does not know about summer time, which is the whole reason a name is stored.
    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: auth(token),
      payload: { timezone: 'UTC+03:00' },
    });
    expect(bad.statusCode).toBe(400);
    expect((await settings(app, token)).user.timezone).toBe('America/New_York');
  });

  it('refuses a request that asks for nothing', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'operator');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: auth(token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/settings/password', () => {
  it('changes the passphrase when the old one is given', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'operator');

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/password',
      headers: auth(token),
      payload: { currentPassword: PASSWORD, newPassword: 'a-much-longer-one' },
    });
    expect(res.statusCode).toBe(200);

    const stale = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: PASSWORD },
    });
    expect(stale.statusCode).toBe(401);

    const fresh = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: 'a-much-longer-one' },
    });
    expect(fresh.statusCode).toBe(200);
  });

  it('refuses without the old passphrase, even with a valid token', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'operator');

    // The token proves the browser had the password once. It does not prove who is at the keyboard.
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/password',
      headers: auth(token),
      payload: { currentPassword: 'not-it', newPassword: 'a-much-longer-one' },
    });
    expect(res.statusCode).toBe(401);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
  });

  it('refuses a new passphrase shorter than the registration rule', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'operator');
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/password',
      headers: auth(token),
      payload: { currentPassword: PASSWORD, newPassword: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('never writes password material into the history trail', async () => {
    const { app, db } = await makeApp();
    const token = await register(app, 'operator');
    await app.inject({
      method: 'POST',
      url: '/api/settings/password',
      headers: auth(token),
      payload: { currentPassword: PASSWORD, newPassword: 'a-much-longer-one' },
    });

    const rows = db.prepare('SELECT kind, payload_json FROM game_events').all() as {
      kind: string;
      payload_json: string;
    }[];
    expect(rows.some((row) => row.kind === 'account.password_changed')).toBe(true);
    for (const row of rows) {
      expect(row.payload_json).not.toContain(PASSWORD);
      expect(row.payload_json).not.toContain('a-much-longer-one');
    }
  });
});
