import {
  askingWage,
  auctionPhaseAt,
  auctionWindow,
  committedWage,
  instantAtHourInZone,
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
import { settleBase } from '../district/settle.js';
import { districtUnitSlots } from '../district/unit-slots.js';
import type { Repositories } from '../db/repos/index.js';
import { mayEnter } from '../city/stakes.js';
import { awardPlayerXp } from '../progression/award.js';
import { notify } from '../social/notify.js';
import {
  assessAgainst,
  factionInfamyOf,
  ledgerFor,
  recruitSlotsFor,
  signRecruit,
  type HireRefusal,
} from './hire.js';
import {
  barDay,
  cityOfRecruit,
  findBarRecruit,
  recruitId,
  seatOf,
  type BarCharacter,
} from './roster.js';
import { barRoomOf } from './room.js';
import { rosterFaces } from '../crew/faces.js';
import { settleEach } from '../world/guard.js';
import { shownNameOf } from '../social/names.js';

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
  return reservationWage(askingWage(recruit.attributes, 0, recruit.perks));
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
  'no_unit_slots',
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
 * The tables this crew is sitting at in one city tonight.
 *
 * Per city, and that is a ruling rather than a detail (maintainer's brief, 2026-09-24): a table is
 * a room you are standing in, so two tables in Ashfall say nothing about how many rooms you can
 * stand in at Terminus. `bar_bids` is keyed `(user_id, day)` with no city column, and it does not
 * need one: `recruit_id` carries the room it was minted in, so the split is a filter rather than a
 * migration. See `cityOfRecruit`.
 */
export function tablesHeldIn(
  repos: Repositories,
  userId: string,
  day: string,
  cityId: string | null,
): BarBid[] {
  return repos.bar.bidsBy(userId, day).filter((bid) => cityOfRecruit(bid.recruitId) === cityId);
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
  if (
    !assessAgainst(base, recruit, factionInfamyOf(repos, base)).interested &&
    !adminWaives('not_interested', admin)
  ) {
    return 'not_interested';
  }
  if (base.commanders.some((officer) => officer.id === recruit.id)) return 'already_hired';
  // `>=`, so a crew over its slots (a save from before the 2026-09-30 ladder) is refused a table
  // until it is back under, and keeps everyone it already holds.
  if (base.commanders.length >= recruitSlotsFor(base) && !adminWaives('no_slots', admin)) {
    return 'no_slots';
  }
  // An officer takes a bed (2026-09-29). Asked here as well as at the close, so a crew with the
  // district full is told at the table rather than losing the person at midnight.
  if (districtUnitSlots(repos, base).spare < 1 && !adminWaives('no_unit_slots', admin)) {
    return 'no_unit_slots';
  }
  // §H7a: two tables at once, three past level 40. A table the crew is already at is not a new
  // one, so raising a bid never runs into the cap that the first bid cleared.
  const mine = tablesHeldIn(repos, userId, day, cityOfRecruit(recruit.id));
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
function payrollRefuses(
  repos: Repositories,
  request: BidRequest,
  amount: number,
  day: string,
): boolean {
  const { base, userId, recruit, admin } = request;
  const effects = crewEffectsFor(repos, base);
  const ledger = ledgerFor(base, effects);
  const wage = committedWage(amount, effects.wageDiscountPercent);
  const reserved = wagesHeldByBids(repos, userId, day, recruit.id, effects.wageDiscountPercent);
  return !payrollFits(ledger, wage + reserved) && !adminWaives('no_payroll', admin);
}

/**
 * The wages this crew's other bids tonight hold against its payroll book (maintainer, 2026-10-04).
 *
 * Every bid holds its wage for the day, won or lost: "if you have bid, that is temporarily taken
 * out of payroll whether you win or not, and bids cannot be taken back. At the end of the day you
 * get back the payroll you did not end up using." One table counts once, at the crew's highest bid
 * there, open or sealed: raising a bid replaces the lower one rather than adding to it. Counted at
 * the talked-down wage, the figure the close commits, across every city: the book is one book.
 *
 * Only tonight's tables, so the hold lifts at the close by itself: the winner's wage becomes a
 * commitment on the book, and what the crew did not win is free again the next day. Because every
 * bid was checked against the book with all the others held, every table the crew wins at midnight
 * fits, whichever order the tables settle in and whichever bidder a table falls back to.
 *
 * It held only the tables the crew led or had sealed until then (2026-10-02), so a crew second at
 * one table could still sign it at the close after the leader was refused and leave its payroll
 * short for a table it was leading.
 */
export function wagesHeldByBids(
  repos: Repositories,
  userId: string,
  day: string,
  exceptRecruitId: string | null,
  wageDiscountPercent: number,
): number {
  return repos.bar
    .bidsBy(userId, day)
    .filter((bid) => bid.recruitId !== exceptRecruitId)
    .reduce((held, bid) => held + committedWage(finalOf(bid), wageDiscountPercent), 0);
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
  const { base, userId, recruit, now } = request;
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
  if (payrollRefuses(repos, request, amount, window.day)) return refuse('no_payroll');

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
  const { base, userId, recruit, now } = request;
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
  if (payrollRefuses(repos, request, amount, window.day)) return refuse('no_payroll');

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
 * Rebuilds the person a table was about, off the room the day was frozen at (`barRoomOf`).
 *
 * The *name* is still stored on the result row rather than regenerated: a table from before the
 * room was frozen can rebuild a shade differently, and the panel a player reads must say who they
 * lost whatever the room has done since.
 */
function recruitOn(repos: Repositories, day: string, recruitId: string): BarCharacter | undefined {
  const seat = seatOf(day, recruitId);
  const cityId = cityOfRecruit(recruitId);
  if (seat === null || cityId === null) return undefined;
  // The room the bidders saw, not the city as it stands at midnight: a crew that levelled after
  // the first read would otherwise have the close settle the table against a person nobody bid on.
  return findBarRecruit(day, recruitId, barRoomOf(repos, cityId, day));
}

/**
 * §H7a: closes every table whose day is over.
 *
 * One transaction per table, and the result row is written inside it. Those two facts are the
 * whole of the safety argument: a crash between signing somebody and recording the close would
 * otherwise leave the table due again, and the second pass would hand the person to the crew
 * behind the one that already has them.
 */
export function settleBarAuctions(repos: Repositories, now: Date, admin = false): number {
  // Counted, so the world settle can tell every open tab the room changed. See `world/settle.ts`.
  return settleEach(
    repos,
    'bar auctions',
    repos.bar.unsettled(barDay(now)),
    (table) => `${table.day}:${table.recruitId}`,
    (table) => closeTable(repos, { day: table.day, recruitId: table.recruitId, now, admin }),
  );
}

/**
 * One table to close, and the mode the close runs in: admin mode waives at midnight what it waived
 * at the table.
 */
interface TableClose {
  day: string;
  recruitId: string;
  now: Date;
  admin: boolean;
}

function closeTable(repos: Repositories, table: TableClose): void {
  const { day, recruitId, now } = table;
  const bids = repos.bar.bidsFor(day, recruitId);
  const recruit = recruitOn(repos, day, recruitId);
  // An id that names no seat cannot be signed by anybody, and leaving it due would settle it again
  // on every read for ever. It goes down as an empty table.
  const name = recruit?.name ?? 'Somebody';
  const { winner, ranked, refused } = recruit
    ? award(repos, table, recruit, bids)
    : { winner: null, ranked: [], refused: new Map<string, PassedOver>() };

  repos.bar.recordResult({
    day,
    recruitId,
    recruitName: name,
    winnerUserId: winner?.userId ?? null,
    price: winner?.price ?? null,
    settledAt: now.toISOString(),
  });
  // Dated at the table's close, the end of its day (`auctionWindow`), not at the tick that got to it.
  tellTheTable(repos, {
    name,
    recruitId,
    bids,
    ranked,
    winner,
    refused,
    at: instantAtHourInZone(day, 24),
  });
}

interface Winner {
  userId: string;
  price: number;
  /** What their book committed after their wage cut (`committedWage`). Their bell alone says it. */
  wage: number;
}

/** Who took a table, and the ranking the close walked to find them, which the bells read. */
interface Award {
  winner: Winner | null;
  ranked: readonly { userId: string }[];
  /** Why each crew ranked above the winner could not take them, for its bell. */
  refused: ReadonlyMap<string, PassedOver>;
}

/** Why a bidder was passed over at the close: a hire refusal, or the city shut behind them. */
type PassedOver = HireRefusal | 'city_shut';

/**
 * Why a crew was passed over at the close, as a clause on its bell (bug pass, 2026-10-02). The bell
 * said only "You could not take them", and a crew that had out-bid the room could not tell which of
 * six doors had shut.
 */
const PASSED_BECAUSE: Readonly<Record<PassedOver, string>> = {
  already_hired: 'they already worked for you',
  no_slots: 'every officer slot was taken',
  no_unit_slots: 'there was no free bed in the district',
  requirement: 'your crew no longer met what they asked',
  infamy: 'your infamy had fallen below what they asked',
  faction: 'your faction had not earned enough for them',
  no_payroll: 'the payroll book would not stretch that far',
  city_shut: 'you no longer hold ground in that city',
};

/**
 * Walks the ranking and signs the first crew that can actually take them.
 *
 * "Can" is every gate a hire ever had, checked at the close and not only at the bid: a crew that
 * filled its last chair after bidding has no room for the person it won, and handing them over
 * anyway would put an officer on books that cannot hold them.
 */
/**
 * The face this recruit's card wore, worked out the way the Bar worked it out: the seats before
 * this one in today's room, against the faces the city holds now. A hire in between can move it
 * by one probe step, and that is still a face nobody else has.
 */
function faceFor(repos: Repositories, day: string, recruit: BarCharacter): string | undefined {
  const seat = seatOf(day, recruit.id);
  const cityId = cityOfRecruit(recruit.id);
  if (seat === null || cityId === null) return undefined;
  // The seats before this one **in this room**. Built off the default city's ids, the probe walked
  // a different room's faces and handed the winner a face their card never wore.
  const seats = Array.from({ length: seat + 1 }, (_, index) => recruitId(day, index, cityId));
  return rosterFaces(repos, seats).get(recruit.id);
}

function award(
  repos: Repositories,
  { day, now, admin }: TableClose,
  recruit: BarCharacter,
  bids: readonly BarBid[],
): Award {
  const positions = bids.map((bid) => ({ userId: bid.userId, open: bid.open, sealed: bid.sealed }));
  const { ranked } = rankBids(positions, reserveFor(recruit), `${day}:${recruit.id}`);
  const refused = new Map<string, PassedOver>();

  for (const entry of ranked) {
    const bid = bids.find((row) => row.userId === entry.userId);
    const bidder = bid ? repos.bases.findById(bid.baseId) : undefined;
    if (!bidder) continue;
    // Settled first, as the barrow's close settles its winner (bug pass, 2026-09-29). The world
    // clock runs this without settling anybody, so a Quarters rung or a research chair that landed
    // before midnight was not on the crew yet, and the winner was passed over for a bed they had.
    const base = settleBase(repos, bidder, now).base;
    /*
     * The room's door, again at the close (maintainer, 2026-10-02): a crew that lost its last
     * ground in the city after bidding cannot open that Bar to raise, seal or read the result, so
     * it does not sign there either. The table passes to the next bidder and the crew is told why.
     */
    const room = cityOfRecruit(recruit.id);
    if (room !== null && !mayEnter(repos, base, room)) {
      refused.set(entry.userId, 'city_shut');
      continue;
    }

    const face = faceFor(repos, day, recruit);
    const signed = signRecruit(repos, {
      base,
      userId: entry.userId,
      recruit,
      price: entry.final,
      now,
      admin,
      ...(face === undefined ? {} : { portraitId: face }),
    });
    if (signed.kind === 'refused') {
      refused.set(entry.userId, signed.reason);
      continue;
    }

    // §I1: signing somebody is one of the few things in a session that takes a real decision, and
    // it still pays when the decision was made hours ago at a table.
    awardPlayerXp(repos, signed.base, 'officerHired');
    // `signRecruit` already tallied the signing itself. Nothing to add here: the two doors into
    // the Bar are one hire, and counting it at both would make the ladder twice as fast for
    // anybody who bids rather than pays the asking price.
    // The **price**, not `signed.wage`: what goes on the result row and into everybody's bell is
    // the number the table closed at. What their negotiators talked it down to is their business.
    return {
      winner: { userId: entry.userId, price: entry.final, wage: signed.wage },
      ranked,
      refused,
    };
  }
  return { winner: null, ranked, refused };
}

function tellTheTable(
  repos: Repositories,
  table: {
    name: string;
    recruitId: string;
    bids: readonly BarBid[];
    ranked: readonly { userId: string }[];
    winner: Winner | null;
    refused: ReadonlyMap<string, PassedOver>;
    at: Date;
  },
): void {
  const { name, recruitId, bids, ranked, winner, refused, at } = table;
  if (winner) {
    notify(repos, {
      userId: winner.userId,
      kind: 'officer_hired',
      // The wage on the book too, when their negotiators took something off it: the Crew page and
      // the dismissal fee read that figure, not the bid (bug pass, 2026-10-02).
      title:
        winner.wage === winner.price
          ? `${name} signed with you at ${winner.price.toLocaleString('en')} caps`
          : `${name} signed with you: won at ${winner.price.toLocaleString('en')}, on the books at ${winner.wage.toLocaleString('en')} caps`,
      link: '/game/bar',
      subjectId: recruitId,
      at,
    });
  }

  const winnerName = winner ? shownNameOf(repos, winner.userId, 'another crew') : '';
  for (const bid of bids) {
    if (bid.userId === winner?.userId) continue;
    if (finalOf(bid) <= 0) continue;
    notify(repos, {
      userId: bid.userId,
      kind: 'bar_outbid',
      title: missedLotTitle({
        name,
        passed: outcomeAgainst(ranked, winner?.userId ?? null, bid.userId) === 'passed',
        winner: winner
          ? { name: winnerName, price: `${winner.price.toLocaleString('en')} caps` }
          : null,
        nobody: 'went unsigned',
        because: ((reason) => (reason ? PASSED_BECAUSE[reason] : undefined))(
          refused.get(bid.userId),
        ),
      }),
      link: '/game/bar',
      subjectId: recruitId,
      at,
    });
  }
}

// --- yesterday, as this reader saw it ---

/**
 * How the tables this crew sat at yesterday ended.
 *
 * `passed` needs the ranking rather than the result row: a crew whose final was over the winner's
 * and who could not take the person at the close is not the same story as one that was simply
 * outbid, and the row alone cannot tell them apart. See {@link outcomeAgainst}.
 */
export function resultsFor(
  repos: Repositories,
  userId: string,
  day: string,
  cityId: string,
): BarAuctionResult[] {
  // One room's tables, because this panel is drawn inside one room. A crew that bid in Terminus
  // last night and opened Ashfall's Bar tonight was shown Terminus's closes under Ashfall's roster.
  const mine = tablesHeldIn(repos, userId, day, cityId);
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
        winner: result.winnerUserId ? shownNameOf(repos, result.winnerUserId, null) : null,
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
  cityId: string,
): BarAuctionResult[] {
  let day = today;
  for (let back = 0; back < RESULTS_LOOKBACK_DAYS; back += 1) {
    day = previousDay(day);
    const results = resultsFor(repos, userId, day, cityId);
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
    return outcomeAgainst(ranked, result.winnerUserId, reader);
  }
  return result.winnerUserId === null ? 'unsold' : 'lost';
}

/**
 * How a closed auction ended for one bidder, off its ranking and whoever took it. The Bar's tables
 * and the Runner's lots both read this.
 *
 * `passed` is every crew the close walked past on its way to the winner, not only the top one (bug
 * pass, 2026-09-29): a crew second over the winner was told it lost, beside a winning price under
 * its own final. With nobody taking it, only the top crew passed and the rest read `unsold`, because
 * "nobody could take them" is the whole story for everybody behind the first.
 */
export function outcomeAgainst(
  ranked: readonly { userId: string }[],
  winnerUserId: string | null,
  reader: string,
): AuctionOutcome {
  if (winnerUserId === reader) return 'won';
  if (winnerUserId === null) return ranked[0]?.userId === reader ? 'passed' : 'unsold';
  const position = ranked.findIndex((entry) => entry.userId === reader);
  const winner = ranked.findIndex((entry) => entry.userId === winnerUserId);
  return position !== -1 && position < winner ? 'passed' : 'lost';
}

/**
 * The bell for a bidder who did not get the lot, told the way {@link outcomeAgainst} tells it.
 *
 * A crew the close walked past was ahead of the winner and could not take the win: a bed, a
 * chair or the payroll at the Bar, the caps at the Runner's barrow, the name or the allowance at
 * the fence. Its bell used to read like everybody else's ("went to Vex for 300") beside its own
 * bid of 500, which reads as the auction being broken rather than as a door the crew had shut.
 * `price` arrives formatted, because the fence prices in infamy and the other two in caps.
 */
export function missedLotTitle(lot: {
  name: string;
  passed: boolean;
  winner: { name: string; price: string } | null;
  /** How the lot ended with nobody taking it, in this door's words: "went unsigned". */
  nobody: string;
  /** Why this reader could not take it, when the door knows: "every officer slot was taken". */
  because?: string | undefined;
}): string {
  const { name, passed, winner, nobody, because } = lot;
  if (passed) {
    const why = because === undefined ? '' : ` (${because})`;
    return winner
      ? `You could not take ${name} at the close${why}, so ${winner.name} did at ${winner.price}`
      : `You could not take ${name} at the close${why}, and nobody else could either`;
  }
  return winner ? `${name} went to ${winner.name} for ${winner.price}` : `${name} ${nobody}`;
}
