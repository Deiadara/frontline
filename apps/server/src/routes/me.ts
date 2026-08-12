import type { MeResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { settleBaseEconomy } from '../economy/settle.js';

export function registerMeRoutes(app: FastifyInstance): void {
  app.get('/me', { preHandler: app.authenticate }, (request): MeResponse => {
    const user = request.currentUser;
    const overseer = user.overseerId
      ? (app.repos.overseers.findById(user.overseerId) ?? null)
      : null;
    const owned = app.repos.bases.findByOwnerId(user.id);
    const base = owned ? settleBaseEconomy(app.repos, owned, new Date()) : null;
    return { user, overseer, base };
  });
}
