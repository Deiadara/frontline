import {
  CITIES,
  DEFAULT_CITY_ID,
  TERMINUS_CITY_ID,
  homePlots,
  startingEconomy,
  startingProgression,
  startingResearch,
  startingTraining,
  STARTING_RESOURCES,
  type Base,
  type CityHomeOffer,
  type OverseerChoicesResponse,
} from '@frontline/shared';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

/**
 * Choosing where to live (maintainer, 2026-09-24).
 *
 * "If a city is full it will show it but as locked... there are 4 plots, so if there are 4 players
 * already you cannot go. Otherwise it assigns a free plot at random if you choose it."
 *
 * Which cities are on offer is a fact about the world that a browser cannot see, so the server
 * publishes it on `GET /overseer/choices` and re-checks it on `POST /overseer`. Both halves are
 * here, along with the case that only exists because there are two of them: two accounts going for
 * the last plot in the same second.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function makeApp(): Promise<{ app: FastifyInstance; db: AppDatabase }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return { app, db };
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function register(app: FastifyInstance, username: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ token: string }>().token;
}

async function choices(app: FastifyInstance, token: string): Promise<OverseerChoicesResponse> {
  const res = await app.inject({
    method: 'GET',
    url: '/api/overseer/choices',
    headers: auth(token),
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<OverseerChoicesResponse>();
}

/** Takes the first character this account is offered, in the city it names. */
async function take(
  app: FastifyInstance,
  token: string,
  cityId?: string,
): Promise<LightMyRequestResponse> {
  const offer = await choices(app, token);
  const first = offer.choices[0];
  if (!first) throw new Error('fixture: the character pool ran dry');
  return app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: first.presetId, ...(cityId === undefined ? {} : { cityId }) },
  });
}

/** A new crew in `cityId`, and the plot it was given. */
async function settle(app: FastifyInstance, username: string, cityId?: string): Promise<string> {
  const token = await register(app, username);
  const res = await take(app, token, cityId);
  expect(res.statusCode, res.body).toBe(201);
  return res.json<{ base: { districtId: string } }>().base.districtId;
}

const offerFor = (response: OverseerChoicesResponse, cityId: string): CityHomeOffer => {
  const offer = response.cities.find((one) => one.cityId === cityId);
  if (!offer) throw new Error(`the offer says nothing about ${cityId}`);
  return offer;
};

const errorCode = (res: LightMyRequestResponse): string =>
  res.json<{ error: { code: string } }>().error.code;

/** A seeded rival on a plot. */
function plantBot(app: FastifyInstance, districtId: string): void {
  const now = new Date().toISOString();
  const ownerId = randomUUID();
  // A bot is an account like any other: `bases.owner_id` is a foreign key, so the row has to exist.
  app.repos.users.insert({
    id: ownerId,
    username: `rival_${districtId}`,
    passwordHash: 'not-a-login',
    createdAt: now,
  });
  const bot: Base = {
    id: randomUUID(),
    ownerId,
    name: `Squatters of ${districtId}`,
    districtId,
    level: 3,
    isBot: true,
    resources: STARTING_RESOURCES,
    economy: startingEconomy(now),
    progression: startingProgression(),
    research: startingResearch(),
    buildings: [],
    buildQueue: [],
    army: {},
    gateArmy: {},
    musterQueue: [],
    training: startingTraining(now),
    inventory: {},
    fittedUpgrades: [],
    unitLoadouts: {},
    fleet: {},
    commanders: [],
    createdAt: now,
  };
  app.repos.bases.insert(bot);
}

describe('the cities a new player is offered', () => {
  it('marks a city with no map behind it as unavailable', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'newcomer');
    const offer = await choices(app, token);

    expect(offer.cities.map((one) => one.cityId)).toEqual(CITIES.map((city) => city.id));
    for (const city of CITIES.filter((one) => !one.open)) {
      const shut = offerFor(offer, city.id);
      expect(shut.available, city.id).toBe(false);
      expect(shut.refusal, city.id).toBe('unbuilt');
    }
    // And the two with a map are on offer, or the half above proves nothing.
    expect(offerFor(offer, DEFAULT_CITY_ID).available).toBe(true);
    expect(offerFor(offer, TERMINUS_CITY_ID).available).toBe(true);
  });

  it('reads full at four resident crews and not at three', async () => {
    const { app } = await makeApp();
    const plots = homePlots(TERMINUS_CITY_ID);

    for (let at = 0; at < 3; at += 1) await settle(app, `settler_${at}`, TERMINUS_CITY_ID);
    const watching = await register(app, 'watcher');
    const three = offerFor(await choices(app, watching), TERMINUS_CITY_ID);
    expect(three.available).toBe(true);
    expect(three.free).toBe(1);
    expect(three.plots).toBe(plots.length);

    await settle(app, 'settler_3', TERMINUS_CITY_ID);
    const four = offerFor(await choices(app, watching), TERMINUS_CITY_ID);
    expect(four.available).toBe(false);
    expect(four.refusal).toBe('full');
    expect(four.free).toBe(0);
  });

  /** "There should be no bots seated on players' locations" (maintainer, 2026-09-28). */
  it('never seats a player on a plot a bot lives on', async () => {
    const { app } = await makeApp();
    const [botPlot, ...rest] = homePlots(TERMINUS_CITY_ID);
    plantBot(app, botPlot!);

    const token = await register(app, 'undeterred');
    expect(offerFor(await choices(app, token), TERMINUS_CITY_ID).free).toBe(rest.length);
    // Every free plot drawn, so a draw that ignored the bot lands on it within these three.
    const homes: string[] = [];
    for (let at = 0; at < rest.length; at += 1) {
      homes.push(await settle(app, `settler_${at}`, TERMINUS_CITY_ID));
    }
    expect([...homes].sort()).toEqual([...rest].sort());
    expect(offerFor(await choices(app, token), TERMINUS_CITY_ID).refusal).toBe('full');
  });
});

