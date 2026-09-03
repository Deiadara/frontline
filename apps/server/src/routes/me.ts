import type { MeResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { settleBase } from '../district/settle.js';
import { buildQuotesFor } from '../district/build.js';

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
    // What the next level of each structure will actually cost, discounts included. The dialog
    // cannot work it out: `buildingCostPercent` is a per-structure record and the effects on the
    // wire are flat numbers. See `BuildQuotesSchema`.
    const buildQuotes = base ? buildQuotesFor(app.repos, base) : undefined;
    return { user, overseer, base, admin: app.config.admin, unread, buildQuotes };
  });
}
