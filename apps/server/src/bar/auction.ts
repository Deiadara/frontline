import {
  askingWage,
  auctionPhaseAt,
  auctionWindow,
  maxOpenAuctionsFor,
  nextMinimumBid,
  payrollFits,
  rankBids,
  reservationWage,
  type AuctionOutcome,
  type AuctionWindow,
  type BarAuction,
  type BarAuctionResult,
  type BarBidView,
  type Base,
} from '@frontline/shared';
import { adminWaives } from '../admin/mode.js';
import { crewEffectsFor } from '../crew/standing.js';
import type { BarBid, BarResult } from '../db/repos/bar.js';
import type { Repositories } from '../db/repos/index.js';
import { awardPlayerXp } from '../progression/award.js';
import { notify } from '../social/notify.js';
import { assessAgainst, committedWage, ledgerFor, recruitSlotsFor, signRecruit } from './hire.js';
import { barDay, findBarRecruit, seatOf, type BarCharacter } from './roster.js';

/**
 * The Bar's daily auction (GDD §H7a), server side.
 *
 * The rules, the phases and the ranking live in `@frontline/shared`'s `bar/auction.ts`, which both
 * ends of the wire read. What is here is the three things a server has to own: **taking a bid**
 * (every gate a hire ever had, applied at the table rather than at the close), **closing a day**
 * (ranking the finals and walking down them until somebody can actually take the person), and
 * **projecting a table** for one reader.
 *
 * ## The close is not a scheduled job
 *
 * There is no cron here either. `settleBarAuctions` looks for tables with bids and no result row
 * on any day before today and settles them, so the close happens on whichever comes first: the
 * world clock's next tick after midnight, or the next request that settles the world. Both call
 * the same function on the same stored rows and reach the same answer, which is what makes it safe
 * to have two doors into it. The tie-break is a hash of the auction and the crew rather than a
 * draw from a stream, so it does not matter which door ran it or how many times.
 *
 * ## One reserve, and it is nobody's in particular
 *
 * A table's floor is `reservationWage(askingWage(sheet))` with no crew discount applied. Two crews
 * bidding against each other have to be bidding against the same number, or the same offer is
 * legal for one of them and below the floor for the other, and the close has to pick which of two
 * reserves the ranking is measured against.
 *
 * `wageDiscountPercent` lands one table further down instead: the price is what everybody bid and
 * what everybody is told, and the winner's own negotiators take their cut off the **contract**
 * (`committedWage`). So the only thing a crew's negotiators buy at the Bar is a cheaper book
 * entry, which is invisible to everyone they were bidding against. The payroll gate reads the same
 * discounted figure at the bid as at the close, or a crew would be refused a bid its book could
 * have held after the talk-down.
 */

/** How many open bids one table shows. The wire caps it and so does the query that fills it. */
export const MAX_BIDS_SHOWN = 20;

/** What this person will not go below, and where their table opens. The city's number, not a crew's. */
export function reserveFor(recruit: BarCharacter): number {
  return reservationWage(askingWage(recruit.attributes));
}

/** What a crew is actually in for at a table: the higher of the two numbers they put down. */
function finalOf(bid: BarBid): number {
  return Math.max(bid.open ?? 0, bid.sealed ?? 0);
}

/** The highest open bid at a table, or `undefined` on one nobody has opened. */
function leaderOf(bids: readonly BarBid[]): BarBid | undefined {
  return bids
    .filter((bid) => bid.open !== null)
    .reduce<BarBid | undefined>(
      (best, bid) => (best === undefined || (bid.open ?? 0) > (best.open ?? 0) ? bid : best),
      undefined,
    );
}

// --- taking a bid ---

export const BID_REFUSALS = [
  'closed',
  'sealed',
  'not_sealed',
  'not_interested',
  'already_hired',
  'no_slots',
  'too_many_auctions',
  'outbid_yourself',
  'already_sealed',
  'too_low',
  'no_payroll',
] as const;
export type BidRefusal = (typeof BID_REFUSALS)[number];

export type BidResult =
  /** `minimum` is the least this crew could have put down, whatever the reason was. */
  { kind: 'refused'; reason: BidRefusal; minimum: number } | { kind: 'placed' };

export interface BidRequest {
  base: Base;
  userId: string;
  recruit: BarCharacter;
  /** Caps a week. Rounded on the way in: the wire is an integer and so is the book. */
  amount: number;
  now: Date;
  /** Testing mode waives the gates that are about how far along a crew is. */
  admin: boolean;
}

/**
 * §H3, §H8 and §H7a: whether this crew may be at this table at all.
 *
 * Every waiver is applied at its own check rather than to a single first-refusal, which is not a
 * style choice. Applied afterwards, a waived gate standing in front of a non-waivable one hides it
 * completely: that is exactly how admin mode once signed two officers into one chair.
 */
