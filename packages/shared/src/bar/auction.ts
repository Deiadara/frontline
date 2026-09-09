import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import { MILESTONE_SECOND_SIGNATURE, isPlayerUnlockActive } from '../progression/unlocks.js';
import { seedFrom } from '../rng.js';
import { GAME_TIMEZONE, dayInZone, nextDayBoundary } from '../time/zone.js';

/**
 * Bidding for people (GDD §H7, reworked by the board 2026-09-07).
 *
 * The Bar used to be a haggle: one crew, one recruit, a conversation with patience in it. It is an
 * auction now, and the room is the whole city's. Everybody sees the same eight people at the same
 * prices, everybody's bids are on the table, and whoever is highest when the day ends signs them.
 * A recruit is not replaced when somebody wins them: the room is what it is until midnight, and at
 * midnight (Athens, like every other daily clock) it turns over whole.
 *
 * ## The day
 *
 * - **Open**, from the turn of the day until thirty minutes before the next one. Bids are public:
 *   the amount, who made it, and who is leading. A bid has to beat the leader by the increment.
 * - **Sealed**, the last thirty minutes. No more open bids. Each crew may lock in *one* secret
 *   final value, revealed only at the close. Nobody sees anybody's, and a locked value cannot be
 *   changed: it is a final answer, not another round.
 * - **Closed**, at midnight. Each bidder's final is the higher of their open bid and their sealed
 *   value. Highest final wins and pays it; a tie goes to a seeded coin rather than to whoever was
 *   first, so a stale clock cannot be a strategy. Nothing changes hands: the price is the weekly
 *   wage committed against the payroll book, exactly as a signed contract always was.
 *
 * ## What the person wants
 *
 * The recruit still has a floor, `reservationWage` off their asking price, and the auction opens
 * there. Nobody bids under it and there is no conversation about it: the floor is a fact about the
 * person and the rest is between the crews.
 *
 * ## Rules the shape of the model needs
 *
 * - A crew can be in {@link MAX_OPEN_AUCTIONS} auctions at once (three past level 40). Counted as
 *   auctions the crew has bid in today, won or losing, until they close: a bid is a commitment.
 * - A sealed value cannot be lower than the crew's own open bid, or than the reserve, or than the
 *   leading open bid: a value that cannot win is not a value, and refusing it says so before the
 *   close does.
 * - Every gate a hire always had still stands at the close: the §H3 doors, a free chair, a wage the
 *   payroll book can hold. A winner who cannot take them at midnight passes to the next final, and
 *   a room nobody can take goes home unsigned.
 */

/** The last thirty minutes of the day are sealed. */
export const AUCTION_SEALED_WINDOW_MS = 30 * 60_000;

/** How many auctions one crew may be in at once. The board's two. */
export const MAX_OPEN_AUCTIONS = 2;

/**
 * §I3: the level-40 milestone used to buy a second signing a day. A day's signings are the
 * auctions now, so it buys a third table to sit at instead. Every reader goes through here rather
 * than the constant, so the milestone cannot be honoured on the screen and forgotten at the gate.
 */
export function maxOpenAuctionsFor(level: number): number {
  return MAX_OPEN_AUCTIONS + (isPlayerUnlockActive(MILESTONE_SECOND_SIGNATURE, level) ? 1 : 0);
}

/** A bid has to beat the leader by this share of the leader, and by at least one cap. */
export const BID_INCREMENT_PERCENT = 5;
export const MIN_BID_INCREMENT = 1;

/** The least a new open bid can be: the reserve on an empty table, the leader plus the step otherwise. */
export function nextMinimumBid(reserve: number, leading: number | null): number {
  if (leading === null) return Math.max(1, Math.round(reserve));
  const step = Math.max(MIN_BID_INCREMENT, Math.ceil((leading * BID_INCREMENT_PERCENT) / 100));
  return Math.max(Math.round(reserve), leading + step);
}

export const AUCTION_PHASES = ['open', 'sealed', 'closed'] as const;
export const AuctionPhaseSchema = z.enum(AUCTION_PHASES);
export type AuctionPhase = z.infer<typeof AuctionPhaseSchema>;

/** When today's auctions seal and close, on the game clock. */
export interface AuctionWindow {
  day: string;
  sealedFrom: Date;
  closesAt: Date;
}

export function auctionWindow(now: Date, zone: string = GAME_TIMEZONE): AuctionWindow {
  const closesAt = nextDayBoundary(now, zone);
  return {
    day: dayInZone(now, zone),
    sealedFrom: new Date(closesAt.getTime() - AUCTION_SEALED_WINDOW_MS),
    closesAt,
  };
}

export function auctionPhaseAt(now: Date, window: AuctionWindow): AuctionPhase {
  if (now.getTime() >= window.closesAt.getTime()) return 'closed';
  if (now.getTime() >= window.sealedFrom.getTime()) return 'sealed';
  return 'open';
}

