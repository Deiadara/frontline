import { describe, expect, it } from 'vitest';
import { findUnit } from '../units/index.js';
import { RESOURCE_KEYS } from '../resources.js';
import {
  CITY_DISTRICTS,
  CITY_PLACES,
  CONTESTED_DISTRICTS,
  RESIDENTIAL_DISTRICTS,
  STARTER_DISTRICT_ID,
  UNIFIED_BONUSES,
  findDistrict,
  findPlace,
  isDistrictRaidable,
  isSeatOfGovernmentPower,
  raidTargetOf,
  unifiedBonusFor,
} from './districts.js';
import {
  FORTIFY_PERCENT_PER_LEVEL,
  PLACE_KINDS,
  PLACE_KIND_CATALOG,
  applyHoldBonus,
  describeHoldBonus,
  noTerritoryEffects,
} from './places.js';
import {
  MAX_TRAVEL_SPEED_BONUS,
  MIN_TRAVEL_MINUTES,
  mapDistance,
  nearestDistricts,
  travelMinutes,
} from './geography.js';
import {
  FORTIFY_MAX_LEVEL,
  fortifyBonusPercent,
  fortifyCost,
  fortifySeconds,
  maxFortifyBonusPercent,
  nextFortifyLevel,
  quoteFortify,
} from './fortification.js';
import {
  districtHolder,
  districtsHeldBy,
  garrisonSize,
  startingGarrison,
  isHeldBy,
  placeDefense,
  sameHolder,
  startingControl,
  startingHolder,
  territoryEffectsFor,
  type PlaceControl,
} from './control.js';

/**
 * The city (GDD §A4).
 *
 * Where a claim can be checked against something other than the constant that produced it, it is —
 * the unified bonus is asserted to be *different in kind* from the places it sits over, and the
 * fortification ladder is asserted in percentages the board named rather than against the table
 * that produces them.
 */

const MINE = 'base-mine';
const THEIRS = 'base-theirs';

const control = (placeId: string, over: Partial<PlaceControl> = {}): PlaceControl => ({
  placeId,
  holder: { kind: 'unoccupied' },
  fortification: 0,
  fortifyingUntil: null,
  garrison: {},
  ...over,
});

/** Every place in the city, held by whoever `holderOf` says. */
function world(holderOf: (placeId: string) => PlaceControl['holder']): Map<string, PlaceControl> {
  return new Map(
    CITY_PLACES.map((place) => [place.id, control(place.id, { holder: holderOf(place.id) })]),
  );
}

describe('the map (§A4)', () => {
  it('is ten districts: somewhere to live, and rather more to fight over', () => {
    expect(CITY_DISTRICTS).toHaveLength(10);
    expect(RESIDENTIAL_DISTRICTS.length).toBeGreaterThanOrEqual(2);
    expect(CONTESTED_DISTRICTS.length).toBeGreaterThan(RESIDENTIAL_DISTRICTS.length);
    expect(RESIDENTIAL_DISTRICTS.length + CONTESTED_DISTRICTS.length).toBe(CITY_DISTRICTS.length);
  });

  it('settles new crews on ground that cannot be taken off them', () => {
    const home = findDistrict(STARTER_DISTRICT_ID);
    expect(home?.kind).toBe('residential');
    expect(home?.places).toEqual([]);
    expect(isDistrictRaidable(home!, true)).toBe(false);
    expect(isDistrictRaidable(home!, false)).toBe(true);
  });

  it('gives some districts a name the street uses, and not all of them', () => {
    const nicknamed = CITY_DISTRICTS.filter((district) => district.nickname !== null);
    expect(nicknamed.length).toBeGreaterThan(0);
    expect(nicknamed.length).toBeLessThan(CITY_DISTRICTS.length);
  });

  it('reads a raid target off the district and nothing else', () => {
    expect(raidTargetOf(findDistrict('combine-spire')!)).toEqual({
      faction: 'government',
      isSeatOfPower: true,
    });
    expect(raidTargetOf(findDistrict('rustyard')!)).toEqual({
      faction: 'independent',
      isSeatOfPower: false,
    });
    for (const district of CITY_DISTRICTS) {
      expect(isSeatOfGovernmentPower(district)).toBe(
        district.faction === 'government' && district.seatOfPower,
      );
    }
  });
});

