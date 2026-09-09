import {
  ITEM_CATALOG,
  addItems,
  lotSeed,
  marketDay,
  nextLotBid,
  rankLotBids,
  spendResources,
  vendorSessionsFor,
  vendorStockFor,
  vendorVisitAt,
  visitClosesAt,
  type Base,
  type ItemId,
  type LotOutcome,
  type VendorAuction,
  type VendorAuctionResult,
  type VendorBidView,
  type VendorLine,
  type VendorVisit,
} from '@frontline/shared';
import { previousDay } from '../bar/auction.js';
import { standingEffectsFor } from '../crew/standing.js';
import type { Repositories } from '../db/repos/index.js';
import type { VendorBid, VendorLotResult } from '../db/repos/vendor-auctions.js';
import { notify } from '../social/notify.js';

/**
 * The Runner's lots (market extension, board 2026-09-08), server side.
 *
 * The rules, the visit and the ranking live in `@frontline/shared`'s `market/auction.ts`, which
 * both ends of the wire read. What is here is the three things a server has to own: **taking a
 * bid**, **closing a visit** (ranking the bids and walking down them until somebody can pay), and
 * **projecting a lot** for one reader. It is the Bar's auction with the sealed phase taken out and
 * caps in place of a payroll book.
 *
 * ## The close is not a scheduled job
 *
 * `settleVendorAuctions` looks for lots with bids and no result row whose visit is over, so the
 * close happens on whichever comes first: the world clock's next tick, or the next read of the
 * market. Both call the same function on the same stored rows and reach the same answer, which is
 * what makes it safe to have two doors into it. The tie-break is a hash of the lot and the crew
 * rather than a draw from a stream, so it does not matter which door ran it or how many times.
 *
 * ## One reserve, and it is nobody's in particular
 *
 * A lot opens at the line's price with no crew discount on it. Two crews bidding against each
 * other have to be bidding against the same floor, or the same offer is legal for one of them and
 * under the reserve for the other. The winner's own ground (§A4's `marketDiscountPercent`) comes
 * off what they **pay** at the close, exactly as a crew's negotiators come off a wage at the Bar,
 * so it is invisible to everybody they were bidding against: the price on the result row and in
 * everybody's bell is the number the lot closed at.
 */

/** How many bids one lot shows. The wire caps it and so does the projection that fills it. */
export const MAX_LOT_BIDS_SHOWN = 20;

/**
 * A price with the crew's market discount taken off (§A4).
 *
 * Floored at one cap: no amount of ground makes anything free, which is the same rule `discounted`
 * applies to every other price in the game. It lives here rather than on the board because the
 * close is the only thing left that charges a discounted figure: what the barrow *quotes* is the
 * city's number now that every line is a lot.
 */
export const MAX_MARKET_DISCOUNT = 45;

export function discountedCaps(price: number, percent: number): number {
  const off = Math.min(MAX_MARKET_DISCOUNT, Math.max(0, percent));
  return Math.max(1, Math.round(price * (1 - off / 100)));
}

/** What one crew would actually be charged for a bid of theirs. */
function chargeFor(repos: Repositories, base: Base, amount: number, now: Date): number {
  return discountedCaps(amount, standingEffectsFor(repos, base, now).marketDiscountPercent);
}

/** The highest bid on a lot, or `undefined` on one nobody has opened. */
function leaderOf(bids: readonly VendorBid[]): VendorBid | undefined {
  return bids.reduce<VendorBid | undefined>(
    (best, bid) => (best === undefined || bid.amount > best.amount ? bid : best),
    undefined,
  );
}

/** How many of a line are left on the barrow today, across the whole city. */
function leftOnTheLine(repos: Repositories, day: string, line: VendorLine): number {
  return Math.max(0, line.stock - repos.market.vendorSold(day, line.id));
}

// --- taking a bid ---

export const VENDOR_BID_REFUSALS = [
  'vendor_closed',
  'unknown_line',
  'sold_out',
  'outbid_yourself',
  'too_low',
  'cannot_afford',
] as const;
export type VendorBidRefusal = (typeof VENDOR_BID_REFUSALS)[number];

