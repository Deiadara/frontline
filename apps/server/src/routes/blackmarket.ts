import {
  BLACK_MARKET_REFUSAL_TEXT,
  GAME_TIMEZONE,
  TakeBlackMarketRequestSchema,
  type Base,
  type BlackMarketMutationResponse,
  type BlackMarketResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { projectBlackMarket, takeFromBlackMarket } from '../blackmarket/shelf.js';
import { AppError, parseBody } from '../errors.js';

/**
 * The back room (black-market extension).
 *
 * A separate route file from `market.ts` rather than three more handlers on it. The two shops share
 * a screen and nothing else: one spends caps and resources against a private stockpile, the other
 * spends infamy against a shelf the whole city is looking at, and folding them together would put
 * two settlement models behind one prefix.
 *
 * Both handlers answer with the whole shelf for the same reason the trading board does: between one
 * player's read and their click, somebody else in the city may have emptied the slot they were
 * aiming at. A delta would leave the screen showing a thing that is no longer there.
 *
 * The player's own timezone decides which day they are shopping on, because the day boundary is a
 * wall clock and the wall clock is theirs. A player who has not changed it is on Athens time, which
 * is the house clock and the default.
 */

function ownBase(app: FastifyInstance, ownerId: string): Base {
  const base = app.repos.bases.findByOwnerId(ownerId);
  if (!base) throw new AppError('NO_BASE', 'You do not have a base yet');
  return base;
}

export function registerBlackMarketRoutes(app: FastifyInstance): void {
  app.get('/black-market', { preHandler: app.authenticate }, (request): BlackMarketResponse => {
    const zone = request.currentUser.timezone || GAME_TIMEZONE;
    return projectBlackMarket(app.repos, ownBase(app, request.currentUser.id), new Date(), zone);
  });

  app.post(
    '/black-market/take',
    { preHandler: app.authenticate },
    (request): BlackMarketMutationResponse => {
      const { slotIndex, goodId } = parseBody(TakeBlackMarketRequestSchema, request.body);
      const now = new Date();
      const zone = request.currentUser.timezone || GAME_TIMEZONE;

      return app.db.transaction(() => {
        const base = ownBase(app, request.currentUser.id);
        const result = takeFromBlackMarket(app.repos, base, slotIndex, goodId, now, zone);
        if (result.kind === 'refused') {
          throw new AppError('BLACK_MARKET_REFUSED', BLACK_MARKET_REFUSAL_TEXT[result.reason]);
        }
        app.repos.history.record({
          actorId: request.currentUser.id,
          baseId: result.base.id,
          kind: 'blackmarket.taken',
          payload: { goodId: result.goodId, slotIndex },
        });
        return { blackMarket: projectBlackMarket(app.repos, result.base, now, zone) };
      })();
    },
  );
}
