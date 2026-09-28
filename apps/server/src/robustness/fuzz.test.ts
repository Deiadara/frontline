import { DECLARE_INFAMY_COST } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * Every route, against input nobody should send (robustness pass, 2026-09-25).
 *
 * The rule under test is the one the maintainer set: the server never panics. A request is
 * answered, and a request the server cannot use is answered with a 4xx that says so. A 500 is a
 * server fault by definition, so a hostile body that reaches one has found a handler that trusted
 * its input or a path nobody wrote a refusal for.
 *
 * Deterministic: the payloads are drawn from a seeded stream, so a failure replays exactly.
 */

const SEED = 20260925;
const PER_ROUTE = 40;

/** Values a field should never be handed, one of each shape a handler might trip on. */
const HOSTILE: readonly unknown[] = [
  null,
  -1,
  0,
  1e308,
  -1e308,
  1.5,
  '',
  ' ',
  'x'.repeat(5_000),
  '../../etc/passwd',
  '%00',
  '__proto__',
  'constructor',
  true,
  [],
  [null, -1, 'x'],
  {},
  { __proto__: { polluted: 1 } },
  { constructor: { prototype: { polluted: 1 } } },
  { razors: -5 },
  { razors: 1e9 },
  { toString: 1 },
];

/** Field names the routes actually read, plus a few that only an attacker would try. */
const FIELDS: readonly string[] = [
  'id',
  'battleId',
  'missionId',
  'templateId',
  'areaId',
  'force',
  'army',
  'unitId',
  'count',
  'amount',
  'leaderId',
  'officerId',
  'districtId',
  'locationId',
  'target',
  'kind',
  'tier',
  'name',
  'username',
  'password',
  'body',
  'subject',
  'recipients',
  'resource',
  'give',
  'want',
  'offerId',
  'lotId',
  'bid',
  'caps',
  'slot',
  'enabled',
  'order',
  'unitSlots',
  'optimiseFor',
  'perimeter',
  'vehicles',
  'featId',
  'pages',
  'pageId',
  'attribute',
  'presetId',
  'cityId',
  'level',
  'from',
  'to',
  'byRail',
  'seatId',
  'recruitId',
  'volume',
  'soundVolume',
  'role',
  'badge',
  'blurb',
  'acceptWaste',
  'hold',
  'trapId',
  'upgradeId',
  'orderId',
  'sessionId',
  'quantity',
  'itemId',
  '__proto__',
  'constructor',
  'prototype',
];

function stream(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function pick<T>(next: () => number, from: readonly T[]): T {
  return from[Math.floor(next() * from.length)]!;
}

/** A body: sometimes not an object at all, usually an object of hostile fields. */
function hostileBody(next: () => number): unknown {
  const roll = next();
  if (roll < 0.15) return pick(next, HOSTILE);
  const body: Record<string, unknown> = {};
  const fields = 1 + Math.floor(next() * 6);
  for (let i = 0; i < fields; i += 1) body[pick(next, FIELDS)] = pick(next, HOSTILE);
  return body;
}

interface Route {
  path: string;
  methods: string[];
}

/**
 * The routes, off Fastify's own printed tree.
 *
 * The tree is radix-compressed: a child's text is appended to its parent's, so `/api/me` with a
 * child `ssages` is `/api/messages`. Depth is read off the indent, four characters a level.
 */
function routesOf(app: FastifyInstance): Route[] {
  const lines = app.printRoutes({ commonPrefix: false }).split('\n').filter(Boolean);
  const stack: string[] = [];
  const routes: Route[] = [];
  for (const line of lines) {
    const marker = line.search(/[├└]── /);
    if (marker === -1) continue;
    const depth = marker / 4;
    const rest = line.slice(marker + 4);
    const match = /^(.*?)(?: \(([^)]*)\))?$/.exec(rest);
    const segment = match?.[1] ?? rest;
    stack.length = depth;
    stack.push(segment);
    const methods = (match?.[2] ?? '')
      .split(',')
      .map((one) => one.trim())
      .filter((one) => one !== '' && one !== 'HEAD' && one !== 'OPTIONS');
    if (methods.length > 0) routes.push({ path: stack.join(''), methods });
  }
  return routes;
}

