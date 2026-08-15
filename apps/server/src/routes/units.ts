import {
  TrainUnitsRequestSchema,
  findUnit,
  type Base,
  type TrainUnitsResponse,
  type UnitsResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { settleFortifications } from '../city/actions.js';
import { settleBase } from '../district/settle.js';
import { AppError, parseBody, type ErrorCode } from '../errors.js';
import { projectUnits } from '../units/roster.js';
import { queueTraining, settleTraining, type TrainingRefusal } from '../units/training.js';

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
  no_supply: { code: 'NO_SUPPLY', message: 'Your Gauntlet cannot support any more' },
  cannot_afford: { code: 'INSUFFICIENT_RESOURCES', message: 'You cannot cover the cost' },
};

export function registerUnitRoutes(app: FastifyInstance): void {
  function settled(ownerId: string, now: Date): Base {
    const owned = app.repos.bases.findByOwnerId(ownerId);
    if (!owned) throw new AppError('NO_BASE', 'You do not have a base yet');
    settleFortifications(app.repos, now);
    return settleTraining(app.repos, settleBase(app.repos, owned, now).base, now);
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

    const result = app.db.transaction(() => queueTraining(app.repos, { base, unit, count, now }))();
    if (result.kind === 'refused') {
      const { code, message } = REFUSAL_ERRORS[result.reason];
      throw new AppError(code, message);
    }
    return { base: result.base, queue: result.base.trainingQueue };
  });
}