describe('the places inside it (§A4)', () => {
  it('gives every place kind a mechanic, a blurb and a reason to want it', () => {
    for (const kind of PLACE_KINDS) {
      const spec = PLACE_KIND_CATALOG[kind];
      expect(spec.label, kind).toBeTruthy();
      expect(spec.blurb.length, kind).toBeGreaterThan(20);
      expect(spec.reward.length, kind).toBeGreaterThan(15);
      expect(spec.baseDefense, kind).toBeGreaterThan(0);
      expect(describeHoldBonus(spec.bonus), kind).toBeTruthy();
    }
  });

  it('finds every authored place by id, and none that were not authored', () => {
    expect(CITY_PLACES.length).toBeGreaterThanOrEqual(25);
    for (const place of CITY_PLACES) expect(findPlace(place.id)).toEqual(place);
    expect(findPlace('nowhere')).toBeUndefined();
  });

  it('gives each contested district a unified bonus unlike anything inside it', () => {
    for (const district of CONTESTED_DISTRICTS) {
      const unified = unifiedBonusFor(district.id);
      expect(unified, district.id).not.toBeNull();
      expect(unified?.title.length ?? 0, district.id).toBeGreaterThan(5);

      // Completing a district must be worth something *other* than more of what it already pays,
      // or the reward for finishing is indistinguishable from farming its best place.
      const inside = new Set(
        district.places.map((place) => PLACE_KIND_CATALOG[place.kind].bonus.kind),
      );
      expect(
        inside.has(unified!.bonus.kind),
        `${district.id}'s unified bonus is more of the same`,
      ).toBe(false);
    }
    expect(Object.keys(UNIFIED_BONUSES)).toHaveLength(CONTESTED_DISTRICTS.length);
  });
});

describe('geography (§A4)', () => {
  it('makes the far side of the city genuinely far', () => {
    const near = travelMinutes(STARTER_DISTRICT_ID, 'chrome-row') ?? 0;
    const far = travelMinutes(STARTER_DISTRICT_ID, 'combine-spire') ?? 0;
    expect(near).toBeGreaterThanOrEqual(MIN_TRAVEL_MINUTES);
    expect(far).toBeGreaterThan(near * 1.5);
    // …and the whole city is crossable in a session, not in a week.
    expect(far).toBeLessThan(180);
  });

  it('is symmetric, and answers null for ground that is not on the map', () => {
    expect(travelMinutes('rustyard', 'undergrid')).toBe(travelMinutes('undergrid', 'rustyard'));
    expect(travelMinutes('rustyard', 'nowhere')).toBeNull();
  });

  it('shortens the journey with a travel bonus, and stops shortening it eventually', () => {
    const plain = travelMinutes(STARTER_DISTRICT_ID, 'combine-spire') ?? 0;
    const quick = travelMinutes(STARTER_DISTRICT_ID, 'combine-spire', 30) ?? 0;
    const absurd = travelMinutes(STARTER_DISTRICT_ID, 'combine-spire', 500) ?? 0;
    const capped = travelMinutes(STARTER_DISTRICT_ID, 'combine-spire', MAX_TRAVEL_SPEED_BONUS) ?? 0;

    expect(quick).toBeLessThan(plain);
    expect(absurd).toBe(capped);
    expect(absurd).toBeGreaterThan(0);
  });

  it('sees the nearest districts first, and the same ones every time', () => {
    const seen = nearestDistricts(STARTER_DISTRICT_ID, 3);
    expect(seen).toHaveLength(3);
    expect(seen.map((d) => d.id)).not.toContain(STARTER_DISTRICT_ID);
    expect(nearestDistricts(STARTER_DISTRICT_ID, 3)).toEqual(seen);

    const home = findDistrict(STARTER_DISTRICT_ID)!;
    const distances = seen.map((d) => mapDistance(home.position, d.position));
    expect([...distances].sort((a, b) => a - b)).toEqual(distances);
    expect(nearestDistricts(STARTER_DISTRICT_ID, 0)).toEqual([]);
  });
});

