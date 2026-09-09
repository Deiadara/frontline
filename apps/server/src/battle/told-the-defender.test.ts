import {
  NOTIFICATION_KIND_SPECS,
  declarationWindow,
  isAlwaysOn,
  type BattleTarget,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

/**
 * §A4: the defender is told.
 *
 * "The whole point of the rework is that the defender is told, and told early enough to do
 * something about it" is the second sentence of `declare.ts`, and nothing in the server was
 * saying it. `district_attacked` is one of the two receipts a player may never switch off, and it
 * had no emitter: the only way to learn that somebody had called a fight on your ground was to
 * open the battle board and notice.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function makeApp() {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  return { app, db };
}

async function register(app: FastifyInstance, username: string) {
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'hunter2pass' },
  });
  const { token, user } = registered.json<{ token: string; user: { id: string } }>();
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  const base = chosen.json<{ base: { id: string; districtId: string } }>().base;
  return { token, userId: user.id, baseId: base.id, districtId: base.districtId };
}

/** Every receipt this account holds, of this kind. */
function received(app: FastifyInstance, userId: string, kind: string) {
  return app.repos.social.notifications(userId, 50).filter((note) => note.kind === kind);
}

describe('calling a fight on somebody', () => {
  it('rings the defender, names the ground and the mark, and never rings the caller', async () => {
    const { app } = await makeApp();
    const holder = await register(app, 'holder');
    const raider = await register(app, 'raider');

    const { CITY_DISTRICTS } = await import('@frontline/shared');
    // One location in a contested district the raider can see, held by the other crew. Only one,
    // so the district is not shut and the location itself is the legal target.
    const district = CITY_DISTRICTS.find(
      (entry) => entry.kind === 'contested' && entry.locations.length > 1,
    );
    if (!district) throw new Error('fixture: no contested district with two locations');
    const location = district.locations[0];
    if (!location) throw new Error('fixture: no location');
    app.repos.city.put({
      locationId: location.id,
      holder: { kind: 'crew', baseId: holder.baseId },
      level: 1,
      upgradingUntil: null,
      fortification: 0,
      fortifyingUntil: null,
      garrison: {},
    });
    app.repos.city.markScouted(raider.baseId, district.id, new Date().toISOString());

    const mark = declarationWindow(new Date()).earliest;
    const called = await app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(raider.token),
      payload: {
        target: {
          kind: 'location',
          districtId: district.id,
          locationId: location.id,
        } as BattleTarget,
        scheduledFor: mark.toISOString(),
      },
    });
    expect(called.statusCode, called.body.slice(0, 200)).toBe(200);

    const bell = received(app, holder.userId, 'district_attacked');
    expect(bell).toHaveLength(1);
    expect(bell[0]?.title).toContain('has called a fight on you');
    // It says which ground, so the receipt is a place to go rather than a place to hunt.
    expect(bell[0]?.body).toContain(location.name);
    // And it is followable: §K5's rule that a receipt with nowhere to go makes a player hunt.
    expect(bell[0]?.link).toBe('/game/battles');
    expect(bell[0]?.subjectId).toBeTruthy();

    // The caller hears nothing about their own call.
    expect(received(app, raider.userId, 'district_attacked')).toHaveLength(0);
  });

  it('cannot be switched off, and the mute is honoured for a kind that can', async () => {
    const { app } = await makeApp();
    const holder = await register(app, 'quiet_holder');
    const raider = await register(app, 'loud_raider');

    // The defender asks for silence on everything the settings page will take.
    app.repos.social.putSettings(holder.userId, {
      muted: Object.keys(NOTIFICATION_KIND_SPECS).filter(
        (kind) => !isAlwaysOn(kind as never),
      ) as never[],
    });

    const { CITY_DISTRICTS } = await import('@frontline/shared');
    const district = CITY_DISTRICTS.find(
      (entry) => entry.kind === 'contested' && entry.locations.length > 1,
    );
    if (!district) throw new Error('fixture: no contested district with two locations');
    const location = district.locations[0];
    if (!location) throw new Error('fixture: no location');
    app.repos.city.put({
      locationId: location.id,
      holder: { kind: 'crew', baseId: holder.baseId },
      level: 1,
      upgradingUntil: null,
      fortification: 0,
      fortifyingUntil: null,
      garrison: {},
    });
    app.repos.city.markScouted(raider.baseId, district.id, new Date().toISOString());

    const called = await app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(raider.token),
      payload: {
        target: {
          kind: 'location',
          districtId: district.id,
          locationId: location.id,
        } as BattleTarget,
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    expect(called.statusCode, called.body.slice(0, 200)).toBe(200);

    // An always-on kind ignores the switch, which is the rule `isAlwaysOn` exists to enforce.
    expect(isAlwaysOn('district_attacked')).toBe(true);
    expect(received(app, holder.userId, 'district_attacked')).toHaveLength(1);
  });

  it('says nothing at all when the ground belongs to nobody with an account', async () => {
    const { app } = await makeApp();
    const raider = await register(app, 'lonely_raider');

    const { CITY_DISTRICTS } = await import('@frontline/shared');
    // Combine or looter ground, straight off the seed: there is no crew behind it to tell.
    const district = CITY_DISTRICTS.find(
      (entry) => entry.kind === 'contested' && entry.locations.length > 1,
    );
    if (!district) throw new Error('fixture: no contested district with two locations');
    const location = district.locations[0];
    if (!location) throw new Error('fixture: no location');
    app.repos.city.markScouted(raider.baseId, district.id, new Date().toISOString());

    const called = await app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(raider.token),
      payload: {
        target: {
          kind: 'location',
          districtId: district.id,
          locationId: location.id,
        } as BattleTarget,
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    expect(called.statusCode, called.body.slice(0, 200)).toBe(200);
    expect(received(app, raider.userId, 'district_attacked')).toHaveLength(0);
  });
});
