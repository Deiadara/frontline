import {
  type BurnRefusal,
  burnUpgrade,
  burnRefusal,
  BurnUpgradeRequestSchema,
  CancelMusterRequestSchema,
  MUSTER_REFUSAL_TEXT,
  MusterUnitsRequestSchema,
  findUnit,
  isPlayerUnit,
  type Base,
  type MusterUnitsResponse,
  type UnitsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { settleLocationUpgrades } from '../city/actions.js';
import { settleBase } from '../district/settle.js';
import { AppError, parseBody, type ErrorCode } from '../errors.js';
import { projectUnits } from '../units/roster.js';
import {
  cancelMuster,
  queueMuster,
  settleMuster,
  type CancelRefusal,
  type MusterRefusal,
} from '../units/muster.js';

/**
 * The unit roster and the bench (GDD §A5).
 *
 * Reads settle first, like everything else: a batch that finished while the page was open joins
 * the army on this very request rather than on the next one.
 */

const REFUSAL_ERRORS: Record<MusterRefusal, { code: ErrorCode; message: string }> = {
  locked: { code: 'UNIT_LOCKED', message: MUSTER_REFUSAL_TEXT.locked },
  queue_full: { code: 'MUSTER_QUEUE_FULL', message: MUSTER_REFUSAL_TEXT.queue_full },
  already_have_one: { code: 'UNIT_LOCKED', message: MUSTER_REFUSAL_TEXT.already_have_one },
  at_the_cap: { code: 'UNIT_LOCKED', message: MUSTER_REFUSAL_TEXT.at_the_cap },
  no_unit_slots: { code: 'NO_UNIT_SLOTS', message: MUSTER_REFUSAL_TEXT.no_unit_slots },
  cannot_afford: { code: 'INSUFFICIENT_RESOURCES', message: MUSTER_REFUSAL_TEXT.cannot_afford },
};

const BURN_ERRORS: Record<BurnRefusal, { code: ErrorCode; message: string }> = {
  unknown_upgrade: { code: 'NOT_FOUND', message: 'No such modification' },
  not_fitted: { code: 'WORKSHOP_REFUSED', message: 'That unit is not wearing it' },
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
    // The upgrades before the crew is read: a level landing settles its holder (`putControl`), and
    // a copy read before that would settle the same stretch of production a second time.
    settleLocationUpgrades(app.repos, now);
    const owned = app.repos.bases.findByOwnerId(ownerId);
    if (!owned) throw new AppError('NO_BASE', 'You do not have a base yet');
    return settleMuster(app.repos, settleBase(app.repos, owned, now).base, now).base;
  }

  app.get('/units', { preHandler: app.authenticate }, (request): UnitsResponse => {
    const now = new Date();
    return projectUnits(app.repos, settled(request.currentUser.id, now), now);
  });

  app.post('/units/muster', { preHandler: app.authenticate }, (request): MusterUnitsResponse => {
    const { unitId, count } = parseBody(MusterUnitsRequestSchema, request.body);
    const now = new Date();
    const base = settled(request.currentUser.id, now);

    /*
     * The Combine's sheets are in the catalogue and are not units anybody can order.
     *
     * `findUnit` resolves an enemy's id as readily as your own, which is what the engine and the
     * garrisons need of it, so the door has to say the fact rather than lean on the gate below.
     * `queueMuster`'s gate is `isUnitUnlocked`, which does refuse a Combine sheet, and its
     * refusal is `locked`, which is on `WAIVED_REFUSALS`: in admin mode, on by default outside
     * the test runner, `POST /units/muster {"unitId":"directive_xero"}` answered 200 and put one
     * of the regime's legendaries on the bench for nothing. Stated here because this is where
     * `MUSTER_REFUSALS` says an id that names nothing a player can field is answered, and
     * because `admin/mode.ts` waives rules about progress and never facts about what exists.
     */
    const unit = findUnit(unitId);
    if (!unit || !isPlayerUnit(unit)) throw new AppError('NOT_FOUND', 'No such unit');

    const result = app.db.transaction(() =>
      queueMuster(app.repos, { base, unit, count, now, admin: app.config.admin }),
    )();
    if (result.kind === 'refused') {
      const { code, message } = REFUSAL_ERRORS[result.reason];
      throw new AppError(code, message);
    }
    return { base: result.base, queue: result.base.musterQueue };
  });

  /**
   * §A5: call a batch off inside its window.
   *
   * A write like any other, so it settles first: an order whose clock ran out while the page was
   * open lands in the army on this request and is then correctly not there to cancel.
   */
  app.post('/units/cancel', { preHandler: app.authenticate }, (request): MusterUnitsResponse => {
    const { orderId, acceptWaste } = parseBody(CancelMusterRequestSchema, request.body);
    const now = new Date();
    const base = settled(request.currentUser.id, now);

    const result = app.db.transaction(() =>
      cancelMuster(app.repos, base, orderId, now, acceptWaste),
    )();
    if (result.kind === 'refused') {
      const { code, message } = CANCEL_ERRORS[result.reason];
      throw new AppError(code, message);
    }
    return { base: result.base, queue: result.base.musterQueue };
  });

  /**
   * §D5c: dismantle a fitted modification.
   *
   * The only way one ever comes off, and it destroys the thing. Putting the same card on a
   * different unit means paying the yard for another, which is what makes bolting one on a
   * decision rather than a loadout screen.
   *
   * Names the unit as well as the card: the same card can be on several sheets, each billed, and
   * a burn pressed on the Razors must leave the Ghosts' copy where it is.
   *
   * Fitting is not here any more (maintainer rule, 2026-09-16). The yard cuts a card *for* a named
   * unit and bolts it on in the same press (`district/scrapyard.ts`), so `POST /units/loadout` and
   * the crew's stock of unfitted cards are both gone: there is nothing left to move around.
   */
  app.post('/units/burn', { preHandler: app.authenticate }, (request): UnitsResponse => {
    const { unitId, upgradeId } = parseBody(BurnUpgradeRequestSchema, request.body);
    const now = new Date();

    return app.db.transaction(() => {
      const base = settled(request.currentUser.id, now);
      const refusal = burnRefusal(base.unitLoadouts, unitId, upgradeId);
      if (refusal !== null) {
        const { code, message } = BURN_ERRORS[refusal];
        throw new AppError(code, message);
      }

      // The brackets only. `fittedUpgrades` is the old shelf, emptied by 0097 and written by
      // nothing since the yard went to one press, so there is no `built` to keep in step.
      const { loadouts } = burnUpgrade(base.unitLoadouts, [], unitId, upgradeId);
      app.repos.bases.updateUnitLoadouts(base.id, loadouts);
      return projectUnits(app.repos, { ...base, unitLoadouts: loadouts }, now);
    })();
  });
}