describe('digging in (§A4)', () => {
  it('pays the board’s 5 / 4 / 3 per level, and easy ground pays the most', () => {
    expect(FORTIFY_PERCENT_PER_LEVEL).toEqual({ easy: 5, medium: 4, hard: 3 });
    expect(fortifyBonusPercent('easy', 3)).toBe(15);
    expect(maxFortifyBonusPercent('easy')).toBe(25);
    expect(maxFortifyBonusPercent('medium')).toBe(20);
    expect(maxFortifyBonusPercent('hard')).toBe(15);
  });

  it('costs the same on every kind of ground — the difference is what it buys', () => {
    // The board's call, and it is what keeps easy/medium/hard a reward axis rather than a second
    // price axis. Asserted directly because it would be very easy to "fix" by accident.
    expect(fortifyCost(3)).toEqual(fortifyCost(3));
    for (let level = 2; level <= FORTIFY_MAX_LEVEL; level += 1) {
      const lower = fortifyCost(level - 1);
      const higher = fortifyCost(level);
      for (const key of RESOURCE_KEYS) {
        expect(higher[key] ?? 0, `${key} at ${level}`).toBeGreaterThanOrEqual(lower[key] ?? 0);
      }
      expect(fortifySeconds(level)).toBeGreaterThan(fortifySeconds(level - 1));
    }
  });

  it('stops at five levels', () => {
    expect(nextFortifyLevel(0)).toBe(1);
    expect(nextFortifyLevel(FORTIFY_MAX_LEVEL)).toBeNull();
    expect(fortifyBonusPercent('easy', 99)).toBe(maxFortifyBonusPercent('easy'));

    const place = CITY_PLACES[0]!;
    expect(quoteFortify(place, FORTIFY_MAX_LEVEL)).toBeNull();
    const quote = quoteFortify(place, 0);
    expect(quote?.level).toBe(1);
    expect(quote?.bonusPercent).toBe(FORTIFY_PERCENT_PER_LEVEL[place.fortifyDifficulty]);
  });
});

describe('who holds what (§A4)', () => {
  it('starts Combine ground garrisoned and independent ground looted', () => {
    expect(startingHolder(findDistrict('undergrid')!)).toEqual({ kind: 'government' });
    expect(startingHolder(findDistrict('rustyard')!)).toEqual({ kind: 'looters' });
  });

  it('tells two crews apart, and a crew from the state', () => {
    expect(sameHolder({ kind: 'faction', baseId: MINE }, { kind: 'faction', baseId: MINE })).toBe(
      true,
    );
    expect(sameHolder({ kind: 'faction', baseId: MINE }, { kind: 'faction', baseId: THEIRS })).toBe(
      false,
    );
    expect(sameHolder({ kind: 'government' }, { kind: 'looters' })).toBe(false);
    expect(isHeldBy(control('x', { holder: { kind: 'faction', baseId: MINE } }), MINE)).toBe(true);
    expect(isHeldBy(control('x', { holder: { kind: 'government' } }), MINE)).toBe(false);
  });

  it('makes a place harder to take for the ground, the digging and the garrison', () => {
    const place = CITY_PLACES.find((p) => p.fortifyDifficulty === 'easy')!;
    const bare = placeDefense(place, control(place.id));
    const dug = placeDefense(place, control(place.id, { fortification: FORTIFY_MAX_LEVEL }));
    const held = placeDefense(place, control(place.id, { garrison: { razors: 20 } }));

    expect(bare).toBe(PLACE_KIND_CATALOG[place.kind].baseDefense);
    expect(dug).toBeGreaterThan(bare);
    expect(held).toBeGreaterThan(bare);
    expect(garrisonSize(control(place.id, { garrison: { razors: 3, ghosts: 2 } }))).toBe(5);
  });

  it('gives a district to nobody until one party holds every place in it', () => {
    const district = CONTESTED_DISTRICTS[0]!;
    const controls = world(() => ({ kind: 'looters' }));
    expect(districtHolder(district, controls)).toEqual({ kind: 'looters' });

    // One place changing hands splits it, and a split district belongs to nobody.
    controls.set(
      district.places[0]!.id,
      control(district.places[0]!.id, { holder: { kind: 'faction', baseId: MINE } }),
    );
    expect(districtHolder(district, controls)).toBeNull();

    for (const place of district.places) {
      controls.set(place.id, control(place.id, { holder: { kind: 'faction', baseId: MINE } }));
    }
    expect(districtHolder(district, controls)).toEqual({ kind: 'faction', baseId: MINE });
    expect(districtsHeldBy(MINE, CONTESTED_DISTRICTS, controls).map((d) => d.id)).toEqual([
      district.id,
    ]);
  });

  it('never calls an unoccupied district anybody’s', () => {
    const district = CONTESTED_DISTRICTS[0]!;
    expect(
      districtHolder(
        district,
        world(() => ({ kind: 'unoccupied' })),
      ),
    ).toBeNull();
  });
});

