import { type UnitsResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer } from '../testing/overseer.js';

/**
 * The two crew switches that lift a hard rule off a unit sheet (bug pass, 2026-09-19).
 *
 * `carriers_fight` puts a crew's porters in a line and `any_ride` gets a `no_ride` sheet into a
 * truck. Neither is a fact about the sheet, so no screen can work either of them out from the
 * catalogue, and neither can ride on `CrewStandingResponse.effects`, which is a record of
 * numbers. The roster payload is where the first one ended up and the second one was simply
 * missing: the deploy window and the mission board asked the catalogue instead, so a crew that
 * had spent a research rung on `any_ride` was told its Colossus walked, was charged no seat for
 * it, and had the confirm refused `no_seats` by a door reading `effects.anyRide`.
 *
 * Pinned on the wire rather than on `standingEffectsFor`, which `research/tracks.test.ts` already
 * covers: the defect was never in the fold, it was that the fold never left the server.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

/** The rungs that grant them. Named rather than searched, so a rename is a red test not a skip. */
const ANY_RIDE = 'tech_load_plans';
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
  it('sends both off for a crew that has bought neither', async () => {
    const roster = await rosterWith();
    expect(roster.anyRide).toBe(false);
    expect(roster.carriersFight).toBe(false);
  });

  it('sends anyRide once the rung that waives no_ride is finished', async () => {
    const roster = await rosterWith(ANY_RIDE);
    expect(roster.anyRide).toBe(true);
    // ...and only that one. Two switches on one payload that move together would pass every test
    // here while telling the deploy window the wrong thing about seats.
    expect(roster.carriersFight).toBe(false);
  });

  /**
   * ...and the card stops printing the rule the waiver takes away.
   *
   * `markedUnit` only ever adds a mark, because `unit_mark` is the only channel the engine has
   * and the engine has no use for a revoked one. `any_ride` revokes: `no_ride` is a travel rule,
   * so the two readers that care take the flag as an argument and `markedUnit` never sees it.
   * The card therefore went on printing "Too big to ride: there is no seat in this city that
   * takes one" on the sheet of a Colossus that this crew puts in a truck.
   */
  it('stops printing Too big to ride once the waiver is bought', async () => {
    const colossusRules = (roster: UnitsResponse) =>
      roster.units.find((unit) => unit.id === 'the_colossus')?.rules.map((rule) => rule.id) ?? [];

    // Without it, the rule is on the sheet and on the card.
    expect(colossusRules(await rosterWith())).toContain('no_ride');
    // With it, the rule does not apply to this crew and the card must not claim it does...
    const waived = colossusRules(await rosterWith(ANY_RIDE));
    expect(waived).not.toContain('no_ride');
    // ...while every other mark the sheet carries survives, which a blanket filter would not.
    expect(waived).toContain('sapper');
  });

  it('sends carriersFight on its own rung, and both together', async () => {
    expect((await rosterWith(CARRIERS_FIGHT)).carriersFight).toBe(true);
    expect((await rosterWith(CARRIERS_FIGHT)).anyRide).toBe(false);

    const both = await rosterWith(ANY_RIDE, CARRIERS_FIGHT);
    expect(both.anyRide).toBe(true);
    expect(both.carriersFight).toBe(true);
  });
});
