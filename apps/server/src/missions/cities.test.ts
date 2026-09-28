import {
  MISC_AREA_ID,
  TERMINUS_CITY_ID,
  cityOf,
  districtsOfCity,
  type MissionArea,
  type MissionsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, type AppDatabase } from '../db/index.js';
import { runMigrations } from '../db/index.js';
import { createRepositories, type Repositories } from '../db/repos/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * The board belongs to the city the crew is standing in (2026-09-24).
 *
 * `GET /missions` handed every crew Ashfall's twelve districts, whoever they were and wherever
 * they held ground, because `projectAreas` was called with `CITY_DISTRICTS`. Terminus is playable
 * and its eight contested districts were on nobody's board.
 *
 * Which city a crew may work is the access model the Bar and the market already run on
 * (`city/access.ts`): their own, or any city they hold at least one location in. These tests walk
 * that rule from both sides, over HTTP, because the read and the launch check it separately and a
 * pair that disagrees is a screen that offers work the send button refuses.
 */

const PASSWORD = 'correct horse battery staple';
const TERMINUS = districtsOfCity(TERMINUS_CITY_ID);
const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

interface Stack {
  app: FastifyInstance;
  repos: Repositories;
  baseId: string;
  token: string;
  overseerId: string;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** A crew living in Ashfall, with eyes on Terminus and nothing held there. */
async function makeStack(username = 'linewalker'): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: PASSWORD },
  });
  expect(registered.statusCode).toBe(201);
  const { token, user } = registered.json<{ token: string; user: { id: string } }>();

  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode).toBe(201);
  const overseerId = chosen.json<{ overseer: { id: string } }>().overseer.id;

  const repos = createRepositories(db);
  const base = repos.bases.findByOwnerId(user.id);
  if (!base) throw new Error('overseer creation did not mint a base');
  repos.bases.updateArmy(base.id, { razors: 20 }, base.trainingQueue);
  // Eyes on the whole line, so the scout is never what closes a Terminus board below. Holding
  // ground there is the rule under test and it is granted one test at a time.
  for (const district of TERMINUS) {
    repos.city.markScouted(base.id, district.id, new Date().toISOString());
  }
  return { app, repos, baseId: base.id, token, overseerId };
}

/** Hands this crew one plot in `districtId`, which is a stake in that city and opens its gate. */
function takeOnePlotIn(repos: Repositories, baseId: string, districtId: string): string {
  const district = TERMINUS.find((one) => one.id === districtId);
  const location = district?.locations[0];
  if (!location) throw new Error(`${districtId} has nothing in it to take`);
  const control = repos.city.control(location.id);
  if (!control) throw new Error(`no control row for ${location.id}`);
  repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });
  return location.id;
}

const boardOf = async (app: FastifyInstance, token: string, city?: string) =>
  app.inject({
    method: 'GET',
    url: city === undefined ? '/api/missions' : `/api/missions?city=${city}`,
    headers: auth(token),
  });

const areaIds = (areas: MissionArea[]): string[] => areas.map((area) => area.id);

