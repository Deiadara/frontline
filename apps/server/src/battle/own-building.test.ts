import { declarationWindow, type BattleTarget } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

/**
 * A structure of your own is not a target.
 *
 * `defenderOf` answers the *district's* holder for a building, so two crews sharing a district a
 * third crew held outright could each declare against a structure on their own plot. The settle
 * then looted the resident, which was the declarer, and paid the haul back off a stockpile read
 * before the loot: the fight minted 150 caps out of nothing, measured. The declaration is where
 * that stops.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function register(app: FastifyInstance, username: string) {
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
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  const base = chosen.json<{ base: { id: string; districtId: string } }>().base;
  return { token, baseId: base.id, districtId: base.districtId };
}

describe('declaring against your own structure', () => {
  it('is refused as your own ground, while a neighbour on the same street is fair game', async () => {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const app = await buildApp({ config, db, logger: false });
    instances.push({ app, db });

    // Both planted on the same opening ground; a third crew holds every location in it, so the
    // district's own gate is the holder's and neither resident is "own ground" for it.
    const raider = await register(app, 'raider');
    const neighbour = await register(app, 'neighbour');
    expect(raider.districtId).toBe(neighbour.districtId);
    const holder = await register(app, 'holder');
    db.prepare('UPDATE bases SET district_id = ? WHERE id = ?').run(
      'ashen-terraces',
      holder.baseId,
    );
    const { CITY_DISTRICTS } = await import('@frontline/shared');
    const district = CITY_DISTRICTS.find((entry) => entry.id === raider.districtId);
    if (!district) throw new Error('fixture: the opening district is not in the catalogue');
    for (const location of district.locations) {
      app.repos.city.put({
        locationId: location.id,
        holder: { kind: 'crew', baseId: holder.baseId },
        level: 1,
        upgradingUntil: null,
        fortification: 0,
        fortifyingUntil: null,
        garrison: {},
      });
    }
    app.repos.sieges.breakGate(district.id, new Date(Date.now() + 3_600_000).toISOString());

    const declare = (buildingId: string) =>
      app.inject({
        method: 'POST',
        url: '/api/battles/declare',
        headers: auth(raider.token),
        payload: {
          target: { kind: 'building', districtId: district.id, buildingId } as BattleTarget,
          scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
        },
      });

    const own = app.repos.bases.findById(raider.baseId)?.buildings[0];
    if (!own) throw new Error('fixture: the raider has no structure');
    const refused = await declare(own.id);
    expect(refused.statusCode, refused.body.slice(0, 200)).toBe(409);
    expect(refused.body).toContain('That is yours');

    // The positive control: the same call against the neighbour's structure stands.
    const theirs = app.repos.bases.findById(neighbour.baseId)?.buildings[0];
    if (!theirs) throw new Error('fixture: the neighbour has no structure');
    const declared = await declare(theirs.id);
    expect(declared.statusCode, declared.body.slice(0, 200)).toBe(200);
  });
});
