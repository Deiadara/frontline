import { z } from 'zod';
import { BarBidViewSchema, nextMinimumBid, rankBids } from '../bar/auction.js';
import { IsoDateTimeSchema } from '../primitives.js';
import { GAME_TIMEZONE, instantAtHourInZone } from '../time/zone.js';
import { currentVendorSession, marketDay, vendorSessionsFor } from './vendor.js';

/**
 * The Runner's barrow is an auction (market extension, board 2026-09-08).
 *
 * He carries the same six lines for the whole city, and a line with two crews after it used to go
 * to whichever of them pressed Buy first, which rewards a fast connection and nothing else. Every
 * line is a **lot** now: while he is in, anybody can bid on it, every bid is on the table under
 * the crew's name, and when he packs up the highest bidder takes one and pays what they bid. The
 * rules are the Bar's (§H7a) with the sealed half hour taken out, because a visit is two hours and
 * a secret last-minute number is a game for a day, not for an afternoon.
 *
 * ## The visit
 *
 * A lot is one line on one **visit**: a session of the day, numbered from `vendorSessionsFor`.
 * He is in twice a day, so a line with stock to spare is auctioned twice, once per visit, and
 * sells at most one per visit. That is what the stock count means now: how many more visits it
 * can go on. A blueprint or a page is one of a kind, so it is one lot and gone.
 *
 * The lot opens at the line's price, which is the city's number: no crew's ground discount is on
 * it, because two crews bidding against each other have to be bidding against the same floor.
 * The winner's own discount comes off what they *pay* at the close, exactly as a crew's
 * negotiators come off a wage at the Bar, so it is invisible to everybody they were bidding
 * against.
 *
 * ## The close
 *
 * Nothing is escrowed at the bid: caps are checked at the table and again at the close, and a
 * winner who cannot cover their bid when he packs up passes to the next crew down. A tie goes to
 * a coin seeded on the lot, never to whoever was first. The close is a settle, not a job: it runs
 * on the world clock's next tick and on the next read of the market, whichever comes first, and
 * both reach the same answer.
 */

/** One crew's position on one lot, as the settle reads it. */
export interface LotBid {
  userId: string;
  amount: number;
}

/** The visit a lot belongs to: the game day and which of the day's sessions. */
export interface VendorVisit {
  day: string;
  session: number;
  closesAt: Date;
}

/** When a visit ends: the instant its session's last hour runs out, on the game clock. */
export function visitClosesAt(day: string, session: number, zone: string = GAME_TIMEZONE): Date {
  const slot = vendorSessionsFor(day)[session];
  if (slot === undefined) throw new Error(`no session ${session} on ${day}`);
  return instantAtHourInZone(day, slot.startHour + slot.hours, zone);
}

/** The visit running at this instant, or null while he is away. */
export function vendorVisitAt(now: Date, zone: string = GAME_TIMEZONE): VendorVisit | null {
  const running = currentVendorSession(now, zone);
  if (running === null) return null;
  const day = marketDay(now, zone);
  const session = vendorSessionsFor(day).findIndex((slot) => slot.startHour === running.startHour);
  return { day, session, closesAt: visitClosesAt(day, session, zone) };
}

/** What seeds the tie-break coin: the lot, so the answer is the same however often it is read. */
export function lotSeed(day: string, session: number, lineId: string): string {
  return `${day}:${session}:${lineId}`;
}

/** The least the next bid on a lot can be: the price on an untouched lot, the leader plus a step otherwise. */
export function nextLotBid(reserve: number, leading: number | null): number {
  return nextMinimumBid(reserve, leading);
}

/**
 * Who takes the lot, and who stands behind them.
 *
 * The Bar's ranking with every position open: highest amount first, ties by the seeded coin,
 * anybody under the price left out. Ranked rather than a single winner because the close still
 * has to find somebody who can pay.
 */
export function rankLotBids(
  bids: readonly LotBid[],
  reserve: number,
  seed: string,
): { userId: string; amount: number }[] {
  return rankBids(
    bids.map((bid) => ({ userId: bid.userId, open: bid.amount, sealed: null })),
    reserve,
    seed,
  ).ranked.map((entry) => ({ userId: entry.userId, amount: entry.final }));
}

// --- the wire ---

/** One bid on a lot, as everybody at the barrow sees it. The Bar's shape, reused on purpose. */
export const VendorBidViewSchema = BarBidViewSchema;
export type VendorBidView = z.infer<typeof VendorBidViewSchema>;

/** One line's auction on this visit, as this reader sees it. */
export const VendorAuctionSchema = z.object({
  lineId: z.string().min(1),
  /** Which of today's sessions this lot belongs to. */
  session: z.number().int().nonnegative(),
  closesAt: IsoDateTimeSchema,
  /** The line's price: where the lot opens and what nobody bids under. */
  reserve: z.number().int().positive(),
  /** The highest bid, or null on an untouched lot. */
  leading: VendorBidViewSchema.nullable(),
  /** The least the next bid can be. */
  nextBid: z.number().int().positive(),
  /** Every bid, newest first, the last twenty. */
  bids: z.array(VendorBidViewSchema),
  /** How many crews have a bid in. */
  bidders: z.number().int().nonnegative(),
  /** The reader's own bid, or null. */
  yourBid: z.number().int().positive().nullable(),
});
export type VendorAuction = z.infer<typeof VendorAuctionSchema>;

export const LOT_OUTCOMES = ['won', 'lost', 'passed', 'unsold'] as const;
export const LotOutcomeSchema = z.enum(LOT_OUTCOMES);
export type LotOutcome = z.infer<typeof LotOutcomeSchema>;

/**
 * How a lot this reader bid on ended.
 *
 * `passed` is a crew whose bid was highest and who could not cover it when he packed up, so the
 * lot went to the next crew; `unsold` is a lot nobody in the ranking could pay for.
 */
export const VendorAuctionResultSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  session: z.number().int().nonnegative(),
  lineId: z.string().min(1),
  item: z.string().min(1),
  outcome: LotOutcomeSchema,
  /** What it went for, or null when it went unsold. */
  price: z.number().int().positive().nullable(),
  /** Who took it, or null. */
  winner: z.string().nullable(),
  /** The reader's own bid on it. */
  yourBid: z.number().int().positive(),
});
export type VendorAuctionResult = z.infer<typeof VendorAuctionResultSchema>;

export const PlaceVendorBidRequestSchema = z.object({
  lineId: z.string().min(1),
  amount: z.number().int().positive(),
});
export type PlaceVendorBidRequest = z.infer<typeof PlaceVendorBidRequestSchema>;
