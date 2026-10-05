import { CSRF_HEADER, CSRF_HEADER_VALUE } from '@frontline/shared';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { SESSION_COOKIE, SESSION_HEADER, SESSION_TTL_SECONDS } from './session.js';

/**
 * The browser's session (security pass, 2026-09-30): an httpOnly cookie, and a header every write
 * that rides it must carry. Each case reads what a real request gets back, flags and all, because
 * a cookie that is set but not `HttpOnly` looks exactly like one that is until a script reads it.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function world(env: Record<string, string> = {}): Promise<FastifyInstance> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'cookie-secret', ...env });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return app;
}

const PASSWORD = 'hunter2pass';
const FROM_THE_PAGE = { [CSRF_HEADER]: CSRF_HEADER_VALUE };

/** The one `Set-Cookie` line an answer carries, or undefined. */
function setCookie(res: LightMyRequestResponse): string | undefined {
  const header = res.headers['set-cookie'];
  return Array.isArray(header) ? header[0] : header;
}

/** The session token a `Set-Cookie` line hands over. */
function cookieToken(line: string | undefined): string {
  const value = /^frontline_session=([^;]*)/.exec(line ?? '')?.[1];
  if (value === undefined) throw new Error(`no session cookie in ${line}`);
  return value;
}

async function register(app: FastifyInstance, username = 'cookiejar'): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    headers: FROM_THE_PAGE,
    payload: { username, password: PASSWORD },
  });
  expect(res.statusCode).toBe(201);
  return cookieToken(setCookie(res));
}

const me = (app: FastifyInstance, token: string) =>
  app.inject({ method: 'GET', url: '/api/me', cookies: { [SESSION_COOKIE]: token } });

const tutorial = (app: FastifyInstance, token: string, headers: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/settings/tutorial',
    cookies: { [SESSION_COOKIE]: token },
    headers,
    payload: { steps: ['welcome'] },
  });

describe('signing in sets the cookie', () => {
  it('is httpOnly, SameSite=Strict, scoped to the API and good for thirty days', async () => {
    const app = await world();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'flagged', password: PASSWORD },
    });
    const line = setCookie(res)!;
    const flags = line.split('; ').slice(1);

    expect(flags).toEqual(
      expect.arrayContaining([
        'HttpOnly',
        'SameSite=Strict',
        'Path=/api',
        `Max-Age=${SESSION_TTL_SECONDS}`,
      ]),
    );
    // Development is plain HTTP, where a Secure cookie would never come back.
    expect(flags).not.toContain('Secure');
  });

  it('is Secure in production', async () => {
    const app = await world({ NODE_ENV: 'production' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'secured', password: PASSWORD },
    });
    expect(setCookie(res)!.split('; ')).toContain('Secure');
  });

  it('on a login as well as a sign-up, and the cookie alone is a session', async () => {
    const app = await world();
    await register(app, 'returning');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'returning', password: PASSWORD },
    });
    const token = cookieToken(setCookie(res));

    const read = await me(app, token);
    expect(read.statusCode).toBe(200);
    expect(read.json<{ user: { username: string } }>().user.username).toBe('returning');
  });

  /** A sign-in acts on the password, never on a cookie, so one riding along changes nothing. */
  it('again over a cookie already held, with no header, as a scripted caller does', async () => {
    const app = await world();
    const held = await register(app, 'twice');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      cookies: { [SESSION_COOKIE]: held },
      payload: { username: 'twice', password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(cookieToken(setCookie(res))).not.toBe('');
  });

  it('never from a wrong password', async () => {
    const app = await world();
    await register(app, 'guarded');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'guarded', password: 'not-the-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(setCookie(res)).toBeUndefined();
  });

  /** A cross-site form can post a sign-in, but only as a form or plain text, never as JSON. */
  it.each([
    ['application/x-www-form-urlencoded', `username=victim&password=${PASSWORD}`],
    ['text/plain', JSON.stringify({ username: 'victim', password: PASSWORD })],
  ])('never from a body a cross-site form can send (%s)', async (contentType, body) => {
    const app = await world();
    await register(app, 'victim');
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': contentType },
      payload: body,
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(setCookie(res)).toBeUndefined();
  });
});

