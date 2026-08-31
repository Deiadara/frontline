import {
  makeAttributes,
  createCommander,
  CITY_DISTRICTS,
  STARTING_RESOURCES,
  STARTER_DISTRICT_ID,
  startingEconomy,
  startingProgression,
  startingResearch,
  type CityResponse,
  type DistrictDetailResponse,
  type SkirmishEngine,
  startingTraining,
  BOT_DISTRICT_ID,
  BUILDING_KINDS,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { settleScouting } from '../scouting/scouting.js';

type InjectResponse = Awaited<ReturnType<FastifyInstance['inject']>>;

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function makeApp(
  skirmishEngine?: SkirmishEngine,
): Promise<{ app: FastifyInstance; db: AppDatabase }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = skirmishEngine
    ? await buildApp({ config, db, skirmishEngine, logger: false })
    : await buildApp({ config, db, logger: false });
  const handle = { app, db };
  instances.push(handle);
  return handle;
}

const PASSWORD = 'hunter2pass';

function errorCode(res: InjectResponse): string {
  return res.json<{ error: { code: string } }>().error.code;
}

async function register(
  app: FastifyInstance,
  username: string,
  password = PASSWORD,
): Promise<{ token: string; userId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json<{ token: string; user: { id: string } }>();
  return { token: body.token, userId: body.user.id };
}

function auth(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

async function chooseOverseer(
  app: FastifyInstance,
  token: string,
  presetId = 'enforcer',
): Promise<{ baseId: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId },
  });
  expect(res.statusCode).toBe(201);
  return { baseId: res.json<{ base: { id: string } }>().base.id };
}

describe('auth', () => {
  it('registers a user and logs back in (round-trip)', async () => {
    const { app } = await makeApp();

    const reg = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'commander', password: PASSWORD },
    });
    expect(reg.statusCode).toBe(201);
    const regBody = reg.json<{ token: string; user: Record<string, unknown> }>();
    expect(regBody.token).toBeTruthy();
    expect(regBody.user).toMatchObject({ username: 'commander', overseerId: null });
    expect(regBody.user).not.toHaveProperty('passwordHash');
    expect(regBody.user).not.toHaveProperty('password');

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'commander', password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json<{ token: string }>().token).toBeTruthy();
  });

  it('rejects a duplicate username case-insensitively with 409', async () => {
    const { app } = await makeApp();
    await register(app, 'Commander');

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'commander', password: PASSWORD },
    });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('USERNAME_TAKEN');
  });

  it('rejects an invalid body with 400 VALIDATION_ERROR', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'ok', password: 'short' },
    });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe('VALIDATION_ERROR');
  });

  it('maps a malformed or empty JSON body to 400, not 500', async () => {
    const { app } = await makeApp();
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: '{"username":"ok", broken',
    });
    const empty = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      headers: { 'content-type': 'application/json' },
      payload: '',
    });
    for (const res of [malformed, empty]) {
      expect(res.statusCode).toBe(400);
      expect(errorCode(res)).toBe('VALIDATION_ERROR');
    }
  });

  it('never 500s when the same username is registered concurrently', async () => {
    const { app } = await makeApp();
    const payload = { username: 'racer', password: PASSWORD };
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        app.inject({ method: 'POST', url: '/api/auth/register', payload }),
      ),
    );
    const statuses = results.map((r) => r.statusCode).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(3);
    expect(statuses).not.toContain(500);
  });

  it('rejects a wrong password and an unknown user identically with 401', async () => {
    const { app } = await makeApp();
    await register(app, 'commander');

    const wrongPw = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'commander', password: 'wrongpassword' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'nobody', password: PASSWORD },
    });

    for (const res of [wrongPw, unknown]) {
      expect(res.statusCode).toBe(401);
      expect(errorCode(res)).toBe('INVALID_CREDENTIALS');
    }
  });
});

describe('authentication guard', () => {
  it('rejects requests with a missing token', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
    expect(errorCode(res)).toBe('UNAUTHORIZED');
  });

  it('rejects requests with an invalid token', async () => {
    const { app } = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: auth('not-a-real-jwt'),
    });
    expect(res.statusCode).toBe(401);
    expect(errorCode(res)).toBe('UNAUTHORIZED');
  });
});

