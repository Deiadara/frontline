import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RegisterRequestSchema } from './api.js';
import { BUILDING_CATALOG, BUILDING_KINDS } from './building/index.js';
import {
  BOT_DISTRICT_ID,
  CITY_DISTRICTS,
  DistrictSchema,
  STARTER_DISTRICT_ID,
  findDistrict,
  garrisonOf,
  isDistrictRaidable,
  CITY_LOCATIONS,
  CONTESTED_DISTRICTS,
  RESIDENTIAL_DISTRICTS,
  findLocation,
  unifiedBonusFor,
  isSeatOfGovernmentPower,
  raidTargetOf,
  type District,
} from './city/index.js';
import { GOVERNMENT_GARRISONS, governmentGarrisonFor } from './factions.js';

/** Minimum gap between two district positions, in normalized (0..1) map units. */
const MIN_DISTRICT_SEPARATION = 0.06;

const district = (id: string): District => {
  const found = findDistrict(id);
  if (!found) throw new Error(`fixture error: no district ${id}`);
  return found;
};

describe('CITY_DISTRICTS', () => {
  it('is a valid map with a starter district', () => {
    expect(() => z.array(DistrictSchema).min(10).parse(CITY_DISTRICTS)).not.toThrow();
    expect(CITY_DISTRICTS).toHaveLength(12);
    expect(findDistrict(STARTER_DISTRICT_ID)?.kind).toBe('residential');
  });

  it('settles the player and the AI rival in two different, real districts', () => {
    expect(STARTER_DISTRICT_ID).not.toBe(BOT_DISTRICT_ID);
    expect(findDistrict(STARTER_DISTRICT_ID)).toBeDefined();
    expect(findDistrict(BOT_DISTRICT_ID)).toBeDefined();
  });

  it('has unique ids', () => {
    const ids = CITY_DISTRICTS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // The map renderer anchors each base marker to its district's position, so districts
  // that sit on top of each other would render overlapping markers and labels.
  it('keeps every district at least MIN_DISTRICT_SEPARATION apart', () => {
    for (let i = 0; i < CITY_DISTRICTS.length; i++) {
      for (let j = i + 1; j < CITY_DISTRICTS.length; j++) {
        const a = CITY_DISTRICTS[i];
        const b = CITY_DISTRICTS[j];
        if (!a || !b) throw new Error('district index out of range');
        const distance = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
        expect(
          distance,
          `${a.id} and ${b.id} are ${distance.toFixed(3)} apart`,
        ).toBeGreaterThanOrEqual(MIN_DISTRICT_SEPARATION);
      }
    }
  });
});

describe('who holds the map (§A3)', () => {
  const contested = CONTESTED_DISTRICTS;

  it('makes the Combine the main enemy without making it the only one', () => {
    const combine = contested.filter((d) => d.faction === 'government');
    expect(combine.length).toBeGreaterThan(contested.length - combine.length);
    expect(combine.length).toBeLessThan(contested.length);
  });

  it('leaves every seat of power in Combine hands', () => {
    const seats = CITY_DISTRICTS.filter((d) => d.seatOfPower);
    expect(seats.length).toBeGreaterThan(0);
    for (const seat of seats) {
      expect(seat.faction, seat.id).toBe('government');
      expect(isSeatOfGovernmentPower(seat), seat.id).toBe(true);
    }
  });

  it('holds more than one seat of Combine power, so taking the state is a campaign', () => {
    // Two at least. A single seat would make the whole government a one-district problem, and
    // `infamyForRaidWon` pays a premium for a seat precisely because there are several to take.
    expect(CITY_DISTRICTS.filter(isSeatOfGovernmentPower).length).toBeGreaterThanOrEqual(2);
  });

  it('calls no residential district Combine ground', () => {
    for (const district of RESIDENTIAL_DISTRICTS) {
      expect(district.faction, district.id).toBe('independent');
      expect(isSeatOfGovernmentPower(district), district.id).toBe(false);
      // And nobody lives on ground that can be taken out from under them.
      expect(district.locations, district.id).toEqual([]);
    }
  });

  it('lets a crew raid anybody’s home but its own, and capture none of them', () => {
    const home = district(STARTER_DISTRICT_ID);
    expect(isDistrictRaidable(home, true)).toBe(false);
    expect(isDistrictRaidable(home, false)).toBe(true);
    // Contested ground is taken a place at a time, never raided as a whole.
    for (const contestedDistrict of CONTESTED_DISTRICTS) {
      expect(isDistrictRaidable(contestedDistrict, false), contestedDistrict.id).toBe(false);
    }
  });

  it('reads a raid target off the district and nothing else', () => {
    expect(raidTargetOf(district('combine-spire'))).toEqual({
      faction: 'government',
      isSeatOfPower: true,
    });
    expect(raidTargetOf(district('undergrid'))).toEqual({
      faction: 'government',
      isSeatOfPower: false,
    });
    expect(raidTargetOf(district('rustyard'))).toEqual({
      faction: 'independent',
      isSeatOfPower: false,
    });
  });

  it('names a Combine garrison that gets heavier as the site does (§A3)', () => {
    expect(garrisonOf(district('glasshouse-fields'))).not.toBe(
      garrisonOf(district('combine-spire')),
    );
    for (const combineHeld of CITY_DISTRICTS.filter((d) => d.faction === 'government')) {
      expect(garrisonOf(combineHeld), combineHeld.id).toMatch(/Combine|Directorate|enforcer/);
    }
    // Independent ground must not be narrated as the government's.
    expect(garrisonOf(district('rustyard'))).not.toMatch(/Combine|Directorate/);
  });

  it('scales the garrison ladder monotonically over the whole difficulty range', () => {
    const seen = new Set<string>();
    for (let difficulty = 1; difficulty <= 10; difficulty++) {
      seen.add(governmentGarrisonFor(difficulty));
    }
    expect(seen.size).toBe(GOVERNMENT_GARRISONS.length);
  });
});

describe('the locations inside a district (§A4)', () => {
  it('gives every contested district something to take, and a unified bonus for taking it all', () => {
    for (const contested of CONTESTED_DISTRICTS) {
      expect(contested.locations.length, contested.id).toBeGreaterThan(0);
      expect(unifiedBonusFor(contested.id), contested.id).not.toBeNull();
    }
  });

  it('gives every place a unique id that names the district it is in', () => {
    const ids = CITY_LOCATIONS.map((place) => place.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const place of CITY_LOCATIONS) {
      expect(place.id.startsWith(place.districtId), place.id).toBe(true);
      expect(findLocation(place.id)).toEqual(place);
    }
  });

  it('spreads the city across enough kinds of place to make holdings differ', () => {
    const kinds = new Set(CITY_LOCATIONS.map((place) => place.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(15);
    expect(CITY_LOCATIONS.length).toBeGreaterThanOrEqual(25);
  });

  it('offers all three grades of ground to dig into', () => {
    const grades = new Set(CITY_LOCATIONS.map((place) => place.fortifyDifficulty));
    expect(grades).toEqual(new Set(['easy', 'medium', 'hard']));
  });
});

describe('BUILDING_CATALOG', () => {
  it('covers every building kind', () => {
    for (const kind of BUILDING_KINDS) {
      expect(BUILDING_CATALOG[kind].name.length).toBeGreaterThan(0);
    }
  });
});

describe('RegisterRequestSchema', () => {
  it('rejects short passwords and bad usernames', () => {
    expect(RegisterRequestSchema.safeParse({ username: 'neo', password: 'short' }).success).toBe(
      false,
    );
    expect(RegisterRequestSchema.safeParse({ username: 'x', password: 'longenough' }).success).toBe(
      false,
    );
    expect(
      RegisterRequestSchema.safeParse({ username: 'neo_2077', password: 'longenough' }).success,
    ).toBe(true);
  });
});
