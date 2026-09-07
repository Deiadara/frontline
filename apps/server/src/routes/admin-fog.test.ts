/**
 * The Console's fog of war (board request).
 *
 * In admin mode every district is scouted by default, and an admin can un-tick one to look at it
 * unscouted. Two things here are worth a test rather than a glance. The override is an *exception
 * list* and never scouting intel: hiding a district a scout has really visited leaves that visit on
 * record, so admin mode off shows exactly what the crew has seen. And the tick and the map go
 * through one read (`visibleDistricts`), so the Console and the city cannot disagree.
 *
 * Driven through HTTP against both builds, because the whole feature is a difference between them.
 */
import { CITY_DISTRICTS, type CityResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function crew(
  admin: boolean,
): Promise<{ app: FastifyInstance; token: string; home: string }> {
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    JWT_SECRET: 'test-secret',
    ADMIN: admin ? 'true' : 'false',
  });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'reviewer', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  return { app, token, home: chosen.json<{ base: { districtId: string } }>().base.districtId };
}

async function scoutedOnTheMap(app: FastifyInstance, token: string): Promise<Set<string>> {
  const res = await app.inject({ method: 'GET', url: '/api/city', headers: auth(token) });
  expect(res.statusCode).toBe(200);
  return new Set(
    res
      .json<CityResponse>()
      .districts.filter((entry) => entry.scouted)
      .map((entry) => entry.district.id),
  );
}

/** A district that is not home, so it can be hidden. */
function elsewhere(home: string): string {
  const other = CITY_DISTRICTS.find((district) => district.id !== home);
  if (!other) throw new Error('fixture error: the city has one district');
  return other.id;
}

describe('the fog of war on the Console', () => {
  it('scouts every district for an admin build, before anybody is sent anywhere', async () => {
    const { app, token } = await crew(true);
    const seen = await scoutedOnTheMap(app, token);
    for (const district of CITY_DISTRICTS) {
      expect(seen.has(district.id), `${district.id} is still in the fog`).toBe(true);
    }
  });

  it('shows a real build only what the crew has actually seen', async () => {
    const { app, token, home } = await crew(false);
    const seen = await scoutedOnTheMap(app, token);
    // A new crew sees its home and the one neighbour the game opens for it, never the whole city.
    expect(seen.has(home)).toBe(true);
    expect(seen.size).toBeLessThan(CITY_DISTRICTS.length);
  });

  it('hides a district when it is un-ticked, and shows it again when ticked', async () => {
    const { app, token, home } = await crew(true);
    const target = elsewhere(home);

    const hidden = await app.inject({
      method: 'POST',
      url: '/api/admin/fog',
      headers: auth(token),
      payload: { districtId: target, visible: false },
    });
    expect(hidden.statusCode, hidden.body.slice(0, 200)).toBe(200);
    // The snapshot and the map agree, because they are the same read.
    const row = hidden
      .json<{ admin: { fog: { districtId: string; visible: boolean }[] } }>()
      .admin.fog.find((entry) => entry.districtId === target);
    expect(row?.visible).toBe(false);
    expect((await scoutedOnTheMap(app, token)).has(target)).toBe(false);

    await app.inject({
      method: 'POST',
      url: '/api/admin/fog',
      headers: auth(token),
      payload: { districtId: target, visible: true },
    });
    expect((await scoutedOnTheMap(app, token)).has(target)).toBe(true);
  });

  it('never writes scouting intel: the exception is the only thing stored', async () => {
    const { app, token, home } = await crew(true);
    const target = elsewhere(home);
    const user = app.repos.users.findByUsername('reviewer')!;
    const base = app.repos.bases.findByOwnerId(user.id)!;
    const intelBefore = app.repos.city.scouted(base.id);

    await app.inject({
      method: 'POST',
      url: '/api/admin/fog',
      headers: auth(token),
      payload: { districtId: target, visible: false },
    });
    await app.inject({
      method: 'POST',
      url: '/api/admin/fog',
      headers: auth(token),
      payload: { districtId: target, visible: true },
    });
    expect([...app.repos.city.scouted(base.id)].sort()).toEqual([...intelBefore].sort());
  });

  it('cannot hide home', async () => {
    const { app, token, home } = await crew(true);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/fog',
      headers: auth(token),
      payload: { districtId: home, visible: false },
    });
    expect(res.statusCode).toBe(200);
    expect((await scoutedOnTheMap(app, token)).has(home)).toBe(true);
    // The map would show home regardless (you live there), so the assertion that can actually
    // fail is on the exception table: an un-tick on home must store nothing.
    const user = app.repos.users.findByUsername('reviewer')!;
    const base = app.repos.bases.findByOwnerId(user.id)!;
    expect(app.repos.city.hiddenByAdmin(base.id).has(home)).toBe(false);
    const row = res.json<{ admin: { fog: { districtId: string; home: boolean }[] } }>().admin.fog;
    expect(row.find((entry) => entry.districtId === home)?.home).toBe(true);
  });

  it('is not a route in a real build', async () => {
    const { app, token, home } = await crew(false);
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/fog',
      headers: auth(token),
      payload: { districtId: elsewhere(home), visible: false },
    });
    expect(res.statusCode).toBe(404);
  });
});