describe('choosing a city', () => {
  it('puts the crew on a free plot in the city it asked for', async () => {
    const { app } = await makeApp();
    const plots = homePlots(TERMINUS_CITY_ID);

    /*
     * All four, rather than one crew and a look at where it landed.
     *
     * The plot is drawn at random out of whatever is free, so one crew proves only that the draw
     * returns something in the city. Four crews with four distinct plots is the property that
     * actually matters, and it is the one a draw that ignored who already lives there would fail
     * three times in four rather than passing by luck.
     */
    const homes: string[] = [];
    for (let at = 0; at < 4; at += 1) {
      homes.push(await settle(app, `frontier_${at}`, TERMINUS_CITY_ID));
    }
    expect([...homes].sort()).toEqual([...plots].sort());
  });

  it('opens a working game for a crew that started in the second city', async () => {
    const { app } = await makeApp();
    const token = await register(app, 'terminal');
    const res = await take(app, token, TERMINUS_CITY_ID);
    expect(res.statusCode, res.body).toBe(201);

    /*
     * The two reads the game opens on, for a crew living somewhere no account could be created
     * before today. Both are keyed off the crew's own district, so a screen that still meant
     * Ashfall by "the city" would answer with a map forty miles from where the crew is standing
     * rather than by failing, which is the failure worth a test.
     */
    const city = await app.inject({ method: 'GET', url: '/api/city', headers: auth(token) });
    expect(city.statusCode, city.body).toBe(200);
    const drawn = city
      .json<{ districts: { district: { id: string; cityId: string } }[] }>()
      .districts.map((one) => one.district.cityId);
    expect(new Set(drawn)).toEqual(new Set([TERMINUS_CITY_ID]));

    const board = await app.inject({ method: 'GET', url: '/api/missions', headers: auth(token) });
    expect(board.statusCode, board.body).toBe(200);
  });

  it('refuses a full city even when the client asks anyway', async () => {
    const { app } = await makeApp();
    for (let at = 0; at < 4; at += 1) await settle(app, `crowd_${at}`, TERMINUS_CITY_ID);

    const token = await register(app, 'latecomer');
    const res = await take(app, token, TERMINUS_CITY_ID);
    expect(res.statusCode, res.body).toBe(409);
    expect(errorCode(res)).toBe('CITY_FULL');
    // Refused whole: no half-made crew left behind by the refusal.
    expect(app.repos.bases.listSummaries().filter((one) => !one.isBot)).toHaveLength(4);
  });

  it('refuses a city that is only a name', async () => {
    const { app } = await makeApp();
    const shut = CITIES.find((city) => !city.open)!;

    const token = await register(app, 'optimist');
    const res = await take(app, token, shut.id);
    expect(res.statusCode, res.body).toBe(400);
    expect(errorCode(res)).toBe('CITY_UNBUILT');
  });

  it('lets two accounts race for the last plot and seats one of them', async () => {
    const { app } = await makeApp();
    for (let at = 0; at < 3; at += 1) await settle(app, `early_${at}`, TERMINUS_CITY_ID);

    const first = await register(app, 'racer_one');
    const second = await register(app, 'racer_two');
    // Both offers read before either write, which is the state the race is actually about: two
    // screens showing one free plot.
    expect(offerFor(await choices(app, first), TERMINUS_CITY_ID).free).toBe(1);
    expect(offerFor(await choices(app, second), TERMINUS_CITY_ID).free).toBe(1);

    const results = await Promise.all([
      take(app, first, TERMINUS_CITY_ID),
      take(app, second, TERMINUS_CITY_ID),
    ]);
    const codes = results.map((res) => res.statusCode).sort();
    expect(codes, results.map((res) => res.body).join('\n')).toEqual([201, 409]);
    expect(errorCode(results.find((res) => res.statusCode === 409)!)).toBe('CITY_FULL');

    const players = app.repos.bases.listSummaries().filter((one) => !one.isBot);
    expect(players, 'the loser is not seated anywhere').toHaveLength(4);
    expect(new Set(players.map((one) => one.districtId)).size).toBe(4);
  });
});
