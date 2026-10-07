import type { MeResponse } from '@frontline/shared';
import { featsReadyCount } from '../feats/project.js';
import type { FastifyInstance } from 'fastify';
import { fightsCalledOn } from '../battle/declare.js';
import { productionRatesFor, productionYieldFor, settleBase } from '../district/settle.js';
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
    // One instant for the whole read (bug pass, 2026-10-06): the settle, the quotes and the rates
    // each read their own wall clock and could describe different moments at an injury's edge.
    const now = new Date();
    const settled = owned ? settleBase(app.repos, owned, now) : null;
    const base = settled?.base ?? null;
    const levelUp = base ? takeLevelUp(app.repos, base.id) : undefined;
    // The two badges, on the call the shell already polls. See `UnreadCountsSchema`.
    const unread = {
      messages: app.repos.social.unreadMessages(user.id),
      notifications: app.repos.social.unreadNotifications(user.id),
      // The red mark on the bottom bar: fights still to come on this crew's ground.
      fightsOnYou: base ? fightsCalledOn(app.repos, base) : 0,
      // And the one on the Feats door: finished and waiting to be collected. Off the same
      // evaluation the screen runs, so the badge and the page cannot disagree about the number.
      featsReady: base ? featsReadyCount(app.repos, base) : 0,
    };
    // What the next level of each structure will actually cost, discounts included. The dialog
    // cannot work it out: `buildingCostPercent` is a per-structure record and the effects on the
    // wire are flat numbers. See `BuildQuotesSchema`.
    const buildQuotes = base ? buildQuotesFor(app.repos, base, now) : undefined;
    // And the clock beside it, for the same reason: the speed fold never reaches the client.
    const buildClocks = base ? buildClocksFor(app.repos, base, now, app.config.admin) : undefined;
    // And what the district is making, for the same reason: the ground and the yields stay here.
    const productionRates = base ? productionRatesFor(app.repos, base, now) : undefined;
    const productionYield = base ? productionYieldFor(app.repos, base, now) : undefined;
    return {
      user,
      overseer,
      base,
      admin: app.config.admin,
      unread,
      buildQuotes,
      buildClocks,
      productionRates,
      productionYield,
      levelUp,
    };
  });
}
