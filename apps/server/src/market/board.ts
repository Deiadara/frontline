import { randomUUID } from 'node:crypto';
import { tallyMarketDeal, tallyResourcesEarned } from '../feats/tally.js';
import {
  officerRecoverySeconds,
  addItems,
  barterQuote,
  brokerPayoutRate,
  brokerRate,
  discountedCaps,
  bundleIsEmpty,
  isReimaginingResearched,
  largestBidWithin,
  canAfford,
  canSettle,
  CLAIM_WINDOW_HOURS,
  dealValue,
  describeWaste,
  OFFER_LIFETIME_HOURS,
  claimUntil,
  describeBundle,
  emptyBundle,
  marketDay,
  mergeResources,
  nextVendorOpening,
  offerExpiresAt,
  offerHasExpired,
  offerRefusal,
  removeItems,
  RESOURCE_KEYS,
  spendResources,
  storageCapacity,
  storageCapacityFor,
  SUPPLY_REFUSAL_TEXT,
  supplyAllowance,
  supplyBoard,
  supplyPrice,
  supplyRationCost,
  supplyRefusal,
  vendorSessionsFor,
  DEFAULT_CITY_ID,
  vendorStockFor,
  vendorVisitAt,
  visibleTo,
  type Base,
  type MarketClaimReason,
  type PartialResources,
  type MarketOffer,
  type MarketResponse,
  type ResourceKey,
  type SupplyRefusal,
  type TradeBundle,
} from '@frontline/shared';
import type { Repositories } from '../db/repos/index.js';
import { adminCaps, adminCost, adminWaives } from '../admin/mode.js';
import { citiesFor, homeCityOf, mayEnter } from '../city/stakes.js';
import { workingRoles } from '../crew/roster.js';
import { crewEffectsFor, standingEffectsFor } from '../crew/standing.js';
import { creditBase, refuseWaste } from '../district/stores.js';
import { settleBase } from '../district/settle.js';
import { notify } from '../social/notify.js';
import { shownNameOf } from '../social/names.js';
import { settleEach } from '../world/guard.js';
import { tellPagesFound } from '../social/pages.js';
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
 * `vendorStockFor` are pure functions of the game date (Athens), so the server does not have to schedule
 * anything and cannot disagree with the client about what is on the barrow. What *is* stored, in
 * `vendor_sales`, is what the city has already bought: a shared counter per line, so a sold-out
 * blueprint is sold out for everybody and stays sold out across a restart.
 */

/**
 * How many of a vendor line the whole city has taken today.
 *
 * In the database, not in this module. It was a `Map` here, which meant a sold-out line went back
 * on the barrow at every restart, crash and deploy inside the same game day: a blueprint the
 * catalogue rations to one could be bought again by the next person through the door, and the
 * exploit was "wait for a deploy". Yesterday's rows are never read, so nothing sweeps them.
 */
export function vendorSoldCount(repos: Repositories, day: string, lineId: string): number {
  return repos.market.vendorSold(day, lineId);
}

/**
 * The board's own clock, run by the world tick: listings past their lifetime close and hold their
 * goods for the poster, and claims past their window are paid out whether they fit or not.
 * Returns how many rows moved, so the tick can tell open market screens.
 */
export function settleMarketBoard(repos: Repositories, now: Date): number {
  /*
   * Row by row, each parsed and settled inside its own guard (`world/guard.ts`), off ids read
   * without parsing anything. One listing or claim that no longer parses (a retired item id in its
   * bundle, a crew row that fails its schema) is reported and left, rather than stopping every
   * expiry and payout after it and turning `GET /market` into a 500 for everybody.
   */
  const due = new Set([
    ...repos.market.openIdsPostedBy(offerLifetimeCutoff(now)),
    ...openIdsAskingNothing(repos),
  ]);
  const expired = settleEach(
    repos,
    'market listings',
    [...due],
    (id) => id,
    (id) => expireOffer(repos, id, now),
  );
  const paid = settleEach(
    repos,
    'market claims',
    repos.market.lapsedClaimIds(now),
    (id) => id,
    (id) => payClaimOut(repos, id, now),
  );
  return expired + paid;
}

/**
 * Open listings that read back asking for nothing, because everything they wanted was a good the
 * catalogue has since retired (maintainer, 2026-09-29). Posting refuses an empty `want`
 * (`offerRefusal`), so retirement is the only way here.
 */
function openIdsAskingNothing(repos: Repositories): string[] {
  return repos.market
    .listByStatus('open')
    .filter((offer) => bundleIsEmpty(offer.want))
    .map((offer) => offer.id);
}

