import { TERMINUS_CITY_ID, findDistrict, travelMinutesBetween } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';
import { settleBattles } from './resolve.js';

/**
 * What happens at the edges of the world (2026-09-24).
 *
 * Two defects lived here and both were silent. A column sent to ground the map could not price
 * **arrived instantly**, because the road answered `0` for an unknown district and its own comment
 * called that honest. And a fight on a district nothing could resolve was skipped on every tick for
 * ever, holding one of the crew's three declaration slots and stranding whatever had been sent to
 * it. Neither was reachable while Ashfall was the world; both became reachable the day a second
 * city opened.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function world(): Promise<{ app: FastifyInstance; token: string; baseId: string }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'marcher', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
  pinOverseer(app, token);
  return { app, token, baseId: chosen.json<{ base: { id: string } }>().base.id };
}

describe('the road to another city', () => {
  it('is a march rather than a teleport', () => {
    /*
     * The exact pair that showed the defect. Positions are normalised inside their own city, so
     * these two sit a fifth of a unit square apart on paper: before the frontier term this came
     * out at the two-minute floor, which is quicker than crossing one district at home.
     */
    const home = findDistrict('ashen-terraces')!;
    const away = findDistrict('last-platform')!;
    expect(home.cityId).not.toBe(away.cityId);
    expect(away.cityId).toBe(TERMINUS_CITY_ID);

    const abroad = travelMinutesBetween(home, away);
    const acrossTown = travelMinutesBetween(home, findDistrict('neon-docks')!);
    expect(abroad).toBeGreaterThan(acrossTown);
    // A guard on the fixture: crossing Ashfall has to be a real journey too, or this proves little.
    expect(acrossTown).toBeGreaterThan(30);
  });
});

describe('a fight nothing can resolve', () => {
  it('is closed rather than retried for ever, and its column comes home', async () => {
    const { app, baseId } = await world();
    const base = app.repos.bases.findById(baseId)!;
    app.repos.bases.updateArmy(base.id, { razors: 6 }, base.trainingQueue);

    /*
     * A battle row pointed at ground the world does not have.
     *
     * Written straight into the repo because no door will accept it, which is the point: this is
     * the state a legacy row, a renamed district or a hand-edited database leaves behind, and the
     * settler has to be able to get out of it.
     */
    const now = new Date();
    const battleId = 'battle-nowhere';
    app.repos.sieges.insert({
      id: battleId,
      attackerBaseId: baseId,
      target: { kind: 'district', districtId: 'a-district-that-never-existed' },
      defender: { kind: 'looters' },
      declaredAt: new Date(now.getTime() - 60_000).toISOString(),
      scheduledFor: new Date(now.getTime() - 1000).toISOString(),
      resolvedAt: null,
      seed: 'nowhere-seed',
      holdAfterCapture: false,
      wokeSleepers: false,
    });

    expect(app.repos.sieges.pendingCountFor(baseId)).toBe(1);
    expect(app.repos.sieges.due(now.toISOString()).length).toBe(1);

    settleBattles(app.repos, app.skirmishEngine, now);

    // Out of every queue: it no longer comes back on the next tick and it no longer costs a slot.
    expect(app.repos.sieges.due(now.toISOString()).length).toBe(0);
    expect(app.repos.sieges.pendingCountFor(baseId)).toBe(0);
    // And nothing was invented: a fight that never happened files no report.
    expect(app.repos.sieges.resolvedFor(baseId, 10).length).toBe(0);
  });
});
