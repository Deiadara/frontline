import {
  BuildVehicleRequestSchema,
  FitUpgradeRequestSchema,
  ITEM_CATALOG,
  UNIT_UPGRADES,
  UPGRADE_LINE_BLUEPRINT,
  VEHICLES,
  buildingLevel,
  canAfford,
  fleetTravelSpeedPercent,
  findUpgrade,
  findVehicle,
  removeItems,
  spendResources,
  upgradeRefusal,
  vehicleRefusal,
  type Base,
  type ItemCost,
  type ItemId,
  type UpgradeRefusal,
  type VehicleRefusal,
  type WorkshopMutationResponse,
  type WorkshopResponse,
  discounted,
  type PartialResources,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { holdsBlueprint, holdsParts } from '../market/board.js';
import { standingEffectsFor } from '../crew/standing.js';
import { AppError, parseBody } from '../errors.js';

/**
 * The workshop and the yard (workshop extension).
 *
 * Two things that are the same shape: a permanent, one-off purchase that changes what the crew can
 * do, paid for in scrap plus something you cannot grind. They share a route file because they share
 * every rule: a level gate on their structure, a blueprint gate past the first tier, resources,
 * and parts out of the satchel.
 *
 * Upgrades are *built once*, vehicles are *counted*. That is the only real difference: building the
 * same upgrade twice is meaningless, and a second motorcycle is a second motorcycle. Where a built
 * upgrade then goes is the roster's business (`units/loadout.ts`): three brackets per unit.
 */

function ownBase(app: FastifyInstance, ownerId: string): Base {
  const base = app.repos.bases.findByOwnerId(ownerId);
  if (!base) throw new AppError('NO_BASE', 'You do not have a base yet');
  return base;
}

/** The player-facing sentence for every gate. The client never writes one of its own. */
const UPGRADE_TEXT: Record<UpgradeRefusal, (name: string) => string> = {
  unknown_upgrade: () => 'No such upgrade',
  already_fitted: () => 'Already built',
  needs_previous_tier: (name) => `Build ${name} first`,
  needs_blueprint: (name) => `Needs the ${name}`,
  gauntlet_too_low: (name) => `Needs the Gauntlet at level ${name}`,
  cannot_afford: () => 'You cannot cover that',
  missing_parts: (name) => `Short of parts: ${name}`,
};

const VEHICLE_TEXT: Record<VehicleRefusal, (name: string) => string> = {
  unknown_vehicle: () => 'No such machine',
  fleet_full: () => 'The yard will not hold another',
  needs_blueprint: (name) => `Needs the ${name}`,
  garage_too_low: (name) => `Needs the Garage at level ${name}`,
  cannot_afford: () => 'You cannot cover that',
  missing_parts: (name) => `Short of parts: ${name}`,
};

function describeParts(parts: ItemCost): string {
  return Object.entries(parts)
    .map(([id, count]) => `${count}× ${ITEM_CATALOG[id as ItemId].name}`)
    .join(', ');
}

/**
 * §A4: what the ground takes off a workshop bill.
 *
 * The Armory pays for the refits (its bench will fit anything you can find a part for); the Rail
 * Yard pays for the machines (bogies, axles and drive parts by the wagonload). Two channels rather
 * than one, because they are two different locations doing two different favours, and a crew that
 * has taken the Armory should not find its vehicles quietly cheaper as well.
 *
 * `discounted` floors every line at 1, so nothing is ever free: the same rule every other price
 * in the game is subject to.
 */
function refitPrice(app: FastifyInstance, base: Base, cost: PartialResources): PartialResources {
  return discounted(cost, standingEffectsFor(app.repos, base).refitDiscountPercent);
}

function vehiclePrice(app: FastifyInstance, base: Base, cost: PartialResources): PartialResources {
  return discounted(cost, standingEffectsFor(app.repos, base).vehiclePartsPercent);
}

function upgradeBlocker(app: FastifyInstance, base: Base, id: string): string | null {
  const spec = findUpgrade(id);
  if (!spec) return 'No such upgrade';
  const gauntlet = buildingLevel(base.buildings, 'gauntlet');
  const reason = upgradeRefusal(
    id,
    base.fittedUpgrades,
    gauntlet,
    holdsBlueprint(base),
    (cost) => canAfford(base.resources, refitPrice(app, base, cost)),
    holdsParts(base),
  );
  if (reason === null) return null;

  if (reason === 'needs_previous_tier') {
    const previous = UNIT_UPGRADES.find(
      (other) => other.line === spec.line && other.tier === spec.tier - 1,
    );
    return UPGRADE_TEXT.needs_previous_tier(previous?.name ?? 'the tier below');
  }
  if (reason === 'needs_blueprint') {
    return UPGRADE_TEXT.needs_blueprint(ITEM_CATALOG[UPGRADE_LINE_BLUEPRINT[spec.line]].name);
  }
  if (reason === 'gauntlet_too_low') {
    return UPGRADE_TEXT.gauntlet_too_low(String(spec.requiresGauntletLevel));
  }
  if (reason === 'missing_parts') return UPGRADE_TEXT.missing_parts(describeParts(spec.parts));
  return UPGRADE_TEXT[reason]('');
}

function vehicleBlocker(app: FastifyInstance, base: Base, id: string): string | null {
  const spec = findVehicle(id);
  if (!spec) return 'No such machine';
  const garage = buildingLevel(base.buildings, 'garage');
  const reason = vehicleRefusal(
    id,
    base.fleet,
    garage,
    holdsBlueprint(base),
    (cost) => canAfford(base.resources, vehiclePrice(app, base, cost)),
    holdsParts(base),
  );
  if (reason === null) return null;

  if (reason === 'needs_blueprint' && spec.requiresBlueprint !== null) {
    return VEHICLE_TEXT.needs_blueprint(ITEM_CATALOG[spec.requiresBlueprint].name);
  }
  if (reason === 'garage_too_low') {
    return VEHICLE_TEXT.garage_too_low(String(spec.requiresGarageLevel));
  }
  if (reason === 'missing_parts') return VEHICLE_TEXT.missing_parts(describeParts(spec.parts));
  return VEHICLE_TEXT[reason]('');
}

export function projectWorkshop(app: FastifyInstance, base: Base): WorkshopResponse {
  return {
    resources: base.resources,
    inventory: base.inventory,
    upgrades: UNIT_UPGRADES.map((spec) => ({
      id: spec.id,
      line: spec.line,
      tier: spec.tier,
      name: spec.name,
      description: spec.description,
      // Quoted with the crew's own discount on it, because the door charges that number.
      cost: refitPrice(app, base, spec.cost),
      parts: spec.parts,
      effect: spec.effect as Record<string, number>,
      built: base.fittedUpgrades.includes(spec.id),
      blocker: base.fittedUpgrades.includes(spec.id) ? null : upgradeBlocker(app, base, spec.id),
    })),
    vehicles: VEHICLES.map((spec) => ({
      id: spec.id,
      name: spec.name,
      description: spec.description,
      cost: vehiclePrice(app, base, spec.cost),
      parts: spec.parts,
      owned: base.fleet[spec.id] ?? 0,
      travelSpeedPercent: spec.travelSpeedPercent,
      blocker: vehicleBlocker(app, base, spec.id),
    })),
    fleetTravelSpeedPercent: fleetTravelSpeedPercent(base.fleet),
  };
}

export function registerWorkshopRoutes(app: FastifyInstance): void {
  app.get('/workshop', { preHandler: app.authenticate }, (request): WorkshopResponse => {
    return projectWorkshop(app, ownBase(app, request.currentUser.id));
  });

  /** Fit an upgrade. Permanent, and it reaches units already trained. */
  app.post(
    '/workshop/fit',
    { preHandler: app.authenticate },
    (request): WorkshopMutationResponse => {
      const { upgradeId } = parseBody(FitUpgradeRequestSchema, request.body);
      return app.db.transaction(() => {
        const base = ownBase(app, request.currentUser.id);
        const blocker = upgradeBlocker(app, base, upgradeId);
        if (blocker !== null) throw new AppError('WORKSHOP_REFUSED', blocker);

        const spec = findUpgrade(upgradeId);
        if (!spec) throw new AppError('NOT_FOUND', 'No such upgrade');

        const resources = spendResources(base.resources, refitPrice(app, base, spec.cost));
        const inventory = removeItems(base.inventory, spec.parts);
        const fitted = [...base.fittedUpgrades, spec.id];
        app.repos.bases.updateHoldings(base.id, resources, inventory);
        app.repos.bases.updateUpgrades(base.id, fitted);

        return {
          workshop: projectWorkshop(app, { ...base, resources, inventory, fittedUpgrades: fitted }),
        };
      })();
    },
  );

  /** Build a machine. Counted, not fitted: the yard holds several. */
  app.post(
    '/workshop/vehicle',
    { preHandler: app.authenticate },
    (request): WorkshopMutationResponse => {
      const { vehicleId } = parseBody(BuildVehicleRequestSchema, request.body);
      return app.db.transaction(() => {
        const base = ownBase(app, request.currentUser.id);
        const blocker = vehicleBlocker(app, base, vehicleId);
        if (blocker !== null) throw new AppError('WORKSHOP_REFUSED', blocker);

        const spec = findVehicle(vehicleId);
        if (!spec) throw new AppError('NOT_FOUND', 'No such machine');

        const resources = spendResources(base.resources, vehiclePrice(app, base, spec.cost));
        const inventory = removeItems(base.inventory, spec.parts);
        const fleet = { ...base.fleet, [spec.id]: (base.fleet[spec.id] ?? 0) + 1 };
        app.repos.bases.updateHoldings(base.id, resources, inventory);
        app.repos.bases.updateFleet(base.id, fleet);

        return { workshop: projectWorkshop(app, { ...base, resources, inventory, fleet }) };
      })();
    },
  );
}
