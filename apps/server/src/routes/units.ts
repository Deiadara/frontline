import {
  type BurnRefusal,
  burnUpgrade,
  burnRefusal,
  BurnUpgradeRequestSchema,
  CancelTrainingRequestSchema,
  FitSlotRequestSchema,
  TrainUnitsRequestSchema,
  findUnit,
  slotRefusal,
  withSlot,
  type SlotRefusal,
  type Base,
  type TrainUnitsResponse,
  type UnitsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { settleFortifications } from '../city/actions.js';
import { settleBase } from '../district/settle.js';
import { AppError, parseBody, type ErrorCode } from '../errors.js';
import { projectUnits } from '../units/roster.js';
import {
  cancelTraining,
  queueTraining,
  settleTraining,
  type CancelRefusal,
  type TrainingRefusal,
} from '../units/training.js';

/**
 * The unit roster and the bench (GDD §A5).
 *
 * Reads settle first, like everything else: a batch that finished while the page was open joins
 * the army on this very request rather than on the next one.
 */

const REFUSAL_ERRORS: Record<TrainingRefusal, { code: ErrorCode; message: string }> = {
  unknown_unit: { code: 'NOT_FOUND', message: 'No such unit' },
  locked: { code: 'UNIT_LOCKED', message: 'You cannot field those yet' },
  queue_full: { code: 'TRAINING_QUEUE_FULL', message: 'The bench is full' },
  already_have_one: { code: 'UNIT_LOCKED', message: 'There is only ever one of those' },
  no_supply: { code: 'NO_SUPPLY', message: 'Your district has nowhere to put any more' },
  cannot_afford: { code: 'INSUFFICIENT_RESOURCES', message: 'You cannot cover the cost' },
};

const SLOT_ERRORS: Record<SlotRefusal, { code: ErrorCode; message: string }> = {
  bad_slot: { code: 'NOT_FOUND', message: 'There is no bracket there' },
  unknown_upgrade: { code: 'NOT_FOUND', message: 'No such upgrade' },
  not_built: { code: 'WORKSHOP_REFUSED', message: 'The workshop has not built that yet' },
  already_slotted: {
    code: 'WORKSHOP_REFUSED',
    message: 'You only have the one, and it is already bolted to something',
  },
  slot_taken: {
    code: 'WORKSHOP_REFUSED',
    message: 'Something is in that bracket. Burn it first',
  },
  cannot_unfit: {
    code: 'WORKSHOP_REFUSED',
    message: 'It does not come off. It can be burned',
  },
};

const BURN_ERRORS: Record<BurnRefusal, { code: ErrorCode; message: string }> = {
  unknown_upgrade: { code: 'NOT_FOUND', message: 'No such upgrade' },
  not_fitted: { code: 'WORKSHOP_REFUSED', message: 'That is not bolted to anything' },
};

const CANCEL_ERRORS: Record<CancelRefusal, { code: ErrorCode; message: string }> = {
  unknown_order: { code: 'NOT_FOUND', message: 'Nothing on the bench by that name' },
  window_closed: {
    code: 'PLACE_UNAVAILABLE',
    message: 'The work has started. It is theirs now',
  },
};

export function registerUnitRoutes(app: FastifyInstance): void {
  function settled(ownerId: string, now: Date): Base {
    const owned = app.repos.bases.findByOwnerId(ownerId);
    if (!owned) throw new AppError('NO_BASE', 'You do not have a base yet');
    settleFortifications(app.repos, now);
    return settleTraining(app.repos, settleBase(app.repos, owned, now).base, now).base;
  }

  app.get('/units', { preHandler: app.authenticate }, (request): UnitsResponse => {
    const now = new Date();
    return projectUnits(app.repos, settled(request.currentUser.id, now), now);
  });

  app.post('/units/train', { preHandler: app.authenticate }, (request): TrainUnitsResponse => {
    const { unitId, count } = parseBody(TrainUnitsRequestSchema, request.body);
    const now = new Date();
    const base = settled(request.currentUser.id, now);

    const unit = findUnit(unitId);
    if (!unit) throw new AppError('NOT_FOUND', 'No such unit');

    const result = app.db.transaction(() =>
      queueTraining(app.repos, { base, unit, count, now, admin: app.config.admin }),
    )();
    if (result.kind === 'refused') {
      const { code, message } = REFUSAL_ERRORS[result.reason];
      throw new AppError(code, message);
    }
    return { base: result.base, queue: result.base.trainingQueue };
  });

  /**
   * §A5: call a batch off inside its window.
   *
   * A write like any other, so it settles first: an order whose clock ran out while the page was
   * open lands in the army on this request and is then correctly not there to cancel.
   */
  app.post('/units/cancel', { preHandler: app.authenticate }, (request): TrainUnitsResponse => {
    const { orderId } = parseBody(CancelTrainingRequestSchema, request.body);
    const now = new Date();
    const base = settled(request.currentUser.id, now);

    const result = app.db.transaction(() => cancelTraining(app.repos, base, orderId, now))();
    if (result.kind === 'refused') {
      const { code, message } = CANCEL_ERRORS[result.reason];
      throw new AppError(code, message);
    }
    return { base: result.base, queue: result.base.trainingQueue };
  });

  /**
   * §A5: put one of the crew's built upgrades in one of a unit's three brackets, or empty it.
   *
   * Free and instant, both on purpose. The workshop already charged for the upgrade; charging
   * again to move it between units would make the choice something a player avoids making rather
   * than something they play with, and a refit timer on a decision this small is a wait with
   * nothing on the other side of it.
   *
   * Returns the whole roster because every sheet on the page is folded at read time: change a
   * bracket and the stats under it change with it.
   */
  app.post('/units/loadout', { preHandler: app.authenticate }, (request): UnitsResponse => {
    const { unitId, slot, upgradeId } = parseBody(FitSlotRequestSchema, request.body);
    const now = new Date();

    return app.db.transaction(() => {
      const base = settled(request.currentUser.id, now);
      if (!findUnit(unitId)) throw new AppError('NOT_FOUND', 'No such unit');

      const refusal = slotRefusal(base.unitLoadouts, unitId, slot, upgradeId, base.fittedUpgrades);
      if (refusal !== null) {
        const { code, message } = SLOT_ERRORS[refusal];
        throw new AppError(code, message);
      }

      const loadouts = withSlot(base.unitLoadouts, unitId, slot, upgradeId);
      app.repos.bases.updateUnitLoadouts(base.id, loadouts);
      return projectUnits(app.repos, { ...base, unitLoadouts: loadouts }, now);
    })();
  });

  /**
   * §D5c: burn a fitted modification (board request).
   *
   * The only way one ever comes off, and it destroys the thing: gone from the bracket *and* from
   * what the crew has built, so putting the same kind of plate on a different unit means building
   * another one. That is what makes fitting it a decision rather than a loadout screen.
   *
   * Both writes in one transaction, because they are one fact. A crash between them would leave a
   * crew holding a plate that is bolted to nothing, or a bracket pointing at something they no
   * longer own.
   */
  app.post('/units/burn', { preHandler: app.authenticate }, (request): UnitsResponse => {
    const { upgradeId } = parseBody(BurnUpgradeRequestSchema, request.body);
    const now = new Date();

    return app.db.transaction(() => {
      const base = settled(request.currentUser.id, now);
      const refusal = burnRefusal(base.unitLoadouts, upgradeId);
      if (refusal !== null) {
        const { code, message } = BURN_ERRORS[refusal];
        throw new AppError(code, message);
      }

      const burnt = burnUpgrade(base.unitLoadouts, base.fittedUpgrades, upgradeId);
      app.repos.bases.updateUnitLoadouts(base.id, burnt.loadouts);
      app.repos.bases.updateUpgrades(base.id, [...burnt.built]);
      return projectUnits(
        app.repos,
        { ...base, unitLoadouts: burnt.loadouts, fittedUpgrades: [...burnt.built] },
        now,
      );
    })();
  });
}