/** The figures a refusal may need to name. Only `too_low` reads them. */
export interface RefusalFigures {
  /** The least this crew could have bid. */
  minimum: number;
  /** What the leader is at, or null on an untouched lot. */
  leading: number | null;
}

export type VendorBidResult =
  ({ kind: 'refused'; reason: VendorBidRefusal } & RefusalFigures) | { kind: 'placed' };

export interface VendorBidRequest {
  base: Base;
  userId: string;
  lineId: string;
  /** Caps. Rounded on the way in: the wire is an integer and so is the till. */
  amount: number;
  now: Date;
}

/**
 * A public bid on a lot, while he is in.
 *
 * The order of the refusals is the order a player wants to hear them in, and `outbid_yourself` is
 * in it for the same reason it is at the Bar: raising your own leading bid is legal in most auction
 * software and costs the bidder caps for nothing, because there is nobody to outbid.
 *
 * `cannot_afford` is measured against what the close would actually charge, which is the bid after
 * this crew's ground. A gate on the raw bid would refuse bids the crew could comfortably cover, and
 * the two numbers would then disagree about the same crew at the table and at the close.
 */
export function placeVendorBid(repos: Repositories, request: VendorBidRequest): VendorBidResult {
  const { base, userId, lineId, now } = request;
  const amount = Math.round(request.amount);
  const bare = (reason: VendorBidRefusal): VendorBidResult => ({
    kind: 'refused',
    reason,
    minimum: 0,
    leading: null,
  });

  const visit = vendorVisitAt(now);
  if (visit === null) return bare('vendor_closed');
  const line = vendorStockFor(visit.day).find((candidate) => candidate.id === lineId);
  if (!line) return bare('unknown_line');

  const bids = repos.vendorAuctions.bidsFor(visit.day, visit.session, lineId);
  const leader = leaderOf(bids);
  const leading = leader?.amount ?? null;
  const minimum = nextLotBid(line.price, leading);
  const refuse = (reason: VendorBidRefusal): VendorBidResult => ({
    kind: 'refused',
    reason,
    minimum,
    leading,
  });

  if (leftOnTheLine(repos, visit.day, line) === 0) return refuse('sold_out');
  if (leader?.userId === userId) return refuse('outbid_yourself');
  if (amount < minimum) return refuse('too_low');
  if (base.resources.caps < chargeFor(repos, base, amount, now)) return refuse('cannot_afford');

  repos.vendorAuctions.placeBid({
    day: visit.day,
    session: visit.session,
    lineId,
    userId,
    baseId: base.id,
    amount,
    at: now.toISOString(),
  });
  return { kind: 'placed' };
}

// --- what one reader sees ---

export interface VendorAuctionView {
  /** The account reading. Its own bid is the only one marked. */
  reader: string;
  visit: VendorVisit;
  line: VendorLine;
  bids: readonly VendorBid[];
  usernames: ReadonlyMap<string, string>;
}

function bidView(
  bid: VendorBid,
  reader: string,
  usernames: ReadonlyMap<string, string>,
): VendorBidView {
  return {
    username: usernames.get(bid.userId) ?? 'Somebody',
    amount: bid.amount,
    at: bid.at,
    yours: bid.userId === reader,
  };
}

/**
 * Who has bid, by name.
 *
 * One lookup per distinct account on the barrow, which is at most a handful: everybody in the city
 * can bid, but only the crews at these six lots are on this payload.
 */
export function bidderNames(
  repos: Repositories,
  bids: readonly VendorBid[],
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const bid of bids) {
    if (names.has(bid.userId)) continue;
    names.set(bid.userId, repos.users.findById(bid.userId)?.username ?? 'Somebody');
  }
  return names;
}

