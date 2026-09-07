import { MAX_FACTION_MEMBERS, type FactionMember, type FactionRank } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import {
  NARROWEST_PICTURE_HEIGHT_PX,
  NARROWEST_PICTURE_PX,
  SEAT_PLACES,
  platesOverlap,
  seated,
  unseated,
} from './seats';

/**
 * The five places in the room, and the two ways a place can be wrong without looking wrong.
 *
 * A plate drawn over its neighbour hides a person: the room shows four names and the roster says
 * five, and at a glance that reads as a table with a spare chair rather than as a bug. A plate
 * outside `OnPlate`'s clearance is worse, because `OnPlate` does not draw it off the picture, it
 * *moves* it to the edge: two plates pushed to the same bound land on exactly the same pixel and
 * the screenshot shows one name where two people are.
 */

const member = (username: string, rank: FactionRank, armySize: number): FactionMember => ({
  userId: `user-${username}`,
  baseId: `base-${username}`,
  username,
  districtName: `${username}'s district`,
  districtId: 'ashen-terraces',
  rank,
  joinedAt: '2026-08-01T00:00:00.000Z',
  level: 5,
  infamy: 100,
  infamyEarned: 100,
  armySize,
  supplyUsed: 10,
  isBot: false,
  card: 'joker',
  cardMark: 'F',
});

/**
 * `PlateRoom`'s clearance for a bottom-anchored control, restated rather than imported.
 *
 * `CLEARANCE_PX` is private to that module, and a test that read the live value would pass by
 * construction the day somebody widened it: the point here is that the plates sit inside the
 * clearance the room actually applies, so the numbers have to be pinned independently. 100px on
 * each side, 78px above and 14px below, which at the narrowest picture is what they are here.
 */
const CLEARANCE_PX = { x: 100, above: 78, below: 14 };

describe('where the five plates hang', () => {
  it('has one place per seat the domain allows', () => {
    expect(SEAT_PLACES).toHaveLength(MAX_FACTION_MEMBERS);
  });

  it('never draws two plates over each other, at the narrowest picture', () => {
    const picture = { width: NARROWEST_PICTURE_PX, height: NARROWEST_PICTURE_HEIGHT_PX };
    for (let a = 0; a < SEAT_PLACES.length; a += 1) {
      for (let b = a + 1; b < SEAT_PLACES.length; b += 1) {
        const left = SEAT_PLACES[a];
        const right = SEAT_PLACES[b];
        if (left === undefined || right === undefined) continue;
        expect(platesOverlap(left, right, picture), `plates ${a} and ${b}`).toBe(false);
      }
    }
  });

  it('is one row split evenly across the foot, centred, with a margin at each end', () => {
    const xs = SEAT_PLACES.map((place) => place.x);
    expect(new Set(SEAT_PLACES.map((place) => place.y)).size).toBe(1);
    for (let at = 1; at < xs.length - 1; at += 1) {
      const before = xs[at - 1];
      const here = xs[at];
      const after = xs[at + 1];
      if (before === undefined || here === undefined || after === undefined) throw new Error('row');
      expect(here - before).toBeCloseTo(after - here, 10);
    }
    expect(xs[2]).toBeCloseTo(0.5, 10);
    expect(xs[0]).toBeGreaterThan(0.03);
    expect(xs[4]).toBeLessThan(0.97);
  });

  it('keeps every place inside the clearance, so the room never moves one', () => {
    const padX = CLEARANCE_PX.x / NARROWEST_PICTURE_PX;
    const above = CLEARANCE_PX.above / NARROWEST_PICTURE_HEIGHT_PX;
    const below = CLEARANCE_PX.below / NARROWEST_PICTURE_HEIGHT_PX;
    for (const place of SEAT_PLACES) {
      expect(place.x).toBeGreaterThan(padX);
      expect(place.x).toBeLessThan(1 - padX);
      expect(place.y).toBeGreaterThan(above);
      expect(place.y).toBeLessThan(1 - below);
    }
  });

  it('says when two plates would land on the same pixels', () => {
    const picture = { width: NARROWEST_PICTURE_PX, height: NARROWEST_PICTURE_HEIGHT_PX };
    expect(platesOverlap({ x: 0.5, y: 0.5 }, { x: 0.52, y: 0.52 }, picture)).toBe(true);
    expect(platesOverlap({ x: 0.5, y: 0.5 }, { x: 0.7, y: 0.5 }, picture)).toBe(false);
    expect(platesOverlap({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.7 }, picture)).toBe(false);
  });
});

describe('who is in which seat', () => {
  it('always draws five places, whoever is at the table', () => {
    expect(seated([])).toHaveLength(MAX_FACTION_MEMBERS);
    expect(seated([member('Nikos', 'leader', 10)])).toHaveLength(MAX_FACTION_MEMBERS);
  });

  it('puts the leader in the middle, the table outward from there in rank order, and the rest empty', () => {
    const places = seated([
      member('Marrow', 'member', 90),
      member('Sable', 'chief', 10),
      member('Nikos', 'leader', 1),
    ]);
    expect(places.map((seat) => seat?.username ?? null)).toEqual([
      null,
      'Sable',
      'Nikos',
      'Marrow',
      null,
    ]);
  });

  it('says so when there are more people than chairs', () => {
    const six = Array.from({ length: 6 }, (_, at) => member(`P${at}`, 'member', 10 - at));
    expect(seated(six).every((seat) => seat !== null)).toBe(true);
    expect(unseated(six).map((seat) => seat.username)).toEqual(['P5']);
    expect(unseated(six.slice(0, 5))).toEqual([]);
  });
});
