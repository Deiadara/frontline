import { MAX_PER_VEHICLE, findVehicle, type GarageResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase, runMigrations, type AppDatabase } from '../db/index.js';
import { districtUnitSlots } from '../district/unit-slots.js';
import { settleTraining } from '../units/training.js';
import { chooseOverseer } from '../testing/overseer.js';

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
  const chosen = await chooseOverseer(app, token);
  return { app, token, baseId: chosen.json<{ base: { id: string } }>().base.id };
}

async function garage(app: FastifyInstance, token: string): Promise<GarageResponse> {
  const res = await app.inject({ method: 'GET', url: '/api/garage', headers: auth(token) });
  expect(res.statusCode).toBe(200);
  return res.json<GarageResponse>();
}

/**
 * Run the bench forward so a queued machine is delivered.
 *
 * A vehicle is queued rather than parked now (maintainer request, 2026-09-15): `/garage/build`
 * puts an order on the units' bench and `settleTraining` is what moves it into `base.fleet`. The
 * tests below therefore have to advance a clock where they used to read the yard immediately.
 *
 * Done by rewinding the order's `startedAt` past its own duration rather than by sleeping, which
 * is how `district.test.ts` drives the same bench: the settle is a pure function of the stored
 * timestamp, so moving the timestamp is the whole of "time passed".
 */
function finishTheBench(app: FastifyInstance, baseId: string): void {
  const base = app.repos.bases.findById(baseId)!;
  const long = base.trainingQueue.reduce((most, order) => Math.max(most, order.durationSeconds), 0);
  const started = new Date(Date.now() - (long + 60) * 1000).toISOString();
  app.repos.bases.updateArmy(
    base.id,
    base.army,
    base.trainingQueue.map((order) => ({ ...order, startedAt: started })),
  );
  const settled = settleTraining(app.repos, app.repos.bases.findById(baseId)!, new Date());
  expect(settled.base.trainingQueue, 'the bench emptied').toEqual([]);
}

function raiseGarage(app: FastifyInstance, baseId: string, level: number): void {
  const base = app.repos.bases.findById(baseId)!;
  app.repos.bases.updateDistrict(
    base.id,
    [
      ...base.buildings.filter((building) => building.kind !== 'garage'),
      { id: 'gar', kind: 'garage', level, modifications: [] },
    ],
    base.buildQueue,
  );
}

/**
 * §D12c: put a finished blueprint document in the inventory.
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

    /*
     * Paid for and on the bench, not yet in the yard (maintainer request, 2026-09-15).
     *
     * The money goes immediately and the machine does not, which is exactly what ordering a unit
     * does. Asserting both halves here rather than only the second is what keeps a regression that
     * charged nothing from passing.
     */
    const ordered = app.repos.bases.findById(baseId)!;
    expect(ordered.fleet.motorcycle, 'not parked yet').toBeUndefined();
    expect(ordered.trainingQueue.map((one) => one.unitId)).toEqual(['motorcycle']);
    expect(ordered.resources.scrap).toBeLessThan(before.scrap);
    expect(ordered.resources.oil).toBeLessThan(before.oil);

    finishTheBench(app, baseId);
    expect(app.repos.bases.findById(baseId)!.fleet.motorcycle).toBe(1);
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

    // The positive control: the same request, with the document in the inventory.
    grantBlueprint(app, baseId, 'bp_motorcycle');
    expect((await build(app, token, 'motorcycle')).statusCode).toBe(200);
    finishTheBench(app, baseId);
    expect(app.repos.bases.findById(baseId)!.fleet.motorcycle).toBe(1);
  });

  it('reports seats across the whole yard, which is what a column can be loaded into', async () => {
    const { app, token, baseId } = await makeStack();
    raiseGarage(app, baseId, 2);
    stock(app, baseId);
    grantBlueprint(app, baseId, 'bp_motorcycle');
    await build(app, token, 'motorcycle');
    await build(app, token, 'motorcycle');
    // Seats are counted off machines that exist, so the bench has to run first: two orders on it
    // are two machines the crew cannot load anything into yet.
    finishTheBench(app, baseId);
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
        overseerLed: false,
        lost: {},
        reported: true,
        outcome: null,
        rewards: {},
        spoils: {},
        resolvedAt: null,
        pagePrize: null,
        pageWon: null,
        found: {},
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
      found: {},
    });
    const allowed = await build(app, token, 'motorcycle');
    expect(allowed.statusCode, allowed.body.slice(0, 200)).toBe(200);
    finishTheBench(app, baseId);
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

    /*
     * Refused while the twelfth is still on the bench, not only once it is parked.
     *
     * This is the hole a queued vehicle opens. The ceiling used to be a fact about the yard, and
     * the yard did not change until the machine was delivered, so ordering one at a time would see
     * eleven bikes every time and let a crew stack orders past the cap for them all to land
     * together. `machinesOnTheBench` is what closes it, and this is the assertion that says so:
     * the second order is refused with the fleet still at eleven.
     */
    expect(app.repos.bases.findById(baseId)!.fleet.motorcycle).toBe(MAX_PER_VEHICLE - 1);
    expect((await build(app, token, 'motorcycle')).statusCode).toBe(409);

    // And once it lands, the cap is reached the ordinary way and still holds.
    finishTheBench(app, baseId);
    expect(app.repos.bases.findById(baseId)!.fleet.motorcycle).toBe(MAX_PER_VEHICLE);
    expect((await build(app, token, 'motorcycle')).statusCode).toBe(409);
    expect(app.repos.bases.findById(baseId)!.fleet.motorcycle).toBe(MAX_PER_VEHICLE);
  });
});

