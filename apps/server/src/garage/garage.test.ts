import { MAX_PER_VEHICLE, findVehicle, type GarageResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';

/**
 * The Garage's own page (§B11, §C2).
 *
 * What matters here is the door rather than the arithmetic (`building/vehicles.test.ts` has that):
 * a machine that is locked has to *say why* and refuse the write, and a machine that is not has to
 * come out of the stockpile and land in the yard on the same request.
 */

const instances: { app: FastifyInstance; db: AppDatabase }[] = [];

afterEach(async () => {
  for (const { app, db } of instances.splice(0)) {
    await app.close();
    db.close();
  }
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function makeStack(): Promise<{ app: FastifyInstance; token: string; baseId: string }> {
  const config = loadConfig({ DATABASE_PATH: ':memory:', JWT_SECRET: 'test-secret' });
  const db = openDatabase(config.databasePath);
  runMigrations(db);
  const app = await buildApp({ config, db, logger: false });
  instances.push({ app, db });

  const registered = await app.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username: 'yard', password: 'hunter2pass' },
  });
  const token = registered.json<{ token: string }>().token;
  const chosen = await app.inject({
    method: 'POST',
    url: '/api/overseer',
    headers: auth(token),
    payload: { presetId: 'enforcer' },
  });
  return { app, token, baseId: chosen.json<{ base: { id: string } }>().base.id };
}

async function garage(app: FastifyInstance, token: string): Promise<GarageResponse> {
  const res = await app.inject({ method: 'GET', url: '/api/garage', headers: auth(token) });
  expect(res.statusCode).toBe(200);
  return res.json<GarageResponse>();
}

function raiseGarage(app: FastifyInstance, baseId: string, level: number): void {
  const base = app.repos.bases.findById(baseId)!;
  app.repos.bases.updateDistrict(
    base.id,
    [
      ...base.buildings.filter((building) => building.kind !== 'garage'),
      { id: 'gar', kind: 'garage', level, modifications: [], damage: 0 },
    ],
    base.buildQueue,
  );
}

/**
 * §D12c: put a finished blueprint document in the satchel.
 *
 * Every machine is behind one now, the first bike included, so a test about the Garage's *other*
 * gates has to clear this one first or it passes for the wrong reason.
 */
function grantBlueprint(app: FastifyInstance, baseId: string, blueprintId: string): void {
  const base = app.repos.bases.findById(baseId)!;
  app.repos.bases.updateHoldings(base.id, base.resources, {
    ...base.inventory,
    [blueprintId]: 1,
  });
}

function stock(app: FastifyInstance, baseId: string): void {
  const base = app.repos.bases.findById(baseId)!;
  app.repos.bases.updateResources(base.id, {
    ...base.resources,
    scrap: 50_000,
    oil: 20_000,
    highQualityMetal: 10_000,
  });
}

const build = (app: FastifyInstance, token: string, vehicleId: string) =>
  app.inject({
    method: 'POST',
    url: '/api/garage/build',
    headers: auth(token),
    payload: { vehicleId },
  });

