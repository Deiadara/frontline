import { CITY_DISTRICTS, declarationWindow, type BattleTarget, type Base } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { MAX_PENDING_DECLARATIONS } from './declare.js';

/**
 * The Raid Boss's tenth rung is a door: one more fight called and pending at once.
 *
 * The cap is read through the standing fold at the declaration, so the rung widens the same
 * refusal every other declaration hits.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe('how many fights may be called at once', () => {
  it('is the cap, plus one once The Name is finished', async () => {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const app = await buildApp({ config, db, logger: false });
    instances.push({ app, db });

    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'the_name', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    const chosen = await app.inject({
      method: 'POST',
      url: '/api/overseer',
      headers: auth(token),
      payload: { presetId: 'enforcer' },
    });
    expect(chosen.statusCode).toBe(201);
    const base = chosen.json<{ base: Base }>().base;

    // Enough ground to call against: a scouted contested district with more locations than the
    // cap, none of them held by anybody.
    const district = CITY_DISTRICTS.find(
      (entry) =>
        entry.kind === 'contested' && entry.locations.length > MAX_PENDING_DECLARATIONS + 1,
    );
    if (!district) throw new Error('fixture: no contested district wide enough');
    app.repos.city.markScouted(base.id, district.id, new Date().toISOString());
    app.repos.bases.updateArmy(base.id, { razors: 40 }, []);

    const declare = (locationId: string) =>
      app.inject({
        method: 'POST',
        url: '/api/battles/declare',
        headers: auth(token),
        payload: {
          target: { kind: 'location', districtId: district.id, locationId } as BattleTarget,
          scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
        },
      });

    const [first, ...rest] = district.locations;
    if (!first) throw new Error('fixture: no locations');
    for (let at = 0; at < MAX_PENDING_DECLARATIONS; at += 1) {
      const location = district.locations[at];
      if (!location) throw new Error('fixture: ran out of locations');
      const called = await declare(location.id);
      expect(called.statusCode, called.body.slice(0, 200)).toBe(200);
    }
    const oneMore = rest[MAX_PENDING_DECLARATIONS - 1];
    const another = rest[MAX_PENDING_DECLARATIONS];
    if (!oneMore || !another) throw new Error('fixture: not enough locations');

    // At the cap: refused.
    const refused = await declare(oneMore.id);
    expect(refused.statusCode, refused.body.slice(0, 200)).toBe(409);

    // The rung finished: the same call stands, and the one after it is the new cap.
    const fresh = app.repos.bases.findById(base.id);
    if (!fresh) throw new Error('fixture: no base');
    app.repos.bases.updateResearch(base.id, {
      ...fresh.research,
      technologies: [...fresh.research.technologies, 'tech_the_name'],
    });
    const allowed = await declare(oneMore.id);
    expect(allowed.statusCode, allowed.body.slice(0, 200)).toBe(200);
    const capped = await declare(another.id);
    expect(capped.statusCode, capped.body.slice(0, 200)).toBe(409);
  });
});