/** One lot on the wire. Every bid on it is public, which is the whole point of the barrow. */
export function projectVendorAuction({
  reader,
  visit,
  line,
  bids,
  usernames,
}: VendorAuctionView): VendorAuction {
  const leader = leaderOf(bids);
  const mine = bids.find((bid) => bid.userId === reader);
  const newestFirst = [...bids].sort((a, b) => b.at.localeCompare(a.at));

  return {
    lineId: line.id,
    session: visit.session,
    closesAt: visit.closesAt.toISOString(),
    reserve: line.price,
    leading: leader ? bidView(leader, reader, usernames) : null,
    nextBid: nextLotBid(line.price, leader?.amount ?? null),
    bids: newestFirst.slice(0, MAX_LOT_BIDS_SHOWN).map((bid) => bidView(bid, reader, usernames)),
    bidders: bids.length,
    yourBid: mine?.amount ?? null,
  };
}

// --- the close ---

/** What a lot went for, and who took it. The price is the bid, not what their ground cut it to. */
interface LotWinner {
  userId: string;
  price: number;
}

/**
 * Closes every lot whose visit is over.
 *
 * One transaction per lot, and the result row is written inside it. Those two facts are the whole
 * of the safety argument: a crash between handing over the goods and recording the close would
 * otherwise leave the lot due again, and the second pass would hand a second unit off a line the
 * catalogue rations to one.
 */
export function settleVendorAuctions(repos: Repositories, now: Date): void {
  for (const lot of repos.vendorAuctions.unsettled(now)) {
    repos.tx(() => closeLot(repos, lot, now));
  }
}

function closeLot(
  repos: Repositories,
  lot: { day: string; session: number; lineId: string },
  now: Date,
): void {
  const { day, session, lineId } = lot;
  const line = vendorStockFor(day).find((candidate) => candidate.id === lineId);
  const bids = repos.vendorAuctions.bidsFor(day, session, lineId);
  // A line id that names nothing on that day's barrow cannot be sold to anybody, and leaving it due
  // would settle it again on every read for ever. It goes down as a lot nobody took.
  const winner = line ? award(repos, { day, session, line, bids, now }) : null;

  repos.vendorAuctions.recordResult({
    day,
    session,
    lineId,
    item: line?.item ?? lineId,
    winnerUserId: winner?.userId ?? null,
    price: winner?.price ?? null,
    settledAt: now.toISOString(),
  });
  tellTheBarrow(repos, { item: line?.item ?? null, lineId, bids, winner, now });
}

/**
 * Walks the ranking and hands the unit to the first crew that can pay for it.
 *
 * Nothing is escrowed at the bid, so caps are checked again here: a crew that spent theirs between
 * bidding and the close passes to the next crew down rather than going overdrawn. The stock counter
 * moves by one, which is what makes a two-stock line a lot again on his next visit.
 */
function award(
  repos: Repositories,
  lot: {
    day: string;
    session: number;
    line: VendorLine;
    bids: readonly VendorBid[];
    now: Date;
  },
): LotWinner | null {
  const { day, session, line, bids, now } = lot;
  // Nothing left on the line is not the same as nobody bidding: a lot can be closed after the city
  // cleared the line out on an earlier visit, and there is no unit to hand over.
  if (leftOnTheLine(repos, day, line) === 0) return null;

  const ranked = rankLotBids(bids, line.price, lotSeed(day, session, line.id));
  for (const entry of ranked) {
    const bid = bids.find((row) => row.userId === entry.userId);
    const base = bid ? repos.bases.findById(bid.baseId) : undefined;
    if (!base) continue;

    const charge = chargeFor(repos, base, entry.amount, now);
    if (base.resources.caps < charge) continue;

    repos.bases.updateHoldings(
      base.id,
      spendResources(base.resources, { caps: charge }),
      addItems(base.inventory, { [line.item as ItemId]: 1 }),
    );
    repos.market.recordVendorSale(day, line.id, 1, now.toISOString());
    return { userId: entry.userId, price: entry.amount };
  }
  return null;
}

/** What a line is called in a sentence. The wire carries the id; a bell carries the name. */
function itemName(item: string | null): string {
  if (item === null) return 'What he had';
  return ITEM_CATALOG[item as ItemId]?.name ?? item;
}

