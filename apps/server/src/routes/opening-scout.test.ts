import { ALL_DISTRICTS, findDistrict, type Base } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { nearestOpenGround } from './overseer.js';

/**
 * The one district a new crew is handed for free has to be somewhere they can go and do something.
 *
 * `nearestOpenGround` filters out districts somebody **lives on**. It did not filter out districts
 * that are somewhere **to live**, and those are different: an empty residential plot passed the
 * sieve, and a plot holds no locations at all. A crew's opening scout could be spent on a street
 * with nothing in it to take, and the district then read as callable with nothing to call on.
 *
 * It became reachable when crews stopped all starting on the same plot, which is what choosing a
 * city did (2026-09-24), and the live walkthrough is what found it.
 *
 * ## Why this asks the rule rather than registering a crew and looking
 *
 * Only two homes in the whole world have a plot as their nearest neighbour: `ashen-terraces` and
 * `embankment`. A test that registered an account and inspected the result therefore passed
 * whether or not the filter existed, on every placement but those two. Measured: with the filter
 * mutated away, such a test stayed green. So the question is put to every home there is.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function world(): Promise<{ app: FastifyInstance; base: Base }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'opener', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 300)).toBe(201);
  pinOverseer(app, token);
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  return { app, base: app.repos.bases.findById(baseId)! };
}

/** Every district a crew could ever be living in. */
const HOMES = ALL_DISTRICTS.filter((district) => district.kind === 'residential');

describe('the ground a new crew is shown for free', () => {
  it('is contested ground with something in it, from every home in the world', async () => {
    const { app, base } = await world();
    // A guard on the sweep: an empty home list would make every assertion below vacuous.
    expect(HOMES.length).toBeGreaterThan(4);

    let found = 0;
    for (const home of HOMES) {
      const ground = nearestOpenGround(app.repos, { ...base, districtId: home.id });
      if (!ground) continue;
      found += 1;
      expect(ground.kind, `${home.id} was shown ${ground.id}`).toBe('contested');
      // The thing the live walkthrough tripped over: a district with nothing to call on.
      expect(ground.locations.length, `${home.id} was shown ${ground.id}`).toBeGreaterThan(0);
      // And it stays inside the crew's own city, because the two maps share a coordinate square.
      expect(ground.cityId, `${home.id} was shown ${ground.id}`).toBe(home.cityId);
    }
    // A second guard: if nothing were ever open this would pass having checked nothing.
    expect(found).toBeGreaterThan(4);
  });

  it('is the case the two homes that actually reach it, named', async () => {
    /*
     * `ashen-terraces` and `embankment` are the only homes whose nearest district is a plot.
     * They are named here so that a future map edit which moves them does not quietly turn the
     * sweep above back into the fixture-dependent test it replaced.
     */
    const { app, base } = await world();
    for (const homeId of ['ashen-terraces', 'embankment']) {
      const home = findDistrict(homeId);
      expect(home, homeId).toBeDefined();
      const sameCity = ALL_DISTRICTS.filter(
        (one) => one.cityId === home!.cityId && one.id !== homeId,
      );
      const closest = sameCity.sort(
        (a, b) =>
          Math.hypot(a.position.x - home!.position.x, a.position.y - home!.position.y) -
          Math.hypot(b.position.x - home!.position.x, b.position.y - home!.position.y),
      )[0]!;
      expect(closest.kind, `${homeId}'s nearest is ${closest.id}`).toBe('residential');

      const ground = nearestOpenGround(app.repos, { ...base, districtId: homeId });
      expect(ground, homeId).toBeDefined();
      expect(ground!.id, homeId).not.toBe(closest.id);
      expect(ground!.kind, homeId).toBe('contested');
    }
  });
});
