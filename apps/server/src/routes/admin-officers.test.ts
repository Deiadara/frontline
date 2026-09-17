import { OFFICER_ROLES } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * The console seats a bench (maintainer request, 2026-09-17).
 *
 * Hiring is an auction that settles at midnight, so a world that has just been stood up has nobody
 * in any chair, and everything downstream of a chair is unreachable from it: scouting needs an
 * officer on the road, a fight wants somebody leading it, role fit and the attribute channels have
 * nothing to read. That made a whole half of the game untestable against a live server without
 * waiting a day for the Bar.
 *
 * The assertion below is not that four rows appeared. It is that the door those rows exist to open
 * is open: `POST /city/scout` refused with `NO_FORCE` before the knob and is accepted after it. A
 * count would pass on a bench the rest of the server could not see.
 */
const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function bench(): Promise<{ app: FastifyInstance; token: string }> {
  const config = loadConfig({
    DATABASE_PATH: ':memory:',
    JWT_SECRET: 'test-secret',
    ADMIN: 'true',
  });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'seater', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  await chooseOverseer(app, token);
  return { app, token };
}

const scout = (app: FastifyInstance, token: string) =>
  app.inject({
    method: 'POST',
    url: '/api/city/scout',
    headers: auth(token),
    payload: { districtId: 'neon-docks' },
  });

describe('the officers knob', () => {
  it('turns a crew with nobody to send into one that can scout', async () => {
    const { app, token } = await bench();

    const before = await scout(app, token);
    expect(before.statusCode, 'a fresh crew has nobody in a chair').toBe(409);
    expect(before.json<{ error: { code: string } }>().error.code).toBe('NO_FORCE');

    const knobs = await app.inject({
      method: 'POST',
      url: '/api/admin/knobs',
      headers: auth(token),
      payload: { officers: { count: 4, rating: 70 } },
    });
    expect(knobs.statusCode, knobs.body.slice(0, 300)).toBe(200);

    const after = await scout(app, token);
    expect(after.statusCode, after.body.slice(0, 300)).toBe(200);
  });

  it('seats one per role at the rating it was given, and no more than were asked for', async () => {
    const { app, token } = await bench();
    await app.inject({
      method: 'POST',
      url: '/api/admin/knobs',
      headers: auth(token),
      payload: { officers: { count: 2, rating: 55 } },
    });

    const crew = await app.inject({ method: 'GET', url: '/api/crew', headers: auth(token) });
    const officers = crew.json<{
      officers: { role: string; attributes: Record<string, number> }[];
    }>().officers;

    expect(officers).toHaveLength(2);
    expect(officers.map((o) => o.role)).toEqual([...OFFICER_ROLES].slice(0, 2));
    // Flat, so a measurement taken against this bench measures the mechanic and not the draw.
    for (const officer of officers) {
      for (const [name, value] of Object.entries(officer.attributes)) {
        expect(value, `${officer.role}'s ${name} is not the rating that was asked for`).toBe(55);
      }
    }
  });
});
