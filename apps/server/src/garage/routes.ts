import {
  BuildVehicleRequestSchema,
  VEHICLES,
  blueprintForVehicle,
  blueprintGateMet,
  buildingLevel,
  vehicleBuildSeconds,
  canAfford,
  describeBlueprintGate,
  discounted,
  findVehicle,
  fleetCapacity,
  vehicleRefusal,
  VEHICLE_REFUSAL_MESSAGES,
  type Base,
  type GarageMutationResponse,
  type GarageResponse,
  type PartialResources,
  type VehicleRefusal,
  mergeFleets,
  type Fleet,
  MAX_MUSTER_QUEUE,
  MAX_PER_VEHICLE,
  vehicleBatchCost,
  vehiclePartsCut,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { adminWaives } from '../admin/mode.js';
import { standingEffectsFor } from '../crew/standing.js';
import { AppError, parseBody } from '../errors.js';
import { settledOwnBase } from '../routes/own-base.js';
import { districtUnitSlots, vehiclesAbroad } from '../district/unit-slots.js';
import { BENCH_FULL_MESSAGE, queueVehicle } from '../units/muster.js';

/**
 * Machines already ordered and not yet delivered.
 *
 * The ceiling counts what a crew *will* have, not only what it has. A vehicle is built on the
 * units' bench now (maintainer request, 2026-09-15), so without this a player could order past
 * `MAX_PER_VEHICLE` simply by ordering one at a time: every order would see a yard still under the
 * cap, and they would all land together. The cap is on the yard, and a machine on the bench has a
 * space in it reserved.
 */
function machinesOnTheBench(base: Base): Fleet {
  const bench: Fleet = {};
  for (const order of base.musterQueue) {
    const spec = findVehicle(order.unitId);
    if (spec === undefined) continue;
    bench[spec.id] = (bench[spec.id] ?? 0) + (order.count - order.delivered);
  }
  return bench;
}

/**
 * The Garage (GDD §B11, §C).
 *
 * The building grants nothing passively. Its whole value is what is parked in it, so it has a page
 * of its own that works the way the units tab does: every machine in the catalogue, always, with
 * what it costs, what it gives and, where it is locked, the one thing standing in the way.
 *
 * Nothing is queued. A machine is paid for and in the yard on the same request, which is a
 * deliberate difference from a structure: the Garage's interesting decision is *which* machine and
 * *whether the scrap is better spent on units*, and a second build queue with its own settle and
 * its own screen would add a wait without adding a choice.
 */

/**
 * §A4: what the ground takes off a Garage bill (the Rail Yard: bogies, axles and drive parts by
 * the wagonload). `discounted` floors every line at 1, so nothing is ever free.
 */
function price(app: FastifyInstance, base: Base, cost: PartialResources): PartialResources {
  // Bent, not stopped (`vehiclePartsCut`, maintainer 2026-10-05).
  return discounted(
    cost,
    vehiclePartsCut(standingEffectsFor(app.repos, base).vehiclePartsPercent),
    100,
  );
}

/**
 * §D12c: the document that gates a machine, answered out of this crew's inventory.
 *
 * One place, so the row's `hasBlueprint` flag and the refusal that greys its button cannot come
 * to different conclusions about the same machine.
 */
function holdsVehicleBlueprint(base: Base): (vehicleId: string) => boolean {
  return (vehicleId) => blueprintGateMet(base.inventory, 'vehicle', vehicleId);
}

/**
 * The one thing in the way, in the player's words, or null when the yard will build it today.
 *
 * `out` is what this crew has committed to a fight or loaded onto a run. It has to be counted
 * against `MAX_PER_VEHICLE`, because those machines have *left* `base.fleet` and are coming
 * back: without it, "however rich a crew gets, the yard holds this many of one kind" was enforced
 * against the wrong number. Send twelve Cheese Wagons out on a mission, build twelve more while
 * they are away, and the yard holds twenty-four when the crew gets home.
 */
function blockerFor(
  app: FastifyInstance,
  base: Base,
  id: string,
  out: Fleet,
  spare: number,
): string | null {
  const spec = findVehicle(id);
  if (!spec) return VEHICLE_REFUSAL_MESSAGES.unknown_vehicle;
  /*
   * §A1: a machine takes a bed, same as a unit (maintainer request, 2026-09-15).
   *
   * Asked here rather than inside `queueVehicle` so the greyed button on the page and the refusal
   * at the door are the same sentence out of the same comparison. `spare` is `districtUnitSlots`'s
   * own figure, which already counts the officers, the army, the garrisons, the bench and the
   * machines that are out at a fight, so a crew cannot make room by sending the yard away.
   */
  // Admin mode waives the beds, the bench and the purse here as `queueVehicle` does after it, or
  // its waivers were never reached (maintainer, 2026-10-02).
  const admin = app.config.admin;
  if (spare < 1 && !adminWaives('no_unit_slots', admin)) return NO_UNIT_SLOTS_MESSAGE;
  // The bench the units share, as `queueVehicle` refuses it: a card offering Build on a full bench
  // came back "The bench is full" on the press (bug pass, 2026-10-02).
  if (base.musterQueue.length >= MAX_MUSTER_QUEUE && !adminWaives('queue_full', admin)) {
    return BENCH_FULL_MESSAGE;
  }
  const reason: VehicleRefusal | null = vehicleRefusal(
    id,
    mergeFleets(mergeFleets(base.fleet, out), machinesOnTheBench(base)),
    buildingLevel(base.buildings, 'garage'),
    holdsVehicleBlueprint(base),
    (cost) =>
      adminWaives('cannot_afford', admin) || canAfford(base.resources, price(app, base, cost)),
  );
  if (reason === null) return null;
  // Two of the six say *which* level and *which* plans, because "needs a blueprint" with no name
  // on it is not a thing a player can go and do anything about.
  if (reason === 'garage_too_low') {
    return `Needs the Garage at level ${spec.requiresGarageLevel}`;
  }
  if (reason === 'needs_blueprint') {
    return describeBlueprintGate('vehicle', spec.id) ?? VEHICLE_REFUSAL_MESSAGES.needs_blueprint;
  }
  return VEHICLE_REFUSAL_MESSAGES[reason];
}

/** What the page and the door both say when the district has no bed left for another machine. */
const NO_UNIT_SLOTS_MESSAGE = 'Nowhere in the district to house the crew for another one';

/**
 * Why the yard will not take an order for `count` of a machine it would build one of, or null.
 *
 * The card's Max is `maxVehiclesBuildable` off the same three figures (`spareUnitSlots`, the
 * per-kind room and the stockpile), so a batch the card offers is a batch this accepts; what
 * reaches here is a typed number past it, or another tab spending first. Each refusal names the
 * figure that stopped it, which is what a player short by one wants to read.
 */
function batchBlockerFor(
  app: FastifyInstance,
  base: Base,
  id: string,
  count: number,
  out: Fleet,
  spare: number,
): string | null {
  const spec = findVehicle(id);
  if (!spec) return VEHICLE_REFUSAL_MESSAGES.unknown_vehicle;
  const admin = app.config.admin;
  const held = mergeFleets(mergeFleets(base.fleet, out), machinesOnTheBench(base))[spec.id] ?? 0;
  const room = Math.max(0, MAX_PER_VEHICLE - held);
  if (count > room) return `The yard has room for ${room} more of these, not ${count}`;
  if (count > spare && !adminWaives('no_unit_slots', admin)) {
    return `Nowhere in the district to house the crew for ${count} of them`;
  }
  if (
    !adminWaives('cannot_afford', admin) &&
    !canAfford(base.resources, vehicleBatchCost(price(app, base, spec.cost), count))
  ) {
    return `Not enough in the yard to build ${count}`;
  }
  return null;
}

export function projectGarage(app: FastifyInstance, base: Base): GarageResponse {
  const holds = holdsVehicleBlueprint(base);
  const out = vehiclesAbroad(app.repos, base);
  // Once for the page rather than once per row: the fold walks the control table and the roster.
  const spare = districtUnitSlots(app.repos, base).spare;
  const bench = machinesOnTheBench(base);
  return {
    resources: base.resources,
    spareUnitSlots: spare,
    garageLevel: buildingLevel(base.buildings, 'garage'),
    fleet: base.fleet,
    capacity: fleetCapacity(base.fleet),
    vehicles: VEHICLES.map((spec) => ({
      id: spec.id,
      name: spec.name,
      class: spec.class,
      description: spec.description,
      owned: base.fleet[spec.id] ?? 0,
      out: out[spec.id] ?? 0,
      onBench: bench[spec.id] ?? 0,
      // Quoted with the crew's own discount on it, because the door charges that number.
      cost: price(app, base, spec.cost),
      // The yard's own level off it, because the queue charges that number and a screen quoting
      // the catalogue while the route charges something else is a price box that lies.
      buildSeconds: vehicleBuildSeconds(spec, buildingLevel(base.buildings, 'garage')),
      capacity: spec.capacity,
      speed: spec.speed,
      // Deprecated duplicate, one release only: see `GarageVehicleSchema.speedPercent`.
      speedPercent: spec.speed,
      requiresGarageLevel: spec.requiresGarageLevel,
      requiresBlueprint: blueprintForVehicle(spec.id)?.name ?? null,
      hasBlueprint: holds(spec.id),
      refusal: blockerFor(app, base, spec.id, out, spare),
    })),
  };
}

export function registerGarageRoutes(app: FastifyInstance): void {
  app.get('/garage', { preHandler: app.authenticate }, (request): GarageResponse => {
    // Settled, like every other screen that prices against the stockpile: the raw row counted a
    // finished machine still on the bench and missed caps sitting in unbanked production.
    return app.db.transaction(() =>
      projectGarage(app, settledOwnBase(app, request.currentUser.id, new Date())),
    )();
  });

  /** Build a batch of one machine. Counted, not fitted: the yard holds several of a kind. */
  app.post('/garage/build', { preHandler: app.authenticate }, (request): GarageMutationResponse => {
    const { vehicleId, count } = parseBody(BuildVehicleRequestSchema, request.body);
    return app.db.transaction(() => {
      const base = settledOwnBase(app, request.currentUser.id, new Date());
      const out = vehiclesAbroad(app.repos, base);
      const spare = districtUnitSlots(app.repos, base).spare;
      // One first, in the page's own words, then the batch: a card greyed for the plans should be
      // refused for the plans and not for the size of the order typed into it.
      const blocker =
        blockerFor(app, base, vehicleId, out, spare) ??
        batchBlockerFor(app, base, vehicleId, count, out, spare);
      if (blocker !== null) throw new AppError('WORKSHOP_REFUSED', blocker);

      const spec = findVehicle(vehicleId);
      if (!spec) throw new AppError('NOT_FOUND', 'No such machine');

      /*
       * Onto the bench, not straight into the yard (maintainer request, 2026-09-15).
       *
       * This used to pay and hand the machine over in the same breath, which made a vehicle the
       * only thing in the game with a cost and no clock, and left `buildSeconds` on every vehicle
       * spec as data nothing read. It shares the units' queue now: `settleMuster` is what puts
       * it in `base.fleet`, and what counts it for the feats board, on the read that catches it
       * finishing.
       */
      const queued = queueVehicle(app.repos, {
        base,
        vehicle: spec,
        cost: vehicleBatchCost(price(app, base, spec.cost), count),
        count,
        now: new Date(),
        admin: app.config.admin,
      });
      if (queued.kind === 'refused') throw new AppError('WORKSHOP_REFUSED', queued.reason);

      return { garage: projectGarage(app, queued.base) };
    })();
  });
}
