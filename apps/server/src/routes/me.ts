import type { MeResponse } from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { fightsCalledOn } from '../battle/declare.js';
import { settleBase } from '../district/settle.js';
import { buildClocksFor, buildQuotesFor } from '../district/build.js';
import { takeLevelUp } from '../progression/award.js';

export function registerMeRoutes(app: FastifyInstance): void {
  app.get('/me', { preHandler: app.authenticate }, (request): MeResponse => {
    const user = request.currentUser;
    const overseer = user.overseerId
      ? (app.repos.overseers.findById(user.overseerId) ?? null)
      : null;
    const owned = app.repos.bases.findByOwnerId(user.id);
    // The one poll the shell always runs, so a build that finished while the player was on another
    // page is settled here. It is also the backstop for every level-up nothing else announced: the
    // world clock's, and any banked by a read route that answers with no `levelUp` of its own.
    // `takeLevelUp` drains the durable marker (migration 0083), so this is drawn exactly once.
    const settled = owned ? settleBase(app.repos, owned, new Date()) : null;
    const base = settled?.base ?? null;
    const levelUp = base ? takeLevelUp(app.repos, base.id) : undefined;
    // The two badges, on the call the shell already polls. See `UnreadCountsSchema`.
    const unread = {
      messages: app.repos.social.unreadMessages(user.id),
      notifications: app.repos.social.unreadNotifications(user.id),
      // The red mark on the bottom bar: fights still to come on this crew's ground.
      fightsOnYou: base ? fightsCalledOn(app.repos, base) : 0,
    };
    // What the next level of each structure will actually cost, discounts included. The dialog
    // cannot work it out: `buildingCostPercent` is a per-structure record and the effects on the
    // wire are flat numbers. See `BuildQuotesSchema`.
    const buildQuotes = base ? buildQuotesFor(app.repos, base) : undefined;
    // And the clock beside it, for the same reason: the speed fold never reaches the client.
    const buildClocks = base
      ? buildClocksFor(app.repos, base, new Date(), app.config.admin)
      : undefined;
    return {
      user,
      overseer,
      base,
      admin: app.config.admin,
      unread,
      buildQuotes,
      buildClocks,
      levelUp,
    };
  });
}