describe('the Garage page (§B11)', () => {
  it('lists every machine in the catalogue, locked or not, with a reason on each lock', async () => {
    const { app, token } = await makeStack();
    const page = await garage(app, token);
    expect(page.vehicles).toHaveLength(7);
    expect(page.garageLevel).toBe(0);
    // Nothing is buildable without a Garage, and every row says so rather than being absent.
    for (const vehicle of page.vehicles) {
      expect(vehicle.refusal, vehicle.id).not.toBeNull();
    }
    expect(page.vehicles.find((row) => row.id === 'motorcycle')?.refusal).toContain('Garage');
  });

  it('names the plans a locked machine wants rather than saying a blueprint is missing', async () => {
    const { app, token, baseId } = await makeStack();
    raiseGarage(app, baseId, 12);
    stock(app, baseId);
    const page = await garage(app, token);
    const rotor = page.vehicles.find((row) => row.id === 'rotorcraft')!;
    expect(rotor.hasBlueprint).toBe(false);
    expect(rotor.refusal).toBe('Needs the Rotorcraft Blueprint');
  });

  it('builds a machine, takes it out of the stockpile and parks it in the yard', async () => {
    const { app, token, baseId } = await makeStack();
    raiseGarage(app, baseId, 2);
    stock(app, baseId);
    grantBlueprint(app, baseId, 'bp_motorcycle');
    const before = app.repos.bases.findById(baseId)!.resources;

    const res = await build(app, token, 'motorcycle');
    expect(res.statusCode).toBe(200);

    const after = app.repos.bases.findById(baseId)!;
    expect(after.fleet.motorcycle).toBe(1);
    // Priced off the quoted line rather than the catalogue's, because the crew's ground may be
    // taking something off it. The page is what the door charged.
    const quoted = res.json<{ garage: GarageResponse }>().garage;
    expect(quoted.fleet.motorcycle).toBe(1);
    expect(after.resources.scrap).toBeLessThan(before.scrap);
    expect(after.resources.oil).toBeLessThan(before.oil);
  });

  it('refuses a machine the Garage is too small for, and banks nothing', async () => {
    const { app, token, baseId } = await makeStack();
    raiseGarage(app, baseId, 1);
    stock(app, baseId);
    // The plans and the money are both in hand, so the Garage level is the only thing left to
    // refuse on: without this the door still says 409, for the blueprint, whatever the level does.
    grantBlueprint(app, baseId, 'bp_armoured_car');
    const before = app.repos.bases.findById(baseId)!.resources;

    const res = await build(app, token, 'armoured_car');
    // 409, the `WORKSHOP_REFUSED` code: a refusal about the *state of the world* rather than about
    // the request, which is well-formed.
    expect(res.statusCode).toBe(409);
    expect(app.repos.bases.findById(baseId)!.resources).toEqual(before);
    expect(app.repos.bases.findById(baseId)!.fleet).toEqual({});
  });

  it('refuses a machine the crew cannot pay for', async () => {
    const { app, token, baseId } = await makeStack();
    raiseGarage(app, baseId, 4);
    grantBlueprint(app, baseId, 'bp_motorcycle');
    const base = app.repos.bases.findById(baseId)!;
    app.repos.bases.updateResources(base.id, { ...base.resources, scrap: 0, oil: 0 });
    expect((await build(app, token, 'motorcycle')).statusCode).toBe(409);
  });

  /**
   * §D12c/§D12h: the document is a gate on the write, not only a line on the page.
   *
   * The refusal string on the row was there before the gate was, so a test that only read the page
   * would have passed against a door that took the scrap anyway. This one presses the button with
   * the Garage tall enough and the stockpile full, so the document is the only thing left.
   */
  it('refuses a machine whose blueprint the crew has not assembled, and banks nothing', async () => {
    const { app, token, baseId } = await makeStack();
    raiseGarage(app, baseId, 2);
    stock(app, baseId);
    const before = app.repos.bases.findById(baseId)!.resources;

    const refused = await build(app, token, 'motorcycle');
    expect(refused.statusCode).toBe(409);
    expect(refused.json<{ error: { message: string } }>().error.message).toBe(
      'Needs the Scrappy Blueprint',
    );
    expect(app.repos.bases.findById(baseId)!.resources).toEqual(before);
    expect(app.repos.bases.findById(baseId)!.fleet).toEqual({});

    // The positive control: the same request, with the document in the satchel.
    grantBlueprint(app, baseId, 'bp_motorcycle');
    expect((await build(app, token, 'motorcycle')).statusCode).toBe(200);
    expect(app.repos.bases.findById(baseId)!.fleet.motorcycle).toBe(1);
  });

  it('reports seats across the whole yard, which is what a column can be loaded into', async () => {
    const { app, token, baseId } = await makeStack();
    raiseGarage(app, baseId, 2);
    stock(app, baseId);
    grantBlueprint(app, baseId, 'bp_motorcycle');
    await build(app, token, 'motorcycle');
    await build(app, token, 'motorcycle');
    const page = await garage(app, token);
    expect(page.capacity).toBe(2 * findVehicle('motorcycle')!.capacity);
  });
});

