import { DEFAULT_SOUND_VOLUME, GAME_TIMEZONE, type SettingsResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

/**
 * Settings is the one screen that can lock a player out of their own account, so the tests here
 * are mostly about the ways it must refuse: a username somebody else holds, a password change
 * without the old password, a timezone that is an offset rather than a zone.
 *
 * The defaults are pinned too. A row written before this feature existed has NULL where the glyph,
 * the display name and the clock go, and the schema is what turns those into a shield, a username
 * and the house clock, if that default ever moves to the database, every account created before the
 * move silently keeps the old one and there is no way to tell the two groups apart. The volume is
 * the one that is `NOT NULL DEFAULT 60` in SQL instead, so both ends have to agree on 60.
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
    expect(current.user.soundVolume).toBe(DEFAULT_SOUND_VOLUME);
    expect(current.gameTimezone).toBe(GAME_TIMEZONE);
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

  /*
   * Bug pass, 2026-09-29: `bobby` set his display name to `Alice`, another player's username, and
   * a name made of a right-to-left override and a zero-width space was stored as sent.
   */
  describe('a display name', () => {
    const rename = (app: FastifyInstance, token: string, payload: object) =>
      app.inject({ method: 'PATCH', url: '/api/settings/profile', headers: auth(token), payload });

    it('may not be another account’s username, whatever the case', async () => {
      const { app } = await makeApp();
      await register(app, 'Alice');
      const token = await register(app, 'bobby');

      const res = await rename(app, token, { displayName: 'alice' });
      expect(res.statusCode).toBe(409);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('DISPLAY_NAME_TAKEN');
      expect((await settings(app, token)).user.displayName).toBeNull();
    });

    it('may not be another account’s display name either', async () => {
      const { app } = await makeApp();
      const first = await register(app, 'carol');
      expect((await rename(app, first, { displayName: 'Night Owl' })).statusCode).toBe(200);
      const token = await register(app, 'bobby');

      const res = await rename(app, token, { displayName: 'NIGHT OWL' });
      expect(res.json<{ error: { code: string } }>().error.code).toBe('DISPLAY_NAME_TAKEN');
    });

    it('may be the player’s own username', async () => {
      const { app } = await makeApp();
      const token = await register(app, 'alice');
      expect((await rename(app, token, { displayName: 'Alice' })).statusCode).toBe(200);
    });

    it('saves again unchanged after somebody registers it as a username', async () => {
      const { app } = await makeApp();
      const token = await register(app, 'alice');
      expect((await rename(app, token, { displayName: 'Zed' })).statusCode).toBe(200);
      await register(app, 'zed');
      // The form resends the name with every save: the icon still changes...
      expect((await rename(app, token, { displayName: 'Zed', icon: 'flask' })).statusCode).toBe(
        200,
      );
      // ...but a new spelling of it is a new claim, and refused.
      expect((await rename(app, token, { displayName: 'ZED' })).statusCode).toBe(409);
    });

    it('is stored without control and format characters', async () => {
      const { app } = await makeApp();
      const token = await register(app, 'bobby');
      const res = await rename(app, token, { displayName: '\u202eevil\u200b' });
      expect(res.statusCode, res.body).toBe(200);
      expect((await settings(app, token)).user.displayName).toBe('evil');
    });

    it('is refused when nothing visible is left', async () => {
      const { app } = await makeApp();
      const token = await register(app, 'bobby');
      const res = await rename(app, token, { displayName: '\u202e\u200b' });
      expect(res.statusCode).toBe(400);
      expect((await settings(app, token)).user.displayName).toBeNull();
    });

    it('may not be one of the game’s own names', async () => {
      const { app } = await makeApp();
      const token = await register(app, 'bobby');
      expect((await rename(app, token, { displayName: 'Directive Xero' })).statusCode).toBe(400);
    });
  });

  it('refuses a rename onto one of the game’s own names', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'operator');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: auth(token),
      payload: { username: 'Directive_Xero' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('USERNAME_RESERVED');
    expect((await settings(app, token)).user.username).toBe('operator');
  });

  it('lets an account that already holds a reserved name save the rest of the form', async () => {
    const { app, db } = await makeApp();
    const token = await register(app, 'operator');
    // Named before the list existed, which is the one way such an account comes to be.
    db.prepare("UPDATE users SET username = 'System' WHERE username = 'operator'").run();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: auth(token),
      payload: { username: 'System', icon: 'flask' },
    });
    expect(res.statusCode, res.body).toBe(200);
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

  it('takes a sound volume anywhere on the bar and refuses one off it', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'operator');

    for (const volume of [0, 35, 100]) {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/settings/profile',
        headers: auth(token),
        payload: { soundVolume: volume },
      });
      expect(res.statusCode).toBe(200);
      // Read back through a fresh request rather than out of the write's own answer: what is being
      // tested is that the column was written, not that the handler can echo its own unit.
      expect((await settings(app, token)).user.soundVolume).toBe(volume);
    }

    // The bar is 0 to 100 whole percent. Anything else is a client that has invented its own scale,
    // and storing it would leave a gain nobody can reproduce from the interface.
    for (const bad of [-1, 101, 12.5]) {
      const res = await app.inject({
        method: 'PATCH',
        url: '/api/settings/profile',
        headers: auth(token),
        payload: { soundVolume: bad },
      });
      expect(res.statusCode, `${bad} was accepted`).toBe(400);
    }
    expect((await settings(app, token)).user.soundVolume).toBe(100);
  });

  it('changes the volume without touching the clock or the glyph', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'operator');
    await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: auth(token),
      payload: { icon: 'sword', timezone: 'America/New_York' },
    });

    await app.inject({
      method: 'PATCH',
      url: '/api/settings/profile',
      headers: auth(token),
      payload: { soundVolume: 15 },
    });

    const after = await settings(app, token);
    expect(after.user.soundVolume).toBe(15);
    expect(after.user.icon).toBe('sword');
    expect(after.user.timezone).toBe('America/New_York');
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
  it('changes the password on the session alone, without the old one', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'operator');

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/password',
      headers: auth(token),
      payload: { newPassword: 'a-much-longer-one' },
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

  it('refuses a new password shorter than the registration rule', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'operator');
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/password',
      headers: auth(token),
      payload: { newPassword: 'short' },
    });
    expect(res.statusCode).toBe(400);
  });

  // bcrypt reads 72 bytes and no more (bug pass, 2026-09-29): a longer password is refused
  // rather than silently cut.
  it('refuses a new password past 72 bytes, counting bytes rather than characters', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'operator');
    const change = (newPassword: string) =>
      app.inject({
        method: 'POST',
        url: '/api/settings/password',
        headers: auth(token),
        payload: { newPassword },
      });
    expect((await change('a'.repeat(73))).statusCode).toBe(400);
    expect((await change('\u20ac'.repeat(25))).statusCode).toBe(400);
    expect((await change('\u20ac'.repeat(24))).statusCode).toBe(200);
  });

  /**
   * `authenticate` checks the session before the handler hashes, and the hash is an await. A "log
   * out everywhere" landing inside it ended this session, and the change went through anyway and
   * signed the request a fresh token: a stolen token could outrun its own revocation.
   */
  it('refuses a change whose session was ended while it was hashing', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'operator');
    // "Log out everywhere" lands once the hash has started, which is the await the route cannot
    // avoid: the first read of the account after it sees the session already ended.
    const hashing = vi.spyOn(bcrypt, 'hash');
    const users = app.repos.users;
    const find = users.findById.bind(users);
    const revoke = vi.spyOn(users, 'findById').mockImplementation((id) => {
      if (hashing.mock.calls.length > 0 && users.sessionVersion(id) === 0) users.revokeSessions(id);
      return find(id);
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/password',
      headers: auth(token),
      payload: { newPassword: 'a-much-longer-one' },
    });
    revoke.mockRestore();
    hashing.mockRestore();

    expect(res.statusCode).toBe(401);
    expect(res.headers['x-session-token']).toBeUndefined();
    const old = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'operator', password: PASSWORD },
    });
    expect(old.statusCode).toBe(200);
  });

  it('never writes password material into the history trail', async () => {
    const { app, db } = await makeApp();
    const token = await register(app, 'operator');
    await app.inject({
      method: 'POST',
      url: '/api/settings/password',
      headers: auth(token),
      payload: { newPassword: 'a-much-longer-one' },
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
