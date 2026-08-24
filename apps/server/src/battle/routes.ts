import {
  DeclareBattleRequestSchema,
  DeployRequestSchema,
  GarrisonStructureRequestSchema,
  LayTrapRequestSchema,
  MAX_BUILDING_GARRISONS,
  SacrificeInfamyRequestSchema,
  canAfford,
  findSacrifice,
  findTrap,
  isHeldBy,
  spendInfamy,
  spendResources,
  type BattleMutationResponse,
  type BattlesResponse,
  type Base,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { settleFortifications } from '../city/actions.js';
import { settleBase } from '../district/settle.js';
import { AppError, parseBody } from '../errors.js';
import { declareBattle, type DeclareRefusal } from './declare.js';
import { adjustDeployment, sideOf, type DeployRefusal } from './deploy.js';
import { settleBattles } from './resolve.js';
import { projectBattles } from './view.js';

/**
 * The battle board (GDD §A4, battle rework): what is coming, what you have moved up for it, what
 * came back, and the two things infamy buys.
 *
 * Every handler settles first, and the settle order is the same one the city routes use with one
 * more step on the end: the crew's own district and payroll, then any fortification whose clock ran
 * out, then **any fight whose mark has passed**. A battle that went off an hour ago has to have gone
 * off before anybody declares the next one, or a crew could call a fight on ground the world has not
 * noticed changing hands yet.
 */

const REFUSAL_MESSAGES: Record<DeclareRefusal | DeployRefusal, string> = {
  off_slot: 'Fights are called on the half hour, and only on the half hour',
  too_soon: 'Nobody gets less than eight hours to see you coming',
  too_late: 'Nothing is called more than a day out',
  gate_armed: 'That district is shut. The only thing to hit is the gate',
  no_gate: 'Nobody holds all of that district. There is no gate, only locations to take',
  gate_intact: 'The gate is standing. Nothing behind it can be reached',
  nothing_to_break: 'There is nothing built there to break',
  unscouted: 'You have not had eyes on that ground',
  already_declared: 'Somebody has already called that one',
  too_many_pending: 'You have as many calls out as you can answer for',
  own_ground: 'That is yours',
  not_a_participant: 'You are not in that fight',
  deployment_closed: 'They are on the ground. Nobody is moving now',
  not_enough_units: 'You do not have those units to send',
  needs_infamy: 'They will not take a contract from a name that small',
};

function refuse(reason: DeclareRefusal | DeployRefusal): never {
  throw new AppError('BATTLE_REFUSED', REFUSAL_MESSAGES[reason]);
}

export function registerBattleRoutes(app: FastifyInstance): void {
  /** The caller's own crew, with every clock that could have run out already settled. */
  function settled(ownerId: string, now: Date): Base {
    const owned = app.repos.bases.findByOwnerId(ownerId);
    if (!owned) throw new AppError('NO_BASE', 'You do not have a base yet');
    settleFortifications(app.repos, now);
    settleBattles(app.repos, app.skirmishEngine, now);
    // Read *after* the fights, because a resolution writes to this crew's roster and stockpile.
    const fresh = app.repos.bases.findByOwnerId(ownerId) ?? owned;
    return settleBase(app.repos, fresh, now).base;
  }

  const respond = (base: Base, now: Date): BattleMutationResponse => ({
    battles: projectBattles(app.repos, base, now),
    base,
  });

  app.get('/battles', { preHandler: app.authenticate }, (request): BattlesResponse => {
    const now = new Date();
    return projectBattles(app.repos, settled(request.currentUser.id, now), now);
  });

  /** §A4 — call a fight, for a mark between eight and twenty-four hours out. */
  app.post(
    '/battles/declare',
    { preHandler: app.authenticate },
    (request): BattleMutationResponse => {
      const body = parseBody(DeclareBattleRequestSchema, request.body);
      const now = new Date();
      const base = settled(request.currentUser.id, now);

      const outcome = app.db.transaction(() =>
        declareBattle(app.repos, {
          base,
          target: body.target,
          scheduledFor: new Date(body.scheduledFor),
          now,
          holdAfterCapture: body.holdAfterCapture ?? false,
        }),
      )();
      if (outcome.kind === 'refused') refuse(outcome.reason);
      return respond(base, now);
    },
  );

  /** §A4 — send people to a coming fight, or pull them back out of one. */
  app.post(
    '/battles/deploy',
    { preHandler: app.authenticate },
    (request): BattleMutationResponse => {
      const body = parseBody(DeployRequestSchema, request.body);
      const now = new Date();
      const base = settled(request.currentUser.id, now);

      const battle = app.repos.sieges.find(body.battleId);
      if (!battle || battle.resolvedAt !== null) throw new AppError('NOT_FOUND', 'No such fight');
      const side = sideOf(app.repos, battle, base.id);
      if (!side) refuse('not_a_participant');

      const outcome = app.db.transaction(() =>
        adjustDeployment(app.repos, {
          base,
          battle,
          side,
          changes: body.changes,
          perimeterChanges: body.perimeterChanges,
          now,
        }),
      )();
      if (outcome.kind === 'refused') refuse(outcome.reason);
      return respond(outcome.base, now);
    },
  );

  /** §A4 — bury something under the approach to a location you hold. */
  app.post('/battles/trap', { preHandler: app.authenticate }, (request): BattleMutationResponse => {
    const body = parseBody(LayTrapRequestSchema, request.body);
    const now = new Date();
    const base = settled(request.currentUser.id, now);

    const spec = findTrap(body.trapId);
    if (!spec) throw new AppError('NOT_FOUND', 'No such trap');
    const control = app.repos.city.control(body.locationId);
    if (!control || !isHeldBy(control, base.id)) {
      throw new AppError('PLACE_UNAVAILABLE', 'You do not hold that');
    }
    if (!base.research.technologies.includes(spec.requiresTech)) {
      throw new AppError('UNIT_LOCKED', 'The Lab has not worked that one out yet');
    }
    if (app.repos.sieges.trap(body.locationId)) {
      throw new AppError('PLACE_UNAVAILABLE', 'There is already something under there');
    }
    if (!canAfford(base.resources, spec.cost)) {
      throw new AppError('INSUFFICIENT_RESOURCES', 'You cannot cover the materials');
    }

    const next: Base = { ...base, resources: spendResources(base.resources, spec.cost) };
    app.db.transaction(() => {
      app.repos.sieges.setTrap(body.locationId, {
        trapId: spec.id,
        armedAt: now.toISOString(),
      });
      app.repos.bases.updateResources(next.id, next.resources);
    })();
    return respond(next, now);
  });

  /**
   * §A4 — station a watch inside one of your own structures, or stand one down.
   *
   * Costs nothing but the people, and the people are the cost: three watches on the Nexus is three
   * watches that are not on the Greenhouse and not in anybody's field army.
   */
  app.post(
    '/battles/garrison',
    { preHandler: app.authenticate },
    (request): BattleMutationResponse => {
      const body = parseBody(GarrisonStructureRequestSchema, request.body);
      const now = new Date();
      const base = settled(request.currentUser.id, now);

      const building = base.buildings.find((candidate) => candidate.id === body.buildingId);
      if (!building) throw new AppError('NOT_FOUND', 'Nothing of yours by that name');

      const garrisons = Math.min(
        MAX_BUILDING_GARRISONS,
        Math.max(0, building.garrisons + body.delta),
      );
      if (garrisons === building.garrisons) {
        throw new AppError('PLACE_UNAVAILABLE', 'It is as watched as it can be');
      }

      const buildings = base.buildings.map((candidate) =>
        candidate.id === building.id ? { ...candidate, garrisons } : candidate,
      );
      app.repos.bases.updateBuildings(base.id, buildings);
      return respond({ ...base, buildings }, now);
    },
  );

  /** §D7 — burn a name for an advantage. The only thing in the game that lowers infamy. */
  app.post(
    '/battles/sacrifice',
    { preHandler: app.authenticate },
    (request): BattleMutationResponse => {
      const { sacrificeId } = parseBody(SacrificeInfamyRequestSchema, request.body);
      const now = new Date();
      const base = settled(request.currentUser.id, now);

      const spec = findSacrifice(sacrificeId);
      if (!spec) throw new AppError('NOT_FOUND', 'Nothing on offer by that name');
      if (base.economy.sacrifice && Date.parse(base.economy.sacrifice.until) > now.getTime()) {
        throw new AppError('PLACE_UNAVAILABLE', 'You are already spending one');
      }

      const left = spendInfamy(base.economy.infamy, spec.cost);
      if (left === null) throw new AppError('NOT_ENOUGH_INFAMY', 'Your name is not worth that yet');

      const economy = {
        ...base.economy,
        infamy: left,
        sacrifice: {
          id: spec.id,
          until: new Date(now.getTime() + spec.hours * 3_600_000).toISOString(),
        },
      };
      app.repos.bases.updateEconomy(base.id, economy);
      return respond({ ...base, economy }, now);
    },
  );
}
