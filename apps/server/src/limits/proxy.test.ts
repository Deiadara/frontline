import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { assertDeployable, loadConfig, trustProxyFrom } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { AUTH_LIMIT, ruleFor } from './rules.js';

/**
 * Who the address bucket is actually about, once there is a reverse proxy in front of the process.
 *
 * `AUTH_LIMIT` is 20 sign-in attempts per quarter hour "per address", and the address comes from
 * `request.ip`. Fastify answers that with the socket's peer unless it is told which hops to
 * believe, so behind nginx, a load balancer or Cloudflare every player in the game arrives from one
 * address and shares one bucket: the twenty-first login of the quarter hour is refused for
 * everybody. That is the limiter's own definition of a bug report rather than a defence.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function makeApp(env: Record<string, string> = {}): Promise<FastifyInstance> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret', ...env });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return app;
}

/** One failed sign-in, presented as arriving from `from` by way of the proxy. */
const knock = (app: FastifyInstance, from: string) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { 'x-forwarded-for': from },
    payload: { username: 'nobody_at_all', password: 'wrongpassword' },
  });

describe('the address bucket behind a proxy', () => {
  it('gives one player’s exhausted quota to every other player when nothing is trusted', async () => {
    const app = await makeApp();
    for (let attempt = 0; attempt < AUTH_LIMIT.quota; attempt++) {
      await knock(app, '203.0.113.10');
    }
    // A completely different player, one hop behind the same proxy.
    const other = await knock(app, '198.51.100.77');
    expect(other.statusCode).toBe(429);
  });

  it('counts each forwarded address on its own once the hop is trusted', async () => {
    const app = await makeApp({ TRUST_PROXY: '1' });
    for (let attempt = 0; attempt < AUTH_LIMIT.quota; attempt++) {
      await knock(app, '203.0.113.10');
    }
    expect((await knock(app, '203.0.113.10')).statusCode).toBe(429);
    const other = await knock(app, '198.51.100.77');
    expect(other.statusCode).not.toBe(429);
  });

  it('refuses to boot in production believing the whole chain', () => {
    // `true` reads every hop, so an unauthenticated caller writes themselves a fresh bucket per
    // request by adding one more address to the header.
    const believing = loadConfig({
      DATABASE_PATH: ':memory:',
      JWT_SECRET: 'a-real-one',
      TRUST_PROXY: 'true',
    });
    expect(() => assertDeployable(believing, 'production')).toThrow(/TRUST_PROXY/);

    const counted = loadConfig({
      DATABASE_PATH: ':memory:',
      JWT_SECRET: 'a-real-one',
      TRUST_PROXY: '1',
    });
    expect(() => assertDeployable(counted, 'production')).not.toThrow();
    expect(counted.trustProxy).toBe(1);
  });

  it('reads an address list as written and an empty setting as no trust', () => {
    expect(trustProxyFrom('')).toBe(false);
    expect(trustProxyFrom('false')).toBe(false);
    expect(trustProxyFrom('2')).toBe(2);
    expect(trustProxyFrom('10.0.0.0/8,127.0.0.1')).toBe('10.0.0.0/8,127.0.0.1');
  });
});

/**
 * Password work belongs behind the password limit, whatever the path spells.
 *
 * `/api/settings/password` does a `bcrypt.compare` *and* a `bcrypt.hash` (measured at 49ms and 55ms
 * on this machine with the repo's own `bcryptjs`), i.e. twice the crypto of a login, and it sat on
 * the 120/minute write bucket. One account could spend 12.5 seconds of CPU a minute on the single
 * thread that serves every player's reads, settles and battle resolutions, and a wrong
 * `currentPassword` is refused *after* the compare, so the refusal costs the server and not the
 * caller.
 */
describe('which bucket a route falls in', () => {
  it('puts changing a password on the sign-in limit, not the write limit', () => {
    expect(ruleFor('POST', '/api/settings/password')).toEqual({
      rule: AUTH_LIMIT,
      scope: 'auth',
    });
    expect(ruleFor('POST', '/api/auth/login')).toEqual({ rule: AUTH_LIMIT, scope: 'auth' });
  });

  it('leaves every other settings write on the write limit, which is the point of the split', () => {
    expect(ruleFor('PATCH', '/api/settings/profile').scope).toBe('write');
    expect(ruleFor('POST', '/api/city/scout').scope).toBe('write');
    expect(ruleFor('GET', '/api/city').scope).toBe('read');
  });

  it('refuses the twenty-first attempt in the window, over HTTP', async () => {
    const app = await makeApp();
    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'grinder', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/settings/password',
        headers: { authorization: `Bearer ${token}` },
        payload: { currentPassword: 'wrongpassword', newPassword: 'anotherpassword' },
      });

    for (let i = 0; i < AUTH_LIMIT.quota; i += 1) {
      expect((await attempt()).statusCode).not.toBe(429);
    }
    expect((await attempt()).statusCode).toBe(429);
  });
});
