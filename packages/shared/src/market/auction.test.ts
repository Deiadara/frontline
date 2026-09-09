import { describe, expect, it } from 'vitest';
import { hourInZone, instantAtHourInZone } from '../time/zone.js';
import { lotSeed, nextLotBid, rankLotBids, vendorVisitAt, visitClosesAt } from './auction.js';
import { vendorSessionsFor } from './vendor.js';

/**
 * The Runner's lots, as both ends of the wire read them.
 *
 * Three things are pinned here and nothing else is: **when a visit ends**, because the close and
 * every countdown hang off it; **who takes a lot**, because two crews at the same number must get
 * the same answer whoever asks and however often; and **what the next bid has to be**, because the
 * client draws a button from it and the server refuses against it.
 */

/**
 * A September day, when Athens runs three hours ahead of UTC.
 *
 * Fixed rather than "today": the barrow, the hours and the close are all pure functions of the day,
 * and a test that took today's would be measuring a different pair of sessions every morning.
 */
const SEPTEMBER = '2026-09-15';

/**
 * An Athens hour of a September day, as a UTC instant, worked out by hand.
 *
 * Deliberately not `instantAtHourInZone`: that is the function under the thing being tested, and
 * an expectation derived from it would agree with any offset it happened to apply, summer time
 * dropped included.
 */
function athensHourAsUtc(day: string, hour: number): Date {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + (hour - 3) * 3_600_000);
}

describe('when a visit ends', () => {
  it('closes at the end of its session, on the Athens clock', () => {
    for (const [session, slot] of vendorSessionsFor(SEPTEMBER).entries()) {
      expect(visitClosesAt(SEPTEMBER, session)).toEqual(
        athensHourAsUtc(SEPTEMBER, slot.startHour + slot.hours),
      );
    }
  });

  it('names no session that is not on the day', () => {
    expect(() => visitClosesAt(SEPTEMBER, vendorSessionsFor(SEPTEMBER).length)).toThrow();
  });
});

describe('the visit running at an instant', () => {
  const sessions = vendorSessionsFor(SEPTEMBER);

  it('is the session whose hours the instant falls in, indexed as the day lists them', () => {
    for (const [session, slot] of sessions.entries()) {
      const halfway = new Date(
        instantAtHourInZone(SEPTEMBER, slot.startHour).getTime() + 30 * 60_000,
      );
      expect(vendorVisitAt(halfway)).toEqual({
        day: SEPTEMBER,
        session,
        closesAt: visitClosesAt(SEPTEMBER, session),
      });
    }
  });

  it('is nothing an hour before he arrives, and nothing the moment he packs up', () => {
    const first = sessions[0];
    if (!first) throw new Error('fixture: no sessions on the day');
    const opens = instantAtHourInZone(SEPTEMBER, first.startHour);

    expect(vendorVisitAt(new Date(opens.getTime() - 60 * 60_000))?.session ?? null).not.toBe(0);
    // The close is the first instant outside the session, not the last inside it. A lot that was
    // still biddable at its own closing time would take a bid the settle had already ranked.
    expect(vendorVisitAt(visitClosesAt(SEPTEMBER, 0))?.session ?? null).not.toBe(0);
  });

  it('runs for exactly the hours the day says, and no more', () => {
    for (const [session, slot] of sessions.entries()) {
      const inside = Array.from({ length: slot.hours }, (_, step) =>
        instantAtHourInZone(SEPTEMBER, slot.startHour + step),
      );
      for (const instant of inside) {
        expect(vendorVisitAt(instant)?.session, `${hourInZone(instant)}:00 Athens`).toBe(session);
      }
    }
  });
});

describe('who takes a lot', () => {
  const seed = lotSeed(SEPTEMBER, 0, '2026-09-15-0-neural_shunt');

  it('ranks by the amount, highest first, and leaves out anybody under the reserve', () => {
    const ranked = rankLotBids(
      [
        { userId: 'ana', amount: 100 },
        { userId: 'bo', amount: 120 },
        { userId: 'cy', amount: 50 },
      ],
      60,
      seed,
    );
    expect(ranked).toEqual([
      { userId: 'bo', amount: 120 },
      { userId: 'ana', amount: 100 },
    ]);
  });

  it('breaks a tie the same way whatever order the rows come back in', () => {
    const bids = [
      { userId: 'ana', amount: 100 },
      { userId: 'bo', amount: 100 },
      { userId: 'cy', amount: 100 },
    ];
    const forwards = rankLotBids(bids, 100, seed);
    const backwards = rankLotBids([...bids].reverse(), 100, seed);
    expect(backwards).toEqual(forwards);
    expect(forwards).toHaveLength(3);
  });

  /**
   * The coin is a coin.
   *
   * The order-independence above passes just as happily on a tie-break that always picks the first
   * name alphabetically, which would hand every tied lot in the game to the same crew. So: some
   * lot, somewhere, gives the other one.
   */
  it('does not always hand a tie to the same crew', () => {
    const bids = [
      { userId: 'ana', amount: 100 },
      { userId: 'bo', amount: 100 },
    ];
    const winners = new Set(
      Array.from(
        { length: 20 },
        (_, index) => rankLotBids(bids, 100, lotSeed(SEPTEMBER, 0, `line-${index}`))[0]?.userId,
      ),
    );
    expect(winners).toEqual(new Set(['ana', 'bo']));
  });
});

describe('what the next bid has to be', () => {
  it('is the reserve on a lot nobody has touched', () => {
    expect(nextLotBid(340, null)).toBe(340);
  });

  it('is the leader plus five percent, rounded up, once somebody is on it', () => {
    expect(nextLotBid(340, 340)).toBe(357);
    expect(nextLotBid(340, 1000)).toBe(1050);
  });

  it('never drops under the reserve, whatever the leader is at', () => {
    // Unreachable through the routes, which refuse a bid under the reserve, but the ranking reads
    // this against stored rows and a barrow can be re-priced under a lot that is already running.
    expect(nextLotBid(340, 50)).toBe(340);
  });

  it('steps by at least one cap, so a cheap lot is not stuck', () => {
    expect(nextLotBid(1, 1)).toBe(2);
  });
});