/**
 * Whether a listing can no longer be taken: past its lifetime, or asking for nothing. The second
 * would hand its escrow to whoever pressed first for free, so it closes as if it had lapsed.
 */
function listingHasRunOut(offer: MarketOffer, now: Date): boolean {
  return offerHasExpired(offer, now) || bundleIsEmpty(offer.want);
}

/** Closes one listing that has run out, if nothing has closed it since the ids were read. */
function expireOffer(repos: Repositories, offerId: string, now: Date): void {
  const offer = repos.market.findById(offerId);
  // Re-read inside the row's transaction: a counter handled a moment ago as its parent closed is
  // no longer open, and holding its escrow a second time would pay it twice.
  if (!offer || offer.status !== 'open' || !listingHasRunOut(offer, now)) return;
  repos.market.setStatus(offer.id, 'expired');
  // The bells are dated when the listing ran out; the claim's own window still runs from now. One
  // closed early for asking nothing ran out now.
  const lapsedAt = offerHasExpired(offer, now) ? offerExpiresAt(offer) : now;
  holdEscrow(repos, offer, 'expired', now, lapsedAt);
  releaseCounters(repos, offer.id, now, lapsedAt);
}

/** The same, for a read that should not show a listing the tick has not reached yet. */
export function sweepExpiredOffers(repos: Repositories, now: Date): void {
  settleMarketBoard(repos, now);
}

/**
 * Every listing this crew has standing, closed with **no escrow back**: the Console's Clean slate.
 *
 * A reset rewrites the base row in place, and `market_offers` hangs off the id rather than the
 * life, so a crew's listings survived its own wipe. The escrow in them was the old life's goods,
 * and the ordinary close (`withdrawOffer`, the sweep) would have credited them to the fresh
 * stockpile two days later: a level-one crew with a level-twenty crew's oil arriving by post.
 * The counters other crews had standing against these listings are theirs and do come home.
 */
export function forfeitOffers(repos: Repositories, baseId: string, now = new Date()): void {
  for (const offer of repos.market.openBySeller(baseId)) {
    repos.market.setStatus(offer.id, 'withdrawn');
    releaseCounters(repos, offer.id, now);
  }
  // What the board was holding for the old life goes with its listings.
  repos.market.dropClaimsFor(baseId);
}

/**
 * A counter is a bid on one particular listing, so it goes when the listing goes.
 *
 * Accepting a listing released its counters from the start; withdrawing one or letting it expire
 * did not, so a counter's escrow stayed locked for its own two days against a listing nobody could
 * take any more. One function for the three ways a listing closes.
 */
function releaseCounters(repos: Repositories, offerId: string, now: Date, at: Date = now): void {
  for (const counter of repos.market.countersTo(offerId)) {
    if (counter.status !== 'open') continue;
    repos.market.setStatus(counter.id, 'withdrawn');
    holdEscrow(repos, counter, 'closed', now, at);
    /*
     * And the counters to that counter (bug pass, 2026-09-29). A counter can be countered back, and
     * that reply answers nothing once the counter it answered is released: it stood open against a
     * closed listing, holding its poster's escrow, and the crew it was aimed at could still take it.
     */
    releaseCounters(repos, counter.id, now, at);
  }
}

/** A listing's escrowed goods, held for whoever posted it: nobody pressed anything for these. */
function holdEscrow(
  repos: Repositories,
  offer: MarketOffer,
  reason: MarketClaimReason,
  now: Date,
  at: Date = now,
): void {
  holdForClaim(repos, { offer, reason, goods: offer.give, takenBy: null, now, at });
}

/**
 * Puts goods on the board for the listing's poster to claim (maintainer, 2026-09-28), and tells
 * them. They were not on the screen when this happened, which is the whole reason it waits.
 */