function tableRefusal(
  repos: Repositories,
  request: BidRequest,
  day: string,
): BidRefusal | undefined {
  const { base, userId, recruit, admin } = request;
  if (!assessAgainst(base, recruit).interested && !adminWaives('not_interested', admin)) {
    return 'not_interested';
  }
  if (base.commanders.some((officer) => officer.id === recruit.id)) return 'already_hired';
  if (base.commanders.length >= recruitSlotsFor(repos, base) && !adminWaives('no_slots', admin)) {
    return 'no_slots';
  }
  // §H7a: two tables at once, three past level 40. A table the crew is already at is not a new
  // one, so raising a bid never runs into the cap that the first bid cleared.
  const mine = repos.bar.bidsBy(userId, day);
  const seated = mine.some((bid) => bid.recruitId === recruit.id);
  if (!seated && mine.length >= maxOpenAuctionsFor(base.level)) return 'too_many_auctions';
  return undefined;
}

/**
 * §H7: the fee has to fit what is left of the book, or winning it would be winning nothing.
 *
 * Measured against what the book would actually be charged, which is the bid after this crew's
 * negotiators (`committedWage`). The close applies the same discount, so a gate on the raw bid
 * would refuse offers the crew could comfortably hold.
 */
function payrollRefuses(repos: Repositories, base: Base, amount: number, admin: boolean): boolean {
  const effects = crewEffectsFor(repos, base);
  const ledger = ledgerFor(base, effects.payrollStepDiscountPercent);
  const wage = committedWage(amount, effects.wageDiscountPercent);
  return !payrollFits(ledger, wage) && !adminWaives('no_payroll', admin);
}

/**
 * §H7a: a public bid, in the open phase.
 *
 * The order of the refusals is the order a player wants to hear them in, and `outbid_yourself` is
 * in it for a reason that is not obvious: raising your own leading bid is legal in most auction
 * software and costs the bidder money for nothing, because there is nobody to outbid. Refusing it
 * is the one place this model is friendlier than a real room.
 */
export function placeBid(repos: Repositories, request: BidRequest): BidResult {
  const { base, userId, recruit, now, admin } = request;
  const amount = Math.round(request.amount);
  const window = auctionWindow(now);
  const bids = repos.bar.bidsFor(window.day, recruit.id);
  const leader = leaderOf(bids);
  const minimum = nextMinimumBid(reserveFor(recruit), leader?.open ?? null);
  const refuse = (reason: BidRefusal): BidResult => ({ kind: 'refused', reason, minimum });

  const phase = auctionPhaseAt(now, window);
  if (phase !== 'open') return refuse(phase === 'sealed' ? 'sealed' : 'closed');

  const ineligible = tableRefusal(repos, request, window.day);
  if (ineligible) return refuse(ineligible);
  if (leader?.userId === userId) return refuse('outbid_yourself');
  if (amount < minimum) return refuse('too_low');
  if (payrollRefuses(repos, base, amount, admin)) return refuse('no_payroll');

  repos.bar.placeOpenBid({
    day: window.day,
    recruitId: recruit.id,
    userId,
    baseId: base.id,
    amount,
    at: now.toISOString(),
  });
  return { kind: 'placed' };
}

/**
 * §H7a: the one secret final value, in the last half hour.
 *
 * A crew with no open bid may still lock one, which is the snipe the sealed phase exists for, and
 * it counts against the two-table cap exactly as an open bid does: a bid is a commitment whichever
 * phase it was made in.
 *
 * The floor is the highest of three numbers: the reserve, the crew's own open bid, and the leading
 * open bid. A value under any of them cannot win, and a lock that cannot win is a lock the player
 * will spend the last half hour of the day believing in.
 */
export function sealBid(repos: Repositories, request: BidRequest): BidResult {
  const { base, userId, recruit, now, admin } = request;
  const amount = Math.round(request.amount);
  const window = auctionWindow(now);
  const bids = repos.bar.bidsFor(window.day, recruit.id);
  const leader = leaderOf(bids);
  const mine = bids.find((bid) => bid.userId === userId);
  const minimum = Math.max(reserveFor(recruit), mine?.open ?? 0, leader?.open ?? 0);
  const refuse = (reason: BidRefusal): BidResult => ({ kind: 'refused', reason, minimum });

  if (auctionPhaseAt(now, window) !== 'sealed') return refuse('not_sealed');

  const ineligible = tableRefusal(repos, request, window.day);
  if (ineligible) return refuse(ineligible);
  if (mine?.sealed != null) return refuse('already_sealed');
  if (amount < minimum) return refuse('too_low');
  if (payrollRefuses(repos, base, amount, admin)) return refuse('no_payroll');

  repos.bar.sealBid({
    day: window.day,
    recruitId: recruit.id,
    userId,
    baseId: base.id,
    amount,
    at: now.toISOString(),
  });
  return { kind: 'placed' };
}