function tellTheBarrow(
  repos: Repositories,
  lot: {
    item: string | null;
    lineId: string;
    bids: readonly VendorBid[];
    winner: LotWinner | null;
    now: Date;
  },
): void {
  const { item, lineId, bids, winner, now } = lot;
  const name = itemName(item);
  if (winner) {
    notify(repos, {
      userId: winner.userId,
      kind: 'market_won',
      title: `You took ${name} off the Runner for ${winner.price}`,
      link: '/game/market',
      subjectId: lineId,
      now,
    });
  }

  const winnerName = winner
    ? (repos.users.findById(winner.userId)?.username ?? 'another crew')
    : '';
  for (const bid of bids) {
    if (bid.userId === winner?.userId) continue;
    notify(repos, {
      userId: bid.userId,
      kind: 'market_outbid',
      title: winner ? `${name} went to ${winnerName} for ${winner.price}` : `${name} went unsold`,
      link: '/game/market',
      subjectId: lineId,
      now,
    });
  }
}

// --- the last visit, as this reader saw it ---

/** How far back the results panel looks for the last visit this crew bid at. */
export const LOT_RESULTS_LOOKBACK_DAYS = 7;

/**
 * How the lots this crew bid on at one visit ended.
 *
 * `passed` needs the ranking rather than the result row: a crew whose bid was highest and who could
 * not cover it when he packed up is not the same story as one that was simply outbid, and the row
 * alone cannot tell them apart.
 */
export function lotResultsFor(
  repos: Repositories,
  userId: string,
  day: string,
  session: number,
): VendorAuctionResult[] {
  const mine = repos.vendorAuctions.bidsBy(userId, day, session);
  if (mine.length === 0) return [];
  const closed = new Map(
    repos.vendorAuctions.results(day, session).map((result) => [result.lineId, result]),
  );

  return mine.flatMap((bid) => {
    const result = closed.get(bid.lineId);
    if (!result) return [];
    return [
      {
        day,
        session,
        lineId: bid.lineId,
        item: result.item,
        outcome: outcomeFor(repos, result, userId),
        price: result.price,
        winner: result.winnerUserId
          ? (repos.users.findById(result.winnerUserId)?.username ?? null)
          : null,
        yourBid: bid.amount,
      },
    ];
  });
}

/**
 * The last visit's results, not strictly the last visit's.
 *
 * He is in twice a day, so a crew that bid this morning and opened the market this evening would
 * find an empty panel if this only ever read the visit before this one. It walks visits newest
 * first for a week and stops at the first one this crew bid at: two visits are never shown
 * together, or a player could not tell which morning a lot they lost belonged to.
 */
export function latestLotResultsFor(
  repos: Repositories,
  userId: string,
  now: Date,
): VendorAuctionResult[] {
  let day = marketDay(now);
  for (let back = 0; back <= LOT_RESULTS_LOOKBACK_DAYS; back += 1) {
    const sessions = vendorSessionsFor(day);
    for (let session = sessions.length - 1; session >= 0; session -= 1) {
      // A visit still running has no results yet, and the one before it is the one to show.
      if (visitClosesAt(day, session).getTime() > now.getTime()) continue;
      const results = lotResultsFor(repos, userId, day, session);
      if (results.length > 0) return results;
    }
    day = previousDay(day);
  }
  return [];
}

function outcomeFor(repos: Repositories, result: VendorLotResult, reader: string): LotOutcome {
  if (result.winnerUserId === reader) return 'won';
  const line = vendorStockFor(result.day).find((candidate) => candidate.id === result.lineId);
  if (line) {
    const bids = repos.vendorAuctions.bidsFor(result.day, result.session, result.lineId);
    const ranked = rankLotBids(
      bids,
      line.price,
      lotSeed(result.day, result.session, result.lineId),
    );
    if (ranked[0]?.userId === reader) return 'passed';
  }
  return result.winnerUserId === null ? 'unsold' : 'lost';
}