describe('which city the board is drawn from', () => {
  it("answers the crew's own city when the request names none", async () => {
    const { app, token } = await makeStack();
    const read = await boardOf(app, token);
    expect(read.statusCode).toBe(200);

    const ids = areaIds(read.json<MissionsResponse>().areas);
    expect(ids[0]).toBe(MISC_AREA_ID);
    expect(ids.some((id) => cityOf(id) === TERMINUS_CITY_ID)).toBe(false);
  });

  /** The market's argument: the wrong boards are worse than a refusal, because they look right. */
  it('refuses a city the crew holds no ground in', async () => {
    const { app, token } = await makeStack();
    const read = await boardOf(app, token, TERMINUS_CITY_ID);
    expect(read.statusCode).toBe(403);
    expect(read.json<{ error: { code: string } }>().error.code).toBe('CITY_SHUT');
  });

  it('draws Terminus for a crew holding one plot in Terminus', async () => {
    const { app, repos, baseId, token } = await makeStack();
    takeOnePlotIn(repos, baseId, 'coldwater-halt');

    const read = await boardOf(app, token, TERMINUS_CITY_ID);
    expect(read.statusCode, read.body).toBe(200);
    const ids = areaIds(read.json<MissionsResponse>().areas);

    expect(ids).toContain('coldwater-halt');
    // Asked of the atlas rather than of the id's spelling: since 2026-09-25 an id is the name
    // the tag shows, so nothing in the string says which city a district is in.
    expect(ids.every((id) => id === MISC_AREA_ID || cityOf(id) === TERMINUS_CITY_ID)).toBe(true);
    // And the home city is still there to go back to on the next read.
    const home = await boardOf(app, token);
    expect(
      areaIds(home.json<MissionsResponse>().areas).some((id) => cityOf(id) === TERMINUS_CITY_ID),
    ).toBe(false);
  });

  /**
   * The pay, which is the half nothing on the screen would have caught.
   *
   * `areaDifficulty` looked its id up in Ashfall's array, missed, and fell through to the `misc`
   * floor, so every Terminus board quoted the cheapest premium in the game. The Halt is authored
   * at difficulty 1 and pays nothing extra; anything harder has to pay more than the misc board.
   */
  it('prices a Terminus board off its own difficulty', async () => {
    const { app, repos, baseId, token } = await makeStack();
    takeOnePlotIn(repos, baseId, 'bonded-row');

    const read = await boardOf(app, token, TERMINUS_CITY_ID);
    const areas = read.json<MissionsResponse>().areas;
    const misc = areas.find((area) => area.id === MISC_AREA_ID);
    const bonded = areas.find((area) => area.id === 'bonded-row');
    if (!misc || !bonded) throw new Error(`no Bonded Row board: ${areaIds(areas).join()}`);

    // Bonded Row is difficulty 4 against the misc board's 1, and both carry the same level term.
    expect(bonded.difficulty).toBe(4);
    expect(bonded.payPercent).toBeGreaterThan(misc.payPercent);
  });
});

describe('launching into a second city', () => {
  /** The board and the send button read the same rule, or the screen offers what it cannot post. */
  it('refuses a job in a city the crew holds nothing in', async () => {
    const { app, repos, baseId, token, overseerId } = await makeStack();
    // Take a plot, read the board to find a real job on it, then give the plot back: the card the
    // crew is holding was on the wall and the stake behind it is gone, which is the stale-tab case.
    const locationId = takeOnePlotIn(repos, baseId, 'coldwater-halt');
    const read = await boardOf(app, token, TERMINUS_CITY_ID);
    const area = read.json<MissionsResponse>().areas.find((one) => one.id === 'coldwater-halt');
    const offer = area?.offers[0];
    if (!offer) throw new Error('the Halt posted nothing to launch');

    const control = repos.city.control(locationId)!;
    repos.city.put({ ...control, holder: { kind: 'looters' }, garrison: {} });

    const refused = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: {
        templateId: offer.templateId,
        areaId: 'coldwater-halt',
        force: { razors: 1 },
        leaderId: overseerId,
      },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json<{ error: { code: string } }>().error.code).toBe('CITY_SHUT');
  });

  it('sends a crew to a Terminus job when they hold ground there', async () => {
    const { app, repos, baseId, token, overseerId } = await makeStack();
    takeOnePlotIn(repos, baseId, 'coldwater-halt');

    const read = await boardOf(app, token, TERMINUS_CITY_ID);
    const area = read.json<MissionsResponse>().areas.find((one) => one.id === 'coldwater-halt');
    const offer = area?.offers.find((one) => one.kind === 'standard');
    if (!offer) throw new Error('the Halt posted no plain work to launch');

    const launched = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: {
        templateId: offer.templateId,
        areaId: 'coldwater-halt',
        force: { razors: 1 },
        leaderId: overseerId,
      },
    });
    expect(launched.statusCode, launched.body).toBe(200);
    const mission = launched.json<{ mission: { areaId: string; status: string } }>().mission;
    expect(mission.areaId).toBe('coldwater-halt');
    expect(mission.status).toBe('active');
  });
});
