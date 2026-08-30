import type { MeResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { settleBase } from '../district/settle.js';

export function registerMeRoutes(app: FastifyInstance): void {
  app.get('/me', { preHandler: app.authenticate }, (request): MeResponse => {
    const user = request.currentUser;
    const overseer = user.overseerId
      ? (app.repos.overseers.findById(user.overseerId) ?? null)
      : null;
    const owned = app.repos.bases.findByOwnerId(user.id);
    const base = owned ? settleBase(app.repos, owned, new Date()).base : null;
    // The two badges, on the call the shell already polls. See `UnreadCountsSchema`.
    const unread = {
      messages: app.repos.social.unreadMessages(user.id),
      notifications: app.repos.social.unreadNotifications(user.id),
    };
    return { user, overseer, base, admin: app.config.admin, unread };
  });
}
