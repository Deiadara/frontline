import { randomUUID } from 'node:crypto';
import {
  addItems,
  barterQuote,
  barterRateFor,
  brokerDealsIn,
  isReimaginingResearched,
  canAfford,
  canSettle,
  creditResources,
  hasItems,
  marketDay,
  nextVendorOpening,
  offerHasExpired,
  offerRefusal,
  removeItems,
  spendResources,
  storageCapacity,
  storageCapacityFor,
  SUPPLY_REFUSAL_TEXT,
  supplyAllowance,
  supplyBoard,
  supplyPrice,
  supplyRefusal,
  vendorSessionsFor,
  vendorStockFor,
  vendorVisitAt,
  visibleTo,
  type Base,
  type ItemCost,
  type MarketOffer,
  type MarketResponse,
  type ResourceKey,
  type SupplyRefusal,
  type TradeBundle,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { seatedRoles } from '../crew/roster.js';
import {
  bidderNames,
  latestLotResultsFor,
  projectVendorAuction,
  type VendorBidRefusal,
} from './auction.js';

/**
 * The market, server side.
 *
 * Three things happen here and they share one rule: **goods move in a single transaction, or not at
 * all.** A barter takes one resource and gives another; a settlement moves two bundles between two
 * crews; the barrow's close (`market/auction.ts`) spends caps and hands over a unit. Every one of
 * them writes both sides with `updateHoldings`, which is a single statement, inside a transaction
 * opened by the route.
 *
 * The Runner's hours and stock are *derived*, never stored: `vendorSessionsFor` and
 * `vendorStockFor` are pure functions of the UTC date, so the server does not have to schedule
 * anything and cannot disagree with the client about what is on the barrow. What *is* stored, in
 * `vendor_sales`, is what the city has already bought: a shared counter per line, so a sold-out
 * blueprint is sold out for everybody and stays sold out across a restart.
 */

/**
 * How many of a vendor line the whole city has taken today.
 *
 * In the database, not in this module. It was a `Map` here, which meant a sold-out line went back
 * on the barrow at every restart, crash and deploy inside the same UTC day: a blueprint the
 * catalogue rations to one could be bought again by the next person through the door, and the
 * exploit was "wait for a deploy". Yesterday's rows are never read, so nothing sweeps them.
 */
export function vendorSoldCount(repos: Repositories, day: string, lineId: string): number {
  return repos.market.vendorSold(day, lineId);
}

/** Expire anything that has stood too long, and give the seller their goods back. */
export function sweepExpiredOffers(repos: Repositories, now: Date): void {
  for (const offer of repos.market.listByStatus('open')) {
    if (!offerHasExpired(offer, now)) continue;
    repos.market.setStatus(offer.id, 'expired');
    releaseEscrow(repos, offer);
  }
}

/** Hand a listing's escrowed goods back to whoever posted it. */
function releaseEscrow(repos: Repositories, offer: MarketOffer): void {
  const seller = repos.bases.findById(offer.sellerBaseId);
  if (!seller) return;
  repos.bases.updateHoldings(
    seller.id,
    creditResources(seller.resources, offer.give.resources),
    addItems(seller.inventory, offer.give.items),
  );
}

export function projectMarket(repos: Repositories, base: Base, now: Date): MarketResponse {
  const day = marketDay(now);
  /*
   * The barrow is empty while he is away, and it is empty **here** rather than on the screen.
   *
   * What he has that day is a pure function of the date, so a shut shop that still answered with
   * its stock was telling every client what would be on the barrow hours before he arrived: a
   * player who read the response could line up their caps for the one blueprint on it, and one who
   * only looked at the page could not. That is not a shop with opening hours, it is a shop with a
   * keyhole. Nobody sees the goods until he is standing there.
   */
  const visit = vendorVisitAt(now);
  /*
   * The price on a line is the city's number, not this crew's.
   *
   * It used to be quoted with §A4's Downtown Market discount on it. A lot cannot be: the reserve is
   * what every crew bids against, and a per-crew floor would make the same bid legal for one of
   * them and under the reserve for the other. The winner's ground comes off what they pay at the
   * close instead (`market/auction.ts`), where nobody they were bidding against can see it.
   */
  const bids = visit ? repos.vendorAuctions.bidsOn(visit.day, visit.session) : [];
  const usernames = bidderNames(repos, bids);
  const stock = visit
    ? vendorStockFor(day).map((line) => {
        const left = Math.max(0, line.stock - vendorSoldCount(repos, day, line.id));
        return {
          line: { ...line, stock: left },
          // Nothing left on the line is nothing to bid on: the city cleared him out on an earlier
          // visit, and he will not have another until tomorrow's barrow is drawn.
          auction:
            left > 0
              ? projectVendorAuction({
                  reader: base.ownerId,
                  visit,
                  line,
                  bids: bids.filter((bid) => bid.lineId === line.id),
                  usernames,
                })
              : null,
        };
      })
    : [];

  const listings = repos.market.listByStatus('open');
  return {
    serverNow: now.toISOString(),
    caps: base.resources.caps,
    resources: base.resources,
    inventory: base.inventory,
    vendor: {
      open: visit !== null,
      sessions: vendorSessionsFor(day),
      session: visit?.session ?? null,
      closesAt: visit?.closesAt.toISOString() ?? null,
      opensAt: nextVendorOpening(now).toISOString(),
      stock,
      // Only the lots this crew bid on, from the last visit it bid at. A panel carrying every close
      // in the city would be a leaderboard nobody asked for.
      results: latestLotResultsFor(repos, base.ownerId, now),
    },
    // Somebody else's public listings, plus counters aimed at this crew. Never its own. Those are
    // `mine`, and a board that showed a crew its own listing twice would read as two offers.
    offers: listings.filter((offer) => offer.sellerBaseId !== base.id && visibleTo(offer, base.id)),
    mine: listings.filter((offer) => offer.sellerBaseId === base.id),
    supply: supplyBoard(
      base.level,
      base.resources,
      storageCapacity(base.buildings),
      repos.market.supplyUsed(base.id, day),
      (key) => storageCapacityFor(base.buildings, key),
    ),
    barterRate: barterRateFor(base.level),
    // §G4: the two things the Blueprints screen cannot see for itself. Read from the same base
    // record the trade route re-reads, so the panel and the refusal never disagree.
    reimagining: {
      hasHeadOfResearch: seatedRoles(base.commanders).includes('head_of_research'),
      hasReimaginingResearch: isReimaginingResearched(base.research.technologies),
    },
  };
}

/**
 * The supply run: caps out, one material in, inside the day's ration.
 *
 * The ration is checked against a capacity recomputed *now* rather than one frozen when the day
 * started, so a crew that has just raised its Apothecary can spend the wider allowance immediately
 * and one whose warehouse has been wrecked cannot spend an allowance it no longer has. That is the
 * same lazy rule the rest of the game follows: state is what the world says at the moment you ask.
 */
export function buySupply(
  repos: Repositories,
  base: Base,
  key: ResourceKey,
  units: number,
  now: Date,
): MarketResult {
  const day = marketDay(now);
  // The ration is measured against the bulk shelf; the room is measured against this resource's own.
  const allowance = supplyAllowance(base.level, storageCapacity(base.buildings));
  const used = repos.market.supplyUsed(base.id, day);

  const refusal = supplyRefusal({
    key,
    units,
    stock: base.resources,
    allowanceLeft: Math.max(0, allowance - used),
    capacity: storageCapacityFor(base.buildings, key),
  });
  if (refusal !== null) return { kind: 'refused', reason: refusal };

  const resources = creditResources(
    spendResources(base.resources, { caps: supplyPrice(key, units) }),
    { [key]: units },
  );
  repos.bases.updateHoldings(base.id, resources, base.inventory);
  repos.market.recordSupply(base.id, day, units, now.toISOString());
  return { kind: 'done', base: { ...base, resources } };
}

export type MarketRefusal =
  // The barrow's own, spelled by the module that owns the lot rules.
  | VendorBidRefusal
  | 'too_small'
  | 'same_resource'
  | 'no_caps'
  | 'unknown_offer'
  | 'not_yours'
  | 'own_offer'
  | 'cannot_settle'
  | 'nothing_offered'
  | 'nothing_wanted'
  | 'cannot_cover'
  | 'too_many_offers'
  | 'untradeable'
  | SupplyRefusal;

export type MarketResult =
  { kind: 'done'; base: Base } | { kind: 'refused'; reason: MarketRefusal };

/**
 * The Broker: any resource into any other, at half.
 *
 * Refuses a same-resource trade explicitly rather than quietly halving somebody's scrap, which is
 * the one input a fat-fingered player will actually produce.
 */
export function barter(
  repos: Repositories,
  base: Base,
  give: ResourceKey,
  want: ResourceKey,
  amount: number,
  minimum: number,
): MarketResult {
  if (give === want) return { kind: 'refused', reason: 'same_resource' };
  // Materials only, either way round: see `BARTER_RESOURCES`.
  if (!brokerDealsIn(give) || !brokerDealsIn(want)) return { kind: 'refused', reason: 'no_caps' };
  if (amount < minimum) return { kind: 'refused', reason: 'too_small' };
  if (!canAfford(base.resources, { [give]: amount })) {
    return { kind: 'refused', reason: 'cannot_afford' };
  }

  // §I3: the Broker stops taking half at level 60. Read off the level here rather than passed in
  // so the quote the screen drew and the trade the server settles cannot come from two rates.
  const gained = barterQuote(amount, barterRateFor(base.level));
  const resources = creditResources(spendResources(base.resources, { [give]: amount }), {
    [want]: gained,
  });
  repos.bases.updateHoldings(base.id, resources, base.inventory);
  return { kind: 'done', base: { ...base, resources } };
}

/**
 * Post a listing, escrowing what it gives.
 *
 * The goods leave the stockpile now. A board of listings that cannot be honoured is worse than no
 * board: the first thing a player learns from one is not to trust it.
 */
export function postOffer(
  repos: Repositories,
  base: Base,
  give: TradeBundle,
  want: TradeBundle,
  counterTo: string | undefined,
  now: Date,
): MarketResult & { offer?: MarketOffer } {
  const standing = repos.market.openBySeller(base.id).length;
  const refusal = offerRefusal(give, want, base.resources, base.inventory, standing);
  if (refusal !== null) return { kind: 'refused', reason: refusal };

  let directedAt: string | null = null;
  if (counterTo !== undefined) {
    const parent = repos.market.findById(counterTo);
    if (!parent || parent.status !== 'open') return { kind: 'refused', reason: 'unknown_offer' };
    if (parent.sellerBaseId === base.id) return { kind: 'refused', reason: 'own_offer' };
    directedAt = parent.sellerBaseId;
  }

  const resources = spendResources(base.resources, give.resources);
  const inventory = removeItems(base.inventory, give.items);
  repos.bases.updateHoldings(base.id, resources, inventory);

  const offer: MarketOffer = {
    id: randomUUID(),
    sellerBaseId: base.id,
    sellerName: base.name,
    give,
    want,
    status: 'open',
    createdAt: now.toISOString(),
    counterTo: counterTo ?? null,
    directedAt,
  };
  repos.market.insert(offer);
  return { kind: 'done', base: { ...base, resources, inventory }, offer };
}

/** Take a listing back. The escrow comes home. */
export function withdrawOffer(repos: Repositories, base: Base, offerId: string): MarketResult {
  const offer = repos.market.findById(offerId);
  if (!offer || offer.status !== 'open') return { kind: 'refused', reason: 'unknown_offer' };
  if (offer.sellerBaseId !== base.id) return { kind: 'refused', reason: 'not_yours' };

  repos.market.setStatus(offer.id, 'withdrawn');
  const resources = creditResources(base.resources, offer.give.resources);
  const inventory = addItems(base.inventory, offer.give.items);
  repos.bases.updateHoldings(base.id, resources, inventory);
  return { kind: 'done', base: { ...base, resources, inventory } };
}

/**
 * Take a listing.
 *
 * The buyer pays what it wants and receives what it gives; the seller receives what it wants. The
 * seller's side of *give* was escrowed at posting, so only the buyer's payment moves here, which
 * is what makes this settle in two writes and not four.
 *
 * Any counters standing against the same listing are released, because the thing they were
 * countering is gone.
 */
export function acceptOffer(
  repos: Repositories,
  base: Base,
  offerId: string,
  now: Date,
): MarketResult {
  const offer = repos.market.findById(offerId);
  if (!offer || offer.status !== 'open') return { kind: 'refused', reason: 'unknown_offer' };
  /*
   * An offer past its 48 hours is gone, whether or not anybody has swept it yet.
   *
   * Expiry was only applied in `sweepExpiredOffers`, which runs on `GET /market`. So on a quiet
   * board nothing expires: a listing days past its lifetime still traded, and the seller's escrow
   * went with it. The sweep is a tidy-up, not the rule, and the rule has to be checked where the
   * goods actually move.
   */
  if (offerHasExpired(offer, now)) return { kind: 'refused', reason: 'unknown_offer' };
  if (offer.sellerBaseId === base.id) return { kind: 'refused', reason: 'own_offer' };
  if (offer.directedAt !== null && offer.directedAt !== base.id) {
    return { kind: 'refused', reason: 'not_yours' };
  }
  if (!canSettle(offer.want, base.resources, base.inventory)) {
    return { kind: 'refused', reason: 'cannot_settle' };
  }

  const seller = repos.bases.findById(offer.sellerBaseId);
  if (!seller) return { kind: 'refused', reason: 'unknown_offer' };

  // Buyer: pays `want`, receives `give`.
  const buyerResources = creditResources(
    spendResources(base.resources, offer.want.resources),
    offer.give.resources,
  );
  const buyerInventory = addItems(removeItems(base.inventory, offer.want.items), offer.give.items);
  repos.bases.updateHoldings(base.id, buyerResources, buyerInventory);

  // Seller: receives `want`. Their `give` left when they posted.
  repos.bases.updateHoldings(
    seller.id,
    creditResources(seller.resources, offer.want.resources),
    addItems(seller.inventory, offer.want.items),
  );

  repos.market.setStatus(offer.id, 'accepted');
  for (const counter of repos.market.countersTo(offer.id)) {
    repos.market.setStatus(counter.id, 'withdrawn');
    releaseEscrow(repos, counter);
  }

  return { kind: 'done', base: { ...base, resources: buyerResources, inventory: buyerInventory } };
}

/** The figures a refusal may name. Only `too_low` reads them. */
export interface RefusalFigures {
  /** The least this crew could have bid. */
  minimum: number;
  /** What the leader is at, or null on an untouched lot. */
  leading: number | null;
}

const NO_FIGURES: RefusalFigures = { minimum: 0, leading: null };

/**
 * A player-facing sentence for every refusal, so the client never invents one.
 *
 * `too_low` is a function rather than a string for the reason the Bar's `BID_ERRORS` is: "somebody
 * is at 40" and "you need at least 42" are the whole of what the screen has to say, and a client
 * deriving the second one from a stale read would print a number the server would refuse.
 */
export const MARKET_REFUSAL_TEXT: Record<
  MarketRefusal,
  string | ((figures: RefusalFigures) => string)
> = {
  // The supply run's own refusals, spelled by the module that owns the rules rather than restated.
  // First, so the one word the two sets share, `cannot_afford`, keeps the market's more general
  // wording: the Broker and the barrow raise it too, and neither of them is about caps.
  ...SUPPLY_REFUSAL_TEXT,
  vendor_closed: 'The Runner is not in the district right now',
  unknown_line: 'That is not on the barrow today',
  sold_out: 'The city cleared him out of those',
  outbid_yourself: 'You are already the highest bid. Save your caps',
  too_low: ({ minimum, leading }) =>
    leading === null
      ? `He will not take under ${minimum}`
      : `Somebody is at ${leading}. You need at least ${minimum}`,
  cannot_afford: 'You cannot cover that',
  too_small: 'The Broker will not get out of his chair for that little',
  same_resource: 'The Broker trades one thing for another, not for itself',
  no_caps: 'The Broker does not touch caps. Materials for materials, or the supply run',
  unknown_offer: 'That listing is gone',
  not_yours: 'That listing is not yours to touch',
  own_offer: 'You cannot trade with yourself',
  cannot_settle: 'You cannot pay what that asks for',
  nothing_offered: 'An offer has to give something',
  nothing_wanted: 'An offer has to ask for something',
  cannot_cover: 'You do not have what you are offering',
  too_many_offers: 'You have too many listings standing already',
  untradeable: 'That is not something anybody will take off you',
};

/** The sentence for a refusal, with the figures the one numbered refusal needs. */
export function marketRefusalText(
  reason: MarketRefusal,
  figures: RefusalFigures = NO_FIGURES,
): string {
  const text = MARKET_REFUSAL_TEXT[reason];
  return typeof text === 'string' ? text : text(figures);
}

/**
 * Whether a crew holds a set of parts.
 *
 * The blueprint sibling that used to sit here went with the flat `blueprint_*` items it was written
 * for: a document is assembled out of pages now and every gate asks `blueprintGateMet`, so nothing
 * had called it since. A `describeParts` beside it was dead too, and `routes/workshop.ts` already
 * carries its own private copy of the same four lines, which is the one that was actually running.
 */
export function holdsParts(base: Base): (parts: ItemCost) => boolean {
  return (parts) => hasItems(base.inventory, parts);
}
