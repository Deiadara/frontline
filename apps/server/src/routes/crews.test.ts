import {
  BOT_DISTRICT_ID,
  CITY_DISTRICTS,
  type CrewProfileResponse,
  type DistrictDetailResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { seedMvpWorld } from '../seed/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';

/**
 * A crew's file (maintainer request, 2026-09-11): one public page for you and for everybody else.
 *
 * What these pin is the line between public and owner-only, and the fog. The page is built from
 * things the city already says, so the assertions are about what it must *not* carry (a sheet, a
 * stockpile, a hold behind the reader's fog) as much as about what it does.
 */

const PASSWORD = 'hunter2pass';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app: open, db } of instances.splice(0)) {
    await open.close();
    db.close();
  }
});

async function makeApp(): Promise<FastifyInstance> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const built = await buildApp({ config, db, logger: false });
  instances.push({ app: built, db });
  return built;
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function player(app: FastifyInstance, username: string, presetId = 'enforcer') {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: PASSWORD },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  /*
   * The character is pinned after the pick rather than asked for in the payload.
   *
   * §F6 offers an account four of thirty and nobody can name one, but this file reads an
   * Overseer's archetype off a crew file and reads holdings through fog, and two of the thirty
   * signatures move exactly that: +2 districts of vision decides what the fogged case can see.
   */
  pinOverseer(app, token, presetId);
  const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
  const body = me.json<{ user: { id: string }; base: { id: string; name: string } }>();
  return { token, username, userId: body.user.id, baseId: body.base.id, crewName: body.base.name };
}

const file = async (app: FastifyInstance, token: string, id: string) =>
  app.inject({ method: 'GET', url: `/api/crews/${id}`, headers: auth(token) });

/** Hands `baseId` one location in `districtId`, as a capture would leave it. */
function hand(app: FastifyInstance, baseId: string, districtId: string): string {
  const district = CITY_DISTRICTS.find((entry) => entry.id === districtId);
  const location = district?.locations[0];
  if (!location) throw new Error(`fixture error: ${districtId} has nothing to hold`);
  const control = app.repos.city.control(location.id);
  if (!control) throw new Error(`fixture error: ${location.id} has no control row`);
  app.repos.city.put({ ...control, holder: { kind: 'crew', baseId }, garrison: {} });
  return location.id;
}

let app: FastifyInstance;
beforeEach(async () => {
  app = await makeApp();
});