function holdForClaim(
  repos: Repositories,
  hold: {
    offer: MarketOffer;
    reason: MarketClaimReason;
    goods: TradeBundle;
    takenBy: string | null;
    now: Date;
    /** When the listing closed, which the bell is dated. `now` unless the close was a lapse. */
    at?: Date;
  },
): void {
  const { offer, reason, goods, takenBy, now, at = now } = hold;
  // Nothing to hold, and no bell to ring about it: a listing posted with goods the catalogue has
  // since retired reads back without them (`db/repos/market.ts`), and a claim of nothing is noise.
  if (bundleIsEmpty(goods)) return;
  const poster = repos.bases.findById(offer.sellerBaseId);
  if (!poster) return;
  repos.market.insertClaim({
    id: randomUUID(),
    baseId: poster.id,
    offer,
    reason,
    goods,
    takenBy,
    createdAt: now.toISOString(),
    claimUntil: claimUntil(now).toISOString(),
  });
  const what = describeBundle(goods);
  const yours = offer.counterTo === null ? 'listing' : 'counter';
  notify(repos, {
    userId: poster.ownerId,
    kind: 'market_claim',
    title:
      reason === 'taken'
        ? `${takenBy ?? 'Somebody'} took your ${yours}: ${what} to claim on the board`
        : reason === 'expired'
          ? `Nobody took your ${yours}: ${what} to claim back on the board`
          : offer.counterTo === null
            ? // Only a listing above a taken counter is closed with nobody taking it or it lapsing.
              `A deal on a counter closed your listing: ${what} to claim back on the board`
            : `The listing you countered closed: ${what} to claim back on the board`,
    body: `Claim it within ${CLAIM_WINDOW_HOURS} hours. After that it is put in your stores anyway, and whatever does not fit is lost.`,
    link: '/game/market/offers',
    subjectId: offer.id,
    at,
  });
}

/**
 * Pays a claim into the crew's stores and inventory and closes it.
 *
 * `acceptWaste` undefined means nobody is asking, which is the lapsed claim: the stores take what
 * fits and the rest is lost. A press passes the player's answer, and is refused with the warning
 * until they say yes.
 */
function payClaim(
  repos: Repositories,
  base: Base,
  claim: {
    id: string;
    goods: TradeBundle;
    offer: MarketOffer;
    takenBy: string | null;
    claimUntil: string;
  },
  now: Date,
  pressed: { acceptWaste: boolean | undefined } | null,
): { base: Base; wasted: PartialResources | undefined } {
  const credit = creditBase(repos, base, claim.goods.resources, now);
  if (pressed) refuseWaste(credit, pressed.acceptWaste);
  const inventory = addItems(base.inventory, claim.goods.items);
  repos.bases.updateHoldings(base.id, credit.resources, inventory);
  repos.market.deleteClaim(claim.id);
  // Only a page the trade brought in rings, never the poster's own escrow coming home.
  if (claim.takenBy !== null) {
    tellPagesFound(repos, {
      userId: base.ownerId,
      before: base.inventory,
      after: inventory,
      source: { kind: 'offer', from: claim.takenBy },
      // A press is now; a lapse paid the goods in when the window shut.
      at: pressed ? now : new Date(claim.claimUntil),
    });
  }
  return { base: { ...base, resources: credit.resources, inventory }, wasted: credit.wasted };
}

/** A claim whose 24 hours are up, paid whether it fits or not. */
function payClaimOut(repos: Repositories, claimId: string, now: Date): void {
  const claim = repos.market.findClaim(claimId);
  if (!claim) return;
  const held = repos.bases.findById(claim.baseId);
  if (!held) {
    repos.market.deleteClaim(claim.id);
    return;
  }
  // Settled first, so a store that finished growing since the crew's last read is the one the
  // goods are measured against.
  const base = settleBase(repos, held, now).base;
  const { wasted: lost } = payClaim(repos, base, claim, now, null);
  if (lost !== undefined) {
    notify(repos, {
      userId: base.ownerId,
      kind: 'market_claim',
      title: `Unclaimed goods went into your stores, and ${describeWaste(lost)} did not fit`,
      body: `Nobody claimed them in ${CLAIM_WINDOW_HOURS} hours, so they were put away as they stood.`,
      link: '/game/market/offers',
      subjectId: claim.offer.id,
      at: new Date(claim.claimUntil),
    });
  }
}

/** Where a listing posted at or before this has stood its lifetime out. */
function offerLifetimeCutoff(now: Date): Date {
  return new Date(now.getTime() - OFFER_LIFETIME_HOURS * 3_600_000);
}

/** The crew pressing Claim: warned about what would not fit, then paid. */
export function claimMarketGoods(
  repos: Repositories,
  base: Base,
  claimId: string,
  now: Date,
  acceptWaste?: boolean,
): MarketResult {
  const claim = repos.market.findClaim(claimId);
  if (!claim) return { kind: 'refused', reason: 'unknown_claim' };
  if (claim.baseId !== base.id) return { kind: 'refused', reason: 'not_yours' };
  return { kind: 'done', base: payClaim(repos, base, claim, now, { acceptWaste }).base };
}

