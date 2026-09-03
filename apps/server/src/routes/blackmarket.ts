import {
  BLACK_MARKET_REFUSAL_TEXT,
  GAME_TIMEZONE,
  TakeBlackMarketRequestSchema,
  type BlackMarketMutationResponse,
  type BlackMarketResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { projectBlackMarket, takeFromBlackMarket } from '../blackmarket/shelf.js';
import { AppError, parseBody } from '../errors.js';
import { ownBase } from './own-base.js';

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
 * The **house clock** decides which day they are shopping on, and that is deliberate rather than a
 * shrug at internationalisation. `time/zone.ts` states the rule: a player may move the display to
 * their own timezone, and the day boundary the rules use does not move with them.
 *
 * This route used to read `currentUser.timezone`, which is a value the player sets with one
 * `PATCH /settings/profile`. The day string is both the once-a-day limit's key and the shelf's
 * seed, so take, change timezone, take again: at the right hour three distinct days are reachable,
 * which makes a once-a-day good a three-a-day good and lets you reroll the shelf until the one you
 * want is on it. A limit keyed to something the limited party controls is not a limit.
 */

export function registerBlackMarketRoutes(app: FastifyInstance): void {
  app.get('/black-market', { preHandler: app.authenticate }, (request): BlackMarketResponse => {
    return projectBlackMarket(
      app.repos,
      ownBase(app, request.currentUser.id),
      new Date(),
      GAME_TIMEZONE,
    );
  });

  app.post(
    '/black-market/take',
    { preHandler: app.authenticate },
    (request): BlackMarketMutationResponse => {
      const { slotIndex, goodId } = parseBody(TakeBlackMarketRequestSchema, request.body);
      const now = new Date();

      return app.db.transaction(() => {
        const base = ownBase(app, request.currentUser.id);
        const result = takeFromBlackMarket(app.repos, base, slotIndex, goodId, now, GAME_TIMEZONE);
        if (result.kind === 'refused') {
          throw new AppError('BLACK_MARKET_REFUSED', BLACK_MARKET_REFUSAL_TEXT[result.reason]);
        }
        app.repos.history.record({
          actorId: request.currentUser.id,
          baseId: result.base.id,
          kind: 'blackmarket.taken',
          payload: { goodId: result.goodId, slotIndex },
        });
        return { blackMarket: projectBlackMarket(app.repos, result.base, now, GAME_TIMEZONE) };
      })();
    },
  );
}