describe('GET /crews/:id', () => {
  it('is the same file whoever reads it, with a flag saying whose it is', async () => {
    const me = await player(app, 'reader', 'fixer');
    const them = await player(app, 'rival', 'netrunner');

    const mine = await file(app, me.token, me.baseId);
    expect(mine.statusCode).toBe(200);
    const own = mine.json<CrewProfileResponse>();
    expect(own.isYou).toBe(true);
    expect(own.crew.name).toBe(me.crewName);
    expect(own.player.name).toBe('reader');
    expect(own.overseer?.archetype).toBe('fixer');

    const theirs = await file(app, me.token, them.baseId);
    const other = theirs.json<CrewProfileResponse>();
    expect(other.isYou).toBe(false);
    expect(other.player.name).toBe('rival');
    expect(other.overseer?.archetype).toBe('netrunner');
    // The two files carry the same keys: nothing is on your own page that is off theirs.
    expect(Object.keys(other).sort()).toEqual(Object.keys(own).sort());
  });

  it('answers to the owner as well as to the crew, since the standings link by player', async () => {
    const me = await player(app, 'reader');
    const them = await player(app, 'rival');
    const byCrew = (await file(app, me.token, them.baseId)).json<CrewProfileResponse>();
    const byOwner = (await file(app, me.token, them.userId)).json<CrewProfileResponse>();
    expect(byOwner.crew.id).toBe(byCrew.crew.id);
    expect(byOwner.player.userId).toBe(them.userId);
  });

  /**
   * §F2: the sheet, the stockpile and the roster are what scouting exists to make hard to read.
   * Asserted on the serialised body rather than on the type, because a projection that spread a
   * `Base` into the response would typecheck against a schema that merely does not *mention* the
   * extra keys.
   */
  it('carries nothing owner-only: no sheet, no stockpile, no roster, no research', async () => {
    const me = await player(app, 'reader');
    const them = await player(app, 'rival');
    const body = (await file(app, me.token, them.baseId)).body;
    for (const secret of [
      'attributes',
      'resources',
      'commanders',
      'research',
      'inventory',
      'army',
      'economy',
      'progression',
    ]) {
      expect(body, `${secret} is on the wire`).not.toContain(`"${secret}"`);
    }
  });

  it('lists what they hold only on ground the reader has walked, and counts the rest', async () => {
    const me = await player(app, 'reader');
    const them = await player(app, 'rival');
    const reader = app.repos.bases.findByOwnerId(me.userId);
    if (!reader) throw new Error('fixture error: the reader has no base');

    // Somewhere the reader cannot see into yet. Chosen from the fog rather than hard-coded, since
    // which ground a new crew starts with open is decided by the map's geography.
    const seen = app.repos.city.visibleDistricts(reader.id);
    const dark = CITY_DISTRICTS.find(
      (district) => district.kind === 'contested' && !seen.has(district.id),
    );
    if (!dark) throw new Error('fixture error: the reader can already see the whole city');
    const locationId = hand(app, them.baseId, dark.id);

    const fogged = (await file(app, me.token, them.baseId)).json<CrewProfileResponse>();
    expect(fogged.holdings.map((hold) => hold.locationId)).not.toContain(locationId);
    expect(fogged.hiddenHoldings).toBe(1);

    app.repos.city.markScouted(reader.id, dark.id, new Date().toISOString());
    const walked = (await file(app, me.token, them.baseId)).json<CrewProfileResponse>();
    expect(walked.holdings.map((hold) => hold.locationId)).toContain(locationId);
    expect(walked.hiddenHoldings).toBe(0);
    const hold = walked.holdings.find((entry) => entry.locationId === locationId);
    expect(hold?.districtName).toBe(dark.name);
  });

  /**
   * The fog covers their street and their whole districts too, not only the location rows.
   *
   * Both came out unfogged at first, and the review that caught it was right about why it
   * matters: the district screen only ever shows what is standing on a plot once it is scouted,
   * and a Gate level is a §B7 counter-intel figure. `hiddenHoldings` says "there is more" without
   * saying where, and a whole district named under "held end to end" said where.
   */
  it('keeps their street and their whole districts behind the fog as well', async () => {
    /*
     * The seeded neighbour rather than a second registered player: every new crew is planted on
     * the same starter plot, so a registered rival lives on the reader's own street, which is
     * always in sight. The house crew lives on its own ground, and the admin fog makes that
     * definitely dark, which is the case under test.
     *
     * Seeded *before* the reader registers, and that order is load-bearing. The house crews hold
     * `fixer`, `enforcer` and `technocrat` (`seed/constants.ts`), §F6 makes a character one
     * account's for the whole world, and `seedStep` reads the unique-index failure that follows
     * from a player having taken one as "already seeded" and leaves the neighbour out of the
     * world. Registering first made this case fail on a missing rival about one run in five.
     */
    await seedMvpWorld({ db: app.db, repos: app.repos });
    const me = await player(app, 'reader');
    const reader = app.repos.bases.findByOwnerId(me.userId);
    if (!reader) throw new Error('fixture error: the reader has no base');
    const rival = app.repos.bases.findBotByDistrictId(BOT_DISTRICT_ID);
    if (!rival) throw new Error('fixture error: the seeded neighbour is missing');
    expect(rival.districtId).not.toBe(reader.districtId);
    app.repos.city.setAdminFog(reader.id, rival.districtId, true);
    const seen = app.repos.city.visibleDistricts(reader.id);
    const dark = CITY_DISTRICTS.find(
      (district) => district.kind === 'contested' && !seen.has(district.id),
    );
    if (!dark) throw new Error('fixture error: the reader can already see the whole city');
    for (const location of dark.locations) {
      const control = app.repos.city.control(location.id);
      if (!control) throw new Error(`fixture error: ${location.id} has no control row`);
      app.repos.city.put({ ...control, holder: { kind: 'crew', baseId: rival.id }, garrison: {} });
    }

    const fogged = (await file(app, me.token, rival.id)).json<CrewProfileResponse>();
    expect(fogged.home.seen).toBe(false);
    expect(fogged.home.buildings).toEqual([]);
    expect(fogged.districtsHeldWhole).toEqual([]);
    expect(fogged.hiddenHoldings).toBe(dark.locations.length);
    expect(JSON.stringify(fogged)).not.toContain(dark.name);

    app.repos.city.setAdminFog(reader.id, rival.districtId, false);
    app.repos.city.markScouted(reader.id, rival.districtId, new Date().toISOString());
    app.repos.city.markScouted(reader.id, dark.id, new Date().toISOString());
    const walked = (await file(app, me.token, rival.id)).json<CrewProfileResponse>();
    expect(walked.home.seen).toBe(true);
    expect(walked.home.buildings.length).toBeGreaterThan(0);
    expect(walked.districtsHeldWhole.map((district) => district.districtId)).toEqual([dark.id]);
    expect(walked.hiddenHoldings).toBe(0);
  });

  it('quotes the rank the standings would give them', async () => {
    const me = await player(app, 'reader');
    const them = await player(app, 'rival');
    const board = await app.inject({
      method: 'GET',
      url: '/api/leaderboard?board=players',
      headers: auth(me.token),
    });
    const row = board
      .json<{ entries: { userId: string; rank: number }[] }>()
      .entries.find((entry) => entry.userId === them.userId);
    expect(row).toBeDefined();
    const theirs = (await file(app, me.token, them.baseId)).json<CrewProfileResponse>();
    expect(theirs.standing.rank).toBe(row?.rank);
  });

  it('refuses an id that is nobody', async () => {
    const me = await player(app, 'reader');
    const missing = await file(app, me.token, 'nobody-at-all');
    expect(missing.statusCode).toBe(404);
  });
});

describe('who holds a location, on the district read', () => {
  it('names the player behind a crew, and nobody behind the looters', async () => {
    const me = await player(app, 'reader');
    const them = await player(app, 'rival');
    const reader = app.repos.bases.findByOwnerId(me.userId);
    if (!reader) throw new Error('fixture error: the reader has no base');
    const seen = app.repos.city.visibleDistricts(reader.id);
    const open = CITY_DISTRICTS.find(
      (district) => district.kind === 'contested' && seen.has(district.id),
    );
    if (!open) throw new Error('fixture error: the reader starts with no ground open');
    const locationId = hand(app, them.baseId, open.id);

    const detail = (
      await app.inject({ method: 'GET', url: `/api/city/${open.id}`, headers: auth(me.token) })
    ).json<DistrictDetailResponse>();
    const theirs = detail.locations.find((view) => view.location.id === locationId);
    expect(theirs?.holder).toEqual({ kind: 'crew', baseId: them.baseId });
    expect(theirs?.holderName).toBe(them.crewName);
    expect(theirs?.holderPlayer).toBe('rival');

    const looted = detail.locations.find((view) => view.holder.kind === 'looters');
    expect(looted, 'the fixture ground has no looters on it').toBeDefined();
    expect(looted?.holderPlayer).toBeNull();
  });
});