export function projectMarket(
  repos: Repositories,
  base: Base,
  now: Date,
  cityId: string = DEFAULT_CITY_ID,
): MarketResponse {
  const day = marketDay(now);
  /*
   * §F2: the crew's storage bonus, on the shelf the run is measured against.
   *
   * The bonus used to reach the production clamp and nothing else, so a crew that had researched
   * room for another 55% of a warehouse was quoted the bare structures' figure here: the ration was
   * sized off a store smaller than the one production was already filling, and `supplyAffordable`
   * returned zero for a crew whose district plainly had room. Read once and handed to both the
   * ration and the per-line room, so the two cannot disagree with each other either.
   */
  const bulk = storageCapacity(
    base.buildings,
    crewEffectsFor(repos, base, now).storageCapacityPercent,
  );
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
    ? vendorStockFor(day, cityId).map((line) => {
        const left = Math.max(0, line.stock - vendorSoldCount(repos, day, line.id));
        // At most one sale a visit, and the line is gone with the day: a two-stock line nobody won
        // on the first visit has one sale left in it, not two.
        const visitsLeft = vendorSessionsFor(day).length - visit.session;
        return {
          line: { ...line, stock: Math.min(left, visitsLeft) },
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

  // This city's board, and every listing of this crew's wherever it is pinned: the five-listing
  // limit is the crew's across the map, and a listing in a city it has since lost ground in has to
  // stay in reach of Withdraw rather than wait out its 48 hours unseen.
  const board = repos.market.openInCity(cityId);
  const mine = repos.market.openBySeller(base.id);
  // §A4: the Downtown Market's cut, read once. It comes off what a winner pays, never the reserve.
  const standing = standingEffectsFor(repos, base, now);
  const ground = standing.marketDiscountPercent;
  // The working Trader's seat points, which move both rates (`traderRates`, 2026-10-04).
  const trader = standing.chairPoints.trader ?? null;
  return {
    serverNow: now.toISOString(),
    cityId,
    cities: citiesFor(repos, base),
    caps: base.resources.caps,
    // What the close would charge is the bid less the crew's ground, and that is what the table
    // measures against the caps: see `placeVendorBid`. The field has to stop at the same edge.
    bidCeiling: largestBidWithin(base.resources.caps, (bid) => discountedCaps(bid, ground)),
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
      results: latestLotResultsFor(repos, base.ownerId, now, cityId),
    },
    // Somebody else's public listings, plus counters aimed at this crew. Never its own. Those are
    // `mine`, and a board that showed a crew its own listing twice would read as two offers.
    offers: board.filter((offer) => offer.sellerBaseId !== base.id && visibleTo(offer, base.id)),
    mine,
    claims: repos.market.claimsFor(base.id).map(({ baseId: _owner, ...claim }) => claim),
    supply: supplyBoard(
      base.level,
      base.resources,
      bulk,
      repos.market.supplyUsed(base.id, day),
      (key) => storageCapacityFor(base.buildings, key, bulk),
      ground,
      trader,
    ),
    barterRate: brokerRate(base.level, ground, trader),
    traderPoints: trader,
    // The raw sum, which every shared price function curves for itself: see the schema field.
    marketDiscountPercent: ground,
    // §G4: the two things the Blueprints screen cannot see for itself. Read from the same base
    // record the trade route re-reads, so the panel and the refusal never disagree.
    reimagining: {
      // Working, not merely seated: a Researcher in a hospital bed reads nothing
      // (maintainer, 2026-09-23).
      hasResearcher: workingRoles(base.commanders, now).includes('researcher'),
      hasReimaginingResearch: isReimaginingResearched(base.research.technologies),
      // ...and how long until they are, so the bench says "laid up" rather than "hire one".
      researcherBackInSeconds: (() => {
        const laidUp = base.commanders.find(
          (officer) =>
            officer.role === 'researcher' && officerRecoverySeconds(officer.injuredUntil, now) > 0,
        );
        return laidUp ? officerRecoverySeconds(laidUp.injuredUntil, now) : null;
      })(),
    },
    traderAtWork: workingRoles(base.commanders, now).includes('trader'),
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
  acceptWaste?: boolean,
  /** Admin mode: the ration and the caps are waived and nothing is charged (2026-10-02). */
  admin = false,
): MarketResult {
  const day = marketDay(now);
  // The ration is measured against the bulk shelf; the room is measured against this resource's own.
  // Both off the same figure the board quoted, the crew's own storage bonus included, or the till would
  // refuse a run the panel had just offered.
  const bulk = storageCapacity(
    base.buildings,
    crewEffectsFor(repos, base, now).storageCapacityPercent,
  );
  const allowance = supplyAllowance(base.level, bulk);
  const used = repos.market.supplyUsed(base.id, day);
  // The crew's market discount, off the same reading the board quoted the lines with.
  const standing = standingEffectsFor(repos, base, now);
  const discount = standing.marketDiscountPercent;
  const trader = standing.chairPoints.trader ?? null;
  const price = supplyPrice(key, units, discount, trader);

  const refusal = supplyRefusal({
    key,
    units,
    stock: base.resources,
    allowanceLeft: admin ? Number.POSITIVE_INFINITY : Math.max(0, allowance - used),
    discountPercent: discount,
    traderPoints: trader,
  });
  if (refusal !== null && !adminWaives(refusal, admin)) return { kind: 'refused', reason: refusal };

  // The store is a warning, not a refusal (maintainer ruling, 2026-09-28): an order past it is
  // asked about first and, once agreed, lands up to the ceiling. The whole order is still charged
  // and still spends the ration, because that is what was bought.
  const paid: Base = {
    ...base,
    resources: spendResources(base.resources, { caps: adminCaps(price, admin) }),
  };
  const credit = creditBase(repos, paid, { [key]: units }, now);
  refuseWaste(credit, acceptWaste);
  const { resources } = credit;
  repos.bases.updateHoldings(base.id, resources, base.inventory);
  // The ration is spent in worth, not in units (maintainer, 2026-09-29): see `supply.ts`.
  repos.market.recordSupply(base.id, day, supplyRationCost(key, units), now.toISOString());
  tallyMarketDeal(repos, base.id, {
    side: 'buy',
    counterparty: 'supplier',
    worth: dealValue(
      { resources: { caps: price }, items: {} },
      { resources: { [key]: units }, items: {} },
    ),
    now,
  });
  tallyResourcesEarned(repos, base.id, credit.landed);
  return { kind: 'done', base: { ...base, resources } };
}

export type MarketRefusal =
  // The barrow's own, spelled by the module that owns the lot rules.
  | VendorBidRefusal
  | 'too_small'
  | 'same_resource'
  | 'unknown_offer'
  | 'unknown_claim'
  | 'not_yours'
  | 'own_offer'
  | 'cannot_settle'
  | 'nothing_offered'
  | 'nothing_wanted'
  | 'cannot_cover'
  | 'too_many_offers'
  | 'untradeable'
  // A board in a city this crew holds no ground in (maintainer, 2026-09-29).
  | 'city_shut'
  | SupplyRefusal;

export type MarketResult =
  { kind: 'done'; base: Base } | { kind: 'refused'; reason: MarketRefusal };

/**
 * The Broker: any resource into any other, caps included (maintainer, 2026-10-01), at half.
 *
 * Refuses a same-resource trade explicitly rather than quietly halving somebody's scrap, which is
 * the one input a fat-fingered player will actually produce.
 */
export function barter(
  repos: Repositories,
  base: Base,
  trade: {
    give: ResourceKey;
    want: ResourceKey;
    amount: number;
    acceptWaste?: boolean | undefined;
  },
  minimum: number,
  now: Date,
  /** Admin mode: what is handed over is not taken, so the trade costs nothing (2026-10-02). */
  admin = false,
): MarketResult {
  const { give, want, amount, acceptWaste } = trade;
  if (give === want) return { kind: 'refused', reason: 'same_resource' };
  if (amount < minimum) return { kind: 'refused', reason: 'too_small' };
  // §I3: the Broker stops taking half at level 60. Read off the level here rather than passed in
  // so the quote the screen drew and the trade the server settles cannot come from two rates. A
  // trade into caps is held under the supply run's price (`brokerPayoutRate`).
  const standing = standingEffectsFor(repos, base, now);
  const discount = standing.marketDiscountPercent;
  const trader = standing.chairPoints.trader ?? null;
  const gained = barterQuote(
    give,
    want,
    amount,
    brokerPayoutRate(want, brokerRate(base.level, discount, trader), discount, trader, give),
  );
  // The quote floors, and valuing by worth means ten of a cheap thing can buy less than one of a
  // dear one. Past the minimum count and still nothing back is the same trade as under it.
  if (gained <= 0) return { kind: 'refused', reason: 'too_small' };
  if (!canAfford(base.resources, { [give]: amount }) && !adminWaives('cannot_afford', admin)) {
    return { kind: 'refused', reason: 'cannot_afford' };
  }
  // The stores' ceiling, which the Broker used to credit straight past and then, from 2026-09-27,
  // refused outright at. Now a warning (maintainer ruling, 2026-09-28): he tells the player what
  // will not fit, and if they go ahead the excess is thrown away.
  const handedOver: Base = {
    ...base,
    resources: spendResources(base.resources, adminCost({ [give]: amount }, admin)),
  };
  const credit = creditBase(repos, handedOver, { [want]: gained }, now);
  refuseWaste(credit, acceptWaste);
  const { resources } = credit;
  repos.bases.updateHoldings(base.id, resources, base.inventory);
  // A barter is a deal and the far side of it is a vendor, so only this crew is counted.
  tallyMarketDeal(repos, base.id, {
    side: 'buy',
    counterparty: 'broker',
    worth: dealValue(
      { resources: { [give]: amount }, items: {} },
      { resources: { [want]: gained }, items: {} },
    ),
    now,
  });
  // Nothing he hands over is earned, caps or goods (bug pass, 2026-10-04). Caps he pays out are
  // goods already counted on their own ladders (caps ruling, 2026-10-01), and goods he hands over
  // are a trade of what the crew already had: with a Trader past C+ a trade into goods comes back
  // at even, so a loop through him counted the same stock again on every lap, for ever.
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
  /**
   * The board it goes up on: the city tab the player posted from, their own city by default. A
   * counter ignores it and goes up on its listing's board.
   */
  postedIn: string = homeCityOf(base),
): MarketResult & { offer?: MarketOffer } {
  const standing = repos.market.openBySeller(base.id).length;
  const refusal = offerRefusal(give, want, base.resources, base.inventory, standing);
  if (refusal !== null) return { kind: 'refused', reason: refusal };

  let directedAt: string | null = null;
  let cityId = postedIn;
  if (counterTo !== undefined) {
    const parent = repos.market.findById(counterTo);
    if (!parent || parent.status !== 'open') return { kind: 'refused', reason: 'unknown_offer' };
    // Past its lifetime is gone, swept or not, for the reason `acceptOffer` gives. A counter
    // escrowed against one was handed straight back by the next sweep, having answered nothing.
    if (listingHasRunOut(parent, now)) return { kind: 'refused', reason: 'unknown_offer' };
    if (parent.sellerBaseId === base.id) return { kind: 'refused', reason: 'own_offer' };
    // A counter is between two crews: only the one it is aimed at may answer it, the rule
    // `acceptOffer` already applies to taking it (bug pass, 2026-09-29).
    if (parent.directedAt !== null && parent.directedAt !== base.id) {
      return { kind: 'refused', reason: 'not_yours' };
    }
    directedAt = parent.sellerBaseId;
    cityId = parent.cityId;
  }
  // A board belongs to a city and only a crew with ground there stands at it (maintainer,
  // 2026-09-29), to post on it or to answer a listing pinned to it.
  if (!mayEnter(repos, base, cityId)) return { kind: 'refused', reason: 'city_shut' };

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
    cityId,
  };
  repos.market.insert(offer);
  // The poster hears about a counter (bug pass, 2026-10-02). It sat on its listing's city board and
  // nowhere else, so a poster browsing another city never saw it, and the counter's escrow stayed
  // locked for two days before coming back as a claim.
  if (directedAt !== null) {
    const poster = repos.bases.findById(directedAt);
    if (poster) {
      notify(repos, {
        userId: poster.ownerId,
        kind: 'market_countered',
        title: `${shownNameOf(repos, base.ownerId, base.name)} countered your listing: ${describeBundle(give)} for ${describeBundle(want)}`,
        link: '/game/market/offers',
        subjectId: offer.id,
        at: now,
      });
    }
  }
  return { kind: 'done', base: { ...base, resources, inventory }, offer };
}

/**
 * Take a listing back. The escrow comes home, into the stores: what no longer fits is warned
 * about first and thrown away if the poster goes ahead (maintainer ruling, 2026-09-28).
 */
export function withdrawOffer(
  repos: Repositories,
  base: Base,
  offerId: string,
  now: Date,
  acceptWaste?: boolean,
): MarketResult {
  const offer = repos.market.findById(offerId);
  if (!offer || offer.status !== 'open') return { kind: 'refused', reason: 'unknown_offer' };
  if (offer.sellerBaseId !== base.id) return { kind: 'refused', reason: 'not_yours' };

  const credit = creditBase(repos, base, offer.give.resources, now);
  refuseWaste(credit, acceptWaste);
  repos.market.setStatus(offer.id, 'withdrawn');
  const { resources } = credit;
  const inventory = addItems(base.inventory, offer.give.items);
  repos.bases.updateHoldings(base.id, resources, inventory);
  releaseCounters(repos, offer.id, now);
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
  acceptWaste?: boolean,
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
  if (listingHasRunOut(offer, now)) return { kind: 'refused', reason: 'unknown_offer' };
  if (offer.sellerBaseId === base.id) return { kind: 'refused', reason: 'own_offer' };
  if (offer.directedAt !== null && offer.directedAt !== base.id) {
    return { kind: 'refused', reason: 'not_yours' };
  }
  // The board's own door (maintainer, 2026-09-29): a listing is taken where it is pinned, by a
  // crew with ground in that city. A Terminus crew with nothing in Ashfall used to take an Ashfall
  // listing off its own tab, which showed every city's.
  if (!mayEnter(repos, base, offer.cityId)) return { kind: 'refused', reason: 'city_shut' };
  /*
   * A counter replaces the listing it answers, which is always the crew's own (bug pass,
   * 2026-09-29). Taking one used to leave that listing standing: the crew paid the counter out of
   * its stockpile while the same goods sat in the listing's escrow, so it was refused when all it
   * held was in that escrow, and when it was not, somebody else could take the listing as well and
   * the goods were sold twice.
   */
  const answered = offer.counterTo === null ? null : repos.market.findById(offer.counterTo);
  if (answered !== null && !listingStands(answered, now)) {
    return { kind: 'refused', reason: 'unknown_offer' };
  }
  const escrowBack = answered?.give ?? emptyBundle();
  const holding = addItems(base.inventory, escrowBack.items);
  const { owed, left } = payOutOfEscrowFirst(escrowBack.resources, offer.want.resources);
  if (!canSettle({ resources: owed, items: offer.want.items }, base.resources, holding)) {
    return { kind: 'refused', reason: 'cannot_settle' };
  }

  const seller = repos.bases.findById(offer.sellerBaseId);
  if (!seller) return { kind: 'refused', reason: 'unknown_offer' };

  /*
   * Buyer: pays `want`, receives `give`, into the stores. The buyer is the one pressing, so what
   * will not fit is warned about before anything moves (maintainer ruling, 2026-09-28). The escrow
   * of a listing this counter replaces pays first, and what is left of it comes home with the goods.
   */
  const paying: Base = { ...base, resources: spendResources(base.resources, owed) };
  const bought = creditBase(repos, paying, mergeResources(left, offer.give.resources), now);
  refuseWaste(bought, acceptWaste);
  const buyerResources = bought.resources;
  const buyerInventory = addItems(removeItems(holding, offer.want.items), offer.give.items);
  repos.bases.updateHoldings(base.id, buyerResources, buyerInventory);
  // Before the release below, which would otherwise hand this very counter back as a claim.
  repos.market.setStatus(offer.id, 'accepted');
  if (answered) {
    repos.market.setStatus(answered.id, 'withdrawn');
    releaseCounters(repos, answered.id, now);
    closeListingsAbove(repos, answered, now);
  }

  // Seller: receives `want`, held on the board until they claim it. Their `give` left when they
  // posted, and nobody is on their screen now to warn (maintainer, 2026-09-28).
  holdForClaim(repos, { offer, reason: 'taken', goods: offer.want, takenBy: base.name, now });

  /*
   * Feats, both sides of the deal (maintainer request, 2026-09-13).
   *
   * The seller's half of the board has been recordable since `market_offers` existed; the buyer's
   * has not, because `acceptOffer` writes no row naming who took it. Counting it here is what
   * makes a buying ladder possible at all without a schema change.
   *
   * ## The deal is counted; what changed hands is not
   *
   * Neither side's `resources_earned` moves here, and this is the only faucet in the game left out
   * of that figure. A trade between two players is a **closed loop**: two accounts can pass one
   * listing back and forth all afternoon, each pass crediting both of them with everything in it,
   * at no net cost to either. The lifetime-caps ladder tops out at three million and pays the
   * largest reward in the catalogue, so that loop is worth running.
   *
   * Every other faucet is bounded by something real. Production is bounded by the clock, a job by
   * the road, a fight by units, and the two vendor doors below by what they charge, since the
   * Broker and the supplier are the house rather than another player and take their cut. Trading
   * still moves wealth, and a crew that lives by it still earns through what it does with the
   * goods; what it cannot do is manufacture a lifetime record out of a handshake.
   *
   * The same loop is why the deal counters have a floor and a daily limit per pair of crews
   * (`tallyMarketDeal`): one scrap for one scrap, passed back and forth, was a buy and a sale a go.
   */
  const worth = dealValue(offer.give, offer.want);
  tallyMarketDeal(repos, base.id, { side: 'buy', counterparty: { baseId: seller.id }, worth, now });
  tallyMarketDeal(repos, seller.id, {
    side: 'sale',
    counterparty: { baseId: base.id },
    worth,
    now,
  });

  // The buyer's pages ring now. The seller's ring when they claim (`payClaim`). Measured from
  // `holding`, so a page coming home out of a replaced listing's escrow is not news.
  tellPagesFound(repos, {
    userId: base.ownerId,
    before: holding,
    after: buyerInventory,
    source: { kind: 'offer', from: offer.sellerName },
    at: now,
  });

  releaseCounters(repos, offer.id, now);

  return { kind: 'done', base: { ...base, resources: buyerResources, inventory: buyerInventory } };
}

/**
 * Every listing above one a taken counter replaced, closed with it (bug pass, 2026-09-29).
 *
 * A negotiation can run deeper than one reply: A lists, B counters, A counters back, and B takes
 * that. Closing only the listing the taken counter answered left A's first listing standing with
 * its escrow, for a third crew to take as well, and A with two deals out of one conversation. Each
 * one up the chain goes, with its escrow held as a claim for its poster (the crew pressing Accept
 * already had the one below paid into its hands) and any other counters to it released.
 */
function closeListingsAbove(repos: Repositories, replaced: MarketOffer, now: Date): void {
  if (replaced.counterTo === null) return;
  const parent = repos.market.findById(replaced.counterTo);
  // Anything already closed released everything below it at the time, so there is nothing above.
  if (!parent || parent.status !== 'open') return;
  repos.market.setStatus(parent.id, 'withdrawn');
  holdEscrow(repos, parent, 'closed', now);
  releaseCounters(repos, parent.id, now);
  closeListingsAbove(repos, parent, now);
}

/** Whether a listing can still be traded against: open, and not run out. */
function listingStands(offer: MarketOffer | undefined, now: Date): offer is MarketOffer {
  return offer !== undefined && offer.status === 'open' && !listingHasRunOut(offer, now);
}

/**
 * Splits a payment between an escrow coming home and the stockpile: the escrow covers what it
 * can, the stockpile owes the rest, and whatever the escrow did not spend is left to credit.
 */
function payOutOfEscrowFirst(
  escrow: PartialResources,
  cost: PartialResources,
): { owed: PartialResources; left: PartialResources } {
  const owed: PartialResources = {};
  const left: PartialResources = {};
  for (const key of RESOURCE_KEYS) {
    const held = escrow[key] ?? 0;
    const due = cost[key] ?? 0;
    if (due > held) owed[key] = due - held;
    else if (held > due) left[key] = held - due;
  }
  return { owed, left };
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
  // Not "at two lots": the number is `MAX_OPEN_LOTS` and the screen prints what is left on every
  // read, so a refusal that baked the figure in would be a second place for it to go stale.
  too_many_lots: 'You have money on every lot you can hold. Let one close first',
  too_small: 'The Broker will not get out of his chair for that little',
  same_resource: 'The Broker trades one thing for another, not for itself',
  unknown_offer: 'That listing is gone',
  unknown_claim: 'Those goods are not on the board any more',
  not_yours: 'That listing is not yours to touch',
  own_offer: 'You cannot trade with yourself',
  cannot_settle: 'You cannot pay what that asks for',
  nothing_offered: 'An offer has to give something',
  nothing_wanted: 'An offer has to ask for something',
  cannot_cover: 'You do not have what you are offering',
  too_many_offers: 'You have too many listings standing already',
  untradeable: 'That is not something anybody will take off you',
  // The words the market read refuses a shut city with (`routes/market.ts`), so a board and a
  // press on it say the same thing.
  city_shut: 'You hold no ground in that city. Take a place in it first.',
};

/** The sentence for a refusal, with the figures the one numbered refusal needs. */
export function marketRefusalText(
  reason: MarketRefusal,
  figures: RefusalFigures = NO_FIGURES,
): string {
  const text = MARKET_REFUSAL_TEXT[reason];
  return typeof text === 'string' ? text : text(figures);
}
