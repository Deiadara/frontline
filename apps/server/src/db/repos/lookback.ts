/**
 * How far back an auction settler looks for lots nobody has closed (hardening pass, 2026-09-27).
 *
 * The three settlers (the Bar, the barrow, the back room) each asked "which lots have bids and no
 * result" over every bid ever placed, every second, and bids are never deleted: the answer is a
 * handful of rows and the question grew with the age of the world. Every lot closes within a day
 * of its last bid, so a month is thirty times the longest a lot can legitimately sit open. A lot
 * older than that with no result is a lot a settler failed on for a month, which the per-row
 * failure log (`world/guard.ts`) has been reporting all along.
 */
export const AUCTION_LOOKBACK_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The earliest day a settler still reads, as the `YYYY-MM-DD` the bid tables are keyed by. */
export function lookbackFloor(now: Date): string {
  return new Date(now.getTime() - AUCTION_LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);
}

/** The same floor, measured back from a `YYYY-MM-DD` day rather than an instant. */
export function lookbackFloorFromDay(day: string): string {
  return lookbackFloor(new Date(`${day}T12:00:00.000Z`));
}
