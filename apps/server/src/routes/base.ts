import type { BaseDetailResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { settleBaseEconomy } from '../economy/settle.js';
import { AppError } from '../errors.js';

export function registerBaseRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>(
    '/base/:id',
    { preHandler: app.authenticate },
    (request): BaseDetailResponse => {
      const base = app.repos.bases.findById(request.params.id);
      if (!base) {
        throw new AppError('NOT_FOUND', 'That base no longer exists');
      }
      if (base.ownerId !== request.currentUser.id) {
        throw new AppError('FORBIDDEN', 'You do not have access to this base');
      }
      return { base: settleBaseEconomy(app.repos, base, new Date()) };
    },
  );
}
