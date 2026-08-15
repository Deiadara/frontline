import {
  CITY_DISTRICTS,
  STARTING_RESOURCES,
  findDistrict,
  type AttackPlaceResponse,
  type CityResponse,
  type DistrictDetailResponse,
  type SkirmishEngine,
  skirmishOutcome,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

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
    expect(body.base.districtId).toBe('neon-docks');
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
    const { token } = await register(app, 'scout');
    await chooseOverseer(app, token);

    const before = await app.inject({ method: 'GET', url: '/api/city', headers: auth(token) });
    const contested = before
      .json<CityResponse>()
      .districts.find((entry) => entry.district.kind === 'contested');
    expect(contested?.scouted).toBe(false);
    expect(contested?.held).toBeNull();

    const detail = await app.inject({
      method: 'GET',
      url: `/api/city/${contested?.district.id ?? ''}`,
      headers: auth(token),
    });
    expect(detail.json<DistrictDetailResponse>().places).toEqual([]);

    await app.inject({
      method: 'POST',
      url: '/api/city/scout',
      headers: auth(token),
      payload: { districtId: contested?.district.id },
    });

    const after = await app.inject({
      method: 'GET',
      url: `/api/city/${contested?.district.id ?? ''}`,
      headers: auth(token),
    });
    const seen = after.json<DistrictDetailResponse>();
    expect(seen.scouted).toBe(true);
    expect(seen.places.length).toBeGreaterThan(0);
    // And a place nobody holds still reports who is standing on it.
    expect(seen.places[0]?.holderName).toBeTruthy();
    // Somebody else's garrison composition is never on the wire.
    expect(seen.places[0]?.garrison).toBeNull();
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

describe('POST /api/city/attack (§A4)', () => {
  /** What a fresh crew is issued — see the rationale on `routes/overseer.ts`. */
  const STARTING_RAZORS = 8;

  const raidDistrict = findDistrict('rustyard');
  if (!raidDistrict) throw new Error('fixture error: rustyard district missing');
  const raid = raidDistrict;
  const target = raid.places[0];
  if (!target) throw new Error('fixture error: the Rustyard has no places');

  const alwaysWins: SkirmishEngine = {
    resolve: () => skirmishOutcome({ winner: 'attacker', log: ['taken'] }),
  };
  const alwaysLoses: SkirmishEngine = {
    resolve: () =>
      skirmishOutcome({
        winner: 'defender',
        log: ['broke'],
        fled: { razors: 1 },
        killed: { razors: 3 },
      }),
  };

  async function crew(app: FastifyInstance, name: string): Promise<string> {
    const { token } = await register(app, name);
    await chooseOverseer(app, token);
    await app.inject({
      method: 'POST',
      url: '/api/city/scout',
      headers: auth(token),
      payload: { districtId: raid.id },
    });
    return token;
  }

  /**
   * The real engine, through the real route.
   *
   * Every other test in this block injects a stub, which is right for asserting what the route does
   * with an outcome — and blind to whether the route builds an *input* the engine can use. This is
   * the one that would catch the battlefield being dropped on the way in: the log names the ground,
   * and the ground can only be named if `battlefieldFor` reached the engine with the place's kind
   * and its fortification on it.
   */
  it('fights on the ground the place is actually made of', async () => {
    const { app } = await makeApp();
    const token = await crew(app, 'groundtruth');

    const res = await app.inject({
      method: 'POST',
      url: '/api/city/attack',
      headers: auth(token),
      payload: { placeId: target.id, force: { razors: 4 } },
    });

    expect(res.statusCode).toBe(200);
    const log = res.json<{ result: { log: string[] } }>().result.log.join(' ');

    expect(log).toContain(target.name);
    // The assertion that catches a dropped battlefield: Kessler Press is a scrap press, which
    // fights `urban`. A default `bareBattlefield` would say "in the open" instead, and a route that
    // passed no ground at all would print no such line.
    expect(log).toContain('in built-up ground');
  });

  /**
   * Winning has to cost something.
   *
   * `outcome.winnerLosses` was computed by the engine and read by nobody, so a successful attack
   * returned the *whole* force including its dead — the attrition the engine spends six modules
   * calculating never reached a single army row. A player could take the map with one squad and
   * never rebuild.
   *
   * The crew is armed directly rather than trained up: a new crew has four Razors and every place
   * is now garrisoned, so nothing a fresh account can field reaches the winning branch at all.
   */
  it('does not hand a winning attacker back the people it lost', async () => {
    const { app } = await makeApp();
    const token = await crew(app, 'butcher');

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    const base = me.json<{ base: { id: string; trainingQueue: [] } }>().base;
    // Eight against the press's four looters: measured at 30 wins in 30, and **not one** of two
    // hundred of those wins cost nothing. Bigger is not safer here — twenty wins so easily it can
    // come home whole, which would make this assertion pass against the bug it exists to catch.
    const sent = 8;
    app.repos.bases.updateArmy(base.id, { razors: sent + 10 }, base.trainingQueue);

    const res = await app.inject({
      method: 'POST',
      url: '/api/city/attack',
      headers: auth(token),
      payload: { placeId: target.id, force: { razors: sent } },
    });
    expect(res.statusCode).toBe(200);

    const body = res.json<{
      captured: boolean;
      returned: Record<string, number>;
      base: { army: Record<string, number> };
    }>();

    expect(body.captured, 'eight Razors must take a four-body looter garrison').toBe(true);
    // The place was held by somebody, so taking it cost somebody.
    expect(body.returned.razors ?? 0).toBeLessThan(sent);
    // ...and the books balance: what is at home is what stayed plus what walked back.
    expect(body.base.army.razors ?? 0).toBe(10 + (body.returned.razors ?? 0));
  });

  /**
   * ...and a garrison that turns an assault back pays for it too. Without this a defender could
   * break any number of attacks at no cost at all, which is the same dead wiring in reverse.
   */
  it('takes losses off a garrison that held', async () => {
    const { app } = await makeApp();
    const token = await crew(app, 'holder');

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    const base = me.json<{ base: { id: string; trainingQueue: [] } }>().base;
    // Eight, matching the measurement below — six turns the place back too but often without
    // touching anybody, which is a hold this test cannot tell from the bug.
    app.repos.bases.updateArmy(base.id, { razors: 8 }, base.trainingQueue);

    // The Bonefield, not the Press: it garrisons eight, turns eight Razors back 143 times in 150,
    // and in every one of those holds it lost somebody. The Press garrisons four and is simply
    // taken.
    const held = raid.places[1];
    if (!held) throw new Error('fixture error: the Rustyard has only one place');

    const before = app.repos.city.control(held.id);
    const garrisoned = Object.values(before?.garrison ?? {}).reduce((sum, n) => sum + n, 0);
    expect(garrisoned, 'the place must start with somebody on it').toBeGreaterThan(0);

    const res = await app.inject({
      method: 'POST',
      url: '/api/city/attack',
      headers: auth(token),
      payload: { placeId: held.id, force: { razors: 8 } },
    });
    expect(res.statusCode).toBe(200);

    // Server fights seed from `randomUUID()`, so this is not a deterministic test: six Razors turn
    // back the Bonefield about nineteen times in twenty. Rather than pick a force so small it
    // cannot hurt anybody, both branches assert what is true of them — a hold costs the holder
    // bodies, a capture clears the place. An earlier version demanded a hold and flaked at 5%.
    const captured = res.json<{ captured: boolean }>().captured;
    const after = app.repos.city.control(held.id);
    const left = Object.values(after?.garrison ?? {}).reduce((sum, n) => sum + n, 0);

    if (captured) expect(after?.garrison, 'a taken place is cleared').toEqual({});
    else expect(left, 'the holder held, and paid for it').toBeLessThan(garrisoned);
  });

  it('rejects an attack before the crew has a base', async () => {
    const { app } = await makeApp();
    const { token } = await register(app, 'commander');

    const res = await app.inject({
      method: 'POST',
      url: '/api/city/attack',
      headers: auth(token),
      payload: { placeId: target.id, force: { razors: 1 } },
    });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('NO_BASE');
  });

  it('refuses ground the crew has never looked at', async () => {
    const { app } = await makeApp(alwaysWins);
    const { token } = await register(app, 'blind');
    await chooseOverseer(app, token);

    const res = await app.inject({
      method: 'POST',
      url: '/api/city/attack',
      headers: auth(token),
      payload: { placeId: target.id, force: { razors: 1 } },
    });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('DISTRICT_UNSCOUTED');
  });

  it('refuses an attack with nobody in it', async () => {
    const { app } = await makeApp(alwaysWins);
    const token = await crew(app, 'empty_handed');

    const res = await app.inject({
      method: 'POST',
      url: '/api/city/attack',
      headers: auth(token),
      payload: { placeId: target.id, force: {} },
    });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('NO_FORCE');
  });

  it('refuses to send units the crew does not have', async () => {
    const { app } = await makeApp(alwaysWins);
    const token = await crew(app, 'overreacher');

    const res = await app.inject({
      method: 'POST',
      url: '/api/city/attack',
      headers: auth(token),
      payload: { placeId: target.id, force: { juggernauts: 40 } },
    });
    expect(res.statusCode).toBe(409);
    expect(errorCode(res)).toBe('NO_FORCE');
  });

  it('takes the place on a win, and records the fight against it', async () => {
    const { app, db } = await makeApp(alwaysWins);
    const token = await crew(app, 'winner');

    const res = await app.inject({
      method: 'POST',
      url: '/api/city/attack',
      headers: auth(token),
      payload: { placeId: target.id, force: { razors: 2 } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<AttackPlaceResponse>();
    expect(body.captured).toBe(true);
    // This stub reports no losses, so the whole force comes home; garrisoning is a separate
    // decision. A *real* win costs bodies — see 'does not hand a winning attacker back' above.
    expect(body.returned).toEqual({ razors: 2 });
    expect(body.base.army.razors).toBe(STARTING_RAZORS);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/city/${raid.id}`,
      headers: auth(token),
    });
    const place = detail
      .json<DistrictDetailResponse>()
      .places.find((p) => p.place.id === target.id);
    expect(place?.holder).toEqual({ kind: 'faction', baseId: body.base.id });
    // A captured position is not a captured position plus the enemy's diggings.
    expect(place?.fortification).toBe(0);
    expect(place?.garrison).toEqual({});

    const rows = db.prepare('SELECT target_place_id, winner FROM battles').all() as {
      target_place_id: string | null;
      winner: string;
    }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.target_place_id).toBe(target.id);
    expect(rows[0]?.winner).toBe('attacker');
  });

  it('routs the attacker on a loss — the runners come home, the rest do not', async () => {
    const { app } = await makeApp(alwaysLoses);
    const token = await crew(app, 'loser');

    const res = await app.inject({
      method: 'POST',
      url: '/api/city/attack',
      headers: auth(token),
      payload: { placeId: target.id, force: { razors: 4 } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<AttackPlaceResponse>();
    expect(body.captured).toBe(false);
    expect(body.returned).toEqual({ razors: 1 });
    // Four went out, one came back. The other three are gone, not merely elsewhere.
    expect(body.base.army.razors ?? 0).toBe(STARTING_RAZORS - 4 + 1);
  });

  /**
   * §D7 and §D8, restored with the fight that moved from the district to the place.
   *
   * Taking ground by force is the loudest infamous action the game has, and *whose* ground it was
   * decides whether it counts as anti-systemic. Both are asserted here because both are silent
   * failures: an infamy meter that never moves and a tally that never fills look exactly like a
   * game where nobody has done anything yet.
   */
  it('moves infamy and the §D8 tally, by more when the ground was the state’s', async () => {
    const combineGround = findDistrict('undergrid');
    if (!combineGround) throw new Error('fixture error: the Undergrid is missing');
    const combinePlace = combineGround.places[0];
    if (!combinePlace) throw new Error('fixture error: the Undergrid has no places');

    const infamyAfter = async (districtId: string, placeId: string): Promise<number> => {
      const { app } = await makeApp(alwaysWins);
      const { token } = await register(app, `taker_${districtId}`);
      await chooseOverseer(app, token);
      await app.inject({
        method: 'POST',
        url: '/api/city/scout',
        headers: auth(token),
        payload: { districtId },
      });
      const res = await app.inject({
        method: 'POST',
        url: '/api/city/attack',
        headers: auth(token),
        payload: { placeId, force: { razors: 1 } },
      });
      expect(res.statusCode).toBe(200);
      return res.json<AttackPlaceResponse>().base.economy.infamy;
    };

    const street = await infamyAfter(raid.id, target.id);
    const state = await infamyAfter(combineGround.id, combinePlace.id);

    expect(street).toBeGreaterThan(0);
    // §D7 — robbing the Combine is the kind of thing the street repeats.
    expect(state).toBeGreaterThan(street);
  });

  it('records the raid against the §D8 stance counters, win or lose', async () => {
    const { app } = await makeApp(alwaysLoses);
    const token = await crew(app, 'stubborn');

    const res = await app.inject({
      method: 'POST',
      url: '/api/city/attack',
      headers: auth(token),
      payload: { placeId: target.id, force: { razors: 4 } },
    });
    expect(res.statusCode).toBe(200);

    // A loss earns no infamy but still goes on the books — a crew that keeps throwing people at
    // doors that do not open is telling the street something about itself.
    const economy = res.json<AttackPlaceResponse>().base.economy;
    expect(economy.infamy).toBe(0);
    expect(economy.reputationTally.raidsLost).toBeGreaterThan(0);
  });

  it('refuses a place the crew already holds', async () => {
    const { app } = await makeApp(alwaysWins);
    const token = await crew(app, 'greedy');
    await app.inject({
      method: 'POST',
      url: '/api/city/attack',
      headers: auth(token),
      payload: { placeId: target.id, force: { razors: 1 } },
    });

    const again = await app.inject({
      method: 'POST',
      url: '/api/city/attack',
      headers: auth(token),
      payload: { placeId: target.id, force: { razors: 1 } },
    });
    expect(again.statusCode).toBe(409);
    expect(errorCode(again)).toBe('PLACE_UNAVAILABLE');
  });
});

describe('POST /api/city/raid (§A4)', () => {
  const alwaysWins: SkirmishEngine = {
    resolve: () => skirmishOutcome({ winner: 'attacker', log: ['robbed'] }),
  };

  it('refuses to raid the crew’s own home', async () => {
    const { app } = await makeApp(alwaysWins);
    const { token } = await register(app, 'selfraider');
    await chooseOverseer(app, token);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) });
    const home = me.json<{ base: { districtId: string } }>().base.districtId;

    const res = await app.inject({
      method: 'POST',
      url: '/api/city/raid',
      headers: auth(token),
      payload: { districtId: home, force: { razors: 1 } },
    });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe('INVALID_TARGET');
  });

  it('refuses to raid contested ground — that is taken a place at a time', async () => {
    const { app } = await makeApp(alwaysWins);
    const { token } = await register(app, 'confused');
    await chooseOverseer(app, token);

    const res = await app.inject({
      method: 'POST',
      url: '/api/city/raid',
      headers: auth(token),
      payload: { districtId: 'rustyard', force: { razors: 1 } },
    });
    expect(res.statusCode).toBe(400);
    expect(errorCode(res)).toBe('INVALID_TARGET');
  });
});

describe('routing', () => {
  it('returns a 404 envelope for unknown routes', async () => {
    const { app } = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(errorCode(res)).toBe('NOT_FOUND');
  });
});
