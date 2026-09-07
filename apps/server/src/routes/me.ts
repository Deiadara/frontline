import type { MeResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { settleBase } from '../district/settle.js';
import { buildQuotesFor } from '../district/build.js';
import { levelUpFrom } from '../progression/award.js';

export function registerMeRoutes(app: FastifyInstance): void {
  app.get('/me', { preHandler: app.authenticate }, (request): MeResponse => {
    const user = request.currentUser;
    const overseer = user.overseerId
      ? (app.repos.overseers.findById(user.overseerId) ?? null)
      : null;
    const owned = app.repos.bases.findByOwnerId(user.id);
    // The one poll the shell always runs, so a build that finished while the player was on another
    // page is settled here, and this is the only response that ever knows it crossed a level.
    const settled = owned ? settleBase(app.repos, owned, new Date()) : null;
    const base = settled?.base ?? null;
    const levelUp = settled ? levelUpFrom(settled.awards) : undefined;
    // The two badges, on the call the shell already polls. See `UnreadCountsSchema`.
    const unread = {
      messages: app.repos.social.unreadMessages(user.id),
      notifications: app.repos.social.unreadNotifications(user.id),
    };
    // What the next level of each structure will actually cost, discounts included. The dialog
    // cannot work it out: `buildingCostPercent` is a per-structure record and the effects on the
    // wire are flat numbers. See `BuildQuotesSchema`.
    const buildQuotes = base ? buildQuotesFor(app.repos, base) : undefined;
    return { user, overseer, base, admin: app.config.admin, unread, buildQuotes, levelUp };
  });
}
