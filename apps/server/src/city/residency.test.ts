import {
  STARTER_DISTRICT_ID,
  type CityResponse,
  type DistrictDetailResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * Who "the crew that lives here" is, on a map with four residential districts and no cap on
 * accounts.
 *
 * The `bases` table has no unique index on `district_id`, so a district holds as many crews as land
 * on it. Both city projections used to answer "the resident" with the first row of an unordered
 * `SELECT ... FROM bases`, which meant the earliest-registered player's whole structure list, damage
 * and all, was served to every other player on the one screen nobody has to scout: their own front
 * door.
 *
 * Sharing used to be the default, because every account was created in `STARTER_DISTRICT_ID`. New
 * crews are spread across the four residential districts now (`quietestDistrict`), so these tests
 * put the second crew back on the first's ground **on purpose**: the bug is about a shared district
 * and a shared district has to be built rather than assumed. It is still an ordinary state, reached
 * as soon as there are more players than districts.
 */

/**
 * Moves a crew onto somebody else's ground, which is the state both cases here are about.
 *
 * Written straight to the column because there is no route for it: a player does not choose where
 * they live. `quietestDistrict` spreads new crews, so two on one district is now something a test
 * has to arrange, and arranging it in one named helper says that out loud.
 */
function share(app: FastifyInstance, baseId: string, districtId: string): void {
  app.db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(districtId, baseId);
}

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

async function makeApp(): Promise<FastifyInstance> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return app;
}

async function makePlayer(
  app: FastifyInstance,
  username: string,
): Promise<{ token: string; baseId: string }> {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  return { token, baseId: chosen.json<{ base: { id: string } }>().base.id };
}

describe('the crew a residential district page is about', () => {
  it('is you, on your own ground, however many crews share it', async () => {
    const app = await makeApp();
    const first = await makePlayer(app, 'operator_one');
    const second = await makePlayer(app, 'operator_two');
    share(app, second.baseId, STARTER_DISTRICT_ID);

    // Something to tell the two apart: the second crew lays a structure the first has not.
    const withStore = app.repos.bases.findById(second.baseId);
    if (!withStore) throw new Error('no base');
    app.repos.bases.updateBuildings(second.baseId, [
      ...withStore.buildings,
      {
        id: 'store-of-the-second-crew',
        kind: 'scrapyard',
        level: 3,
        modifications: [],
        damage: 0,
      },
    ]);

    const page = await app.inject({
      method: 'GET',
      url: `/api/city/${STARTER_DISTRICT_ID}`,
      headers: auth(second.token),
    });
    const detail = page.json<DistrictDetailResponse>();

    expect(detail.base?.id).toBe(second.baseId);
    expect(detail.base?.id).not.toBe(first.baseId);
    // And the structures drawn on it are the viewer's own, not the first-registered player's.
    expect(detail.residentBuildings.map((building) => building.id)).toContain(
      'store-of-the-second-crew',
    );
  });

  it('names the viewer on the city map, not whoever registered first', async () => {
    const app = await makeApp();
    const first = await makePlayer(app, 'operator_one');
    const second = await makePlayer(app, 'operator_two');
    share(app, second.baseId, STARTER_DISTRICT_ID);

    const map = await app.inject({
      method: 'GET',
      url: '/api/city',
      headers: auth(second.token),
    });
    const home = map
      .json<CityResponse>()
      .districts.find((district) => district.district.id === STARTER_DISTRICT_ID);

    expect(home?.base?.id).toBe(second.baseId);
    expect(home?.base?.id).not.toBe(first.baseId);
  });

  it('does not hand one player another player’s structure list', async () => {
    const app = await makeApp();
    const first = await makePlayer(app, 'operator_one');
    const second = await makePlayer(app, 'operator_two');

    const firstBase = app.repos.bases.findById(first.baseId);
    if (!firstBase) throw new Error('no base');
    app.repos.bases.updateBuildings(first.baseId, [
      ...firstBase.buildings,
      {
        id: 'secret-of-the-first-crew',
        kind: 'scrapyard',
        level: 7,
        modifications: [],
        damage: 40,
      },
    ]);

    const page = await app.inject({
      method: 'GET',
      url: `/api/city/${STARTER_DISTRICT_ID}`,
      headers: auth(second.token),
    });
    const ids = page.json<DistrictDetailResponse>().residentBuildings.map((b) => b.id);
    expect(ids).not.toContain('secret-of-the-first-crew');
  });
});
