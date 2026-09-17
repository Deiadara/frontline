import {
  BLACK_MARKET_REFUSAL_TEXT,
  GAME_TIMEZONE,
  PlaceBlackMarketBidRequestSchema,
  type BlackMarketMutationResponse,
  type Base,
  type BlackMarketResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import {
  placeBlackMarketBid,
  projectBlackMarket,
  settleBlackMarketLots,
} from '../blackmarket/shelf.js';
import { cityAsked } from '../city/stakes.js';
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
 * player's read and their click, somebody else in the city may have bid over them or the day may
 * have turned. A delta would leave the screen showing a lot that has already been settled.
 *
 * Both close the lots that are due first, the way `/market` does. There is no scheduler: a player
 * opening the shelf five minutes after midnight is the one who settles last night's five, and they
 * must see what they won on that very read rather than on the next one.
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
  /**
   * The city a request asked for, or the refusal. The barrow's own gate, word for word.
   *
   * A crew may stand in the back room of any city they hold ground in, and a city they hold nothing
   * in is refused rather than quietly answered with their own room: the lots in it are different
   * lots, and answering the wrong room to somebody thrown out of a city since they bookmarked it
   * would have them bidding on crates they cannot win.
   */
  const cityOrRefuse = (base: Base, asked: string | undefined): string => {
    const cityId = cityAsked(app.repos, base, asked);
    if (cityId === null) {
      throw new AppError('CITY_SHUT', 'You hold no ground in that city. Take a place in it first.');
    }
    return cityId;
  };

  app.get('/black-market', { preHandler: app.authenticate }, (request): BlackMarketResponse => {
    const now = new Date();
    settleBlackMarketLots(app.repos, now, GAME_TIMEZONE);
    const base = ownBase(app, request.currentUser.id);
    const cityId = cityOrRefuse(base, (request.query as { city?: string } | undefined)?.city);
    return projectBlackMarket(app.repos, base, now, GAME_TIMEZONE, cityId);
  });

  /** Say a number on one of the five lots. The close hands the crate over at midnight. */
  app.post(
    '/black-market/bid',
    { preHandler: app.authenticate },
    (request): BlackMarketMutationResponse => {
      const { slotIndex, goodId, amount, city } = parseBody(
        PlaceBlackMarketBidRequestSchema,
        request.body,
      );
      const now = new Date();
      // The close first, the way `/market/bid` does it: a bid landing just after midnight belongs
      // to today's shelf, and last night's lot has to be settled before anything is written.
      settleBlackMarketLots(app.repos, now, GAME_TIMEZONE);

      return app.db.transaction(() => {
        const base = ownBase(app, request.currentUser.id);
        const result = placeBlackMarketBid(app.repos, {
          base,
          userId: request.currentUser.id,
          slotIndex,
          goodId,
          amount,
          now,
          zone: GAME_TIMEZONE,
          // Checked here rather than trusted: a bid names the room it is placed in, and a crew that
          // has been thrown out of a city since the screen loaded must not be able to keep bidding.
          cityId: cityOrRefuse(base, city),
        });
        if (result.kind === 'refused') {
          throw new AppError('BLACK_MARKET_REFUSED', BLACK_MARKET_REFUSAL_TEXT[result.reason]);
        }
        app.repos.history.record({
          actorId: request.currentUser.id,
          baseId: base.id,
          kind: 'blackmarket.bid',
          payload: { goodId, slotIndex, amount },
        });
        return { blackMarket: projectBlackMarket(app.repos, base, now, GAME_TIMEZONE) };
      })();
    },
  );
}
