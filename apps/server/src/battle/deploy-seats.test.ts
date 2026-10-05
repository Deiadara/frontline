/**
 * §C3: the seats are the ceiling, and a column on the road is still coming.
 *
 * `adjustDeployment` checks the muster against `fleetCapacity` of the machines this crew has
 * committed, and its own note says why it is the muster rather than the batch: "the ceiling is
 * about what will be standing there when the clock runs out". Since columns walk
 * (`battle/movement.ts`), the units in one are neither on the deployment row nor in the batch
 * being posted, so a crew that sends the same batch twice is counted twice as nobody. One
 * motorcycle seats two; two requests put four on the ground under it, and ten requests put twenty.
 *
 * The seat rule is the only thing bounding a force once a machine is loaded, so bypassing it is
 * bypassing the rule, and it is bypassed by pressing the button again.
 */
import {
  DECLARE_INFAMY_COST,
  declarationWindow,
  fleetCapacity,
  ridingUnitSlots,
  skirmishOutcome,
  type BattleTarget,
  type SkirmishEngine,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { armTheAttack } from '../testing/attack.js';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { chooseOverseer, pinOverseer } from '../testing/overseer.js';

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];
afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string): { authorization: string } => ({ authorization: `Bearer ${token}` });

const PRESS: BattleTarget = {
  kind: 'location',
  districtId: 'steelbelt',
  locationId: 'steelbelt-press',
};

/** One bike: two seats, which is two Razors and no more. */
const ONE_BIKE = { motorcycle: 1 };

describe('the seat ceiling on a fight somebody has loaded machines onto', () => {
  it('counts the column already walking to it', async () => {
    const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
    const db = openDatabase(config.databasePath);
    runMigrations(db);
    const engine: SkirmishEngine = { resolve: () => skirmishOutcome({ winner: 'attacker' }) };
    const app = await buildApp({ config, db, skirmishEngine: engine, logger: false });
    instances.push({ app, db });

    const registered = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'loader', password: 'hunter2pass' },
    });
    const token = registered.json<{ token: string }>().token;
    const chosen = await chooseOverseer(app, token);
    expect(chosen.statusCode, chosen.body.slice(0, 200)).toBe(201);
    pinOverseer(app, token);
    const baseId = chosen.json<{ base: { id: string } }>().base.id;

    const base = app.repos.bases.findById(baseId)!;
    app.repos.bases.updateEconomy(baseId, { ...base.economy, infamy: DECLARE_INFAMY_COST * 4 });
    app.repos.bases.updateArmy(baseId, { razors: 12 }, base.musterQueue);
    app.repos.bases.updateFleet(baseId, ONE_BIKE);
    // One plot let go, so the district is not shut and a location is a legal call.
    const ramp = app.repos.city.control('steelbelt-ramp')!;
    app.repos.city.put({ ...ramp, holder: { kind: 'unoccupied' }, garrison: {} });

    const declared = await app.inject({
      method: 'POST',
      url: '/api/battles/declare',
      headers: auth(token),
      payload: {
        target: PRESS,
        scheduledFor: declarationWindow(new Date()).earliest.toISOString(),
      },
    });
    expect(declared.statusCode, declared.body.slice(0, 300)).toBe(200);
    const battleId = app.repos.sieges.pending()[0]!.id;

    const loaded = await app.inject({
      method: 'POST',
      url: '/api/battles/vehicles',
      headers: auth(token),
      payload: { battleId, vehicles: ONE_BIKE },
    });
    expect(loaded.statusCode, loaded.body.slice(0, 300)).toBe(200);

    const seats = fleetCapacity(ONE_BIKE);
    const send = (count: number) =>
      app.inject({
        method: 'POST',
        url: '/api/battles/deploy',
        headers: auth(token),
        payload: { battleId, changes: { razors: count }, perimeterChanges: {} },
      });

    // The first batch fills the bike exactly. Nothing has arrived: a column walks.
    const first = await send(2);
    expect(first.statusCode, first.body.slice(0, 300)).toBe(200);
    expect(app.repos.sieges.deployment(battleId, 'attacker', baseId)?.army).toEqual({});
    expect(app.repos.movements.forBattle(battleId).length).toBe(1);

    // The same batch again. Every one of these four is walking to the fight and will be standing
    // on the ground at the mark, and there are two seats.
    const second = await send(2);
    expect(second.statusCode, 'a second column was loaded onto a bike that is already full').toBe(
      409,
    );

    const walking = app.repos.movements
      .forBattle(battleId)
      .reduce<Record<string, number>>((total, movement) => {
        for (const [unitId, count] of Object.entries(movement.army)) {
          total[unitId] = (total[unitId] ?? 0) + count;
        }
        return total;
      }, {});
    expect(ridingUnitSlots(walking)).toBeLessThanOrEqual(seats);

    /*
     * And the machines stay for the fight in its last hour, as the units do (bug pass,
     * 2026-10-02): unloading them a minute before the mark put them back in the yard and spared
     * them the wreck roll.
     */
    // The attack's least commitment, or the lock calls it off (2026-10-05).
    armTheAttack(app.repos, battleId, baseId);
    db.prepare('UPDATE scheduled_battles SET scheduled_for = ? WHERE id = ?').run(
      new Date(Date.now() + 20 * 60_000).toISOString(),
      battleId,
    );
    const unloaded = await app.inject({
      method: 'POST',
      url: '/api/battles/vehicles',
      headers: auth(token),
      payload: { battleId, vehicles: {} },
    });
    expect(unloaded.statusCode, unloaded.body.slice(0, 300)).toBe(409);
    expect(app.repos.sieges.deployment(battleId, 'attacker', baseId)?.vehicles).toEqual(ONE_BIKE);
    expect(app.repos.bases.findById(baseId)?.fleet.motorcycle ?? 0).toBe(0);
  });
});
