import {
  CITY_DISTRICTS,
  createCommander,
  makeAttributes,
  scoutMinutesFor,
  type CityResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { tickWorld } from '../live/clock.js';
import { defaultScout, planScout, sendScout, settleScouting } from './scouting.js';

/**
 * §A4: scouting as a journey (board rework).
 *
 * The old scout was a button that opened ground on the spot, from anywhere, free. What replaced it
 * is one officer walking there, spending time on it, and walking back. These tests are about the
 * three things that makes true: the ground stays dark while they are out, it opens when they are
 * home, and it opens **without anybody reading a page**, because the clock is what runs it now.
 */

interface Stack {
  app: FastifyInstance;
  db: AppDatabase;
  token: string;
  baseId: string;
}

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function makeStack(username: string): Promise<Stack> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  return { app, db, token, baseId: chosen.json<{ base: { id: string } }>().base.id };
}

/** Somebody worth sending. A brand-new crew has nobody, which is its own test below. */
function hire(stack: Stack, rating = 30, role: 'scout' | 'trader' = 'scout'): void {
  const base = stack.app.repos.bases.findById(stack.baseId)!;
  stack.app.repos.bases.updateCommanders(base.id, [
    ...base.commanders,
    createCommander(`o-${base.commanders.length}`, 'Wire', role, makeAttributes(rating), []),
  ]);
}

const city = async (stack: Stack): Promise<CityResponse> =>
  (
    await stack.app.inject({ method: 'GET', url: '/api/city', headers: auth(stack.token) })
  ).json<CityResponse>();

/** A district this crew has not seen, and does not live in. */
async function darkDistrict(stack: Stack): Promise<string> {
  const seen = await city(stack);
  const dark = seen.districts.find((entry) => !entry.scouted);
  if (!dark) throw new Error('fixture error: the whole city is already open');
  return dark.district.id;
}

const send = (stack: Stack, districtId: string) =>
  stack.app.inject({
    method: 'POST',
    url: '/api/city/scout',
    headers: auth(stack.token),
    payload: { districtId },
  });

describe('sending somebody to look', () => {
  it('leaves the ground dark until they are home', async () => {
    const stack = await makeStack('watcher');
    hire(stack);
    const districtId = await darkDistrict(stack);

    expect((await send(stack, districtId)).statusCode).toBe(200);

    // The half the instant scout skipped entirely: a run that is under way has told you nothing.
    const midway = await city(stack);
    expect(midway.districts.find((entry) => entry.district.id === districtId)?.scouted).toBe(false);
  });

  /**
   * And it opens with nobody reading a page.
   *
   * The same promise the world clock makes about fights and missions: a player who sent somebody
   * out and closed the tab should come back to open ground, not cause it by opening the city.
   */
  it('opens the ground from the world clock alone', async () => {
    const stack = await makeStack('unwatched');
    hire(stack);
    const districtId = await darkDistrict(stack);
    await send(stack, districtId);

    stack.db
      .prepare('UPDATE scouting_runs SET returns_at = ?')
      .run(new Date(Date.now() - 60_000).toISOString());

    // No HTTP request between the wind-back and the assertion.
    tickWorld(stack.app.repos, stack.app.skirmishEngine, new Date());

    expect(stack.app.repos.city.scouted(stack.baseId).has(districtId)).toBe(true);
  });

  /** The positive control: without the clock the ground stays dark, which is the old bug's mirror. */
  it('does not open on its own', async () => {
    const stack = await makeStack('nowind');
    hire(stack);
    const districtId = await darkDistrict(stack);
    await send(stack, districtId);

    stack.db
      .prepare('UPDATE scouting_runs SET returns_at = ?')
      .run(new Date(Date.now() - 60_000).toISOString());
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(stack.app.repos.city.scouted(stack.baseId).has(districtId)).toBe(false);
  });

  it('rings the bell when they walk back in', async () => {
    const stack = await makeStack('belled');
    hire(stack);
    const districtId = await darkDistrict(stack);
    await send(stack, districtId);
    const ownerId = stack.app.repos.bases.findById(stack.baseId)!.ownerId;

    stack.db
      .prepare('UPDATE scouting_runs SET returns_at = ?')
      .run(new Date(Date.now() - 60_000).toISOString());
    settleScouting(stack.app.repos, new Date());

    const bell = stack.app.repos.social.notifications(ownerId, 50);
    expect(bell.some((entry) => entry.kind === 'scout_home')).toBe(true);
  });

  it('settles a finished run once, however many times the clock passes over it', async () => {
    const stack = await makeStack('once');
    hire(stack);
    await send(stack, await darkDistrict(stack));
    stack.db
      .prepare('UPDATE scouting_runs SET returns_at = ?')
      .run(new Date(Date.now() - 60_000).toISOString());

    expect(settleScouting(stack.app.repos, new Date())).toBe(1);
    expect(settleScouting(stack.app.repos, new Date())).toBe(0);
  });
});

