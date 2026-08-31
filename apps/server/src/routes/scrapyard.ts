import {
  BuildAddonRequestSchema,
  type BuildAddonResponse,
  type ScrapyardResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { buildAddon, projectScrapyard } from '../district/scrapyard.js';
import { settleBase } from '../district/settle.js';
import { AppError, parseBody } from '../errors.js';

/**
 * The Scrapyard's page (§B9): its own route, not a modal on the district.
 *
 * A separate file from `workshop.ts` on purpose. The workshop is the crew's bench and the yard is
 * the crew's shop, and they answer different questions; folding the yard into the workshop's route
 * would have put two screens' worth of gates behind one projection and made either one hard to
 * change without touching the other.
 */
export function registerScrapyardRoutes(app: FastifyInstance): void {
  function settled(ownerId: string) {
    const owned = app.repos.bases.findByOwnerId(ownerId);
    if (!owned) throw new AppError('NO_BASE', 'You do not have a base yet');
    return settleBase(app.repos, owned, new Date()).base;
  }

  app.get('/scrapyard', { preHandler: app.authenticate }, (request): ScrapyardResponse => {
    return projectScrapyard(settled(request.currentUser.id));
  });

  app.post('/scrapyard/build', { preHandler: app.authenticate }, (request): BuildAddonResponse => {
    const { kind, id } = parseBody(BuildAddonRequestSchema, request.body);
    return app.db.transaction(() => {
      const base = settled(request.currentUser.id);
      const result = buildAddon(app.repos, base, kind, id);
      if (result.kind === 'refused') throw new AppError('SCRAPYARD_REFUSED', result.reason);
      return { scrapyard: projectScrapyard(result.base), base: result.base };
    })();
  });
}
