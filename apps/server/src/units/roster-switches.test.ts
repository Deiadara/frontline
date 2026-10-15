import { type UnitsResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * The crew switch that lifts a hard rule off a unit sheet (bug pass, 2026-09-19), and the waiver
 * that no longer exists (maintainer, 2026-10-15).
 *
 * `carriers_fight` puts a crew's porters in a line. It is not a fact about the sheet, so no screen
 * can work it out from the catalogue, and the roster payload carries it. Its sibling `any_ride`
 * put a `no_ride` sheet into a truck until the maintainer took it out of the game: the Colossus
 * never rides, and the rung that granted it pays faster machines instead.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

/** The rungs in question. Named rather than searched, so a rename is a red test not a skip. */
const LOAD_PLANS = 'tech_load_plans';
const CARRIERS_FIGHT = 'tech_everybody_fights';

async function rosterWith(...technologies: string[]): Promise<UnitsResponse> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'the_loader', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const baseId = (await chooseOverseer(app, token)).json<{ base: { id: string } }>().base.id;

  if (technologies.length > 0) {
    const base = app.repos.bases.findById(baseId);
    if (!base) throw new Error('the fixture crew has no base');
    app.repos.bases.updateResearch(baseId, {
      ...base.research,
      technologies: [...base.research.technologies, ...technologies],
    });
  }

  const read = await app.inject({
    method: 'GET',
    url: '/api/units',
    headers: { authorization: `Bearer ${token}` },
  });
  expect(read.statusCode, read.body.slice(0, 300)).toBe(200);
  return read.json<UnitsResponse>();
}

describe('the crew switches the roster has to carry', () => {
  it('sends carriersFight off for a crew that has not bought it, and on once it has', async () => {
    expect((await rosterWith()).carriersFight).toBe(false);
    expect((await rosterWith(CARRIERS_FIGHT)).carriersFight).toBe(true);
  });

  it('pays Load Plans as faster machines, and leaves the Colossus too big to ride', async () => {
    const colossusRules = (roster: UnitsResponse) =>
      roster.units.find((unit) => unit.id === 'the_colossus')?.rules.map((rule) => rule.id) ?? [];
    const roster = await rosterWith(LOAD_PLANS);
    expect(roster.vehicleSpeedPercent).toBe(10);
    expect(colossusRules(roster)).toContain('no_ride');
    expect(roster.carriersFight).toBe(false);
  });
});
