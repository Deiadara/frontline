import {
  MISC_AREA_ID,
  TERMINUS_CITY_ID,
  cityOf,
  districtsOfCity,
  findDistrict,
  missionBoardKey,
  missionDealer,
  missionOffers,
  missionWalkMinutes,
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
import { resolveDueMissions } from './resolve.js';

/**
 * The board belongs to the crew's **home** city and nowhere else (maintainer, 2026-10-07).
 *
 * "You can only do missions in your starting city and only in districts that you or your faction
 * control entirely." It reversed 2026-09-24, under which the board followed the access model the
 * Bar and the market run on, so a crew with one plot in Terminus read Terminus boards and could
 * work them. Ground in a second city is ground to walk to and fight over now; nobody there hires.
 *
 * Both halves are walked here, over HTTP, because the read and the launch check them separately
 * and a pair that disagrees is a screen that offers work the send button refuses.
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
  repos.bases.updateArmy(base.id, { razors: 20 }, base.musterQueue);
  return { app, repos, baseId: base.id, token, overseerId };
}

/** Hands this crew every plot in a district, which is what opens its board. */
function takeDistrict(repos: Repositories, baseId: string, districtId: string): void {
  const district = findDistrict(districtId);
  if (!district || district.locations.length === 0) {
    throw new Error(`${districtId} has nothing in it to take`);
  }
  for (const location of district.locations) {
    const control = repos.city.control(location.id);
    if (!control) throw new Error(`no control row for ${location.id}`);
    repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });
  }
}

const boardOf = async (app: FastifyInstance, token: string, city?: string) =>
  app.inject({
    method: 'GET',
    url: city === undefined ? '/api/missions' : `/api/missions?city=${city}`,
    headers: auth(token),
  });

const areaIds = (areas: MissionArea[]): string[] => areas.map((area) => area.id);

describe('which city the board is drawn from', () => {
  it("answers the crew's own city, and says which it is", async () => {
    const { app, token } = await makeStack();
    const read = await boardOf(app, token);
    expect(read.statusCode).toBe(200);

    const board = read.json<MissionsResponse>();
    expect(board.cityId).toBe('ashfall');
    expect(areaIds(board.areas)[0]).toBe(MISC_AREA_ID);
    expect(areaIds(board.areas).some((id) => cityOf(id) === TERMINUS_CITY_ID)).toBe(false);
  });

  /**
   * A `?city=` is answered with the home board rather than refused (2026-10-07).
   *
   * There is one board set in the game for a given crew now, so a request naming another city is
   * asking for something that does not exist. Answering with the board that does, and saying which
   * it is, leaves a tab left open on an older build working rather than broken.
   */
  it('ignores a city on the request, however much ground is held there', async () => {
    const { app, repos, baseId, token } = await makeStack();
    takeDistrict(repos, baseId, 'coldwater-halt');

    const read = await boardOf(app, token, TERMINUS_CITY_ID);
    expect(read.statusCode, read.body.slice(0, 200)).toBe(200);
    const board = read.json<MissionsResponse>();
    expect(board.cityId).toBe('ashfall');
    expect(areaIds(board.areas)).not.toContain('coldwater-halt');
    expect(
      areaIds(board.areas).every((id) => id === MISC_AREA_ID || cityOf(id) === 'ashfall'),
    ).toBe(true);
  });

  it('opens a home district on the last plot taken in it, and only then', async () => {
    const { app, repos, baseId, token } = await makeStack();
    const district = findDistrict('chrome-row');
    if (!district) throw new Error('fixture: no Chrome Row');

    const control = repos.city.control(district.locations[0]!.id)!;
    repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });
    expect(areaIds((await boardOf(app, token)).json<MissionsResponse>().areas)).toEqual([
      MISC_AREA_ID,
    ]);

    takeDistrict(repos, baseId, district.id);
    expect(areaIds((await boardOf(app, token)).json<MissionsResponse>().areas)).toContain(
      district.id,
    );
  });
});

