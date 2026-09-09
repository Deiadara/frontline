import { describe, expect, it } from 'vitest';
import { makeAttributes } from '../attributes.js';
import {
  AUCTION_SEALED_WINDOW_MS,
  MAX_OPEN_AUCTIONS,
  auctionPhaseAt,
  auctionWindow,
  finalValue,
  maxOpenAuctionsFor,
  nextMinimumBid,
  rankBids,
} from './auction.js';
import { assessJoin } from './join.js';
import { dayInZone } from '../time/zone.js';
import {
  RECRUIT_BASE_WAGE,
  WAGE_RESERVATION_FRACTION,
  askingWage,
  reservationWage,
} from './wage.js';

describe('§H3, who will talk to you', () => {
  const crew = (notoriety: number, level: number) => ({ notoriety, level });

  it('shuts the door on a crew below the rank the character demands', () => {
    const wants = { minNotoriety: 3, minLevel: 1 };
    expect(assessJoin(wants, crew(2, 40)).interested).toBe(false);
    expect(assessJoin(wants, crew(2, 40)).blockers).toEqual(['notoriety']);
    expect(assessJoin(wants, crew(3, 1)).interested).toBe(true);
  });

  it('shuts it on a crew that has not been around long enough, whatever its rank', () => {
    const wants = { minNotoriety: 0, minLevel: 12 };
    expect(assessJoin(wants, crew(9, 11)).blockers).toEqual(['level']);
    expect(assessJoin(wants, crew(0, 12)).interested).toBe(true);
  });

  it('reports both doors when both are shut, rank first', () => {
    const assessment = assessJoin({ minNotoriety: 4, minLevel: 20 }, crew(1, 3));
    expect(assessment.blockers).toEqual(['notoriety', 'level']);
    expect(assessment.meetsNotoriety).toBe(false);
    expect(assessment.meetsLevel).toBe(false);
  });

  it('lets an open door through for a crew with nothing at all', () => {
    expect(assessJoin({ minNotoriety: 0, minLevel: 1 }, crew(0, 1)).interested).toBe(true);
  });
});

describe('§H7: what a contract costs', () => {
  const sheet = (value: number) => makeAttributes(value);

  it('prices a better sheet higher', () => {
    expect(askingWage(sheet(35))).toBeGreaterThan(askingWage(sheet(20)));
  });

  it('never asks less than the floor wage, however poor the sheet', () => {
    expect(askingWage(sheet(0))).toBe(RECRUIT_BASE_WAGE);
  });

  /**
   * The whole cost of haggling badly. The six-hour standoff is a delay; this is the part that
   * persists, and it is what makes an opening lowball a decision rather than a free roll.
   */
  it('puts the floor at a fixed share of the asking price', () => {
    for (const asking of [12, 40, 137]) {
      expect(reservationWage(asking)).toBe(Math.ceil(asking * WAGE_RESERVATION_FRACTION));
      expect(reservationWage(asking)).toBeLessThan(asking);
    }
  });
});

describe('the shared package keeps no role-shaped data', () => {
  it('prices a wage off the visible sheet only, never off a role', () => {
    // A wage that tracked role fit would put the hidden table on the wire with a price on it
    // (§B8a, INTERFACES R4). Two sheets with the same ratings in different *attributes* must
    // therefore cost exactly the same.
    const first = makeAttributes(18, { stealth: 38, logic: 30 });
    const second = makeAttributes(18, { medicine: 38, diplomacy: 30 });
    expect(askingWage(first, 0)).toBe(askingWage(second, 0));
  });
});

/**
 * The conversation (§H7).
 *
 * `negotiateWage` answered one question the same way for everybody; this is the part that makes
 * hiring feel like hiring a person. Every property below is one a Football Manager negotiation has
 * and this one had to grow: a floor that does not move, a demand that does, a personality behind
 * both, patience that runs out, and a door.
 */
