import {
  BuildAddonRequestSchema,
  type Base,
  type BuildAddonResponse,
  type ScrapyardResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { standingEffectsFor } from '../crew/standing.js';
import { buildAddon, projectScrapyard, type YardStanding } from '../district/scrapyard.js';
import { settleBase } from '../district/settle.js';
import { AppError, parseBody } from '../errors.js';

/**
 * The Scrapyard's page (§B9): its own route, not a modal on the district.
 *
 * It was one of two doors to a refit until the maintainer's 2026-09-10 call: `routes/workshop.ts` sold
 * the same nine upgrades at a different price and honoured the Armory's discount, and this one did
 * not. The Workshop is gone and the yard is the one shop, so the ground's favour is read here.
 */
export function registerScrapyardRoutes(app: FastifyInstance): void {
  function settled(ownerId: string) {
    const owned = app.repos.bases.findByOwnerId(ownerId);
    if (!owned) throw new AppError('NO_BASE', 'You do not have a base yet');
    return settleBase(app.repos, owned, new Date()).base;
  }

  /** §A4: the Armory pays for the refits. `discounted` floors every line at 1, so nothing is free. */
  const standingOf = (base: Base): YardStanding => ({
    refitDiscountPercent: standingEffectsFor(app.repos, base).refitDiscountPercent,
  });

  app.get('/scrapyard', { preHandler: app.authenticate }, (request): ScrapyardResponse => {
    const base = settled(request.currentUser.id);
    return projectScrapyard(base, standingOf(base));
  });

  app.post('/scrapyard/build', { preHandler: app.authenticate }, (request): BuildAddonResponse => {
    const { kind, id } = parseBody(BuildAddonRequestSchema, request.body);
    return app.db.transaction(() => {
      const base = settled(request.currentUser.id);
      const standing = standingOf(base);
      const result = buildAddon(app.repos, base, kind, id, standing);
      if (result.kind === 'refused') throw new AppError('SCRAPYARD_REFUSED', result.reason);
      return { scrapyard: projectScrapyard(result.base, standing), base: result.base };
    })();
  });
}