describe('launching', () => {
  /** The board and the send button read the same rule, or the screen offers what it cannot post. */
  it('refuses a job in a home district the crew does not hold whole', async () => {
    const { app, repos, baseId, token, overseerId } = await makeStack();
    // Take it, read a real card off its board, then give one plot back: the card the crew is
    // holding was on the wall and the ground behind it is gone, which is the stale-tab case.
    takeDistrict(repos, baseId, 'chrome-row');
    const read = await boardOf(app, token);
    const area = read.json<MissionsResponse>().areas.find((one) => one.id === 'chrome-row');
    const offer = area?.offers[0];
    if (!offer) throw new Error('Chrome Row posted nothing to launch');

    const plot = findDistrict('chrome-row')!.locations[0]!.id;
    const control = repos.city.control(plot)!;
    repos.city.put({ ...control, holder: { kind: 'looters' }, garrison: {} });

    const refused = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: {
        templateId: offer.templateId,
        areaId: 'chrome-row',
        boardKey: offer.boardKey,
        grade: offer.grade,
        force: { razors: 1 },
        leaderId: overseerId,
      },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { code: string; message: string } }>().error).toEqual({
      code: 'MISSION_REFUSED',
      message:
        'Nobody there hires a crew that does not hold the district. Take the rest of it first',
    });
  });

  /**
   * The city door, said separately from the whole-district one.
   *
   * A crew holding every plot of a Terminus district passes the whole-district test and must still
   * be refused, which is exactly the request a tab open on yesterday's build would post.
   */
  it('refuses a job in another city, held whole or not', async () => {
    const { app, repos, baseId, token, overseerId } = await makeStack();
    takeDistrict(repos, baseId, 'coldwater-halt');
    expect(TERMINUS.some((one) => one.id === 'coldwater-halt')).toBe(true);
    // The card the Halt's board would deal today, worked out rather than read: the board is not on
    // the screen any more, and a made-up card is refused as a card before the city is looked at.
    const now = new Date();
    const boardKey = missionBoardKey('coldwater-halt', now);
    const card = missionOffers(
      'coldwater-halt',
      boardKey,
      1,
      missionDealer(repos.bases.findById(baseId)!),
    )[0];
    if (!card) throw new Error('the Halt deals nothing today');

    const refused = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: {
        templateId: card.template.id,
        areaId: 'coldwater-halt',
        boardKey,
        grade: card.grade,
        force: { razors: 1 },
        leaderId: overseerId,
      },
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { message: string } }>().error.message).toBe(
      'Nobody out there is hiring. Work is offered in your own city',
    );
  });

  it('sends a crew to a home district it holds whole', async () => {
    const { app, repos, baseId, token, overseerId } = await makeStack();
    takeDistrict(repos, baseId, 'chrome-row');

    const read = await boardOf(app, token);
    const area = read.json<MissionsResponse>().areas.find((one) => one.id === 'chrome-row');
    const offer = area?.offers.find((one) => one.kind === 'standard');
    if (!offer) throw new Error('Chrome Row posted no plain work to launch');

    const launched = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: {
        templateId: offer.templateId,
        areaId: 'chrome-row',
        boardKey: offer.boardKey,
        grade: offer.grade,
        force: { razors: 1 },
        leaderId: overseerId,
      },
    });
    expect(launched.statusCode, launched.body).toBe(200);
    const mission = launched.json<{ mission: { areaId: string; status: string } }>().mission;
    expect(mission.areaId).toBe('chrome-row');
    expect(mission.status).toBe('active');
  });

  /**
   * A run outlives the board it came off (maintainer's rule, read the obvious way).
   *
   * A district can fall while a crew is out in it, and the board closes on the next read. The run
   * must still settle and still come home: it is already out there, and a party that vanished with
   * its board would be the quietest bug on this screen.
   */
  it('brings a crew home from a board that closed while they were out', async () => {
    const { app, repos, baseId, token, overseerId } = await makeStack('dispossessed');
    takeDistrict(repos, baseId, 'chrome-row');
    const read = await boardOf(app, token);
    const offer = read
      .json<MissionsResponse>()
      .areas.find((one) => one.id === 'chrome-row')
      ?.offers.find((one) => one.kind === 'standard');
    if (!offer) throw new Error('Chrome Row posted no plain work to launch');

    const launched = await app.inject({
      method: 'POST',
      url: '/api/missions',
      headers: auth(token),
      payload: {
        templateId: offer.templateId,
        areaId: 'chrome-row',
        boardKey: offer.boardKey,
        grade: offer.grade,
        force: { razors: 3 },
        leaderId: overseerId,
      },
    });
    expect(launched.statusCode, launched.body).toBe(200);
    const missionId = launched.json<{ mission: { id: string } }>().mission.id;

    // The district falls while they are out there.
    const plot = findDistrict('chrome-row')!.locations[0]!.id;
    const control = repos.city.control(plot)!;
    repos.city.put({ ...control, holder: { kind: 'looters' }, garrison: {} });

    const after = await boardOf(app, token);
    const board = after.json<MissionsResponse>();
    // The board is gone from the screen and the run is still on it, with its crew still out.
    expect(areaIds(board.areas)).not.toContain('chrome-row');
    expect(board.missions.find((one) => one.id === missionId)?.status).toBe('active');

    // ...and they walk back in when the clock runs out.
    const stored = repos.missions.findById(missionId);
    if (!stored) throw new Error('the run went missing');
    const later = new Date(Date.parse(stored.mission.startedAt) + 30 * 24 * 60 * 60 * 1000);
    const settled = resolveDueMissions(repos, repos.bases.findById(baseId)!, later);
    expect(settled.resolved.map((one) => one.id)).toEqual([missionId]);
    expect(repos.bases.findById(baseId)?.army).toEqual({ razors: 20 });
  });
});

describe('the road to a job', () => {
  /**
   * Every board a crew can read is in its own city, so the cross-city leg is never charged.
   *
   * `missionWalkMinutes` is still the one function that answers it, and still answers the crossing
   * for a pair of districts in different cities: what changed is that no board offers such a pair
   * any more. Left in place rather than deleted, because the rule it encodes is a fact about the
   * map and the next ruling that opens a second city's boards will want it.
   */
  it('adds nothing to a job on any board the crew can read', async () => {
    const { app, token, repos, baseId } = await makeStack('homebody');
    takeDistrict(repos, baseId, 'chrome-row');
    const home = repos.bases.findById(baseId)!.districtId;
    expect(missionWalkMinutes(home, MISC_AREA_ID)).toBe(0);
    for (const area of (await boardOf(app, token)).json<MissionsResponse>().areas) {
      expect(missionWalkMinutes(home, area.id), area.id).toBe(0);
    }
  });
});
