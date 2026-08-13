import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RegisterRequestSchema } from './api.js';
import { BUILDING_CATALOG, BUILDING_KINDS } from './building.js';
import {
  BOT_DISTRICT_ID,
  CITY_DISTRICTS,
  DistrictSchema,
  STARTER_DISTRICT_ID,
  findDistrict,
  garrisonOf,
  isDistrictAttackable,
  isSeatOfGovernmentPower,
  raidTargetOf,
  type District,
} from './city.js';
import { REVOLUTIONARY_SEATS } from './economy/reputation.js';
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
    expect(findDistrict(STARTER_DISTRICT_ID)?.kind).toBe('player_base');
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
  const attackable = CITY_DISTRICTS.filter((d) =>
    isDistrictAttackable(d, { isOwnBase: false, hasBotBase: false }),
  );

  it('makes the Combine the main enemy without making it the only one', () => {
    const combine = attackable.filter((d) => d.faction === 'government');
    expect(combine.length).toBeGreaterThan(attackable.length - combine.length);
    expect(combine.length).toBeLessThan(attackable.length);
  });

  it('leaves every stronghold in Combine hands — a stronghold is a seat of its power', () => {
    const strongholds = CITY_DISTRICTS.filter((d) => d.kind === 'npc_stronghold');
    expect(strongholds.length).toBeGreaterThan(0);
    for (const stronghold of strongholds) {
      expect(stronghold.faction, stronghold.id).toBe('government');
      expect(isSeatOfGovernmentPower(stronghold), stronghold.id).toBe(true);
    }
  });

  it('holds enough seats of power for a revolution to be possible (§D8)', () => {
    // `Revolutionary` needs `REVOLUTIONARY_SEATS` of them, so the map has to field at least that
    // many or the label is unreachable however hard a player plays.
    expect(CITY_DISTRICTS.filter(isSeatOfGovernmentPower).length).toBeGreaterThanOrEqual(
      REVOLUTIONARY_SEATS,
    );
  });

  it('calls no player base or market Combine ground', () => {
    for (const district of CITY_DISTRICTS.filter(
      (d) => d.kind === 'player_base' || d.kind === 'market',
    )) {
      expect(district.faction, district.id).toBe('independent');
      expect(isSeatOfGovernmentPower(district), district.id).toBe(false);
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

describe('isDistrictAttackable', () => {
  const EMPTY = { isOwnBase: false, hasBotBase: false };

  it('offers raid sites and NPC strongholds', () => {
    expect(isDistrictAttackable(district('rustyard'), EMPTY)).toBe(true);
    expect(isDistrictAttackable(district('blacksite-7'), EMPTY)).toBe(true);
  });

  it('holds the line at markets', () => {
    expect(isDistrictAttackable(district('sprawl-exchange'), EMPTY)).toBe(false);
  });

  it('never targets your own base', () => {
    expect(
      isDistrictAttackable(district(STARTER_DISTRICT_ID), { isOwnBase: true, hasBotBase: false }),
    ).toBe(false);
  });

  it('never targets another human player', () => {
    expect(isDistrictAttackable(district(STARTER_DISTRICT_ID), EMPTY)).toBe(false);
  });

  it('targets the AI rival garrisoning a district', () => {
    // Empty, the rival's district is an ordinary player_base node; the bot makes it hostile.
    expect(isDistrictAttackable(district(BOT_DISTRICT_ID), EMPTY)).toBe(false);
    expect(
      isDistrictAttackable(district(BOT_DISTRICT_ID), { isOwnBase: false, hasBotBase: true }),
    ).toBe(true);
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
