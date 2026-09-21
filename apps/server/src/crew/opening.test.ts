import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { Base, ClaimFeatResponse, FeatsResponse, UnitsResponse } from '@frontline/shared';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * The first five minutes, end to end through the real routes.
 *
 * Measured on 2026-09-18, before any of this: a new crew stood a Nexus and a Generator, held 600
 * caps against the 512 a second Nexus level costs, produced six oil an hour and no caps at all,
 * and **could not train a single unit**, because every unit in the catalogue answered to a
 * Gauntlet that answers to Nexus 3 and Quarters 2. The eight Razors it is handed were therefore
 * the only bodies it would ever have until missions paid for a barracks, and missions need
 * bodies to send.
 *
 * Three things had to be true to break that circle and all three are pinned here, against the
 * routes rather than against the catalogue: the opening district can train a carrier, the act of
 * picking a character finishes a feat, and collecting it puts five of them on the roster.
 * `units/units.test.ts` and `feats/catalog.test.ts` hold the same facts from the data side; what
 * this file adds is that the wiring between them exists, which is the half that fails silently.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

async function newCrew(): Promise<{ app: FastifyInstance; token: string; base: Base }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'first_evening', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  return { app, token, base: chosen.json<{ base: Base }>().base };
}

async function feats(app: FastifyInstance, token: string): Promise<FeatsResponse> {
  const res = await app.inject({ method: 'GET', url: '/api/feats', headers: auth(token) });
  expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
  return res.json<FeatsResponse>();
}

describe('a brand new crew', () => {
  it('can train the cheap carrier on its first second, and nothing else', async () => {
    const { app, token, base } = await newCrew();
    // The district really is the bare opening, or the rest of this proves nothing about it.
    expect(base.buildings.map((one) => `${one.kind}${one.level}`).sort()).toEqual([
      'generator1',
      'nexus1',
    ]);

    const res = await app.inject({ method: 'GET', url: '/api/units', headers: auth(token) });
    expect(res.statusCode, res.body.slice(0, 200)).toBe(200);
    const open = res
      .json<UnitsResponse>()
      .units.filter((unit) => unit.unlocked)
      .map((unit) => unit.id);
    expect(open).toEqual(['scavengers']);

    // ...and the route agrees: an order for five of them is taken.
    const ordered = await app.inject({
      method: 'POST',
      url: '/api/units/train',
      headers: auth(token),
      payload: { unitId: 'scavengers', count: 5 },
    });
    expect(ordered.statusCode, ordered.body.slice(0, 200)).toBe(200);
  });

  it('finishes the opening feat by picking a character, and is paid five Scavengers for it', async () => {
    const { app, token } = await newCrew();

    const opening = (await feats(app, token)).progress.find((one) => one.id === 'overseer_taken');
    expect(opening?.state, 'the first feat is finished before the board is first read').toBe(
      'ready',
    );
    expect(opening?.value).toBe(1);

    const claimed = await app.inject({
      method: 'POST',
      url: '/api/feats/claim',
      headers: auth(token),
      payload: { featId: 'overseer_taken' },
    });
    expect(claimed.statusCode, claimed.body.slice(0, 200)).toBe(200);

    // What came out of the till, then what is standing in the district.
    expect(claimed.json<ClaimFeatResponse>().paid.units).toEqual({ scavengers: 5 });
    const roster = await app.inject({ method: 'GET', url: '/api/units', headers: auth(token) });
    // Eight Razors is what a crew is handed; the five carriers are what the feat added.
    expect(roster.json<UnitsResponse>().army).toMatchObject({ razors: 8, scavengers: 5 });

    // Collected, not merely paid: a second press has to find the row already there.
    const twice = await app.inject({
      method: 'POST',
      url: '/api/feats/claim',
      headers: auth(token),
      payload: { featId: 'overseer_taken' },
    });
    expect(twice.statusCode).toBe(409);
  });
});
