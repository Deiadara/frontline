import type { MeResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';

export function registerMeRoutes(app: FastifyInstance): void {
  app.get('/me', { preHandler: app.authenticate }, (request): MeResponse => {
    const user = request.currentUser;
    const overseer = user.overseerId
      ? (app.repos.overseers.findById(user.overseerId) ?? null)
      : null;
    const base = app.repos.bases.findByOwnerId(user.id) ?? null;
    return { user, overseer, base };
  });
}