/**
 * §A1: a machine takes a bed, the same pool the army and the officers draw on (2026-09-15).
 *
 * One bed whatever it seats. What is asserted here is the *accounting*: charged from the moment
 * the order is written, charged once rather than in both places while it is part way home, and
 * still charged while it is out on a job. The rule itself and its arithmetic are pinned in
 * `building/unit-slots.test.ts`.
 */
describe('what a machine costs the district (§A1)', () => {
  const housed = (app: FastifyInstance, baseId: string) =>
    districtUnitSlots(app.repos, app.repos.bases.findById(baseId)!);

  it('charges the bed at order time and hands it to the yard on delivery, once', async () => {
    const { app, token, baseId } = await makeStack();
    raiseGarage(app, baseId, 2);
    stock(app, baseId);
    grantBlueprint(app, baseId, 'bp_motorcycle');

    const before = housed(app, baseId);
    expect((await build(app, token, 'motorcycle')).statusCode).toBe(200);

    // On the bench: the bed is claimed, and the yard has not moved.
    const queued = housed(app, baseId);
    expect(queued.training - before.training).toBe(1);
    expect(queued.fleet).toBe(before.fleet);
    expect(queued.total).toBe(before.total + 1);

    // Delivered: the same one bed, now in the yard. The total does not move, which is the half
    // that would double-count a machine sitting between the bench and the fleet column.
    finishTheBench(app, baseId);
    const landed = housed(app, baseId);
    expect(landed.fleet).toBe(before.fleet + 1);
    expect(landed.training).toBe(before.training);
    expect(landed.total).toBe(queued.total);
  });

  it('refuses a machine the district has no bed for, on the page and at the door', async () => {
    const { app, token, baseId } = await makeStack();
    raiseGarage(app, baseId, 2);
    stock(app, baseId);
    grantBlueprint(app, baseId, 'bp_motorcycle');

    // Razors are one unit slot apiece, so this fills the district exactly to its ceiling. Added to the
    // army the preset already handed out rather than replacing it, or the swap frees as many beds
    // as it takes and the district is never actually full.
    const base = app.repos.bases.findById(baseId)!;
    const room = housed(app, baseId).spare;
    expect(room).toBeGreaterThan(0);
    const fill = (spare: number) =>
      app.repos.bases.updateArmy(
        base.id,
        { ...base.army, razors: (base.army.razors ?? 0) + spare },
        base.trainingQueue,
      );
    fill(room);
    expect(housed(app, baseId).spare).toBe(0);

    const page = await garage(app, token);
    const bike = page.vehicles.find((row) => row.id === 'motorcycle')!;
    expect(bike.refusal).toBe('Nowhere in the district to house the crew for another one');
    const refused = await build(app, token, 'motorcycle');
    expect(refused.statusCode, refused.body.slice(0, 200)).toBe(409);
    expect(app.repos.bases.findById(baseId)!.trainingQueue).toEqual([]);

    // The positive control: one bed back, and the same request stands.
    fill(room - 1);
    expect(housed(app, baseId).spare).toBe(1);
    expect((await build(app, token, 'motorcycle')).statusCode).toBe(200);
  });

  it('keeps charging for a machine that is out on a run', async () => {
    const { app, token, baseId } = await makeStack();
    raiseGarage(app, baseId, 2);
    stock(app, baseId);
    grantBlueprint(app, baseId, 'bp_motorcycle');
    expect((await build(app, token, 'motorcycle')).statusCode).toBe(200);
    finishTheBench(app, baseId);

    const parked = housed(app, baseId);
    expect(parked.fleet).toBe(1);

    /*
     * Loading it onto a run takes it out of `base.fleet`. If the yard were the whole sum the bed
     * would come free, a training order would take it, and the bike would come home into a
     * district with no room for it: the same hole `unitsAbroad` closes for units.
     */
    const base = app.repos.bases.findById(baseId)!;
    app.repos.bases.updateFleet(base.id, {});
    app.repos.missions.insert({
      seed: 1,
      successChance: 1,
      mission: {
        id: 'the-bike-is-out',
        baseId: base.id,
        templateId: 'scrap-run',
        areaId: 'misc',
        payPercent: 0,
        xp: 0,
        force: {},
        vehicles: { motorcycle: 1 },
        pricedMinutes: 60,
        startedAt: new Date().toISOString(),
        recalledAt: null,
        travelMinutes: 30,
        durationMinutes: 60,
        status: 'active',
        officerId: null,
        overseerLed: false,
        lost: {},
        reported: true,
        outcome: null,
        rewards: {},
        spoils: {},
        resolvedAt: null,
        pagePrize: null,
        pageWon: null,
        found: {},
      },
    });

    const away = housed(app, baseId);
    expect(away.fleet).toBe(1);
    expect(away.spare).toBe(parked.spare);
  });
});
