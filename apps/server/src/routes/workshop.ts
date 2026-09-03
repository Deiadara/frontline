import {
  FitUpgradeRequestSchema,
  ITEM_CATALOG,
  UNIT_UPGRADES,
  blueprintGateMet,
  buildingLevel,
  canAfford,
  describeBlueprintGate,
  findUpgrade,
  removeItems,
  spendResources,
  upgradeRefusal,
  type Base,
  type ItemCost,
  type ItemId,
  type UpgradeRefusal,
  type WorkshopMutationResponse,
  type WorkshopResponse,
  discounted,
  type PartialResources,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { holdsParts } from '../market/board.js';
import { standingEffectsFor } from '../crew/standing.js';
import { AppError, parseBody } from '../errors.js';
import { ownBase } from './own-base.js';

/**
 * The workshop (workshop extension).
 *
 * A permanent, one-off purchase that changes what the crew can do, paid for in scrap plus
 * something you cannot grind: a level gate on the Gauntlet, a blueprint gate past the first tier,
 * resources, and parts out of the satchel.
 *
 * The yard used to be here too, on the grounds that a vehicle is the same shape of purchase. §B11
 * gave the Garage a page of its own, so building a machine is `garage/routes.ts` now: an upgrade
 * is *built once* and lands on a unit's brackets (`units/loadout.ts`), and a machine is *counted*
 * and lands on a fight.
 */

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

function upgradeBlocker(app: FastifyInstance, base: Base, id: string): string | null {
  const spec = findUpgrade(id);
  if (!spec) return 'No such upgrade';
  const gauntlet = buildingLevel(base.buildings, 'gauntlet');
  const reason = upgradeRefusal(
    id,
    base.fittedUpgrades,
    gauntlet,
    (upgradeId) => blueprintGateMet(base.inventory, 'unit_upgrade', upgradeId),
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
    // §D12g: the document, named. `describeBlueprintGate` already writes the whole sentence, so
    // the template here would double the "Needs the".
    return describeBlueprintGate('unit_upgrade', spec.id) ?? UPGRADE_TEXT.needs_blueprint('plans');
  }
  if (reason === 'gauntlet_too_low') {
    return UPGRADE_TEXT.gauntlet_too_low(String(spec.requiresGauntletLevel));
  }
  if (reason === 'missing_parts') return UPGRADE_TEXT.missing_parts(describeParts(spec.parts));
  return UPGRADE_TEXT[reason]('');
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
}