/**
 * §C: "however rich a crew gets, the yard holds this many of one kind".
 *
 * `vehicleRefusal` was handed `base.fleet` alone, and a machine committed to a fight or loaded
 * onto a run has *left* `base.fleet`: it sits on the deployment or the mission row until the crew
 * is home. So the yard's ceiling was enforced against the machines standing in it rather than
 * against the machines the crew owns. Send the yard out, build a second yard while it is away, and
 * the cap is exactly doubled the moment they come back. The page already computed what is out, for
 * the "1 in the yard, 2 out" line: the door simply was not reading it.
 */
describe('how many of one machine a yard holds (§C)', () => {
  /** A full yard of bikes, the cheap way: written straight to the fleet column. */
  function park(app: FastifyInstance, baseId: string, fleet: Record<string, number>): void {
    app.repos.bases.updateFleet(baseId, fleet);
  }

  it('counts the machines that are out on the road against the ceiling', async () => {
    const { app, token, baseId } = await makeStack();
    raiseGarage(app, baseId, 2);
    stock(app, baseId);
    grantBlueprint(app, baseId, 'bp_motorcycle');

    // The whole yard, minus one, and one bike out on a job: that is the cap, in total.
    park(app, baseId, { motorcycle: MAX_PER_VEHICLE - 1 });
    const base = app.repos.bases.findById(baseId)!;
    app.repos.missions.insert({
      seed: 1,
      successChance: 1,
      mission: {
        id: 'out-on-a-run',
        baseId: base.id,
        templateId: 'scrap-run',
        areaId: 'misc',
        payPercent: 0,
        xp: 0,
        force: { razors: 1 },
        vehicles: { motorcycle: 1 },
        pricedMinutes: 60,
        startedAt: new Date().toISOString(),
        recalledAt: null,
        travelMinutes: 30,
        durationMinutes: 60,
        status: 'active',
        officerId: null,
        outcome: null,
        rewards: {},
        spoils: {},
        resolvedAt: null,
        pagePrize: null,
        pageWon: null,
      },
    });

    // The page says the ceiling is reached, counting the one on the road.
    const page = await garage(app, token);
    const bike = page.vehicles.find((row) => row.id === 'motorcycle')!;
    expect(bike.owned).toBe(MAX_PER_VEHICLE - 1);
    expect(bike.out).toBe(1);
    expect(bike.refusal).toBe('There is nowhere left to park another one');

    // And the door agrees, which is the half that could mint a thirteenth bike.
    const refused = await build(app, token, 'motorcycle');
    expect(refused.statusCode, refused.body.slice(0, 200)).toBe(409);
    expect(app.repos.bases.findById(baseId)!.fleet.motorcycle).toBe(MAX_PER_VEHICLE - 1);

    // The positive control: one fewer out, and the same request stands.
    app.repos.missions.markResolved('out-on-a-run', {
      outcome: 'success',
      rewards: {},
      spoils: {},
      resolvedAt: new Date().toISOString(),
      pageWon: null,
    });
    const allowed = await build(app, token, 'motorcycle');
    expect(allowed.statusCode, allowed.body.slice(0, 200)).toBe(200);
    expect(app.repos.bases.findById(baseId)!.fleet.motorcycle).toBe(MAX_PER_VEHICLE);
  });

  it('still refuses the machine after the ceiling with nothing out at all', async () => {
    const { app, token, baseId } = await makeStack();
    raiseGarage(app, baseId, 2);
    stock(app, baseId);
    grantBlueprint(app, baseId, 'bp_motorcycle');

    // Cap minus one: the last one goes in.
    park(app, baseId, { motorcycle: MAX_PER_VEHICLE - 1 });
    expect((await build(app, token, 'motorcycle')).statusCode).toBe(200);
    expect(app.repos.bases.findById(baseId)!.fleet.motorcycle).toBe(MAX_PER_VEHICLE);
    // Cap plus one: refused.
    expect((await build(app, token, 'motorcycle')).statusCode).toBe(409);
    expect(app.repos.bases.findById(baseId)!.fleet.motorcycle).toBe(MAX_PER_VEHICLE);
  });
});