describe('what it costs, and who pays it', () => {
  /** A better scout is off and back sooner. The whole reason the chair is worth filling. */
  /**
   * Measured on **one** crew with two officers, not on two crews.
   *
   * The first version built two stacks and compared their runs, and the numbers never matched: two
   * accounts are planted in different home districts, so the walks are different lengths and the
   * difference between the two runs is the walk plus the looking rather than the looking. Same
   * crew, same road, one variable.
   */
  it('takes less time with a better officer', async () => {
    const stack = await makeStack('bothcrew');
    hire(stack, 5, 'trader');
    hire(stack, 90, 'trader');
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    const [poor, good] = base.commanders;
    const districtId = await darkDistrict(stack);
    const now = new Date();

    const slow = planScout(stack.app.repos, base, districtId, poor!, now)!;
    const fast = planScout(stack.app.repos, base, districtId, good!, now)!;

    expect(fast.minutes).toBeLessThan(slow.minutes);
    // And the whole difference is the looking: the road is the same for both of them.
    expect(slow.minutes - fast.minutes).toBe(
      scoutMinutesFor(makeAttributes(5)) - scoutMinutesFor(makeAttributes(90)),
    );
  });

  it('refuses a crew with nobody to send', async () => {
    const stack = await makeStack('nobody');
    const res = await send(stack, await darkDistrict(stack));

    expect(res.statusCode).not.toBe(200);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('NO_FORCE');
  });

  /** One run at a time, which is what makes the order a player opens the map in a decision. */
  it('refuses a second run while somebody is still out', async () => {
    const stack = await makeStack('busy');
    hire(stack);
    const seen = await city(stack);
    const dark = seen.districts.filter((entry) => !entry.scouted).slice(0, 2);
    expect(dark.length).toBe(2);

    expect((await send(stack, dark[0]!.district.id)).statusCode).toBe(200);
    const second = await send(stack, dark[1]!.district.id);
    expect(second.statusCode).not.toBe(200);
  });

  it('refuses ground the crew has already seen', async () => {
    const stack = await makeStack('again');
    hire(stack);
    const open = (await city(stack)).districts.find((entry) => entry.scouted);
    expect(open, 'a new crew starts with one district open').toBeDefined();

    const res = await send(stack, open!.district.id);
    expect(res.statusCode).not.toBe(200);
  });

  /** Sends the Scout by default, and the best sheet when that chair is empty. */
  it('picks the Scout over anybody else', async () => {
    const stack = await makeStack('picking');
    hire(stack, 90, 'trader');
    hire(stack, 20, 'scout');
    const base = stack.app.repos.bases.findById(stack.baseId)!;

    expect(defaultScout(base)?.role).toBe('scout');
  });

  it('falls back to the fastest sheet when there is no Scout', async () => {
    const stack = await makeStack('fallback');
    hire(stack, 10, 'trader');
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    stack.app.repos.bases.updateCommanders(base.id, [
      ...base.commanders,
      createCommander('best', 'Best', 'raid_boss', makeAttributes(80), []),
    ]);
    const fuller = stack.app.repos.bases.findById(stack.baseId)!;

    // The better sheet, not the first name on the roster: an accidental default that sent the
    // worst person on the books would be a trap for exactly the player who has not thought about it.
    expect(defaultScout(fuller)?.id).toBe('best');
  });

  it('will not send anybody to the district the crew lives in', async () => {
    const stack = await makeStack('athome');
    hire(stack);
    const base = stack.app.repos.bases.findById(stack.baseId)!;

    const outcome = sendScout(stack.app.repos, {
      base,
      districtId: base.districtId,
      now: new Date(),
    });
    expect(outcome).toEqual({ kind: 'refused', reason: 'own_district' });
  });
});

describe('the ground a new crew starts with', () => {
  /**
   * One district open from the first minute (board request).
   *
   * Scouting costs an officer and hours, and a new crew has neither, so a wholly fogged start is a
   * first session that opens with a wait before the first mission board can be read.
   */
  it('opens the nearest district nobody lives in', async () => {
    const stack = await makeStack('fresh');
    const seen = await city(stack);
    const base = stack.app.repos.bases.findById(stack.baseId)!;
    // Two: the ground they live on, which needs no scouting, and the one they were given.
    const open = seen.districts.filter((entry) => entry.scouted);
    const granted = open.filter((entry) => entry.district.id !== base.districtId);

    expect(open).toHaveLength(2);
    expect(granted).toHaveLength(1);
    /*
     * Nobody lives there.
     *
     * The closest district overall is often another crew's home, and handing a beginner a view of
     * somebody's defences is not the same as handing them somewhere to work. Asserted against who
     * has a base on the ground rather than against `held`, which counts *locations* and reports
     * `{ mine: 0, total: 8 }` for any district that has been looked at.
     */
    const homes = new Set(
      stack.app.repos.bases.listSummaries().map((summary) => summary.districtId),
    );
    expect(homes.has(granted[0]!.district.id)).toBe(false);

    // And it really is the nearest of those, rather than whichever the catalogue lists first.
    const home = CITY_DISTRICTS.find((district) => district.id === base.districtId)!;
    const occupied = new Set(
      stack.app.repos.bases.listSummaries().map((summary) => summary.districtId),
    );
    const nearest = CITY_DISTRICTS.filter(
      (district) => district.id !== home.id && !occupied.has(district.id),
    ).sort(
      (a, b) =>
        Math.hypot(home.position.x - a.position.x, home.position.y - a.position.y) -
        Math.hypot(home.position.x - b.position.x, home.position.y - b.position.y),
    )[0];
    expect(granted[0]?.district.id).toBe(nearest?.id);
  });
});