// --- what one reader sees ---

export interface AuctionView {
  /** The account reading. Its own bids are the only ones marked, and the only sealed one shown. */
  reader: string;
  window: AuctionWindow;
  now: Date;
  recruit: BarCharacter;
  bids: readonly BarBid[];
  usernames: ReadonlyMap<string, string>;
}

function bidView(bid: BarBid, reader: string, usernames: ReadonlyMap<string, string>): BarBidView {
  return {
    username: usernames.get(bid.userId) ?? 'Somebody',
    amount: bid.open ?? 0,
    at: bid.openAt ?? '',
    yours: bid.userId === reader,
  };
}

/** One table on the wire. Sealed values are never on it except the reader's own. */
export function projectAuction({
  reader,
  window,
  now,
  recruit,
  bids,
  usernames,
}: AuctionView): BarAuction {
  const reserve = reserveFor(recruit);
  const opens = bids
    .filter((bid) => bid.open !== null && bid.openAt !== null)
    .sort((a, b) => (b.openAt ?? '').localeCompare(a.openAt ?? ''));
  const leader = leaderOf(bids);
  const mine = bids.find((bid) => bid.userId === reader);

  return {
    recruitId: recruit.id,
    reserve,
    sealedFrom: window.sealedFrom.toISOString(),
    closesAt: window.closesAt.toISOString(),
    phase: auctionPhaseAt(now, window),
    leading: leader ? bidView(leader, reader, usernames) : null,
    nextBid: nextMinimumBid(reserve, leader?.open ?? null),
    bids: opens.slice(0, MAX_BIDS_SHOWN).map((bid) => bidView(bid, reader, usernames)),
    // Everybody with a position, including the sealed-only ones nothing else on this object shows.
    // It is the one honest signal that the room is busier than the open bids make it look.
    bidders: bids.filter((bid) => bid.open !== null || bid.sealed !== null).length,
    yourBid: mine?.open ?? null,
    yourSealed: mine?.sealed ?? null,
  };
}

// --- the close ---

