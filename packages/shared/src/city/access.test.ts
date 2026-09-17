import { describe, expect, it } from 'vitest';
import {
  LEVELS_PER_NOTORIETY_RANK,
  MAX_WEIGHTED_LOCATIONS,
  canEnterCity,
  citiesOpenTo,
  cityCalibre,
  cityOfDistrict,
  crewStanding,
  stakeWeight,
  type CityStake,
} from './access.js';
import { CITY_DISTRICTS } from './districts.js';
import { DEFAULT_CITY_ID } from './cities.js';

/**
 * The door, and the vote behind it (maintainer request, 2026-09-17).
 *
 * Two rules that are easy to state and easy to get subtly wrong, and both of them decide what a
 * player sees rather than what a screen draws: who may walk into a city's rooms, and whose standing
 * stocks them.
 */

const stake = (over: Partial<CityStake> = {}): CityStake => ({
  cityId: DEFAULT_CITY_ID,
  resident: false,
  locationsHeld: 0,
  ...over,
});

describe('the door', () => {
  it('opens for one location, and for somebody who lives there with none', () => {
    expect(canEnterCity(stake({ locationsHeld: 1 }))).toBe(true);
    expect(canEnterCity(stake({ resident: true }))).toBe(true);
  });

  /**
   * The whole of "if you are kicked out you lose that privilege".
   *
   * Nothing revokes anything: the stake is read off the control map, so a crew whose last location
   * changed hands is a crew with no stake the next time the door is asked.
   */
  it('shuts the moment the last location is gone', () => {
    expect(canEnterCity(stake({ locationsHeld: 0 }))).toBe(false);
  });

  it('puts the crew’s own city first among the ones it may enter', () => {
    const open = citiesOpenTo([
      stake({ cityId: 'saltmarch', locationsHeld: 2 }),
      stake({ cityId: 'ashfall', resident: true }),
      stake({ cityId: 'verge-station', locationsHeld: 0 }),
    ]);
    expect(open[0]).toBe('ashfall');
    expect(open).toEqual(['ashfall', 'saltmarch']);
  });

  it('names the city a district belongs to, and falls back for one the map has not', () => {
    expect(cityOfDistrict(CITY_DISTRICTS[0]!.id)).toBe(DEFAULT_CITY_ID);
    expect(cityOfDistrict('a-district-nobody-drew')).toBe(DEFAULT_CITY_ID);
  });
});

describe('how much a crew counts', () => {
  /** The maintainer's number: ten locations is a whole voice, one is a tenth of one. */
  it('climbs a tenth per location and stops at ten', () => {
    expect(stakeWeight(stake({ locationsHeld: 1 }))).toBeCloseTo(0.1, 10);
    expect(stakeWeight(stake({ locationsHeld: 5 }))).toBeCloseTo(0.5, 10);
    expect(stakeWeight(stake({ locationsHeld: MAX_WEIGHTED_LOCATIONS }))).toBe(1);
    expect(stakeWeight(stake({ locationsHeld: MAX_WEIGHTED_LOCATIONS * 3 }))).toBe(1);
  });

  /** "A player who is already there affects it by a constant amount." Holding ground adds nothing. */
  it('gives somebody who lives there one whole voice, however little they hold', () => {
    expect(stakeWeight(stake({ resident: true }))).toBe(1);
    expect(stakeWeight(stake({ resident: true, locationsHeld: 40 }))).toBe(1);
  });

  it('gives a crew with no stake no voice at all, which is the door read again', () => {
    expect(stakeWeight(stake())).toBe(0);
    expect(canEnterCity(stake())).toBe(false);
  });

  /** "Both your infamy level and your district level count towards it." */
  it('counts the ladder as well as the levels', () => {
    expect(crewStanding(10, 0)).toBe(10);
    expect(crewStanding(10, 3)).toBe(10 + 3 * LEVELS_PER_NOTORIETY_RANK);
    // ...and the district level is still the bigger term for anybody short of the top of the ladder.
    expect(crewStanding(30, 5)).toBeGreaterThan(crewStanding(10, 13));
  });

  it('never counts a negative level or a negative rank', () => {
    expect(crewStanding(-5, -5)).toBe(0);
  });
});

describe('what a city’s rooms are stocked against', () => {
  const at = (level: number, notoriety: number, over: Partial<CityStake> = {}) => ({
    stake: stake(over),
    level,
    notoriety,
  });

  it('is the weighted mean of everybody with a stake in it', () => {
    // One resident at 20 and one visitor at 40 holding five locations: 20 + 40 * 0.5 over 1.5.
    const calibre = cityCalibre([at(20, 0, { resident: true }), at(40, 0, { locationsHeld: 5 })]);
    expect(calibre).toBeCloseTo((20 + 40 * 0.5) / 1.5, 10);
  });

  /**
   * The maintainer's rule, stated as the thing it is for: a visitor who holds ten counts for as
   * much as somebody who lives there, and a visitor who holds one barely moves the room.
   */
  it('lets ten locations pull as hard as living there, and one barely pull at all', () => {
    const resident = at(10, 0, { resident: true });
    const whole = cityCalibre([resident, at(50, 0, { locationsHeld: MAX_WEIGHTED_LOCATIONS })]);
    const token = cityCalibre([resident, at(50, 0, { locationsHeld: 1 })]);
    expect(whole).toBeCloseTo(30, 10);
    expect(token!).toBeLessThan(15);
    expect(token!).toBeGreaterThan(10);
  });

  it('ignores a crew with no stake rather than dragging the room down with them', () => {
    const alone = cityCalibre([at(30, 0, { resident: true })]);
    const withStranger = cityCalibre([at(30, 0, { resident: true }), at(1, 0)]);
    expect(withStranger).toBe(alone);
  });

  it('says nothing about a city nobody has a stake in', () => {
    expect(cityCalibre([])).toBeNull();
    expect(cityCalibre([at(40, 5)])).toBeNull();
  });
});
