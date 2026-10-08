import { describe, expect, it, afterEach } from 'vitest';
import { MISC_AREA_ID, featMeasureKey, findDistrict } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';
import { featSnapshot } from './snapshot.js';
import { tallyMissionHome } from './tally.js';

/**
 * The board's work, counted without naming a district (maintainer, 2026-10-07).
 *
 * Both measures are derived in the snapshot off the `missions_in_area` tallies the board already
 * writes, so they count runs made before they existed. The Miscellaneous board is not a district
 * and must not be counted as one, which is the half a crew meets first: every new crew runs misc
 * jobs for an evening before it holds anything whole.
 */
const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

async function world(): Promise<{ app: FastifyInstance; baseId: string }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });
  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'boardwork', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await chooseOverseer(app, token);
  return { app, baseId: chosen.json<{ base: { id: string } }>().base.id };
}

const run = (app: FastifyInstance, baseId: string, areaId: string, times = 1) => {
  for (let at = 0; at < times; at += 1) {
    tallyMissionHome(app.repos, baseId, { areaId, kind: 'standard', succeeded: true });
  }
};

describe('the board`s work, counted without a district name', () => {
  it('counts distinct districts and leaves the Miscellaneous board out of them', async () => {
    const { app, baseId } = await world();
    const base = () => app.repos.bases.findById(baseId)!;

    run(app, baseId, MISC_AREA_ID, 4);
    expect(featSnapshot(app.repos, base())['mission_districts']).toBe(0);
    expect(featSnapshot(app.repos, base())[featMeasureKey('missions_in_area', MISC_AREA_ID)]).toBe(
      4,
    );

    run(app, baseId, 'steelbelt', 3);
    run(app, baseId, 'chrome-row');
    // Three runs out of one district is still one district.
    expect(featSnapshot(app.repos, base())['mission_districts']).toBe(2);
  });

  it('counts the runs made on ground the regime held, wherever the crew lives', async () => {
    const { app, baseId } = await world();
    const base = () => app.repos.bases.findById(baseId)!;
    const regime = findDistrict('annexes')!;
    const looters = findDistrict('chrome-row')!;
    expect(regime.allegiance, 'the fixture needs Combine ground').toBe('government');
    expect(looters.allegiance).not.toBe('government');

    run(app, baseId, looters.id, 5);
    expect(featSnapshot(app.repos, base())['missions_on_combine_ground']).toBe(0);
    run(app, baseId, regime.id, 2);
    expect(featSnapshot(app.repos, base())['missions_on_combine_ground']).toBe(2);
  });
});