/** A concrete URL for a route, with any `:param` filled with something hostile. */
function urlFor(path: string, next: () => number): string {
  return path.replace(/:[A-Za-z]+/g, () =>
    encodeURIComponent(
      String(pick(next, ['x', '__proto__', 'constructor', '-1', 'a'.repeat(300), '%', '..'])),
    ),
  );
}

let app: FastifyInstance;
let db: AppDatabase;
let token = '';
let clock = Date.parse('2026-09-25T12:00:00.000Z');

beforeAll(async () => {
  // Only `Date`, so the rate limiter's windows can be stepped past between batches. The limiter
  // takes `Date.now` when it is built, so the fake has to be in place before the app is.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(clock);
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'fuzz-secret' });
  db = openDatabase(config.databasePath);
  runMigrations(db);
  app = await buildApp({ config, db, logger: false });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'fuzzer', password: 'hunter2pass' },
  });
  token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  // Enough of everything that a request is refused for what it says rather than for being poor.
  const base = app.repos.bases.findById(baseId)!;
  app.repos.bases.updateEconomy(baseId, { ...base.economy, infamy: DECLARE_INFAMY_COST * 50 });
  app.repos.bases.updateArmy(baseId, { ...base.army, razors: 50 }, base.trainingQueue);
});

afterAll(async () => {
  await app.close();
  db.close();
  vi.useRealTimers();
});

/** Past every limiter window, so a batch is refused for its content and never for its rate. */
function nextMinute(): void {
  clock += 61 * 60_000;
  vi.setSystemTime(clock);
}

describe('hostile input, every route', () => {
  it('answers every request without a 500, signed in or not', async () => {
    const routes = routesOf(app).filter(
      // The live channel holds its response open for ever; it has its own tests.
      (route) => !route.path.startsWith('/api/events'),
    );
    expect(routes.length).toBeGreaterThan(40);
    const next = stream(SEED);
    const faults: string[] = [];
    const codes = new Map<number, number>();
    let sent = 0;

    for (const route of routes) {
      for (const method of route.methods) {
        for (let i = 0; i < PER_ROUTE; i += 1) {
          if (sent % 50 === 0) nextMinute();
          sent += 1;
          const url = urlFor(route.path, next);
          const signed = next() < 0.85;
          const query =
            next() < 0.3
              ? `?city=${encodeURIComponent(JSON.stringify(pick(next, HOSTILE)) ?? '')}`
              : '';
          const body = method === 'GET' || method === 'DELETE' ? undefined : hostileBody(next);
          const res = await app.inject({
            method: method as 'GET',
            url: url + query,
            headers: signed ? { authorization: `Bearer ${token}` } : {},
            ...(body === undefined
              ? {}
              : {
                  payload: JSON.stringify(body),
                  headers: {
                    ...(signed ? { authorization: `Bearer ${token}` } : {}),
                    'content-type': 'application/json',
                  },
                }),
          });
          // Log out everywhere and a password change end this session and hand the caller a new
          // token, as `auth/session.ts` does for every client: adopt it, as the real client does.
          const renewed = res.headers['x-session-token'];
          if (typeof renewed === 'string') token = renewed;
          codes.set(res.statusCode, (codes.get(res.statusCode) ?? 0) + 1);
          if (res.statusCode >= 500 && res.statusCode !== 503) {
            faults.push(
              `${method} ${url}${query} ${JSON.stringify(body)?.slice(0, 200)} -> ${res.statusCode} ${res.body.slice(0, 200)}`,
            );
          }
        }
      }
    }
    expect(faults, faults.slice(0, 20).join('\n')).toEqual([]);
    // A fuzzer that never reaches a handler proves nothing: most of it must get past the door.
    // Measured 2026-09-25: 866 answered 200 and 2,427 were refused 400 of 4,560 sent.
    expect(codes.get(200) ?? 0).toBeGreaterThan(sent / 10);
    expect(codes.get(400) ?? 0).toBeGreaterThan(sent / 4);
    // And the server is still there, and nothing was polluted on the way through.
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  }, 300_000);
});
