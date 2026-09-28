import { DEFAULT_CITY_ID, type BarResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { roomProfileOf } from '../city/stakes.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { openDoors } from '../testing/doors.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { barRoster, findBarRecruit, recruitId } from './roster.js';

/**
 * One room a day (maintainer, 2026-09-28).
 *
 * The seats read the city's crews, and a crew that levelled at noon used to re-roll every chair in
 * the room: the person a player bid on in the morning was not on the card by the evening, and the
 * close could sign somebody nobody had seen. The first read freezes the day's profile
 * (`barRoomOf`), and the read, the bid routes and the close all rebuild the room from it.
 */

/** Midday in Athens. */
const NOW = new Date('2026-08-13T09:00:00.000Z');
/** Half past midnight in Athens: the next game day, and yesterday's tables are due. */
const AFTER = new Date('2026-08-13T21:30:00.000Z');

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
  vi.setSystemTime(NOW);
});

async function makeApp(): Promise<FastifyInstance> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return app;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function makePlayer(app: FastifyInstance, username: string) {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  expect(registered.statusCode).toBe(201);
  const { token } = registered.json<{ token: string }>();
  const overseer = await chooseOverseer(app, token);
  expect(overseer.statusCode).toBe(201);
  openDoors(app, token, 'bar');
  pinOverseer(app, token);
  return { token, baseId: overseer.json<{ base: { id: string } }>().base.id };
}

async function readBar(app: FastifyInstance, token: string): Promise<BarResponse> {
  const res = await app.inject({ method: 'GET', url: '/api/bar', headers: auth(token) });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<BarResponse>();
}

/** The crew as a finished city's would be: level ninety, ten rungs bought. */
function growUp(app: FastifyInstance, baseId: string): void {
  const base = app.repos.bases.findById(baseId);
  if (!base) throw new Error('no base');
  app.repos.bases.updateProgression(baseId, 90, base.progression);
  app.repos.bases.updateEconomy(baseId, { ...base.economy, notoriety: 10 });
}

const sheets = (bar: BarResponse) => bar.recruits.map((recruit) => recruit.attributes);

describe('the day’s room', () => {
  it('holds still when a crew levels mid-day, and follows it the next day', async () => {
    const app = await makeApp();
    const one = await makePlayer(app, 'frozen_reader');

    const morning = await readBar(app, one.token);
    const frozen = app.repos.bar.room(morning.day, DEFAULT_CITY_ID);
    expect(frozen, 'the first read froze nothing').not.toBeNull();

    growUp(app, one.baseId);
    // The positive control: the city itself really did move under the room.
    expect(roomProfileOf(app.repos, DEFAULT_CITY_ID)).not.toEqual(frozen);

    const noon = await readBar(app, one.token);
    expect(sheets(noon)).toEqual(sheets(morning));
    expect(app.repos.bar.room(morning.day, DEFAULT_CITY_ID)).toEqual(frozen);

    vi.setSystemTime(AFTER);
    const tomorrow = await readBar(app, one.token);
    const live = roomProfileOf(app.repos, DEFAULT_CITY_ID);
    expect(app.repos.bar.room(tomorrow.day, DEFAULT_CITY_ID)).toEqual(live);
    const poured = barRoster(tomorrow.day, tomorrow.recruits.length, live);
    expect(sheets(tomorrow)).toEqual(poured.map((recruit) => recruit.attributes));
  });

  /**
   * The close rebuilds the table's person from the frozen room, so the officer signed at midnight
   * is the sheet that was on the card, however the city moved after the bid.
   */
  it('signs the person that was bid on, after the city moved', async () => {
    const app = await makeApp();
    const one = await makePlayer(app, 'frozen_bidder');

    const bar = await readBar(app, one.token);
    // An average seat inside the open floor: the chair the city's middle decides.
    const id = recruitId(bar.day, 1);
    const card = bar.recruits.find((recruit) => recruit.id === id);
    const table = bar.auctions.find((auction) => auction.recruitId === id);
    if (!card || !table) throw new Error('fixture: seat 1 is not on the card');
    expect(card.assessment.interested, 'fixture: seat 1 will not talk to a new crew').toBe(true);

    const placed = await app.inject({
      method: 'POST',
      url: '/api/bar/bid',
      headers: auth(one.token),
      payload: { recruitId: id, amount: table.reserve },
    });
    expect(placed.statusCode, placed.body).toBe(200);

    growUp(app, one.baseId);
    // The positive control: rebuilt off the live city, seat 1 is somebody else.
    const live = findBarRecruit(
      bar.day,
      id,
      bar.recruits.length,
      roomProfileOf(app.repos, DEFAULT_CITY_ID),
    );
    expect(live?.attributes).not.toEqual(card.attributes);

    vi.setSystemTime(AFTER);
    const after = await readBar(app, one.token);
    const signed = after.officers.find((officer) => officer.commander.name === card.name);
    expect(signed, 'the won officer should be on the books').toBeDefined();
    expect(signed?.commander.attributes).toEqual(card.attributes);
  });
});
