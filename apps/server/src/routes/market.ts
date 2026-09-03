import {
  UnlockBlueprintRequestSchema,
  unlockBlueprint,
  unlockRefusal,
  reimagine,
  reimaginingRefusal,
  isReimaginingResearched,
  type ReimaginingContext,
  type ReimagineResponse,
  BARTER_MINIMUM,
  BarterRequestSchema,
  BuyFromVendorRequestSchema,
  BuySupplyRequestSchema,
  OfferActionRequestSchema,
  PostOfferRequestSchema,
  type Base,
  type MarketMutationResponse,
  type MarketResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import {
  MARKET_REFUSAL_TEXT,
  acceptOffer,
  barter,
  buyFromVendor,
  buySupply,
  postOffer,
  projectMarket,
  sweepExpiredOffers,
  withdrawOffer,
  type MarketRefusal,
} from '../market/board.js';
import { AppError, parseBody } from '../errors.js';
import { ownBase } from './own-base.js';
import { seatedRoles } from '../crew/roster.js';

/**
 * The market (market extension).
 *
 * Every read sweeps expired listings first, for the same reason every other read settles its own
 * clocks: there is no scheduler, and a listing that stood past its lifetime has to give its goods
 * back the next time anybody looks at the board rather than the next time a cron job runs.
 *
 * Every write answers with the whole refreshed board. A market is the one screen where what
 * somebody else did between your last read and this one changes what you should do next, so
 * handing back a delta would leave the client showing a listing that is already gone.
 */

function refuse(reason: MarketRefusal): never {
  throw new AppError('MARKET_REFUSED', MARKET_REFUSAL_TEXT[reason]);
}

export function registerMarketRoutes(app: FastifyInstance): void {
  const board = (base: Base, now: Date): MarketResponse => projectMarket(app.repos, base, now);

  app.get('/market', { preHandler: app.authenticate }, (request): MarketResponse => {
    const now = new Date();
    const base = ownBase(app, request.currentUser.id);
    app.db.transaction(() => sweepExpiredOffers(app.repos, now))();
    return board(app.repos.bases.findByOwnerId(base.ownerId) ?? base, now);
  });

  /** Buy from the Runner, while he is in. */
  app.post('/market/buy', { preHandler: app.authenticate }, (request): MarketMutationResponse => {
    const { lineId, count } = parseBody(BuyFromVendorRequestSchema, request.body);
    const now = new Date();
    return app.db.transaction(() => {
      const result = buyFromVendor(
        app.repos,
        ownBase(app, request.currentUser.id),
        lineId,
        count,
        now,
      );
      if (result.kind === 'refused') refuse(result.reason);
      return { market: board(result.base, now) };
    })();
  });

  /**
   * §D10: turning a complete set of pages into the blueprint.
   *
   * On the market routes rather than on a blueprints controller of its own, because a blueprint and
   * its pages are items: they live in `inventory_json` beside every other thing a crew holds, and
   * this answers with the same board every other holdings mutation answers with, so the satchel
   * updates from the response instead of racing a refetch.
   *
   * The whole rule is in `unlockBlueprint`, which is pure and tested in shared. This route is the
   * transaction around it and nothing else: refuse, spend, write, answer.
   */
  app.post(
    '/blueprints/unlock',
    { preHandler: app.authenticate },
    (request): MarketMutationResponse => {
      const { blueprintId } = parseBody(UnlockBlueprintRequestSchema, request.body);
      const now = new Date();
      return app.db.transaction(() => {
        const base = ownBase(app, request.currentUser.id);
        const refusal = unlockRefusal(base.inventory, blueprintId);
        if (refusal !== null) throw new AppError('BLUEPRINT_REFUSED', refusal);

        const inventory = unlockBlueprint(base.inventory, blueprintId);
        // `unlockRefusal` already cleared every reason this can be null, so a null here is the two
        // of them disagreeing rather than a state a player can reach.
        if (inventory === null) throw new AppError('BLUEPRINT_REFUSED', 'missing_pages');

        app.repos.bases.updateHoldings(base.id, base.resources, inventory);
        return { market: board({ ...base, inventory }, now) };
      })();
    },
  );

  /**
   * §G2/§G3: three spare pages to the Lab, one page you do not have back.
   *
   * Everything a player could try to steer is decided here rather than sent: which pages go, and
   * which one comes back. The seed is the base and the moment, so a request that is retried
   * because the connection dropped cannot be retried until the Lab offers something better.
   *
   * The availability check is re-run off the base record rather than trusted from the board that
   * drew the button. A client holding a stale payload is the ordinary case, not an attack, and it
   * is the same predicate either way.
   */
  app.post(
    '/blueprints/reimagine',
    { preHandler: app.authenticate },
    (request): ReimagineResponse => {
      const now = new Date();
      return app.db.transaction(() => {
        const base = ownBase(app, request.currentUser.id);
        const context: ReimaginingContext = {
          hasHeadOfResearch: seatedRoles(base.commanders).includes('head_of_research'),
          hasReimaginingResearch: isReimaginingResearched(base.research.technologies),
        };
        const input = {
          inventory: base.inventory,
          context,
          seed: `${base.id}:${now.toISOString()}`,
        };
        const refusal = reimaginingRefusal(input);
        if (refusal !== null) throw new AppError('REIMAGINING_REFUSED', refusal);

        const traded = reimagine(input);
        // `reimaginingRefusal` cleared every reason this returns null, so a null here is the two of
        // them disagreeing rather than a state a player can reach.
        if (traded === null) throw new AppError('REIMAGINING_REFUSED', 'not_available');

        app.repos.bases.updateHoldings(base.id, base.resources, traded.inventory);
        return {
          market: board({ ...base, inventory: traded.inventory }, now),
          spent: traded.spent,
          gained: traded.gained,
        };
      })();
    },
  );

  /** The Broker, who is always in and always takes half. */
  app.post(
    '/market/barter',
    { preHandler: app.authenticate },
    (request): MarketMutationResponse => {
      const { give, want, amount } = parseBody(BarterRequestSchema, request.body);
      const now = new Date();
      return app.db.transaction(() => {
        const result = barter(
          app.repos,
          ownBase(app, request.currentUser.id),
          give,
          want,
          amount,
          BARTER_MINIMUM,
        );
        if (result.kind === 'refused') refuse(result.reason);
        return { market: board(result.base, now) };
      })();
    },
  );

  /** The supply run: caps into materials, inside the day's ration. */
  app.post(
    '/market/supply',
    { preHandler: app.authenticate },
    (request): MarketMutationResponse => {
      const { key, units } = parseBody(BuySupplyRequestSchema, request.body);
      const now = new Date();
      return app.db.transaction(() => {
        const result = buySupply(app.repos, ownBase(app, request.currentUser.id), key, units, now);
        if (result.kind === 'refused') refuse(result.reason);
        return { market: board(result.base, now) };
      })();
    },
  );

  /** Post a listing, or counter somebody else's. */
  app.post('/market/offer', { preHandler: app.authenticate }, (request): MarketMutationResponse => {
    const { give, want, counterTo } = parseBody(PostOfferRequestSchema, request.body);
    const now = new Date();
    return app.db.transaction(() => {
      const result = postOffer(
        app.repos,
        ownBase(app, request.currentUser.id),
        give,
        want,
        counterTo,
        now,
      );
      if (result.kind === 'refused') refuse(result.reason);
      return { market: board(result.base, now) };
    })();
  });

  app.post(
    '/market/withdraw',
    { preHandler: app.authenticate },
    (request): MarketMutationResponse => {
      const { offerId } = parseBody(OfferActionRequestSchema, request.body);
      const now = new Date();
      return app.db.transaction(() => {
        const result = withdrawOffer(app.repos, ownBase(app, request.currentUser.id), offerId);
        if (result.kind === 'refused') refuse(result.reason);
        return { market: board(result.base, now) };
      })();
    },
  );

  app.post(
    '/market/accept',
    { preHandler: app.authenticate },
    (request): MarketMutationResponse => {
      const { offerId } = parseBody(OfferActionRequestSchema, request.body);
      const now = new Date();
      return app.db.transaction(() => {
        const result = acceptOffer(
          app.repos,
          ownBase(app, request.currentUser.id),
          offerId,
          new Date(),
        );
        if (result.kind === 'refused') refuse(result.reason);
        return { market: board(result.base, now) };
      })();
    },
  );
}
