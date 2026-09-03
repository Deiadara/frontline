import {
  blueprintGateMet,
  DeclareBattleRequestSchema,
  DeployRequestSchema,
  LayTrapRequestSchema,
  BuyBattleBoostRequestSchema,
  LeadBattleRequestSchema,
  TakeVehiclesRequestSchema,
  mergeFleets,
  officerIsInjured,
  removeFleet,
  RecallColumnRequestSchema,
  canAfford,
  boostAvailable,
  findBattleBoost,
  findBlackMarketGood,
  stashCount,
  findTrap,
  deploymentIsOpen,
  emptyDeployment,
  isHeldBy,
  notorietyUpgradeCost,
  spendInfamy,
  spendResources,
  type BattleMutationResponse,
  type ActionsResponse,
  type BattlesResponse,
  type Base,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { settleBase } from '../district/settle.js';
import { AppError, parseBody, type ErrorCode } from '../errors.js';
import { declareBattle, type DeclareRefusal } from './declare.js';
import { adjustDeployment, sideOf, type DeployRefusal } from './deploy.js';
import { recallColumn, type RecallRefusal } from './movement.js';
import { projectActions, projectBattles } from './view.js';
import { seatedRoles } from '../crew/roster.js';
import { settleWorld } from '../world/settle.js';
import { OFFICER_DUTY_MESSAGES, officerDuty } from '../crew/duty.js';

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

const RECALL_ERRORS: Record<RecallRefusal, { code: ErrorCode; message: string }> = {
  unknown_movement: { code: 'NOT_FOUND', message: 'Nothing on the road by that name' },
  not_yours: { code: 'FORBIDDEN', message: 'That is not your column' },
  window_closed: { code: 'PLACE_UNAVAILABLE', message: 'They are too far out to turn around' },
};

/**
 * Exported so the faction reinforcement route says the same sentence for the same refusal.
 *
 * Sending units to an ally's fight goes through `adjustDeployment` exactly as deploying into your
 * own does, so it can be turned away for the same reasons, and a second table of wordings is how
 * "You do not have those units to send" becomes two different sentences on two screens.
 */
export const REFUSAL_MESSAGES: Record<DeclareRefusal | DeployRefusal, string> = {
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
  not_a_fighting_force: 'Scavengers carry. They do not fight. Send them on a mission instead',
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
    // Every clock the shared world runs on, in the one order there is (`world/settle.ts`). Columns
    // that landed while nobody was looking are folded in *before* the fights, a force that arrived
    // at 14:59 for a 15:00 battle has to be on the ground when that battle is resolved, and a
    // captured gate that finished before the mark has to be standing: this path used to settle
    // neither gates nor scouting.
    settleWorld(app.repos, app.skirmishEngine, now);
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

  /** §A4: call a fight, for a mark between eight and twenty-four hours out. */
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

  /** §A4: send people to a coming fight, or pull them back out of one. */
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

  /** §A4: bury something under the approach to a location you hold. */
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
   * §D7: buy the one boost a declared fight is allowed.
   *
   * Paid at the moment it is chosen and never refunded, so changing your mind costs the name twice.
   * One per battle by construction: the id lives on the deployment row, so a second purchase
   * replaces the first rather than stacking with it, and the player is told what that costs before
   * they press it.
   */
  app.post(
    '/battles/boost',
    { preHandler: app.authenticate },
    (request): BattleMutationResponse => {
      const { battleId, boostId } = parseBody(BuyBattleBoostRequestSchema, request.body);
      const now = new Date();
      const base = settled(request.currentUser.id, now);

      const battle = app.repos.sieges.find(battleId);
      if (!battle || battle.resolvedAt !== null) {
        throw new AppError('NOT_FOUND', 'No fight by that name is still coming');
      }
      const side = sideOf(app.repos, battle, base.id);
      if (side === null) throw new AppError('FORBIDDEN', 'You are not in this one');
      if (!deploymentIsOpen(new Date(battle.scheduledFor), now)) {
        throw new AppError('PLACE_UNAVAILABLE', 'They are already on the ground');
      }

      const spec = findBattleBoost(boostId);
      const crate = spec ? undefined : findBlackMarketGood(boostId);
      if (spec === undefined && crate === undefined) {
        throw new AppError('NOT_FOUND', 'Nothing on offer by that name');
      }

      if (spec !== undefined) {
        const allowed = boostAvailable(
          spec,
          {
            technologies: base.research.technologies,
            // A benched officer is in no chair, so they unlock nothing a chair unlocks.
            roles: seatedRoles(base.commanders),
          },
          // §D12e: and the drawings, for the ones that are made rather than proposed.
          (boostId) => blueprintGateMet(base.inventory, 'battle_boost', boostId),
        );
        if (!allowed) throw new AppError('FORBIDDEN', 'Nobody has put that on the table for you');
      } else {
        /*
         * Contraband is applied here rather than applying itself to whatever fight happened next.
         *
         * Nothing is taken out of the bag at this point: the crate is *named* on the deployment and
         * spent when the fight resolves, which is what lets a player change their mind for free
         * right up to the mark. It also means naming the same crate on two battles is legal and
         * only the first one to land gets it, which is checked in `appliedBoost`.
         */
        if (crate?.boost === undefined) {
          throw new AppError('FORBIDDEN', 'That is not something you take into a fight');
        }
        const stash = app.repos.blackMarket.stashFor(base.id);
        if (stashCount(stash, boostId) <= 0) {
          throw new AppError('FORBIDDEN', 'You are not carrying one of those');
        }
      }

      // This crew's own row: a boost is bought against the buyer's deployment, and `side.ts` reads
      // one boost for the whole side, so a reinforcement buying a second would be ignored anyway.
      const deployment =
        app.repos.sieges.deployment(battleId, side, base.id) ??
        emptyDeployment(battleId, base.id, side, now.toISOString());

      /*
       * Buying the boost you already hold is not a change of mind, so it does not cost the name
       * twice: it costs nothing and changes nothing. Charging for it made a double click, a
       * retried request, and re-picking the current boost out of the dropdown (which lists it,
       * undimmed) all bill full price for a row that does not move. Swapping to a *different*
       * boost still pays again, which is the §D7 rule and is pinned by its own test.
       */
      if (deployment.boostId === boostId) return respond(base, now);

      // A crate costs nothing here: it was paid for at the shelf. Only a name burns infamy.
      const left = spec ? spendInfamy(base.economy.infamy, spec.cost) : base.economy.infamy;
      if (left === null) throw new AppError('NOT_ENOUGH_INFAMY', 'Your name is not worth that yet');
      app.repos.sieges.putDeployment({
        ...deployment,
        baseId: base.id,
        boostId,
        updatedAt: now.toISOString(),
      });

      const economy = { ...base.economy, infamy: left };
      app.repos.bases.updateEconomy(base.id, economy);
      return respond({ ...base, economy }, now);
    },
  );

  /**
   * §D1: put one officer at the front of this column, or take them back off it.
   *
   * Free, and free to change right up to the mark. Nothing is spent by naming somebody: what a
   * player is committing is the person, and the price is §D4's stretcher if it goes badly.
   *
   * One officer per **crew**, which the deployment row enforces by holding a single id, and one per
   * **side**, which is enforced here: an ally who names somebody when the crew whose fight it is
   * has already named somebody is refused, because the settler reads exactly one leader per side
   * and the second would silently do nothing.
   */
  app.post('/battles/lead', { preHandler: app.authenticate }, (request): BattleMutationResponse => {
    const { battleId, officerId } = parseBody(LeadBattleRequestSchema, request.body);
    const now = new Date();
    const base = settled(request.currentUser.id, now);

    const battle = app.repos.sieges.find(battleId);
    if (!battle || battle.resolvedAt !== null) {
      throw new AppError('NOT_FOUND', 'No fight by that name is still coming');
    }
    const side = sideOf(app.repos, battle, base.id);
    if (side === null) throw new AppError('FORBIDDEN', 'You are not in this one');
    if (!deploymentIsOpen(new Date(battle.scheduledFor), now)) {
      throw new AppError('PLACE_UNAVAILABLE', 'They are already on the ground');
    }

    if (officerId !== null) {
      const officer = base.commanders.find((held) => held.id === officerId);
      if (!officer) throw new AppError('NOT_FOUND', 'Nobody on your books by that id');
      // §D4: leading is a service, and an officer in a bed is not performing any.
      if (officerIsInjured(officer.injuredUntil, now)) {
        throw new AppError('FORBIDDEN', `${officer.name} is still laid up`);
      }
      const taken = app.repos.sieges
        .side(battle.id, side)
        .some((row) => row.baseId !== base.id && row.officerId !== null);
      if (taken) {
        throw new AppError('FORBIDDEN', 'Somebody on your side is already leading this one');
      }
      /*
       * §D1: one officer, one fight.
       *
       * The clause above only asked whether *this* fight already had a leader, so the same person
       * could be written onto every battle a crew had declared and turn up at all of them: their
       * sheet in each line and their leading perks paid out several times over, off one wage.
       * Declaring is free and reversible, so this was cheap to do by accident as well as on
       * purpose.
       *
       * Refused rather than silently moved. A player who has forgotten where they put somebody is
       * better told than quietly un-led somewhere they are not looking.
       */
      /*
       * ...and one job, not one fight. The clause above was applied only within this system, so an
       * officer already out on a six-hour mission or walking home from a scouting run could still
       * be named to lead: at the mark `leaderFor` finds them on the books and not injured, and puts
       * their sheet and their leading perks into a fight they are nowhere near. `officerDuty` asks
       * the question once for all three doors.
       */
      const duty = officerDuty(app.repos, base, officer, now, battle.id);
      if (duty !== null) {
        throw new AppError('FORBIDDEN', `${officer.name} ${OFFICER_DUTY_MESSAGES[duty]}`);
      }
    }

    const deployment =
      app.repos.sieges.deployment(battleId, side, base.id) ??
      emptyDeployment(battleId, base.id, side, now.toISOString());
    app.repos.sieges.putDeployment({
      ...deployment,
      baseId: base.id,
      officerId,
      updatedAt: now.toISOString(),
    });
    return respond(base, now);
  });

  /**
   * §C3: which machines this crew is taking to this fight.
   *
   * Absolute rather than a delta, and the whole set in one request: a fleet is a dozen machines at
   * the very top end and the picker is a row of counters, so "this is what I am taking" is the
   * honest shape. Committed machines leave the Garage on this request, exactly as deployed units
   * leave the roster, and come back the moment the set is narrowed again.
   *
   * Nothing is spent. What is risked is the machines: a force that is wiped loses everything it
   * took, and the crew that wiped it earns infamy equal to what those machines could carry.
   */
  app.post(
    '/battles/vehicles',
    { preHandler: app.authenticate },
    (request): BattleMutationResponse => {
      const { battleId, vehicles } = parseBody(TakeVehiclesRequestSchema, request.body);
      const now = new Date();
      const base = settled(request.currentUser.id, now);

      const battle = app.repos.sieges.find(battleId);
      if (!battle || battle.resolvedAt !== null) {
        throw new AppError('NOT_FOUND', 'No fight by that name is still coming');
      }
      const side = sideOf(app.repos, battle, base.id);
      if (side === null) throw new AppError('FORBIDDEN', 'You are not in this one');
      if (!deploymentIsOpen(new Date(battle.scheduledFor), now)) {
        throw new AppError('PLACE_UNAVAILABLE', 'They are already on the ground');
      }

      const deployment =
        app.repos.sieges.deployment(battleId, side, base.id) ??
        emptyDeployment(battleId, base.id, side, now.toISOString());
      // Against the yard *plus what this fight already holds*, so narrowing a set is never refused
      // for machines the crew has already handed over to this very battle.
      const available = mergeFleets(base.fleet, deployment.vehicles);
      for (const [id, count] of Object.entries(vehicles)) {
        if ((available[id as keyof typeof available] ?? 0) < (count ?? 0)) {
          throw new AppError('FORBIDDEN', 'You do not have that many in the yard');
        }
      }

      const fleet = removeFleet(available, vehicles);
      app.repos.sieges.putDeployment({
        ...deployment,
        baseId: base.id,
        vehicles,
        updatedAt: now.toISOString(),
      });
      app.repos.bases.updateFleet(base.id, fleet);
      return respond({ ...base, fleet }, now);
    },
  );

  /**
   * §D7: buy the next rung of the ladder.
   *
   * The rank is permanent and the points are gone: that asymmetry is the whole mechanic. A crew that
   * spends its wallet down to nothing on a boost tonight is still Feared tomorrow, and everything
   * gated on the rank stays open.
   */
  /** §A4: everything this crew has on the road. */
  app.get('/actions', { preHandler: app.authenticate }, (request): ActionsResponse => {
    const now = new Date();
    return projectActions(app.repos, settled(request.currentUser.id, now), now);
  });

  /**
   * §A4: turn a column around, inside the first tenth of its walk.
   *
   * The units go straight back onto the roster: they have not reached anybody's ring, so unlike a
   * withdrawal from ground already held, nothing is owed for leaving.
   */
  app.post('/actions/recall', { preHandler: app.authenticate }, (request): ActionsResponse => {
    const { movementId } = parseBody(RecallColumnRequestSchema, request.body);
    const now = new Date();
    const base = settled(request.currentUser.id, now);

    const result = app.db.transaction(() => recallColumn(app.repos, base, movementId, now))();
    if (result.kind === 'refused') {
      const { code, message } = RECALL_ERRORS[result.reason];
      throw new AppError(code, message);
    }
    const fresh = app.repos.bases.findById(base.id) ?? base;
    return projectActions(app.repos, fresh, now);
  });

  app.post(
    '/battles/notoriety',
    { preHandler: app.authenticate },
    (request): BattleMutationResponse => {
      const now = new Date();
      const base = settled(request.currentUser.id, now);

      const cost = notorietyUpgradeCost(base.economy.notoriety);
      if (cost === null) {
        throw new AppError('PLACE_UNAVAILABLE', 'There is no name above the one you have');
      }
      const left = spendInfamy(base.economy.infamy, cost);
      if (left === null) throw new AppError('NOT_ENOUGH_INFAMY', 'Your name is not worth that yet');

      const economy = { ...base.economy, infamy: left, notoriety: base.economy.notoriety + 1 };
      app.repos.bases.updateEconomy(base.id, economy);
      return respond({ ...base, economy }, now);
    },
  );
}
