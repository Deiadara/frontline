import {
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
        const result = acceptOffer(app.repos, ownBase(app, request.currentUser.id), offerId);
        if (result.kind === 'refused') refuse(result.reason);
        return { market: board(result.base, now) };
      })();
    },
  );
}