describe('GET /api/me', () => {
  it('returns null overseer/base before an overseer is chosen', async () => {
    const { app } = await makeApp();
    const { token } = await register(app, 'commander');

    const res = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ user: { username: string }; overseer: unknown; base: unknown }>();
    expect(body.user.username).toBe('commander');
    expect(body.overseer).toBeNull();
    expect(body.base).toBeNull();
  });

  it('returns the overseer and base after creation', async () => {
    const { app } = await makeApp();
    const { token } = await register(app, 'commander');
    await chooseOverseer(app, token);

    const res = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    const body = res.json<{
      user: { overseerId: string | null };
      overseer: { archetype: string } | null;
      base: { name: string } | null;
    }>();
    expect(body.user.overseerId).toBeTruthy();
    expect(body.overseer?.archetype).toBe('enforcer');
    expect(body.base?.name).toBe("commander's Crew");
  });
});

describe('POST /api/overseer', () => {
  it('creates an overseer and starting base', async () => {
    const { app } = await makeApp();
    const { token, userId } = await register(app, 'commander');

    const res = await app.inject({
      method: 'POST',
      url: '/api/overseer',
      headers: auth(token),
      payload: { presetId: 'netrunner' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json<{
      user: { overseerId: string | null };
      overseer: { archetype: string; attributes: Record<string, number> };
      base: {
        ownerId: string;
        districtId: string;
        level: number;
        resources: typeof STARTING_RESOURCES;
        buildings: { kind: string; level: number }[];
      };
    }>();
    expect(body.overseer.archetype).toBe('netrunner');
    expect(body.user.overseerId).toBeTruthy();
    expect(body.base.ownerId).toBe(userId);
    // The constant, not the id it currently holds: which plot new crews get is a design decision
    // that has moved once and will again, and this test is about the route honouring it.
    expect(body.base.districtId).toBe(STARTER_DISTRICT_ID);
    expect(body.base.level).toBe(1);
    expect(body.base.resources).toEqual(STARTING_RESOURCES);
    expect(body.base.buildings.map((b) => b.kind)).toEqual(['nexus', 'generator']);
    expect(body.base.buildings.every((b) => b.level === 1)).toBe(true);
  });

  it('rejects a second overseer with 409', async () => {
    const { app } = await makeApp();
    const { token } = await register(app, 'commander');
    await chooseOverseer(app, token);

    const res = await app.inject({
      method: 'POST',
      url: '/api/overseer',
      headers: auth(token),
      payload: { presetId: 'fixer' },
    });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('OVERSEER_ALREADY_CHOSEN');
  });

  it('rejects an unknown preset with 400 UNKNOWN_PRESET', async () => {
    const { app } = await makeApp();
    const { token } = await register(app, 'commander');

    const res = await app.inject({
      method: 'POST',
      url: '/api/overseer',
      headers: auth(token),
      payload: { presetId: 'wizard' },
    });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe('UNKNOWN_PRESET');
  });
});

describe('GET /api/city', () => {
  it('lists districts and base summaries without private fields', async () => {
    const { app } = await makeApp();
    const alice = await register(app, 'alice');
    await chooseOverseer(app, alice.token);
    const bob = await register(app, 'bob');
    await chooseOverseer(app, bob.token);

    const res = await app.inject({ method: 'GET', url: '/api/city', headers: auth(alice.token) });
    expect(res.statusCode).toBe(200);
    const body = res.json<CityResponse>();
    expect(body.districts).toHaveLength(CITY_DISTRICTS.length);

    // A crew on the map is shown as a public summary and nothing more.
    const residents = body.districts.flatMap((entry) => (entry.base ? [entry.base] : []));
    expect(residents.length).toBeGreaterThan(0);
    for (const summary of residents) {
      expect(Object.keys(summary).sort()).toEqual(
        ['districtId', 'id', 'isBot', 'level', 'name', 'ownerId'].sort(),
      );
      expect(summary).not.toHaveProperty('resources');
      expect(summary).not.toHaveProperty('army');
    }
  });

  /**
   * §A4's fog, over the real route.
   *
   * The important half is that unscouted ground reports `null` rather than `0 / 4`: zero is a fact
   * about the world and null is a fact about what this crew knows, and a map that confused the two
   * would be telling a player something they have not earned.
   */
  it('hides what is inside a district until the crew has looked', async () => {
    const { app } = await makeApp();
    const { token, userId } = await register(app, 'scout');
    await chooseOverseer(app, token);

    const before = await app.inject({ method: 'GET', url: '/api/city', headers: auth(token) });
    /*
     * A district this crew has *not* had eyes on.
     *
     * `find(kind === 'contested')` used to be enough, because a new crew had seen nothing at all.
     * A new crew is now given its nearest unoccupied district (`openTheNearestGround`), so the
     * first contested entry on the list is sometimes the one that is already open, and this test
     * would then be asserting fog over ground the game deliberately handed them.
     */
    const contested = before
      .json<CityResponse>()
      .districts.find((entry) => entry.district.kind === 'contested' && !entry.scouted);
    expect(contested, 'a new crew should still have ground it has not seen').toBeDefined();
    expect(contested?.scouted).toBe(false);
    expect(contested?.held).toBeNull();

    const detail = await app.inject({
      method: 'GET',
      url: `/api/city/${contested?.district.id ?? ''}`,
      headers: auth(token),
    });
    expect(detail.json<DistrictDetailResponse>().locations).toEqual([]);

    /*
     * Scouting is a journey now, so the button sends somebody and the ground opens when they are
     * home. The fixture drives the *clock* rather than waiting hours: the run is wound back and
     * the world clock settles it, which also exercises the path a real player's ground opens on.
     */
    /*
     * Somebody to send.
     *
     * A brand-new crew has nobody on the books, and scouting now costs an officer, so the refusal
     * is correct behaviour rather than something to work around: it is the reason a new player is
     * handed one district open (`openTheNearestGround`). This test is about the fog, so it hires
     * past that.
     */
    const own = app.repos.bases.findByOwnerId(userId)!;
    app.repos.bases.updateCommanders(own.id, [
      createCommander('scout-1', 'Wire', 'scout', makeAttributes(30), []),
    ]);

    const sent = await app.inject({
      method: 'POST',
      url: '/api/city/scout',
      headers: auth(token),
      payload: { districtId: contested?.district.id },
    });
    expect(sent.statusCode).toBe(200);

    // Still fogged, because nobody is back yet. This is the half the old instant scout skipped.
    const midway = await app.inject({
      method: 'GET',
      url: `/api/city/${contested?.district.id ?? ''}`,
      headers: auth(token),
    });
    expect(midway.json<DistrictDetailResponse>().scouted).toBe(false);

    app.db
      .prepare('UPDATE scouting_runs SET returns_at = ?')
      .run(new Date(Date.now() - 60_000).toISOString());
    settleScouting(app.repos, new Date());

    const after = await app.inject({
      method: 'GET',
      url: `/api/city/${contested?.district.id ?? ''}`,
      headers: auth(token),
    });
    const seen = after.json<DistrictDetailResponse>();
    expect(seen.scouted).toBe(true);
    expect(seen.locations.length).toBeGreaterThan(0);
    // And a place nobody holds still reports who is standing on it.
    expect(seen.locations[0]?.holderName).toBeTruthy();
    // Somebody else's garrison composition is never on the wire.
    expect(seen.locations[0]?.garrison).toBeNull();
  });

  /**
   * What is standing on a neighbour's ground is public; what they *know* is not.
   *
   * A structure is a building on a street: anyone walking past can see how far it has been built
   * up, so the district view carries it and the client draws their district the same way it draws
   * yours. The line this test exists to hold is where that stops: no stockpile, no research, no
   * roles, and nothing at all until the ground has been scouted.
   */
  it('shows what a neighbour has built, behind the same fog as everything else', async () => {
    const { app } = await makeApp();
    const { token, userId } = await register(app, 'neighbour');
    await chooseOverseer(app, token);

    // A rival placed by hand rather than by the seed: `makeApp` deliberately builds an *unseeded*
    // world, and a test that quietly depended on the MVP seed would be testing the fixture.
    const home = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    const mine = home.json<{ base: { districtId: string } }>().base.districtId;
    const elsewhere = CITY_DISTRICTS.find(
      (district) => district.kind === 'residential' && district.id !== mine,
    );
    expect(elsewhere, 'the city has residential ground other than yours').toBeDefined();
    const districtId = elsewhere?.id ?? '';

    app.repos.users.insert({
      id: 'rival-user',
      username: 'Vex_Test',
      passwordHash: 'x',
      createdAt: new Date().toISOString(),
    });
    app.repos.bases.insert({
      id: 'rival-base',
      ownerId: 'rival-user',
      name: 'Vex Holdings',
      districtId,
      level: 5,
      isBot: true,
      resources: STARTING_RESOURCES,
      economy: startingEconomy(new Date().toISOString()),
      progression: startingProgression(),
      research: startingResearch(),
      buildings: [
        { id: 'r-nexus', kind: 'nexus', level: 5, modifications: [], damage: 0, fortification: 0 },
        { id: 'r-gate', kind: 'gate', level: 3, modifications: [], damage: 0, fortification: 0 },
      ],
      buildQueue: [],
      army: {},
      trainingQueue: [],
      training: startingTraining('2026-08-16T00:00:00.000Z'),
      inventory: {},
      fittedUpgrades: [],
      unitLoadouts: {},
      fleet: {},
      commanders: [],
      createdAt: new Date().toISOString(),
    });

    const unscouted = await app.inject({
      method: 'GET',
      url: `/api/city/${districtId}`,
      headers: auth(token),
    });
    expect(unscouted.json<DistrictDetailResponse>().residentBuildings).toEqual([]);

    // A journey now, not a button. The fixture wants the *state* the journey produces, so it
    // writes the intel directly rather than sending somebody and winding a clock forward.
    app.repos.city.markScouted(
      app.repos.bases.findByOwnerId(userId)!.id,
      districtId,
      new Date().toISOString(),
    );

    const seen = (
      await app.inject({ method: 'GET', url: `/api/city/${districtId}`, headers: auth(token) })
    ).json<DistrictDetailResponse>();
    expect(seen.residentBuildings.length).toBeGreaterThan(0);
    for (const building of seen.residentBuildings) {
      expect(building.level).toBeGreaterThan(0);
    }

    // Their home can never be taken: only robbed. That is what makes the AI a neighbour rather
    // than a target, and it is a property of the ground, not of the UI that draws it.
    expect(seen.district.kind).toBe('residential');

    // And none of what they know comes with it.
    const wire = JSON.stringify(seen);
    // `officers` rather than the `assignees` that used to be here: that key was deleted with the
    // pool, so the guard was checking for a field that could no longer appear under any bug while
    // the roster that replaced it went unchecked. A neighbour's officers are hidden info too.
    for (const secret of ['resources', 'research', 'facts', 'officers', 'army']) {
      expect(wire, secret).not.toContain(`"${secret}"`);
    }
  });

  it('always shows the crew its own district, without scouting it', async () => {
    const { app } = await makeApp();
    const { token } = await register(app, 'homebody');
    await chooseOverseer(app, token);

    const body = (
      await app.inject({ method: 'GET', url: '/api/city', headers: auth(token) })
    ).json<CityResponse>();
    const home = body.districts.find((entry) => entry.isHome);
    expect(home?.scouted).toBe(true);
    expect(home?.district.id).toBe(body.homeDistrictId);
  });
});

describe('GET /api/base/:id', () => {
  it('returns the caller-owned base', async () => {
    const { app } = await makeApp();
    const { token } = await register(app, 'commander');
    const { baseId } = await chooseOverseer(app, token);

    const res = await app.inject({
      method: 'GET',
      url: `/api/base/${baseId}`,
      headers: auth(token),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ base: { id: string } }>().base.id).toBe(baseId);
  });

  it('forbids reading another player base with 403', async () => {
    const { app } = await makeApp();
    const alice = await register(app, 'alice');
    const { baseId } = await chooseOverseer(app, alice.token);
    const bob = await register(app, 'bob');

    const res = await app.inject({
      method: 'GET',
      url: `/api/base/${baseId}`,
      headers: auth(bob.token),
    });
    expect(res.statusCode).toBe(403);
    expect(errorCode(res)).toBe('FORBIDDEN');
  });

  it('returns 404 for an unknown base', async () => {
    const { app } = await makeApp();
    const { token } = await register(app, 'commander');

    const res = await app.inject({
      method: 'GET',
      url: '/api/base/does-not-exist',
      headers: auth(token),
    });
    expect(res.statusCode).toBe(404);
    expect(errorCode(res)).toBe('NOT_FOUND');
  });
});

/*
 * The `POST /api/city/attack` and `POST /api/city/raid` suites were here, and they went with the
 * routes (board, battle rework).
 *
 * Every rule they pinned still exists and is still measured, one layer along: what may be attacked
 * and when is `battle/declare.ts` and its tests, who ends up holding the ground is
 * `battle/resolve.ts`, and the whole loop through the real HTTP surface is `battle/battle.test.ts`.
 * What is gone is the fight that resolved the instant a button was pressed.
 */

describe('routing', () => {
  it('returns a 404 envelope for unknown routes', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(errorCode(res)).toBe('NOT_FOUND');
  });
});

/**
 * An empty plot is still a district.
 *
 * Every residential district is the same ground; three of the four have nobody on them, and the
 * screen for one used to be a single sentence saying so, which is a hole where every other plot
 * has a place. It draws that ground at level 1 instead, which is also exactly what a crew settling
 * there would start from.
 */
describe('a plot nobody lives on draws itself at level 1', () => {
  it('serves a full district at level 1, and no crew', async () => {
    const { app } = await makeApp();
    const mine = await register(app, 'nikos');
    await chooseOverseer(app, mine.token);

    // A plot that is not this crew's own and that nobody has been seeded into.
    const empty = CITY_DISTRICTS.find(
      (district) =>
        district.kind === 'residential' &&
        district.id !== STARTER_DISTRICT_ID &&
        district.id !== BOT_DISTRICT_ID,
    );
    expect(empty, 'the city has an unoccupied plot to look at').toBeDefined();

    // The state, not the journey: see the note on the neighbour test above.
    app.repos.city.markScouted(
      app.repos.bases.findByOwnerId(mine.userId)!.id,
      empty!.id,
      new Date().toISOString(),
    );
    const seen = (
      await app.inject({ method: 'GET', url: `/api/city/${empty!.id}`, headers: auth(mine.token) })
    ).json<DistrictDetailResponse>();

    expect(seen.base, 'nobody lives there').toBeNull();
    expect(seen.residentBuildings.length).toBe(BUILDING_KINDS.length);
    for (const building of seen.residentBuildings) expect(building.level).toBe(1);
    // Stable between reads: the scene positions outlines by id, so a fresh id every poll would
    // make the drawing jump.
    const again = (
      await app.inject({ method: 'GET', url: `/api/city/${empty!.id}`, headers: auth(mine.token) })
    ).json<DistrictDetailResponse>();
    expect(again.residentBuildings.map((b) => b.id)).toEqual(
      seen.residentBuildings.map((b) => b.id),
    );
  });
});

/**
 * One crew, one name, per city.
 *
 * A crew's name is the only thing that identifies it anywhere a player meets one: the tag on the
 * map, both sides of a battle report, a listing on the board. Two crews sharing one does not read
 * as a clash, it reads as the same crew being in two places, and there is no second field a reader
 * could fall back on.
 */
describe('crew names are unique in a city', () => {
  it('refuses a name another crew is already using, whatever the casing', async () => {
    const { app } = await makeApp();
    const mine = await register(app, 'nikos');
    await chooseOverseer(app, mine.token);
    const theirs = await register(app, 'rival');
    await chooseOverseer(app, theirs.token, 'netrunner');

    const claimed = await app.inject({
      method: 'POST',
      url: '/api/base/district-name',
      headers: auth(mine.token),
      payload: { name: 'EterosEgw' },
    });
    expect(claimed.statusCode).toBe(200);

    for (const name of ['EterosEgw', 'eterosegw', '  ETEROSEGW  ']) {
      const clash = await app.inject({
        method: 'POST',
        url: '/api/base/district-name',
        headers: auth(theirs.token),
        payload: { name },
      });
      expect(clash.statusCode, name).toBe(409);
      expect(errorCode(clash), name).toBe('DISTRICT_NAME_TAKEN');
    }
  });

  /** Re-saving your own name unchanged is not a collision, or the field could never be left alone. */
  it('lets a crew keep the name it already has', async () => {
    const { app } = await makeApp();
    const mine = await register(app, 'nikos');
    await chooseOverseer(app, mine.token);
    for (let i = 0; i < 2; i += 1) {
      const saved = await app.inject({
        method: 'POST',
        url: '/api/base/district-name',
        headers: auth(mine.token),
        payload: { name: 'EterosEgw' },
      });
      expect(saved.statusCode).toBe(200);
    }
  });

  /** A crew called `Player District II` is indistinguishable from the plot the map draws. */
  it('refuses the names the map has reserved for the plots', async () => {
    const { app } = await makeApp();
    const mine = await register(app, 'nikos');
    await chooseOverseer(app, mine.token);
    for (const name of ['Player District', 'Player District II', 'player district iii']) {
      const refused = await app.inject({
        method: 'POST',
        url: '/api/base/district-name',
        headers: auth(mine.token),
        payload: { name },
      });
      expect(refused.statusCode, name).toBe(409);
      expect(errorCode(refused), name).toBe('DISTRICT_NAME_TAKEN');
    }
  });

  /**
   * Registration must never fail on a name the player did not choose: the note on
   * `defaultFactionName` calls that an unrecoverable account. It disambiguates instead.
   */
  it('gives a new crew a free name rather than refusing to create it', async () => {
    const { app } = await makeApp();
    const first = await register(app, 'nikos');
    await chooseOverseer(app, first.token);
    const taken = await app.inject({
      method: 'POST',
      url: '/api/base/district-name',
      headers: auth(first.token),
      payload: { name: "rival's Crew" },
    });
    expect(taken.statusCode).toBe(200);

    const second = await register(app, 'rival');
    await chooseOverseer(app, second.token, 'netrunner');
    const me = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: auth(second.token),
    });
    expect(me.statusCode).toBe(200);
    const name = me.json<{ base: { name: string } }>().base.name;
    expect(name).not.toBe("rival's Crew");
    expect(name.length).toBeGreaterThan(0);
  });
});