/** The calendar day before this one. Arithmetic on the key, so no zone can shift it. */
export function previousDay(day: string): string {
  return new Date(new Date(`${day}T00:00:00.000Z`).getTime() - 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * Rebuilds the person a table was about.
 *
 * The roster is a pure function of the day and of the city's average level, and the city keeps
 * levelling, so a room read back a day later can be a shade stronger than the one that was bid on.
 * That is why the *name* is stored on the result row rather than regenerated: the panel a player
 * reads must say who they lost, whatever the room has done since.
 */
function recruitOn(repos: Repositories, day: string, recruitId: string): BarCharacter | undefined {
  const seat = seatOf(day, recruitId);
  if (seat === null) return undefined;
  return findBarRecruit(day, recruitId, seat + 1, repos.bases.averageLevel());
}

/**
 * §H7a: closes every table whose day is over.
 *
 * One transaction per table, and the result row is written inside it. Those two facts are the
 * whole of the safety argument: a crash between signing somebody and recording the close would
 * otherwise leave the table due again, and the second pass would hand the person to the crew
 * behind the one that already has them.
 */
export function settleBarAuctions(repos: Repositories, now: Date): void {
  for (const table of repos.bar.unsettled(barDay(now))) {
    repos.tx(() => closeTable(repos, table.day, table.recruitId, now));
  }
}

function closeTable(repos: Repositories, day: string, recruitId: string, now: Date): void {
  const bids = repos.bar.bidsFor(day, recruitId);
  const recruit = recruitOn(repos, day, recruitId);
  // An id that names no seat cannot be signed by anybody, and leaving it due would settle it again
  // on every read for ever. It goes down as an empty table.
  const name = recruit?.name ?? 'Somebody';
  const winner = recruit ? award(repos, day, recruit, bids, now) : null;

  repos.bar.recordResult({
    day,
    recruitId,
    recruitName: name,
    winnerUserId: winner?.userId ?? null,
    price: winner?.price ?? null,
    settledAt: now.toISOString(),
  });
  tellTheTable(repos, { name, recruitId, bids, winner, now });
}

interface Winner {
  userId: string;
  price: number;
}

/**
 * Walks the ranking and signs the first crew that can actually take them.
 *
 * "Can" is every gate a hire ever had, checked at the close and not only at the bid: a crew that
 * filled its last chair after bidding has no room for the person it won, and handing them over
 * anyway would put an officer on books that cannot hold them.
 */
function award(
  repos: Repositories,
  day: string,
  recruit: BarCharacter,
  bids: readonly BarBid[],
  now: Date,
): Winner | null {
  const positions = bids.map((bid) => ({ userId: bid.userId, open: bid.open, sealed: bid.sealed }));
  const { ranked } = rankBids(positions, reserveFor(recruit), `${day}:${recruit.id}`);

  for (const entry of ranked) {
    const bid = bids.find((row) => row.userId === entry.userId);
    const base = bid ? repos.bases.findById(bid.baseId) : undefined;
    if (!base) continue;

    const signed = signRecruit(repos, {
      base,
      userId: entry.userId,
      recruit,
      price: entry.final,
      now,
    });
    if (signed.kind === 'refused') continue;

    // §I1: signing somebody is one of the few things in a session that takes a real decision, and
    // it still pays when the decision was made hours ago at a table.
    awardPlayerXp(repos, signed.base, 'officerHired');
    // The **price**, not `signed.wage`: what goes on the result row and into everybody's bell is
    // the number the table closed at. What their negotiators talked it down to is their business.
    return { userId: entry.userId, price: entry.final };
  }
  return null;
}

function tellTheTable(
  repos: Repositories,
  table: {
    name: string;
    recruitId: string;
    bids: readonly BarBid[];
    winner: Winner | null;
    now: Date;
  },
): void {
  const { name, recruitId, bids, winner, now } = table;
  if (winner) {
    notify(repos, {
      userId: winner.userId,
      kind: 'officer_hired',
      title: `${name} signed with you at ${winner.price} a week`,
      link: '/game/bar',
      subjectId: recruitId,
      now,
    });
  }

  const winnerName = winner
    ? (repos.users.findById(winner.userId)?.username ?? 'another crew')
    : '';
  for (const bid of bids) {
    if (bid.userId === winner?.userId) continue;
    if (finalOf(bid) <= 0) continue;
    notify(repos, {
      userId: bid.userId,
      kind: 'bar_outbid',
      title: winner ? `${name} went to ${winnerName} for ${winner.price}` : `${name} went unsigned`,
      link: '/game/bar',
      subjectId: recruitId,
      now,
    });
  }
}

// --- yesterday, as this reader saw it ---

/**
 * How the tables this crew sat at yesterday ended.
 *
 * `passed` needs the ranking rather than the result row: a crew whose final was highest and who
 * could not take the person at the close is not the same story as one that was simply outbid, and
 * the row alone cannot tell them apart.
 */
export function resultsFor(repos: Repositories, userId: string, day: string): BarAuctionResult[] {
  const mine = repos.bar.bidsBy(userId, day);
  if (mine.length === 0) return [];
  const closed = new Map(repos.bar.results(day).map((result) => [result.recruitId, result]));

  return mine.flatMap((bid) => {
    const result = closed.get(bid.recruitId);
    const yourFinal = finalOf(bid);
    if (!result || yourFinal <= 0) return [];
    return [
      {
        day,
        recruitId: bid.recruitId,
        name: result.recruitName,
        outcome: outcomeFor(repos, result, userId),
        price: result.price,
        winner: result.winnerUserId
          ? (repos.users.findById(result.winnerUserId)?.username ?? null)
          : null,
        yourFinal,
      },
    ];
  });
}

/** How far back the results panel looks for the last night this crew sat at a table. */
export const RESULTS_LOOKBACK_DAYS = 7;

/**
 * The last night's results, not strictly last night's.
 *
 * A crew that bid on Monday and next opened the Bar on Thursday found an empty panel, because the
 * panel only ever read the day before today. The bells still rang, but a bell is one line and the
 * panel is the whole story. So this walks back a week for the most recent day the crew sat at any
 * table that has closed, and stops there: two nights are not shown together.
 */
export function latestResultsFor(
  repos: Repositories,
  userId: string,
  today: string,
): BarAuctionResult[] {
  let day = today;
  for (let back = 0; back < RESULTS_LOOKBACK_DAYS; back += 1) {
    day = previousDay(day);
    const results = resultsFor(repos, userId, day);
    if (results.length > 0) return results;
  }
  return [];
}

function outcomeFor(repos: Repositories, result: BarResult, reader: string): AuctionOutcome {
  if (result.winnerUserId === reader) return 'won';
  const recruit = recruitOn(repos, result.day, result.recruitId);
  if (recruit) {
    const bids = repos.bar.bidsFor(result.day, result.recruitId);
    const positions = bids.map((bid) => ({
      userId: bid.userId,
      open: bid.open,
      sealed: bid.sealed,
    }));
    const { ranked } = rankBids(
      positions,
      reserveFor(recruit),
      `${result.day}:${result.recruitId}`,
    );
    if (ranked[0]?.userId === reader) return 'passed';
  }
  return result.winnerUserId === null ? 'unsold' : 'lost';
}
