import {
  BuildVehicleRequestSchema,
  VEHICLES,
  blueprintForVehicle,
  blueprintGateMet,
  buildingLevel,
  canAfford,
  describeBlueprintGate,
  discounted,
  findVehicle,
  fleetCapacity,
  spendResources,
  vehicleRefusal,
  VEHICLE_REFUSAL_MESSAGES,
  type Base,
  type GarageMutationResponse,
  type GarageResponse,
  type PartialResources,
  type VehicleRefusal,
  mergeFleets,
  type Fleet,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { standingEffectsFor } from '../crew/standing.js';
import { AppError, parseBody } from '../errors.js';
import { ownBase } from '../routes/own-base.js';

/**
 * §C3: every machine of this crew's that is not in the yard because it is somewhere else.
 *
 * Committed to a fight still coming (the deployment row holds them until the settle hands the
 * survivors back), or carrying a crew on a run (the mission row holds them until the crew is
 * home). Both leave `base.fleet` on the request that names them, so this is the only way the page
 * can say where the yard went.
 */
function machinesOut(app: FastifyInstance, base: Base): Fleet {
  const committed = app.repos.sieges
    .deploymentsFor(base.id)
    .map((deployment) => deployment.vehicles)
    .reduce(mergeFleets, {} as Fleet);
  const riding = app.repos.missions
    .listActiveByBaseId(base.id)
    .map((stored) => stored.mission.vehicles)
    .reduce(mergeFleets, {} as Fleet);
  return mergeFleets(committed, riding);
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
  return discounted(cost, standingEffectsFor(app.repos, base).vehiclePartsPercent);
}

/**
 * §D12c: the document that gates a machine, answered out of this crew's satchel.
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
function blockerFor(app: FastifyInstance, base: Base, id: string, out: Fleet): string | null {
  const spec = findVehicle(id);
  if (!spec) return VEHICLE_REFUSAL_MESSAGES.unknown_vehicle;
  const reason: VehicleRefusal | null = vehicleRefusal(
    id,
    mergeFleets(base.fleet, out),
    buildingLevel(base.buildings, 'garage'),
    holdsVehicleBlueprint(base),
    (cost) => canAfford(base.resources, price(app, base, cost)),
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

export function projectGarage(app: FastifyInstance, base: Base): GarageResponse {
  const holds = holdsVehicleBlueprint(base);
  const out = machinesOut(app, base);
  return {
    resources: base.resources,
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
      // Quoted with the crew's own discount on it, because the door charges that number.
      cost: price(app, base, spec.cost),
      buildSeconds: spec.buildSeconds,
      capacity: spec.capacity,
      speed: spec.speed,
      // Deprecated duplicate, one release only: see `GarageVehicleSchema.speedPercent`.
      speedPercent: spec.speed,
      requiresGarageLevel: spec.requiresGarageLevel,
      requiresBlueprint: blueprintForVehicle(spec.id)?.name ?? null,
      hasBlueprint: holds(spec.id),
      refusal: blockerFor(app, base, spec.id, out),
    })),
  };
}

export function registerGarageRoutes(app: FastifyInstance): void {
  app.get('/garage', { preHandler: app.authenticate }, (request): GarageResponse => {
    return projectGarage(app, ownBase(app, request.currentUser.id));
  });

  /** Build a machine. Counted, not fitted: the yard holds several of a kind. */
  app.post('/garage/build', { preHandler: app.authenticate }, (request): GarageMutationResponse => {
    const { vehicleId } = parseBody(BuildVehicleRequestSchema, request.body);
    return app.db.transaction(() => {
      const base = ownBase(app, request.currentUser.id);
      const blocker = blockerFor(app, base, vehicleId, machinesOut(app, base));
      if (blocker !== null) throw new AppError('WORKSHOP_REFUSED', blocker);

      const spec = findVehicle(vehicleId);
      if (!spec) throw new AppError('NOT_FOUND', 'No such machine');

      const resources = spendResources(base.resources, price(app, base, spec.cost));
      const fleet = { ...base.fleet, [spec.id]: (base.fleet[spec.id] ?? 0) + 1 };
      app.repos.bases.updateResources(base.id, resources);
      app.repos.bases.updateFleet(base.id, fleet);

      return { garage: projectGarage(app, { ...base, resources, fleet }) };
    })();
  });
}
