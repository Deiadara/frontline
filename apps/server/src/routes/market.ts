import {
  UnlockBlueprintRequestSchema,
  unlockBlueprint,
  unlockRefusal,
  reimagine,
  ReimagineRequestSchema,
  reimaginingRefusal,
  isReimaginingResearched,
  type ReimaginingContext,
  type ReimagineResponse,
  BARTER_MINIMUM,
  BarterRequestSchema,
  cityOfVendorLine,
  BuySupplyRequestSchema,
  PlaceVendorBidRequestSchema,
  ClaimMarketRequestSchema,
  OfferActionRequestSchema,
  PostOfferRequestSchema,
  NO_TRADER_TEXT,
  type Base,
  type ItemId,
  type MarketMutationResponse,
  type MarketResponse,
} from '@frontline/shared';
import type { FastifyInstance } from 'fastify';
import { requireAreaFor } from '../progression/doors.js';
import {
  acceptOffer,
  barter,
  claimMarketGoods,
  buySupply,
  marketRefusalText,
  postOffer,
  projectMarket,
  sweepExpiredOffers,
  withdrawOffer,
  type MarketRefusal,
  type RefusalFigures,
} from '../market/board.js';
import { placeVendorBid, settleVendorAuctions } from '../market/auction.js';
import { AppError, cityQuery, parseBody } from '../errors.js';
import { ownBase, settledOwnBase } from './own-base.js';
import { cityAsked, homeCityOf } from '../city/stakes.js';
import { workingOfficer, workingRoles } from '../crew/roster.js';
import { awardPlayerXp } from '../progression/award.js';
import { tallyBenchTrade, tallyPageReimagined, tallyPagesIn } from '../feats/tally.js';
import { tellPagesFound } from '../social/pages.js';

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

function refuse(reason: MarketRefusal, figures?: RefusalFigures): never {
  // A shut city is the market read's own refusal (`cityOrRefuse`), and it answers the same way.
  throw new AppError(
    reason === 'city_shut' ? 'CITY_SHUT' : 'MARKET_REFUSED',
    marketRefusalText(reason, figures),
  );
}

/**
 * District Offers is the Trader's work (maintainer, 2026-09-29): a new deal, posted, countered or
 * accepted, needs one fit to work in the chair. Withdrawing and claiming are not gated. What is
 * already on the board stays there and other crews may still take it, so a Trader in a hospital
 * bed never strands goods held in escrow. See `NO_TRADER_TEXT`.
 */
function withTrader(base: Base, now: Date): Base {
  if (workingOfficer(base.commanders, 'trader', now) === undefined) {
    throw new AppError('MARKET_REFUSED', NO_TRADER_TEXT);
  }
  return base;
}