/** One crew's position in one auction, as the settle reads it. */
export interface AuctionBid {
  userId: string;
  /** The open bid, or null for a crew that only sealed. */
  open: number | null;
  /** The locked final value, or null. */
  sealed: number | null;
}

/** What a crew is actually in for: the higher of the two numbers they put down. */
export function finalValue(bid: AuctionBid): number {
  return Math.max(bid.open ?? 0, bid.sealed ?? 0);
}

export interface AuctionRanking {
  /** Everybody with a final at or above the reserve, best first. Ties already broken. */
  ranked: { userId: string; final: number }[];
}

/**
 * Who won, and in what order the rest stand behind them.
 *
 * Ranked rather than a single winner, because the close still has to clear every gate a hire ever
 * had, and a winner who cannot take the person at midnight hands them to the next final. The tie
 * is broken by a coin seeded on the auction, so two crews at the same number get the same answer
 * however many times the settle is read, and neither of them can win it by being quicker.
 */
export function rankBids(
  bids: readonly AuctionBid[],
  reserve: number,
  seed: string,
): AuctionRanking {
  // One coin per crew, hashed off the auction and the crew rather than drawn from a stream, so
  // the ranking is the same whatever order the rows come back in.
  const ranked = bids
    .map((bid) => ({
      userId: bid.userId,
      final: finalValue(bid),
      coin: seedFrom(`${seed}:${bid.userId}`),
    }))
    .filter((entry) => entry.final >= reserve && entry.final > 0)
    .sort((a, b) => b.final - a.final || a.coin - b.coin)
    .map(({ userId, final }) => ({ userId, final }));
  return { ranked };
}

// --- the wire ---

/** One open bid as everybody at the Bar sees it. */
export const BarBidViewSchema = z.object({
  username: z.string().min(1),
  amount: z.number().int().positive(),
  at: IsoDateTimeSchema,
  /** The reader's own, so the screen can say "you" without knowing its own name. */
  yours: z.boolean(),
});
export type BarBidView = z.infer<typeof BarBidViewSchema>;

/** One recruit's auction, as this reader sees it. */
export const BarAuctionSchema = z.object({
  recruitId: IdSchema,
  /** What they will not go below, and what the table opens at. */
  reserve: z.number().int().positive(),
  sealedFrom: IsoDateTimeSchema,
  closesAt: IsoDateTimeSchema,
  phase: AuctionPhaseSchema,
  /** The highest open bid, or null on an untouched table. */
  leading: BarBidViewSchema.nullable(),
  /** The least the next open bid can be. */
  nextBid: z.number().int().positive(),
  /** Open bids, newest first, the last twenty. Sealed values are never here. */
  bids: z.array(BarBidViewSchema),
  /** How many crews have a bid in, open or sealed. */
  bidders: z.number().int().nonnegative(),
  /** The reader's own open bid, or null. */
  yourBid: z.number().int().positive().nullable(),
  /** The reader's own locked value, or null. Only ever the reader's. */
  yourSealed: z.number().int().positive().nullable(),
});
export type BarAuction = z.infer<typeof BarAuctionSchema>;

export const AUCTION_OUTCOMES = ['won', 'lost', 'passed', 'unsold'] as const;
export const AuctionOutcomeSchema = z.enum(AUCTION_OUTCOMES);
export type AuctionOutcome = z.infer<typeof AuctionOutcomeSchema>;

/**
 * How yesterday's table ended for this reader.
 *
 * `won` and `lost` say themselves. `passed` is a crew whose final was highest and who could not
 * take the person at the close (no chair, no payroll), so they went to the next; `unsold` is a
 * table the reader bid on that nobody could take.
 */
export const BarAuctionResultSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  recruitId: IdSchema,
  name: z.string().min(1),
  outcome: AuctionOutcomeSchema,
  /** What it went for, or null when it went unsold. */
  price: z.number().int().positive().nullable(),
  /** Who took them, or null. */
  winner: z.string().nullable(),
  /** The reader's own final in it. */
  yourFinal: z.number().int().positive(),
});
export type BarAuctionResult = z.infer<typeof BarAuctionResultSchema>;

export const PlaceBidRequestSchema = z.object({
  recruitId: IdSchema,
  amount: z.number().int().positive(),
});
export type PlaceBidRequest = z.infer<typeof PlaceBidRequestSchema>;

export const SealBidRequestSchema = z.object({
  recruitId: IdSchema,
  amount: z.number().int().positive(),
});
export type SealBidRequest = z.infer<typeof SealBidRequestSchema>;

/** Both bid routes answer with the table as it now stands, and the reader's own count. */
export const BidResponseSchema = z.object({
  auction: BarAuctionSchema,
  auctionsUsed: z.number().int().nonnegative(),
  auctionsAllowed: z.number().int().positive(),
});
export type BidResponse = z.infer<typeof BidResponseSchema>;