describe('a write that rides the cookie', () => {
  it('is refused without the page’s header', async () => {
    const app = await world();
    const token = await register(app);
    const res = await tutorial(app, token);

    expect(res.statusCode).toBe(403);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('FORBIDDEN');
  });

  it('goes through with it', async () => {
    const app = await world();
    const token = await register(app);
    expect((await tutorial(app, token, FROM_THE_PAGE)).statusCode).toBe(200);
  });

  it('is refused with the wrong value in it', async () => {
    const app = await world();
    const token = await register(app);
    expect((await tutorial(app, token, { [CSRF_HEADER]: 'XMLHttpRequest' })).statusCode).toBe(403);
  });

  it('leaves reads alone, which change nothing another site could want', async () => {
    const app = await world();
    const token = await register(app);
    expect((await me(app, token)).statusCode).toBe(200);
  });

  /** No other site can make a browser attach an Authorization header, so a Bearer write needs none. */
  it('leaves a Bearer write alone', async () => {
    const app = await world();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'scripted', password: PASSWORD },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/tutorial',
      headers: { authorization: `Bearer ${registered.json<{ token: string }>().token}` },
      payload: { steps: ['welcome'] },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('signing out', () => {
  it('overwrites the cookie with an expired one', async () => {
    const app = await world();
    const token = await register(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE]: token },
      headers: FROM_THE_PAGE,
    });

    expect(res.statusCode).toBe(200);
    const line = setCookie(res)!;
    expect(line).toMatch(/^frontline_session=;/);
    expect(line.split('; ')).toEqual(
      expect.arrayContaining(['Max-Age=0', 'HttpOnly', 'Path=/api']),
    );
  });

  it('is refused without the page’s header, so another site cannot sign a player out', async () => {
    const app = await world();
    const token = await register(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      cookies: { [SESSION_COOKIE]: token },
    });
    expect(res.statusCode).toBe(403);
    expect(setCookie(res)).toBeUndefined();
  });

  it('needs no header from a Bearer caller, which no other site can forge', async () => {
    const app = await world();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: 'Bearer anything' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('everywhere hands this browser a new cookie and ends the old one', async () => {
    const app = await world();
    const token = await register(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/logout-all',
      cookies: { [SESSION_COOKIE]: token },
      headers: FROM_THE_PAGE,
    });

    expect(res.statusCode).toBe(200);
    // The browser never sees a token: the survivor arrives as a cookie and nowhere else.
    expect(res.headers[SESSION_HEADER]).toBeUndefined();
    const kept = cookieToken(setCookie(res));
    expect((await me(app, token)).statusCode).toBe(401);
    expect((await me(app, kept)).statusCode).toBe(200);
  });

  it('on a password change rotates the cookie the same way', async () => {
    const app = await world();
    const token = await register(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/settings/password',
      cookies: { [SESSION_COOKIE]: token },
      headers: FROM_THE_PAGE,
      payload: { newPassword: 'another-good-one' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers[SESSION_HEADER]).toBeUndefined();
    expect((await me(app, token)).statusCode).toBe(401);
    expect((await me(app, cookieToken(setCookie(res)))).statusCode).toBe(200);
  });
});

describe('renewal', () => {
  it('refreshes the cookie once the session is a day old, and never puts the token in a header', async () => {
    const app = await world();
    const fresh = await register(app);
    expect(setCookie(await me(app, fresh))).toBeUndefined();

    const { sub } = app.jwt.decode<{ sub: string }>(fresh)!;
    const now = Math.floor(Date.now() / 1000);
    const dayOld = app.jwt.sign({
      sub,
      ver: 0,
      iat: now - 25 * 60 * 60,
      exp: now + SESSION_TTL_SECONDS,
    });
    const res = await me(app, dayOld);

    expect(res.headers[SESSION_HEADER]).toBeUndefined();
    const renewed = cookieToken(setCookie(res));
    expect(now - app.jwt.decode<{ iat: number }>(renewed)!.iat).toBeLessThan(60);
    expect((await me(app, renewed)).statusCode).toBe(200);
  });
});

describe('the limiter', () => {
  /** Keyed by the address, everybody behind one NAT would share a bucket with every cookie. */
  it('counts a cookie session against its account', async () => {
    const app = await world();
    const first = await register(app, 'cookieone');
    const second = await register(app, 'cookietwo');
    for (let i = 0; i < 20; i += 1) await me(app, first);

    const busy = await me(app, first);
    const quiet = await me(app, second);
    expect(Number(quiet.headers['x-ratelimit-remaining'])).toBeGreaterThan(
      Number(busy.headers['x-ratelimit-remaining']),
    );
  });
});
