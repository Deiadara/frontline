import {
  type BurnRefusal,
  burnUpgrade,
  burnRefusal,
  BurnUpgradeRequestSchema,
  CancelTrainingRequestSchema,
  TrainUnitsRequestSchema,
  findUnit,
  isPlayerUnit,
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
  locked: { code: 'UNIT_LOCKED', message: 'You cannot field those yet' },
  queue_full: { code: 'TRAINING_QUEUE_FULL', message: 'The bench is full' },
  already_have_one: { code: 'UNIT_LOCKED', message: 'There is only ever one of those' },
  no_unit_slots: { code: 'NO_UNIT_SLOTS', message: 'Your district has nowhere to put any more' },
  cannot_afford: { code: 'INSUFFICIENT_RESOURCES', message: 'You cannot cover the cost' },
};

const BURN_ERRORS: Record<BurnRefusal, { code: ErrorCode; message: string }> = {
  unknown_upgrade: { code: 'NOT_FOUND', message: 'No such modification' },
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

    /*
     * The Combine's sheets are in the catalogue and are not units anybody can order.
     *
     * `findUnit` resolves an enemy's id as readily as your own, which is what the engine and the
     * garrisons need of it, so the door has to say the fact rather than lean on the gate below.
     * `queueTraining`'s gate is `isUnitUnlocked`, which does refuse a Combine sheet, and its
     * refusal is `locked`, which is on `WAIVED_REFUSALS`: in admin mode, on by default outside
     * the test runner, `POST /units/train {"unitId":"directive_xero"}` answered 200 and put one
     * of the regime's legendaries on the bench for nothing. Stated here because this is where
     * `TRAINING_REFUSALS` says an id that names nothing a player can field is answered, and
     * because `admin/mode.ts` waives rules about progress and never facts about what exists.
     */
    const unit = findUnit(unitId);
    if (!unit || !isPlayerUnit(unit)) throw new AppError('NOT_FOUND', 'No such unit');

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
   * §D5c: dismantle a fitted modification.
   *
   * The only way one ever comes off, and it destroys the thing. Putting the same card on a
   * different unit means paying the yard for another, which is what makes bolting one on a
   * decision rather than a loadout screen.
   *
   * Fitting is not here any more (maintainer rule, 2026-09-16). The yard cuts a card *for* a named
   * unit and bolts it on in the same press (`district/scrapyard.ts`), so `POST /units/loadout` and
   * the crew's stock of unfitted cards are both gone: there is nothing left to move around.
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
      return projectUnits(app.repos, { ...base, unitLoadouts: burnt.loadouts }, now);
    })();
  });
}