export function registerMarketRoutes(app: FastifyInstance): void {
  const board = (base: Base, now: Date, cityId?: string): MarketResponse =>
    projectMarket(app.repos, base, now, cityId ?? homeCityOf(base));

  /**
   * The city a read asked for, or the refusal (maintainer, 2026-09-17).
   *
   * A market belongs to a city and a crew may trade in any city they hold ground in. A name they
   * hold nothing in is refused rather than quietly answered with their own barrow: the lots on it
   * are different lots, and showing the wrong ones to somebody who bookmarked a city they have
   * since been thrown out of would have them bidding on crates they cannot win.
   */
  const cityOrRefuse = (base: Base, asked: string | undefined): string => {
    const cityId = cityAsked(app.repos, base, asked);
    if (cityId === null) {
      throw new AppError('CITY_SHUT', 'You hold no ground in that city. Take a place in it first.');
    }
    return cityId;
  };

  app.get('/market', { preHandler: app.authenticate }, (request): MarketResponse => {
    const now = new Date();
    app.db.transaction(() => sweepExpiredOffers(app.repos, now))();
    // Before the board is drawn: any lot whose visit is over. A player who opens the market five
    // minutes after he packed up is the one who closes it if the world clock has not got there
    // first, and they must see what they won on this very read rather than on the next one.
    settleVendorAuctions(app.repos, now);
    // Settled, as every write here is: priced off the stored row, the caps, the bid ceiling and
    // the supply run's `most` left out the unbanked production, and the screen greyed a bid or a
    // run the server would then have taken.
    const reader = app.db.transaction(() => settledOwnBase(app, request.currentUser.id, now))();
    const cityId = cityOrRefuse(reader, cityQuery(request.query));
    return board(reader, now, cityId);
  });

  /** Bid on a lot, while he is in. The close hands it over when he packs up. */
  app.post('/market/bid', { preHandler: app.authenticate }, (request): MarketMutationResponse => {
    requireAreaFor(app.repos, request.currentUser.id, 'market');
    const { lineId, amount } = parseBody(PlaceVendorBidRequestSchema, request.body);
    const now = new Date();
    // The close first, the way `/bar` does it: a bid landing just after a visit ended belongs to
    // the next one, and the lot it names has to be settled before anything is written against it.
    settleVendorAuctions(app.repos, now);
    return app.db.transaction(() => {
      const base = settledOwnBase(app, request.currentUser.id, now);
      /*
       * The door, which this route did not have at all (2026-09-24).
       *
       * The read was gated and the write was not, so a crew with no stake in Terminus could take a
       * Terminus lot by sending its line id: `findVendorLine` searches every city, and nothing
       * here asked whether the crew could stand at that barrow. The room comes out of the id
       * rather than off the request, because the id is what the bid is filed under and a city
       * named beside it could disagree with it.
       */
      const cityId = cityOrRefuse(base, cityOfVendorLine(lineId));
      const result = placeVendorBid(app.repos, {
        base,
        userId: request.currentUser.id,
        lineId,
        amount,
        now,
        admin: app.config.admin,
      });
      if (result.kind === 'refused') refuse(result.reason, result);
      // The barrow the bid landed at, not the crew's own: a bid in Terminus used to answer with
      // Ashfall's stock, so the lot the player had just bid on was not on the board they got back.
      // Read again, because the bid took its caps (held bids, 2026-10-06): drawn off the row read
      // before it, the board quoted the caps the crew had before it bid.
      return { market: board(ownBase(app, request.currentUser.id), now, cityId) };
    })();
  });

  /**
   * §D10: turning a complete set of pages into the blueprint.
   *
   * On the market routes rather than on a blueprints controller of its own, because a blueprint and
   * its pages are items: they live in `inventory_json` beside every other thing a crew holds, and
   * this answers with the same board every other holdings mutation answers with, so the inventory
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
   * §G2/§G3: three pages to the Lab, one page you do not have back.
   *
   * The three that go in are the player's, named on the request: the machine on the Reimagining
   * tab has three sockets and they fill them. What comes back is still decided here, seeded off
   * the base and the moment, so a request that is retried because the connection dropped cannot be
   * retried until the Lab offers something better.
   *
   * Both checks are re-run off the base record rather than trusted from the board that drew the
   * button: whether the Lab is open, and whether the crew really holds the three pages it named. A
   * client holding a stale payload is the ordinary case, not an attack, and it is the same
   * predicate either way.
   */
  app.post(
    '/blueprints/reimagine',
    { preHandler: app.authenticate },
    (request): ReimagineResponse => {
      const { pages } = parseBody(ReimagineRequestSchema, request.body);
      const now = new Date();
      return app.db.transaction(() => {
        const base = ownBase(app, request.currentUser.id);
        const context: ReimaginingContext = {
          hasResearcher: workingRoles(base.commanders).includes('researcher'),
          hasReimaginingResearch: isReimaginingResearched(base.research.technologies),
        };
        const input = {
          inventory: base.inventory,
          context,
          pages,
          seed: `${base.id}:${now.toISOString()}`,
        };
        const refusal = reimaginingRefusal(input);
        if (refusal !== null) throw new AppError('REIMAGINING_REFUSED', refusal);

        const traded = reimagine(input);
        // `reimaginingRefusal` cleared every reason this returns null, so a null here is the two of
        // them disagreeing rather than a state a player can reach.
        if (traded === null) throw new AppError('REIMAGINING_REFUSED', 'not_available');

        app.repos.bases.updateHoldings(base.id, base.resources, traded.inventory);

        /*
         * The end of the collection: three pages in, experience out (maintainer, 2026-09-23).
         *
         * A crew holding or having bound every page in the game has nothing the bench can hand
         * over, and the machine used to refuse. It pays `REIMAGINING_COMPLETE_XP` instead, through
         * the one funnel that writes player XP, so the district's and the crew's own bonuses apply
         * to it exactly as they do to a finished mission. Nothing below this runs: there is no page
         * to count as found, no rarity to tally, and no bell to ring about a page nobody received.
         */
        if (traded.gained === null) {
          const paid = awardPlayerXp(app.repos, base, 'pagesReimagined');
          tallyBenchTrade(app.repos, base.id, true);
          return {
            market: board({ ...paid.base, inventory: traded.inventory }, now),
            spent: traded.spent,
            gained: null,
            xp: paid.award.xpGained,
          };
        }

        /*
         * The one that came back, counted where it was found.
         *
         * `pages_found` is documented as "pages off a job, a shelf, a barrow or a feat", and the
         * bench is one more door a page arrives through, but it was the only one of them that rang
         * the bell and counted nothing: a crew that built its whole collection out of the Lab
         * finished the `pages` ladder on zero. The other three doors call `tallyPagesIn` at the
         * moment the goods move (`missions/resolve.ts`, `blackmarket/shelf.ts`, `market/auction.ts`).
         *
         * The bundle is the single page, not `traded.inventory`. Handing the whole bag over would
         * count every page the crew is already holding on every trade, which is the same mistake in
         * the other direction from counting the scrap servos in a mission haul.
         */
        tallyPagesIn(app.repos, base.id, { [traded.gained as ItemId]: 1 });
        /*
         * ...and separately, whether it was a Masterpiece.
         *
         * The bench is the one door whose payout a player can steer: three Basic sheets pay a
         * Masterpiece once in two hundred and three Masterpiece sheets pay one four times in five
         * (`blueprints/reimagine-odds.ts`). `pages_found` cannot see that spread, because a page
         * is a page to it, so the top of the ladder gets a counter of its own.
         */
        tallyPageReimagined(app.repos, base.id, traded.gained);
        tallyBenchTrade(app.repos, base.id, false);
        // §G3: the one that came back, not the three that went in. The response says the same
        // thing to whoever pressed the button; the bell is for the list they read later.
        tellPagesFound(app.repos, {
          userId: request.currentUser.id,
          before: base.inventory,
          after: traded.inventory,
          source: { kind: 'lab' },
          at: now,
        });
        return {
          market: board({ ...base, inventory: traded.inventory }, now),
          spent: traded.spent,
          gained: traded.gained,
          xp: 0,
        };
      })();
    },
  );

  /** The Broker, who is always in and always takes half. */
  app.post(
    '/market/barter',
    { preHandler: app.authenticate },
    (request): MarketMutationResponse => {
      requireAreaFor(app.repos, request.currentUser.id, 'market');
      const trade = parseBody(BarterRequestSchema, request.body);
      const now = new Date();
      return app.db.transaction(() => {
        const result = barter(
          app.repos,
          settledOwnBase(app, request.currentUser.id, now),
          trade,
          BARTER_MINIMUM,
          now,
          app.config.admin,
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
      requireAreaFor(app.repos, request.currentUser.id, 'market');
      const { key, units, acceptWaste } = parseBody(BuySupplyRequestSchema, request.body);
      const now = new Date();
      return app.db.transaction(() => {
        const result = buySupply(
          app.repos,
          settledOwnBase(app, request.currentUser.id, now),
          key,
          units,
          now,
          acceptWaste,
          app.config.admin,
        );
        if (result.kind === 'refused') refuse(result.reason);
        return { market: board(result.base, now) };
      })();
    },
  );

  /** Post a listing, or counter somebody else's. */
  app.post('/market/offer', { preHandler: app.authenticate }, (request): MarketMutationResponse => {
    // The Market's own door first, as the client nests them (`App.tsx`).
    requireAreaFor(app.repos, request.currentUser.id, 'market');
    requireAreaFor(app.repos, request.currentUser.id, 'offers');
    const { give, want, counterTo, cityId } = parseBody(PostOfferRequestSchema, request.body);
    const now = new Date();
    return app.db.transaction(() => {
      const base = withTrader(settledOwnBase(app, request.currentUser.id, now), now);
      const result = postOffer(
        app.repos,
        base,
        give,
        want,
        counterTo,
        now,
        cityId ?? homeCityOf(base),
      );
      if (result.kind === 'refused') refuse(result.reason);
      // The board it went up on, which is the tab it was posted from. It answered with the home
      // city's, so a listing posted on the Terminus tab was not on the board the player got back.
      return { market: board(result.base, now, result.offer?.cityId) };
    })();
  });

  app.post(
    '/market/withdraw',
    { preHandler: app.authenticate },
    (request): MarketMutationResponse => {
      const { offerId, acceptWaste } = parseBody(OfferActionRequestSchema, request.body);
      const now = new Date();
      return app.db.transaction(() => {
        const result = withdrawOffer(
          app.repos,
          settledOwnBase(app, request.currentUser.id, now),
          offerId,
          now,
          acceptWaste,
        );
        if (result.kind === 'refused') refuse(result.reason);
        // The listing's own board where the crew may still read it. A crew taking back a listing
        // from a city it has lost its ground in gets its own city's board instead.
        const pinned = app.repos.market.findById(offerId)?.cityId;
        return {
          market: board(result.base, now, cityAsked(app.repos, result.base, pinned) ?? undefined),
        };
      })();
    },
  );

  app.post(
    '/market/accept',
    { preHandler: app.authenticate },
    (request): MarketMutationResponse => {
      requireAreaFor(app.repos, request.currentUser.id, 'market');
      requireAreaFor(app.repos, request.currentUser.id, 'offers');
      const { offerId, acceptWaste } = parseBody(OfferActionRequestSchema, request.body);
      const now = new Date();
      return app.db.transaction(() => {
        const result = acceptOffer(
          app.repos,
          withTrader(settledOwnBase(app, request.currentUser.id, now), now),
          offerId,
          now,
          acceptWaste,
        );
        if (result.kind === 'refused') refuse(result.reason);
        // The board the listing was taken off, which `acceptOffer` has just checked the door of.
        return { market: board(result.base, now, app.repos.market.findById(offerId)?.cityId) };
      })();
    },
  );

  /** Takes goods the board is holding for this crew, warned first about what would not fit. */
  app.post('/market/claim', { preHandler: app.authenticate }, (request): MarketMutationResponse => {
    const { claimId, acceptWaste } = parseBody(ClaimMarketRequestSchema, request.body);
    const now = new Date();
    return app.db.transaction(() => {
      const result = claimMarketGoods(
        app.repos,
        settledOwnBase(app, request.currentUser.id, now),
        claimId,
        now,
        acceptWaste,
      );
      if (result.kind === 'refused') refuse(result.reason);
      return { market: board(result.base, now) };
    })();
  });
}
