import {
  GRADES,
  LEANING_PROFILES,
  MAX_RECRUITMENT_ATTRIBUTE,
  MISSION_LEANINGS,
  RECRUIT_MAX_MIN_INFAMY,
  RECRUIT_MAX_MIN_NOTORIETY,
  RECRUIT_MIN_INFAMY_GATE,
  RECRUIT_LEGEND_NOTORIETY,
  askingWage,
  assessJoin,
  basePayrollCapacity,
  cityRoomProfile,
  crewStanding,
  flatRoom,
  leaderGradeIndex,
  type Attributes,
  type CityParticipant,
  type CrewStanding,
  type RoomProfile,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { reserveFor } from './auction.js';
import {
  BAR_ROSTER_SIZE,
  CITY_LEVELS_PER_CALIBRE,
  EARLY_ROOM_STANDING,
  HIGH_SEAT_RANK_SLACK,
  LATE_ROOM_STANDING,
  LOW_SEAT,
  MAX_ROOM_CALIBRE,
  barCalibre,
  barRoster,
  barSeatsFor,
  seatKindOf,
  standoutRankBand,
  type BarCharacter,
  type SeatKind,
} from './roster.js';

/**
 * Who each chair is for (maintainer, 2026-09-28).
 *
 * "If 3 players are max level and one is a beginner have an officer appear for him as well." The
 * room seats one person for the weakest crew in the city, one for the strongest, four around the
 * middle and two standouts above it, and the whole of it climbs with the city well past where the
 * old room stopped. What is pinned here is what a player would notice: the beginner has somebody
 * to sign, the top crew has somebody worth asking for, and a finished city's Bar pours officers a
 * late-game job can lean on.
 */

const DAYS = Array.from({ length: 120 }, (_, index) =>
  new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString().slice(0, 10),
);

const resident = (level: number, notoriety: number): CityParticipant => ({
  stake: { cityId: 'ashfall', resident: true, locationsHeld: 0 },
  level,
  notoriety,
});

/** The maintainer's example: three crews at the top of the game and one on their first week. */
const TOP = { level: 100, notoriety: 11 };
const BEGINNER = { level: 1, notoriety: 0 };
const SPLIT_CITY = cityRoomProfile([
  resident(TOP.level, TOP.notoriety),
  resident(TOP.level, TOP.notoriety),
  resident(TOP.level, TOP.notoriety),
  resident(BEGINNER.level, BEGINNER.notoriety),
])!;

const NEW_CREW: CrewStanding = { notoriety: 0, infamy: 0, factionInfamy: 0 };

/** The job this person would lead best, as an index on the grade ladder (`GRADES`). */
const bestLeaning = (attributes: Attributes): number =>
  Math.max(...MISSION_LEANINGS.map((l) => leaderGradeIndex(attributes, LEANING_PROFILES[l])));

const mean = (values: readonly number[]): number =>
  values.reduce((sum, value) => sum + value, 0) / values.length;

/** Every sitter of one kind of chair, across the sample of nights. */
function sitters(room: RoomProfile | number, kind: SeatKind): BarCharacter[] {
  return DAYS.flatMap((day) =>
    barRoster(day, BAR_ROSTER_SIZE, room).filter((_, seat) => seatKindOf(seat) === kind),
  );
}

describe('the chairs', () => {
  it('seats the low end first, the high end before the standouts, and the middle between', () => {
    const kinds = Array.from({ length: BAR_ROSTER_SIZE }, (_, seat) => seatKindOf(seat));
    expect(kinds).toEqual([
      'low',
      'average',
      'average',
      'average',
      'average',
      'high',
      'standout',
      'standout',
    ]);
    // A widened room adds people who happened to be in, pitched at the middle like the rest.
    for (let seat = BAR_ROSTER_SIZE; seat < barSeatsFor(1000); seat += 1) {
      expect(seatKindOf(seat), `widened seat ${seat}`).toBe('average');
    }
  });
});

describe('a city of three veterans and a beginner', () => {
  it('seats somebody the beginner can clear and afford, every night', () => {
    const book = basePayrollCapacity(1, 0);
    for (const day of DAYS) {
      const low = barRoster(day, BAR_ROSTER_SIZE, SPLIT_CITY)[LOW_SEAT]!;
      expect(assessJoin(low.requirement, NEW_CREW).interested, day).toBe(true);
      expect(reserveFor(low), `${day}: a starting book cannot hold the floor`).toBeLessThanOrEqual(
        book,
      );
    }
  });

  /**
   * The low seat is poured at the beginner and at nobody else, so it is the chair a city of one
   * beginner would have poured. The positive control: the middle of this city is out of that
   * crew's reach, which is the reason the chair exists.
   */
  it('pitches the low seat at the beginner, not at the city', () => {
    for (const day of DAYS.slice(0, 20)) {
      const split = barRoster(day, BAR_ROSTER_SIZE, SPLIT_CITY)[LOW_SEAT];
      const alone = barRoster(day, BAR_ROSTER_SIZE, flatRoom(BEGINNER.level))[LOW_SEAT];
      expect(split?.attributes, day).toEqual(alone?.attributes);
    }
    const middle = sitters(SPLIT_CITY, 'average').map((one) => reserveFor(one));
    expect(mean(middle)).toBeGreaterThan(basePayrollCapacity(1, 0));
  });

  it('puts the high seat behind the top crew’s own rank, or one under it', () => {
    const doors = sitters(SPLIT_CITY, 'high').map((one) => one.requirement.minNotoriety);
    for (const door of doors) {
      expect(door).toBeGreaterThanOrEqual(TOP.notoriety - HIGH_SEAT_RANK_SLACK);
      expect(door).toBeLessThanOrEqual(TOP.notoriety);
    }
    // Both ends of the band turn up, so the door is a roll and not a constant.
    expect(new Set(doors)).toEqual(new Set([TOP.notoriety - 1, TOP.notoriety]));
    // And the top crew clears it: a real ask, not a locked door.
    const top: CrewStanding = { notoriety: TOP.notoriety, infamy: 0, factionInfamy: 0 };
    for (const one of sitters(SPLIT_CITY, 'high')) {
      expect(assessJoin(one.requirement, top).interested).toBe(true);
    }
  });

  it('rolls the high seat at the top crew’s level, above the middle of the city', () => {
    const high = mean(sitters(SPLIT_CITY, 'high').map((one) => bestLeaning(one.attributes)));
    const middle = mean(sitters(SPLIT_CITY, 'average').map((one) => bestLeaning(one.attributes)));
    // Measured at 14.9 against 11.8.
    expect(high - middle).toBeGreaterThan(2);
  });

  it('opens the high seat to anybody while the top crew is still `Nobody`', () => {
    for (const one of sitters(flatRoom(8), 'high')) {
      expect(one.requirement.minNotoriety).toBe(0);
    }
  });
});

/**
 * "Up to even higher ones" (maintainer, 2026-09-28).
 *
 * The room used to stop at standing thirty: recruit attributes capped at 40, the calibre capped at
 * ten, and the best leader the Bar ever produced graded about D-. It climbs to standing 110 now,
 * which is a crew at level ninety that has bought ten rungs, where an active player stands around
 * day seventy-five.
 */
describe('how far the room climbs', () => {
  it('leaves the early room on the slope it was balanced on', () => {
    for (let standing = 0; standing <= EARLY_ROOM_STANDING; standing += 1) {
      expect(barCalibre(standing), `standing ${standing}`).toBe(
        Math.floor(standing / CITY_LEVELS_PER_CALIBRE),
      );
    }
    // A young city never sees an attribute past the old ceiling, standouts included.
    for (const one of DAYS.flatMap((day) => barRoster(day, BAR_ROSTER_SIZE, 12))) {
      expect(Math.max(...Object.values(one.attributes))).toBeLessThanOrEqual(
        MAX_RECRUITMENT_ATTRIBUTE,
      );
    }
  });

  it('climbs with every level of the late game, and tops out at the late standing', () => {
    for (let standing = EARLY_ROOM_STANDING; standing < LATE_ROOM_STANDING; standing += 1) {
      expect(barCalibre(standing + 1)).toBeGreaterThanOrEqual(barCalibre(standing));
    }
    expect(barCalibre(60)).toBeGreaterThan(barCalibre(EARLY_ROOM_STANDING));
    expect(barCalibre(LATE_ROOM_STANDING - 1)).toBeLessThan(MAX_ROOM_CALIBRE);
    expect(barCalibre(LATE_ROOM_STANDING)).toBe(MAX_ROOM_CALIBRE);
    expect(barCalibre(200)).toBe(MAX_ROOM_CALIBRE);
  });

  /**
   * The target: a finished city seats leaders grading B to A, and a standout reaches A+.
   *
   * Floors under the measured figures (average seats 13.9, standouts 16.0 with a best of 17.0, at
   * a city of level ninety and rank ten), so a retune that quietly caps the room again fails here.
   */
  it('seats late-game leaders in a finished city', () => {
    const finished = flatRoom(90, 10);
    expect(crewStanding(90, 10)).toBe(LATE_ROOM_STANDING);
    const middle = sitters(finished, 'average').map((one) => bestLeaning(one.attributes));
    const standouts = sitters(finished, 'standout').map((one) => bestLeaning(one.attributes));

    expect(mean(middle)).toBeGreaterThan(GRADES.indexOf('B'));
    expect(mean(standouts)).toBeGreaterThan(GRADES.indexOf('A-') + 0.5);
    expect(Math.max(...standouts)).toBeGreaterThanOrEqual(GRADES.indexOf('A+') - 0.5);
    // ...and a young one does not: the early room is still green.
    const young = sitters(flatRoom(5), 'average').map((one) => bestLeaning(one.attributes));
    expect(mean(young)).toBeLessThan(GRADES.indexOf('E'));
  });

  /** §H7: a better officer asks more, because the price reads the sheet. */
  it('prices the late room above the early one', () => {
    const wage = (room: RoomProfile) =>
      mean(sitters(room, 'average').map((one) => askingWage(one.attributes, 0, one.perks)));
    expect(wage(flatRoom(90, 10))).toBeGreaterThan(wage(flatRoom(30, 3)) * 2);
  });
});

describe('doors that climb with the city’s rank', () => {
  it('lifts the ordinary ladder once the average crew is past `Marked`', () => {
    const young = sitters(flatRoom(40, 3), 'average').map((one) => one.requirement.minNotoriety);
    const old = sitters(flatRoom(90, 10), 'average').map((one) => one.requirement.minNotoriety);
    expect(Math.max(...young)).toBeLessThanOrEqual(RECRUIT_MAX_MIN_NOTORIETY);
    expect(Math.max(...old)).toBeGreaterThan(RECRUIT_MAX_MIN_NOTORIETY);
    // Never past the city's own average: these are the seats an ordinary crew there can reach.
    expect(Math.max(...old)).toBeLessThanOrEqual(10);
  });

  it('puts the standouts at or above the city’s average rank, and asks a fatter wallet', () => {
    expect(standoutRankBand(0, 0)).toEqual({ floor: 3, top: RECRUIT_LEGEND_NOTORIETY });
    const old = sitters(flatRoom(90, 10), 'standout');
    for (const one of old) {
      expect(one.requirement.minNotoriety).toBeGreaterThanOrEqual(10);
      expect(one.requirement.minInfamy).toBeGreaterThanOrEqual(RECRUIT_MIN_INFAMY_GATE * 2);
    }
    const young = sitters(flatRoom(30, 0), 'standout');
    expect(mean(old.map((one) => one.requirement.minInfamy))).toBeGreaterThan(
      mean(young.map((one) => one.requirement.minInfamy)) * 1.5,
    );
  });

  it('keeps a standout within one rung of the strongest crew in town', () => {
    // Everybody at rank ten: the door stops at eleven, not at the average plus three.
    expect(standoutRankBand(10, 10)).toEqual({ floor: 10, top: 11 });
    for (const one of sitters(flatRoom(90, 10), 'standout')) {
      expect(one.requirement.minNotoriety).toBeLessThanOrEqual(11);
    }
    // One crew far ahead lets the average's own reach through.
    expect(standoutRankBand(6, 12).top).toBe(9);
  });

  it('keeps the wallet door within what a rank-ten crew holds', () => {
    for (const one of sitters(flatRoom(90, 10), 'standout')) {
      expect(one.requirement.minInfamy).toBeLessThanOrEqual(RECRUIT_MAX_MIN_INFAMY * 2);
    }
  });
});
