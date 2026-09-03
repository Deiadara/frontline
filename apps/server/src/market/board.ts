import { randomUUID } from 'node:crypto';
import {
  addItems,
  barterQuote,
  barterRateFor,
  isReimaginingResearched,
  canAfford,
  canSettle,
  creditResources,
  currentVendorSession,
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
  vendorClosesAt,
  vendorOpenAt,
  vendorSessionsFor,
  vendorStockFor,
  visibleTo,
  type Base,
  type ItemCost,
  type ItemId,
  type MarketOffer,
  type MarketResponse,
  type ResourceKey,
  type SupplyRefusal,
  type TradeBundle,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { standingEffectsFor } from '../crew/standing.js';
import { seatedRoles } from '../crew/roster.js';

/**
 * The market, server side.
 *
 * Three things happen here and they share one rule: **goods move in a single transaction, or not at
 * all.** A purchase spends caps and hands over an item; a barter takes one resource and gives
 * another; a settlement moves two bundles between two crews. Every one of them writes both sides
 * with `updateHoldings`, which is a single statement, inside a transaction opened by the route.
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
   * §A4: the Downtown Market's discount, on the **quoted** price as well as the charged one.
   *
   * The two came apart: `buyFromVendor` charged the discounted figure and this quoted the
   * catalogue one. A player holding that floor saw the full price on every card and was charged
   * less at the till, and, worse, `affordable` was judged against the price they were *not* going
   * to pay, so a purchase they could comfortably make showed a dead button. The black market's own
   * code carries a comment about exactly this failure; the vendor had it.
   */
  const discount = standingEffectsFor(repos, base).marketDiscountPercent;
  /*
   * The barrow is empty while he is away, and it is empty **here** rather than on the screen.
   *
   * What he has that day is a pure function of the date, so a shut shop that still answered with
   * its stock was telling every client what would be on the barrow hours before he arrived: a
   * player who read the response could line up their caps for the one blueprint on it, and one who
   * only looked at the page could not. That is not a shop with opening hours, it is a shop with a
   * keyhole. Nobody sees the goods until he is standing there.
   */
  const open = vendorOpenAt(now);
  const stock = open
    ? vendorStockFor(day).map((line) => {
        const left = Math.max(0, line.stock - vendorSoldCount(repos, day, line.id));
        const price = discountedCaps(line.price, discount);
        return {
          line: { ...line, stock: left, price },
          affordable: left > 0 && base.resources.caps >= price,
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
      open,
      sessions: vendorSessionsFor(day),
      closesAt: vendorClosesAt(now)?.toISOString() ?? null,
      opensAt: nextVendorOpening(now).toISOString(),
      stock,
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
  | 'vendor_closed'
  | 'unknown_line'
  | 'sold_out'
  | 'cannot_afford'
  | 'too_small'
  | 'same_resource'
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
 * A price with the crew's market discount taken off (§A4).
 *
 * Floored at one cap: no amount of ground makes anything free, which is the same rule
 * `discounted` applies to every other price in the game.
 */
export const MAX_MARKET_DISCOUNT = 45;

export function discountedCaps(price: number, percent: number): number {
  const off = Math.min(MAX_MARKET_DISCOUNT, Math.max(0, percent));
  return Math.max(1, Math.round(price * (1 - off / 100)));
}

/** Buy from the Runner. Only while he is actually in the district. */
export function buyFromVendor(
  repos: Repositories,
  base: Base,
  lineId: string,
  count: number,
  now: Date,
): MarketResult {
  if (currentVendorSession(now) === null) return { kind: 'refused', reason: 'vendor_closed' };

  const day = marketDay(now);
  const line = vendorStockFor(day).find((candidate) => candidate.id === lineId);
  if (!line) return { kind: 'refused', reason: 'unknown_line' };

  const left = line.stock - vendorSoldCount(repos, day, lineId);
  if (left < count) return { kind: 'refused', reason: 'sold_out' };

  // §A4: the Downtown Market. Every price in this city is quoted to whoever holds that floor at
  // a better number than to anybody else, and the Spire's unified bonus is more of the same.
  // Per unit, then multiplied: the same arithmetic in the same order the card quoted, so buying
  // three never costs a cap more or less than three times what the shelf said one costs.
  const unit = discountedCaps(line.price, standingEffectsFor(repos, base).marketDiscountPercent);
  const price = unit * count;
  if (base.resources.caps < price) return { kind: 'refused', reason: 'cannot_afford' };

  const resources = spendResources(base.resources, { caps: price });
  const inventory = addItems(base.inventory, { [line.item as ItemId]: count });
  repos.bases.updateHoldings(base.id, resources, inventory);
  repos.market.recordVendorSale(day, lineId, count, now.toISOString());

  return { kind: 'done', base: { ...base, resources, inventory } };
}

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

/** A player-facing sentence for every refusal, so the client never invents one. */
export const MARKET_REFUSAL_TEXT: Record<MarketRefusal, string> = {
  // The supply run's own refusals, spelled by the module that owns the rules rather than restated.
  // First, so the one word the two sets share, `cannot_afford`, keeps the market's more general
  // wording: the Broker and the barrow raise it too, and neither of them is about caps.
  ...SUPPLY_REFUSAL_TEXT,
  vendor_closed: 'The Runner is not in the district right now',
  unknown_line: 'That is not on the barrow today',
  sold_out: 'The city cleared him out of those',
  cannot_afford: 'You cannot cover that',
  too_small: 'The Broker will not get out of his chair for that little',
  same_resource: 'The Broker trades one thing for another, not for itself',
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