describe('bidding for people (§H7, the auction)', () => {
  it('opens at the reserve and steps by five percent, never by less than a cap', () => {
    expect(nextMinimumBid(40, null)).toBe(40);
    expect(nextMinimumBid(40, 40)).toBe(42);
    expect(nextMinimumBid(40, 100)).toBe(105);
    // A leader under the reserve cannot happen, but the floor still holds if it did.
    expect(nextMinimumBid(40, 10)).toBe(40);
    expect(nextMinimumBid(12, 12)).toBe(13);
  });

  it('seals the last thirty minutes of the game day and closes at its turn', () => {
    const now = new Date('2026-09-07T10:00:00Z');
    const window = auctionWindow(now);
    expect(window.day).toBe('2026-09-07');
    expect(window.closesAt.getTime() - window.sealedFrom.getTime()).toBe(AUCTION_SEALED_WINDOW_MS);
    // Athens is three hours ahead in September: the day turns at 21:00Z.
    expect(window.closesAt.toISOString()).toBe('2026-09-07T21:00:00.000Z');
    expect(auctionPhaseAt(now, window)).toBe('open');
    expect(auctionPhaseAt(new Date('2026-09-07T20:29:59Z'), window)).toBe('open');
    expect(auctionPhaseAt(new Date('2026-09-07T20:30:00Z'), window)).toBe('sealed');
    expect(auctionPhaseAt(new Date('2026-09-07T21:00:00Z'), window)).toBe('closed');
  });

  /**
   * The two nights of the year the arithmetic answer is wrong.
   *
   * A day is 23 hours long in Athens on the last Sunday of March and 25 on the last Sunday of
   * October, so "midnight plus 24 hours" is an hour out on both, and a table that closed an hour
   * early or an hour late is a table somebody was still bidding at. `nextDayBoundary` searches
   * rather than adds, and this is what says so at the seam the Bar actually uses.
   *
   * The assertions are stated as facts about the *day key* rather than as UTC instants wherever
   * they can be, so they stay true if a tz database update moves a boundary: the last instant of
   * the auction has to be inside the day it belongs to, and the close has to be the first instant
   * of the next one.
   */
  it('closes at the real Athens midnight on both summer-time nights', () => {
    const nights = [
      // Spring forward: 29 March 2026 is 23 hours long. Athens is EEST (+3) by the evening, so
      // the day turns at 21:00Z rather than at 22:00Z.
      { during: '2026-03-29T12:00:00Z', day: '2026-03-29', closes: '2026-03-29T21:00:00.000Z' },
      // The day *before* it, which is still EET (+2) and turns at 22:00Z.
      { during: '2026-03-28T12:00:00Z', day: '2026-03-28', closes: '2026-03-28T22:00:00.000Z' },
      // Fall back: 25 October 2026 is 25 hours long and ends in EET (+2).
      { during: '2026-10-25T12:00:00Z', day: '2026-10-25', closes: '2026-10-25T22:00:00.000Z' },
      { during: '2026-10-24T12:00:00Z', day: '2026-10-24', closes: '2026-10-24T21:00:00.000Z' },
    ];

    for (const night of nights) {
      const window = auctionWindow(new Date(night.during));
      expect(window.day, night.during).toBe(night.day);
      expect(window.closesAt.toISOString(), night.during).toBe(night.closes);
      // The seal is thirty minutes of wall clock, whatever the day's length.
      expect(window.closesAt.getTime() - window.sealedFrom.getTime()).toBe(
        AUCTION_SEALED_WINDOW_MS,
      );
      // The last instant of the auction is inside its own day, and the close is not.
      expect(dayInZone(new Date(window.closesAt.getTime() - 1))).toBe(night.day);
      expect(dayInZone(window.closesAt)).not.toBe(night.day);
      // And the phases line up on the boundary itself.
      expect(auctionPhaseAt(new Date(window.sealedFrom.getTime() - 1), window)).toBe('open');
      expect(auctionPhaseAt(window.sealedFrom, window)).toBe('sealed');
      expect(auctionPhaseAt(new Date(window.closesAt.getTime() - 1), window)).toBe('sealed');
      expect(auctionPhaseAt(window.closesAt, window)).toBe('closed');
    }
  });

  /**
   * A crew bidding through the change, minute by minute.
   *
   * The seal must open exactly once and stay open: an off-by-an-hour in the boundary shows up here
   * as a table that seals twice, or never, on the one night of the year it matters.
   */
  it('runs one uninterrupted open phase and one seal across a 23-hour day', () => {
    const day = '2026-03-29';
    // Every ten minutes of the short day, from its first instant to its last.
    const start = new Date('2026-03-28T22:00:00Z').getTime();
    const seen: string[] = [];
    for (let at = start; at < start + 23 * 3_600_000; at += 10 * 60_000) {
      const now = new Date(at);
      const window = auctionWindow(now);
      expect(window.day, now.toISOString()).toBe(day);
      const phase = auctionPhaseAt(now, window);
      if (seen[seen.length - 1] !== phase) seen.push(phase);
    }
    expect(seen, 'open, then sealed, and nothing in between or after').toEqual(['open', 'sealed']);
  });

  it('counts a crew in for the higher of its open bid and its sealed value', () => {
    expect(finalValue({ userId: 'a', open: 50, sealed: null })).toBe(50);
    expect(finalValue({ userId: 'a', open: 50, sealed: 80 })).toBe(80);
    expect(finalValue({ userId: 'a', open: null, sealed: 30 })).toBe(30);
  });

  it('ranks by final, drops anybody under the reserve, and breaks a tie the same way twice', () => {
    const bids = [
      { userId: 'open-leader', open: 60, sealed: null },
      { userId: 'sniper', open: 45, sealed: 75 },
      { userId: 'under', open: null, sealed: 20 },
      { userId: 'tied-a', open: 75, sealed: null },
    ];
    const first = rankBids(bids, 40, 'day:seat');
    const second = rankBids(bids, 40, 'day:seat');
    expect(first.ranked.map((entry) => entry.final)).toEqual([75, 75, 60]);
    expect(first.ranked.map((entry) => entry.userId)).toEqual(second.ranked.map((e) => e.userId));
    expect(first.ranked.some((entry) => entry.userId === 'under')).toBe(false);
    // And the coin is the auction's, not the order's: a different seed can flip the tie.
    const flips = ['a', 'b', 'c', 'd', 'e', 'f'].map(
      (seed) => rankBids(bids, 40, seed).ranked[0]!.userId,
    );
    expect(new Set(flips).size).toBe(2);
  });

  it('lets a crew sit at two tables, three past the level-40 milestone', () => {
    expect(MAX_OPEN_AUCTIONS).toBe(2);
    expect(maxOpenAuctionsFor(1)).toBe(2);
    expect(maxOpenAuctionsFor(39)).toBe(2);
    expect(maxOpenAuctionsFor(40)).toBe(3);
  });
});
