import {
  CITIES,
  ARCA_CITY_ID,
  TERMINUS_CITY_ID,
  createCommander,
  districtHolder,
  districtsOfCity,
  makeAttributes,
  type District,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';
import { shutCityForThisFile } from '../testing/shut-city.js';

/**
 * A closed city has ground in the atlas and no way onto it (bug pass, 2026-09-29).
 *
 * Arca was the shut city then, authored down to its control rows with part of Candlemarket empty.
 * It opened on 2026-10-07, so this file shuts it again (`shutCityForThisFile`) to keep the doors
 * tested for the next city authored before it opens. The fight door
 * refused it, and every other journey there did not: a column walked in and claimed a plot, which
 * opened the city's Bar, mission board, market and back room to the crew; a Sleeper cell went to
 * ground where no fight can ever be called; and a spy job paid to read a gate nobody may attack.
 *
 * Each door is checked against the same journey into an open city, so a refusal that came from
 * something other than the closed door (no fighting force, no whispers, no caps) cannot pass here.
 */

shutCityForThisFile(ARCA_CITY_ID);

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

interface World {
  app: FastifyInstance;
  token: string;
  baseId: string;
}

async function makeWorld(): Promise<World> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'wanderer', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token, 'ashfall');
  const baseId = chosen.json<{ base: { id: string } }>().base.id;
  const base = app.repos.bases.findById(baseId)!;
  app.repos.bases.updateArmy(baseId, { razors: 20, sleepers: 6 }, []);
  // The Master of Whispers, which is all a spy job needs.
  app.repos.bases.updateCommanders(baseId, [
    ...base.commanders,
    createCommander('o-whispers', 'Wire', 'master_of_whispers', makeAttributes(30), []),
  ]);
  return { app, token, baseId };
}

/** An empty location in an open district of this city: somewhere a column or a cell may go. */
function emptyGround(world: World, cityId: string): string {
  const controls = world.app.repos.city.controls();
  const location = districtsOfCity(cityId)
    .filter((district) => districtHolder(district, controls) === null)
    .flatMap((district) => district.locations)
    .find((one) => controls.get(one.id)?.holder.kind === 'unoccupied');
  if (!location) throw new Error(`fixture: no empty ground in ${cityId}`);
  return location.id;
}

/** A district held whole in this city, by the regime or the clans: a gate with somebody behind it. */
function combineGate(world: World, cityId: string): District {
  const controls = world.app.repos.city.controls();
  const district = districtsOfCity(cityId).find((one) => {
    const kind = districtHolder(one, controls)?.kind;
    return kind === 'government' || kind === 'looters';
  });
  if (!district) throw new Error(`fixture: no armed gate in ${cityId}`);
  return district;
}

function post(world: World, url: string, payload: object) {
  return world.app.inject({ method: 'POST', url, headers: auth(world.token), payload });
}

describe('a closed city', () => {
  it('is Arca for this file, and Terminus is open', () => {
    expect(CITIES.find((city) => city.id === ARCA_CITY_ID)?.open).toBe(false);
    expect(CITIES.find((city) => city.id === TERMINUS_CITY_ID)?.open).toBe(true);
  });

  it('takes no column onto its empty ground, so none of its rooms open', async () => {
    const world = await makeWorld();
    const send = (locationId: string) =>
      post(world, '/api/actions/move', {
        from: { kind: 'district' },
        to: { kind: 'location', locationId },
        army: { razors: 5 },
      });

    const open = await send(emptyGround(world, TERMINUS_CITY_ID));
    expect(open.statusCode, open.body).toBe(200);

    const closed = await send(emptyGround(world, ARCA_CITY_ID));
    expect(closed.statusCode).toBe(400);
    expect(closed.json<{ error: { message: string } }>().error.message).toMatch(/not open yet/);
    expect(world.app.repos.moves.activeFor(world.baseId)).toHaveLength(1);
  });

  it('takes no Sleeper cell', async () => {
    const world = await makeWorld();
    const plant = (locationId: string) =>
      post(world, '/api/city/sleepers', { locationId, army: { sleepers: 2 } });

    const open = await plant(emptyGround(world, TERMINUS_CITY_ID));
    expect(open.statusCode, open.body).toBe(200);

    const closed = await plant(emptyGround(world, ARCA_CITY_ID));
    expect(closed.statusCode).toBe(409);
    expect(closed.json<{ error: { message: string } }>().error.message).toMatch(/not open yet/);
    expect(world.app.repos.bases.findById(world.baseId)!.army.sleepers).toBe(4);
  });

  it('sends no spy, and takes no caps for one', async () => {
    const world = await makeWorld();
    const look = (district: District) =>
      post(world, '/api/city/spy', {
        target: { kind: 'gate', districtId: district.id },
        tier: 'loose_ears',
      });

    const closed = await look(combineGate(world, ARCA_CITY_ID));
    expect(closed.statusCode).toBe(400);
    expect(closed.json<{ error: { message: string } }>().error.message).toMatch(/not open yet/);
    const caps = world.app.repos.bases.findById(world.baseId)!.resources.caps;

    const open = await look(combineGate(world, TERMINUS_CITY_ID));
    expect(open.statusCode, open.body).toBe(200);
    expect(world.app.repos.bases.findById(world.baseId)!.resources.caps).toBeLessThan(caps);
  });
});
