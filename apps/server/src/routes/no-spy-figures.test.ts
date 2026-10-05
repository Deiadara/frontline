import * as shared from '@frontline/shared';
import { CITY_DISTRICTS, createCommander, makeAttributes, type Building } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';

/**
 * How hard a crew is to read is not a public figure (maintainer, 2026-10-01: "these are not public
 * values"). The server keeps both spy totals for the contest and sends neither to a browser: not
 * the crew's own, not a rival's, and not a gate's share of them. Perk cards that describe their own
 * bonus in words are the one exception, and they carry no key.
 */
const SPY_KEYS = ['intelYieldPercent', 'intelResistancePercent'] as const;

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

interface Player {
  token: string;
  baseId: string;
  districtId: string;
}

async function register(app: FastifyInstance, username: string): Promise<Player> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  pinOverseer(app, token);
  const base = chosen.json<{ base: { id: string; districtId: string } }>().base;
  return { token, baseId: base.id, districtId: base.districtId };
}

/** A crew with every source of both totals the save can hold: perks, a Gate, an Encrypted Core. */
function armed(app: FastifyInstance, player: Player): void {
  const base = app.repos.bases.findById(player.baseId)!;
  app.repos.bases.updateCommanders(base.id, [
    ...base.commanders,
    createCommander('spy', 'Wire', 'master_of_whispers', makeAttributes(60), [
      'street_ears',
      'paper_shredder',
    ]),
  ]);
  const gate: Building = {
    id: 'gate-1',
    kind: 'gate',
    level: 6,
    modifications: ['nexus_encrypted_core'],
  };
  app.repos.bases.updateBuildings(base.id, [
    ...base.buildings.filter((building) => building.kind !== 'gate'),
    gate,
  ]);
}

/** Every key anywhere in a JSON value, however deep. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysOf(item, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      keysOf(inner, into);
    }
  }
  return into;
}

describe('no public response carries a spy total', () => {
  it('leaves both keys out of every read a player can make', async () => {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const app = await buildApp({ config, db, logger: false });
    instances.push({ app, db });
    const me = await register(app, 'reader');
    const rival = await register(app, 'readee');
    armed(app, me);
    armed(app, rival);
    // ...and a district held whole behind a captured gate, which the city view lists.
    const whole = CITY_DISTRICTS.find((district) => district.locations.length > 1)!;
    for (const location of whole.locations) {
      const control = app.repos.city.control(location.id);
      if (control) {
        app.repos.city.put({
          ...control,
          holder: { kind: 'crew', baseId: me.baseId },
          garrison: {},
        });
      }
    }
    app.repos.capturedGates.put({
      districtId: whole.id,
      level: 5,
      upgradingTo: null,
      upgradingUntil: null,
      upgradingSince: null,
    });

    const reads = [
      '/me',
      '/overseer/me',
      '/overseer/choices',
      '/crew',
      '/training',
      '/units',
      '/research',
      '/scrapyard',
      '/garage',
      '/city',
      `/city/${me.districtId}`,
      `/city/${rival.districtId}`,
      `/city/${whole.id}`,
      `/base/${me.baseId}`,
      `/base/${rival.baseId}`,
      `/crews/${rival.baseId}`,
      '/battles',
      '/actions',
      '/automations',
      '/missions',
      '/bar',
      '/market',
      '/black-market',
      '/factions',
      '/feats',
      '/settings',
      '/messages',
      '/notifications',
      '/leaderboard',
    ];
    const answered: string[] = [];
    const leaks: string[] = [];
    for (const url of reads) {
      const res = await app.inject({
        method: 'GET',
        url: `/api${url}`,
        headers: { authorization: `Bearer ${me.token}` },
      });
      if (res.statusCode !== 200) continue;
      answered.push(url);
      const keys = keysOf(res.json());
      for (const key of SPY_KEYS) if (keys.has(key)) leaks.push(`${url} sends ${key}`);
    }
    expect(leaks).toEqual([]);
    // The captured gate is drawn on the city view, so the sweep did read one.
    const city = await app.inject({
      method: 'GET',
      url: '/api/city',
      headers: { authorization: `Bearer ${me.token}` },
    });
    expect(
      city
        .json<{ capturedGates: { districtId: string }[] }>()
        .capturedGates.map((g) => g.districtId),
    ).toContain(whole.id);
    // A guard on the guard: a sweep that every route refused would pass on nothing.
    expect(answered.length, `answered: ${answered.join(', ')}`).toBeGreaterThanOrEqual(24);
  });

  /*
   * Bug pass, 2026-10-02: a rival's plot answered with its structures whole, cards and all, so an
   * Encrypted Core and the gate's level read straight off the JSON added up to two terms of the
   * counter score. The street sees the buildings and their levels, not what was fitted to them.
   */
  it('shows nobody the cards fitted on a rival\u2019s ground', async () => {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const app = await buildApp({ config, db, logger: false });
    instances.push({ app, db });
    const me = await register(app, 'reader');
    const rival = await register(app, 'readee');
    armed(app, rival);

    const looked: string[] = [];
    for (const url of [
      `/city/${rival.districtId}`,
      `/base/${rival.baseId}`,
      `/crews/${rival.baseId}`,
    ]) {
      const res = await app.inject({
        method: 'GET',
        url: `/api${url}`,
        headers: { authorization: `Bearer ${me.token}` },
      });
      if (res.statusCode !== 200) continue;
      looked.push(url);
      expect(res.body, url).not.toContain('nexus_encrypted_core');
    }
    // The plot itself is drawn, with the gate on it: the structures still arrive, only bare.
    expect(looked).toContain(`/city/${rival.districtId}`);
    const plot = await app.inject({
      method: 'GET',
      url: `/api/city/${rival.districtId}`,
      headers: { authorization: `Bearer ${me.token}` },
    });
    const gate = plot
      .json<{ residentBuildings: Building[] }>()
      .residentBuildings.find((building) => building.kind === 'gate');
    expect(gate?.level).toBe(6);
  });

  /*
   * And the contract, so a field cannot come back through a schema the sweep above did not reach:
   * no response or view schema `@frontline/shared` exports declares either key.
   */
  it('is declared by no shared response or view schema', () => {
    const declared: string[] = [];
    const seen = new Set<unknown>();
    const walk = (schema: unknown, path: string): void => {
      if (schema === null || typeof schema !== 'object' || seen.has(schema)) return;
      seen.add(schema);
      const def = (schema as { _zod?: { def?: Record<string, unknown> } })._zod?.def;
      if (!def) return;
      const shape = def['shape'] as Record<string, unknown> | undefined;
      if (shape) {
        for (const [key, inner] of Object.entries(shape)) {
          if ((SPY_KEYS as readonly string[]).includes(key)) declared.push(`${path}.${key}`);
          walk(inner, `${path}.${key}`);
        }
      }
      for (const field of ['innerType', 'element', 'valueType', 'in', 'out', 'left', 'right']) {
        walk(def[field], path);
      }
      for (const field of ['options', 'items']) {
        const list = def[field];
        if (Array.isArray(list)) for (const one of list) walk(one, path);
      }
    };
    const schemas = Object.entries(shared).filter(
      ([name]) => name.endsWith('Schema') && /Response|View|Report|Defence/.test(name),
    );
    expect(schemas.length).toBeGreaterThan(50);
    for (const [name, schema] of schemas) walk(schema, name);
    expect(declared).toEqual([]);
  });
});