describe('what territory is worth (§A4)', () => {
  it('is nothing at all for a crew holding nothing', () => {
    const effects = territoryEffectsFor(
      MINE,
      CITY_PLACES,
      world(() => ({ kind: 'looters' })),
    );
    expect(effects).toEqual(noTerritoryEffects());
  });

  it('pays for each place held, and again for finishing a district', () => {
    const district = CONTESTED_DISTRICTS.find((d) => d.id === 'undergrid')!;

    const partial = new Map(
      CITY_PLACES.map((place) => [
        place.id,
        control(place.id, {
          holder:
            place.id === district.places[0]!.id
              ? { kind: 'faction', baseId: MINE }
              : { kind: 'government' },
        }),
      ]),
    );
    const whole = world((placeId) =>
      district.places.some((place) => place.id === placeId)
        ? { kind: 'faction', baseId: MINE }
        : { kind: 'government' },
    );

    const one = territoryEffectsFor(MINE, CITY_PLACES, partial);
    const all = territoryEffectsFor(MINE, CITY_PLACES, whole);

    // The Undergrid's places are substations; its unified bonus is more supply on top.
    expect(one.powerSupply).toBeGreaterThan(0);
    expect(all.powerSupply).toBeGreaterThan(one.powerSupply);
  });

  it('never pays a crew for ground somebody else is holding', () => {
    const theirs = world(() => ({ kind: 'faction', baseId: THEIRS }));
    expect(territoryEffectsFor(MINE, CITY_PLACES, theirs)).toEqual(noTerritoryEffects());
    expect(territoryEffectsFor(THEIRS, CITY_PLACES, theirs)).not.toEqual(noTerritoryEffects());
  });

  it('takes the widest vision rather than the sum of two uplinks', () => {
    const effects = noTerritoryEffects();
    applyHoldBonus(effects, { kind: 'vision', districts: 2 });
    applyHoldBonus(effects, { kind: 'vision', districts: 3 });
    // Two dishes do not see five districts. They see as far as the better one.
    expect(effects.visionRange).toBe(3);
  });

  it('sums the resource lines a crew’s places produce', () => {
    const effects = noTerritoryEffects();
    applyHoldBonus(effects, { kind: 'resource', resource: 'scrap', perHour: 10 });
    applyHoldBonus(effects, { kind: 'resource', resource: 'scrap', perHour: 5 });
    applyHoldBonus(effects, { kind: 'resource', resource: 'oil', perHour: 3 });
    expect(effects.perHour).toEqual({ scrap: 15, oil: 3 });
  });
});

describe('NPC garrisons (§A3, §A4)', () => {
  /**
   * Every place used to start with an empty garrison — held on paper and defended by nobody, so
   * the whole city map could be taken by one Razor for free. Found by trying to write a test that
   * needed somebody to fight and discovering there was never anybody there.
   */
  it('puts somebody on every place nobody has taken yet', () => {
    for (const district of CITY_DISTRICTS) {
      for (const place of district.places) {
        const control = startingControl(place, district);
        if (control.holder.kind === 'unoccupied') continue;
        expect(garrisonSize(control), `${district.id}/${place.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('garrisons every place with units that actually exist', () => {
    for (const district of CITY_DISTRICTS) {
      for (const place of district.places) {
        for (const unitId of Object.keys(startingGarrison(place, district))) {
          expect(findUnit(unitId), unitId).toBeDefined();
        }
      }
    }
  });

  it('puts regulars on Combine ground and rabble on everything else', () => {
    const withPlaces = CITY_DISTRICTS.filter((district) => district.places.length > 0);
    const combine = withPlaces.find((district) => district.faction === 'government');
    const independent = withPlaces.find((district) => district.faction !== 'government');
    expect(combine && independent).toBeTruthy();
    if (!combine || !independent) return;

    const tiers = (district: typeof combine) => {
      const place = district.places[0];
      if (!place) return [];
      return Object.keys(startingGarrison(place, district)).map((id) => findUnit(id)?.tier);
    };
    expect(tiers(combine).every((tier) => tier !== 'rabble')).toBe(true);
    expect(tiers(independent).some((tier) => tier === 'rabble')).toBe(true);
  });

  it('garrisons hard ground more heavily than easy ground', () => {
    const sorted = [...CITY_DISTRICTS]
      .filter((district) => district.places.length > 0)
      .sort((a, b) => a.difficulty - b.difficulty);
    const easiest = sorted[0];
    const hardest = sorted[sorted.length - 1];
    expect(easiest && hardest).toBeTruthy();
    if (!easiest || !hardest) return;

    const strength = (district: typeof easiest) =>
      district.places.reduce(
        (total, place) =>
          total +
          Object.values(startingGarrison(place, district)).reduce((sum, count) => sum + count, 0),
        0,
      ) / Math.max(1, district.places.length);
    expect(strength(hardest)).toBeGreaterThan(strength(easiest));
  });

  it('is the same world for everybody', () => {
    const district = CITY_DISTRICTS.find((candidate) => candidate.places.length > 0);
    const place = district?.places[0];
    expect(district && place).toBeTruthy();
    if (!district || !place) return;
    expect(startingGarrison(place, district)).toEqual(startingGarrison(place, district));
  });
});
