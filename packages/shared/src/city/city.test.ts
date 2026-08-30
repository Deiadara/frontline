import { describe, expect, it } from 'vitest';
import { findUnit } from '../units/index.js';
import { RESOURCE_KEYS } from '../resources.js';
import {
  CITY_DISTRICTS,
  CITY_LOCATIONS,
  CONTESTED_DISTRICTS,
  RESIDENTIAL_DISTRICTS,
  districtDisplayName,
  sameDistrictName,
  isReservedDistrictName,
  BOT_DISTRICT_ID,
  STARTER_DISTRICT_ID,
  UNIFIED_BONUSES,
  findDistrict,
  findLocation,
  isDistrictRaidable,
  isSeatOfGovernmentPower,
  raidTargetOf,
  unifiedBonusFor,
} from './districts.js';
import {
  LOCATION_KINDS,
  LOCATION_CATALOG,
  applyHoldBonus,
  describeHoldBonus,
  noTerritoryEffects,
} from './locations.js';
import {
  MAX_TRAVEL_SPEED_BONUS,
  MIN_TRAVEL_MINUTES,
  mapDistance,
  nearestDistricts,
  travelMinutes,
} from './geography.js';
import {
  FORTIFY_LEVEL_PERCENT,
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
  locationDefense,
  sameHolder,
  startingControl,
  startingHolder,
  SQUATTED_PLACES_PER_OPEN_DISTRICT,
  territoryEffectsFor,
  type LocationControl,
} from './control.js';

/**
 * The city (GDD §A4).
 *
 * Where a claim can be checked against something other than the constant that produced it, it is:
 * the unified bonus is asserted to be *different in kind* from the locations it sits over, and the
 * fortification ladder is asserted in percentages the board named rather than against the table
 * that produces them.
 */

const MINE = 'base-mine';
const THEIRS = 'base-theirs';

const control = (locationId: string, over: Partial<LocationControl> = {}): LocationControl => ({
  locationId,
  holder: { kind: 'unoccupied' },
  level: 1,
  upgradingUntil: null,
  fortification: 0,
  fortifyingUntil: null,
  garrison: {},
  ...over,
});

/** Every location in the city, held by whoever `holderOf` says. */
function world(
  holderOf: (locationId: string) => LocationControl['holder'],
): Map<string, LocationControl> {
  return new Map(
    CITY_LOCATIONS.map((location) => [
      location.id,
      control(location.id, { holder: holderOf(location.id) }),
    ]),
  );
}

describe('the map (§A4)', () => {
  it('is twelve districts: somewhere to live, and rather more to fight over', () => {
    expect(CITY_DISTRICTS).toHaveLength(12);
    expect(RESIDENTIAL_DISTRICTS.length).toBeGreaterThanOrEqual(2);
    expect(CONTESTED_DISTRICTS.length).toBeGreaterThan(RESIDENTIAL_DISTRICTS.length);
    expect(RESIDENTIAL_DISTRICTS.length + CONTESTED_DISTRICTS.length).toBe(CITY_DISTRICTS.length);
  });

  it('settles new crews on ground that cannot be taken off them', () => {
    const home = findDistrict(STARTER_DISTRICT_ID);
    expect(home?.kind).toBe('residential');
    expect(home?.locations).toEqual([]);
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
      allegiance: 'government',
      isSeatOfPower: true,
    });
    expect(raidTargetOf(findDistrict('rustyard')!)).toEqual({
      allegiance: 'independent',
      isSeatOfPower: false,
    });
    for (const district of CITY_DISTRICTS) {
      expect(isSeatOfGovernmentPower(district)).toBe(
        district.allegiance === 'government' && district.seatOfPower,
      );
    }
  });
});

describe('the locations inside it (§A4)', () => {
  it('gives every location kind a mechanic, a blurb and a reason to want it', () => {
    for (const kind of LOCATION_KINDS) {
      const spec = LOCATION_CATALOG[kind];
      expect(spec.label, kind).toBeTruthy();
      expect(spec.blurb.length, kind).toBeGreaterThan(20);
      expect(spec.reward.length, kind).toBeGreaterThan(15);
      expect(spec.baseDefense, kind).toBeGreaterThan(0);
      for (const bonus of spec.bonuses) expect(describeHoldBonus(bonus), kind).toBeTruthy();
    }
  });

  it('finds every authored location by id, and none that were not authored', () => {
    expect(CITY_LOCATIONS.length).toBeGreaterThanOrEqual(25);
    for (const location of CITY_LOCATIONS) expect(findLocation(location.id)).toEqual(location);
    expect(findLocation('nowhere')).toBeUndefined();
  });

  it('gives each contested district a unified bonus unlike anything inside it', () => {
    for (const district of CONTESTED_DISTRICTS) {
      const unified = unifiedBonusFor(district.id);
      expect(unified, district.id).not.toBeNull();
      expect(unified?.title.length ?? 0, district.id).toBeGreaterThan(5);

      // Completing a district must be worth something *other* than more of what it already pays,
      // or the reward for finishing is indistinguishable from farming its best location.
      const inside = new Set(
        district.locations.flatMap((location) =>
          LOCATION_CATALOG[location.kind].bonuses.map((bonus) => bonus.kind),
        ),
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
  it('doubles at every level, and easy ground still pays the most', () => {
    // The authored curve is medium's: 2.5 / 5 / 10. Asserted literally because it is the number
    // the screen quotes and the one a balance change would come for first.
    expect(FORTIFY_LEVEL_PERCENT.medium).toEqual([2.5, 5, 10]);
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const [one, two, three] = FORTIFY_LEVEL_PERCENT[difficulty];
      expect(two).toBe(one! * 2);
      expect(three).toBe(two! * 2);
    }
    // The board's inversion: what digging is *worth* falls as the ground gets harder.
    expect(maxFortifyBonusPercent('easy')).toBeGreaterThan(maxFortifyBonusPercent('medium'));
    expect(maxFortifyBonusPercent('medium')).toBeGreaterThan(maxFortifyBonusPercent('hard'));
    expect(maxFortifyBonusPercent('medium')).toBe(10);
  });

  it('costs the same on every kind of ground, and the top level is the one you have to mean', () => {
    // The board's call, and it is what keeps easy/medium/hard a reward axis rather than a second
    // price axis. Asserted directly because it would be very easy to "fix" by accident.
    for (let level = 2; level <= FORTIFY_MAX_LEVEL; level += 1) {
      const lower = fortifyCost(level - 1);
      const higher = fortifyCost(level);
      for (const key of RESOURCE_KEYS) {
        expect(higher[key] ?? 0, `${key} at ${level}`).toBeGreaterThanOrEqual(lower[key] ?? 0);
      }
      expect(fortifySeconds(level)).toBeGreaterThan(fortifySeconds(level - 1));
    }
    // The step, not the slope: the last level costs more than the two below it put together.
    const top = fortifyCost(FORTIFY_MAX_LEVEL);
    const below = Array.from({ length: FORTIFY_MAX_LEVEL - 1 }, (_, index) =>
      fortifyCost(index + 1),
    );
    for (const key of RESOURCE_KEYS) {
      const under = below.reduce((total, cost) => total + (cost[key] ?? 0), 0);
      if (under === 0) continue;
      expect(top[key] ?? 0, `${key} at the top level`).toBeGreaterThan(under);
    }
  });

  it('stops at three levels', () => {
    expect(FORTIFY_MAX_LEVEL).toBe(3);
    expect(nextFortifyLevel(0)).toBe(1);
    expect(nextFortifyLevel(FORTIFY_MAX_LEVEL)).toBeNull();
    expect(fortifyBonusPercent('easy', 99)).toBe(maxFortifyBonusPercent('easy'));
    expect(fortifyBonusPercent('easy', 0)).toBe(0);

    const location = CITY_LOCATIONS[0]!;
    expect(quoteFortify(location, FORTIFY_MAX_LEVEL)).toBeNull();
    const quote = quoteFortify(location, 0);
    expect(quote?.level).toBe(1);
    expect(quote?.bonusPercent).toBe(FORTIFY_LEVEL_PERCENT[location.fortifyDifficulty][0]);
  });
});

describe('who holds what (§A4)', () => {
  /**
   * The shape of the first hour, and the one thing about the map a new player actually meets.
   *
   * Every location in the city used to start held, which meant every district was **shut**: one party
   * holding all of it is what arms a gate, and the only legal move anywhere was to break a door
   * down. The split below is what replaced that: the Combine locks its ground, and independent
   * ground is squatted rather than owned.
   */
  it('shuts Combine ground and leaves independent ground open but squatted', () => {
    const combine = findDistrict('undergrid');
    const open = findDistrict('rustyard');
    expect(combine).toBeDefined();
    expect(open).toBeDefined();
    if (!combine || !open) return;

    // Every Combine location is held, which is what arms its gate.
    for (const location of combine.locations) {
      expect(startingHolder(location, combine), location.id).toEqual({ kind: 'government' });
    }

    const held = open.locations.filter(
      (location) => startingHolder(location, open).kind === 'looters',
    );
    const empty = open.locations.filter(
      (location) => startingHolder(location, open).kind === 'unoccupied',
    );
    expect(held).toHaveLength(SQUATTED_PLACES_PER_OPEN_DISTRICT);
    // ...and there is genuinely somewhere to walk onto, which is the whole point.
    expect(empty.length).toBeGreaterThan(0);

    // The squatters take the best ground, not the first ground: an empty location a new crew can
    // walk onto has to be the *cheap* one, or "open" buys them nothing.
    const defenseOf = (location: (typeof open.locations)[number]): number =>
      LOCATION_CATALOG[location.kind].baseDefense;
    expect(Math.min(...held.map(defenseOf))).toBeGreaterThanOrEqual(
      Math.max(...empty.map(defenseOf)),
    );
  });

  it('gives an unoccupied location nobody to fight', () => {
    const open = findDistrict('rustyard');
    expect(open).toBeDefined();
    if (!open) return;
    for (const location of open.locations) {
      if (startingHolder(location, open).kind !== 'unoccupied') continue;
      expect(startingGarrison(location, open), location.id).toEqual({});
    }
  });

  it('tells two crews apart, and a crew from the state', () => {
    expect(sameHolder({ kind: 'crew', baseId: MINE }, { kind: 'crew', baseId: MINE })).toBe(true);
    expect(sameHolder({ kind: 'crew', baseId: MINE }, { kind: 'crew', baseId: THEIRS })).toBe(
      false,
    );
    expect(sameHolder({ kind: 'government' }, { kind: 'looters' })).toBe(false);
    expect(isHeldBy(control('x', { holder: { kind: 'crew', baseId: MINE } }), MINE)).toBe(true);
    expect(isHeldBy(control('x', { holder: { kind: 'government' } }), MINE)).toBe(false);
  });

  it('makes a location harder to take for the ground, the digging and the garrison', () => {
    const location = CITY_LOCATIONS.find((p) => p.fortifyDifficulty === 'easy')!;
    const bare = locationDefense(location, control(location.id));
    const dug = locationDefense(
      location,
      control(location.id, { fortification: FORTIFY_MAX_LEVEL }),
    );
    const held = locationDefense(location, control(location.id, { garrison: { razors: 20 } }));

    expect(bare).toBe(LOCATION_CATALOG[location.kind].baseDefense);
    expect(dug).toBeGreaterThan(bare);
    expect(held).toBeGreaterThan(bare);
    expect(garrisonSize(control(location.id, { garrison: { razors: 3, ghosts: 2 } }))).toBe(5);
  });

  it('gives a district to nobody until one party holds every location in it', () => {
    const district = CONTESTED_DISTRICTS[0]!;
    const controls = world(() => ({ kind: 'looters' }));
    expect(districtHolder(district, controls)).toEqual({ kind: 'looters' });

    // One location changing hands splits it, and a split district belongs to nobody.
    controls.set(
      district.locations[0]!.id,
      control(district.locations[0]!.id, { holder: { kind: 'crew', baseId: MINE } }),
    );
    expect(districtHolder(district, controls)).toBeNull();

    for (const location of district.locations) {
      controls.set(location.id, control(location.id, { holder: { kind: 'crew', baseId: MINE } }));
    }
    expect(districtHolder(district, controls)).toEqual({ kind: 'crew', baseId: MINE });
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
      CITY_LOCATIONS,
      world(() => ({ kind: 'looters' })),
    );
    expect(effects).toEqual(noTerritoryEffects());
  });

  it('pays for each location held, and again for finishing a district', () => {
    const district = CONTESTED_DISTRICTS.find((d) => d.id === 'undergrid')!;

    const partial = new Map(
      CITY_LOCATIONS.map((location) => [
        location.id,
        control(location.id, {
          holder:
            location.id === district.locations[0]!.id
              ? { kind: 'crew', baseId: MINE }
              : { kind: 'government' },
        }),
      ]),
    );
    const whole = world((locationId) =>
      district.locations.some((location) => location.id === locationId)
        ? { kind: 'crew', baseId: MINE }
        : { kind: 'government' },
    );

    const one = territoryEffectsFor(MINE, CITY_LOCATIONS, partial);
    const all = territoryEffectsFor(MINE, CITY_LOCATIONS, whole);

    // The Undergrid's locations are substations; its unified bonus is more supply on top.
    expect(one.powerSupply).toBeGreaterThan(0);
    expect(all.powerSupply).toBeGreaterThan(one.powerSupply);
  });

  it('never pays a crew for ground somebody else is holding', () => {
    const theirs = world(() => ({ kind: 'crew', baseId: THEIRS }));
    expect(territoryEffectsFor(MINE, CITY_LOCATIONS, theirs)).toEqual(noTerritoryEffects());
    expect(territoryEffectsFor(THEIRS, CITY_LOCATIONS, theirs)).not.toEqual(noTerritoryEffects());
  });

  it('takes the widest vision rather than the sum of two uplinks', () => {
    const effects = noTerritoryEffects();
    applyHoldBonus(effects, { kind: 'vision', districts: 2 });
    applyHoldBonus(effects, { kind: 'vision', districts: 3 });
    // Two dishes do not see five districts. They see as far as the better one.
    expect(effects.visionRange).toBe(3);
  });

  it('sums the resource lines a crew’s locations produce', () => {
    const effects = noTerritoryEffects();
    applyHoldBonus(effects, { kind: 'resource', resource: 'scrap', perHour: 10 });
    applyHoldBonus(effects, { kind: 'resource', resource: 'scrap', perHour: 5 });
    applyHoldBonus(effects, { kind: 'resource', resource: 'oil', perHour: 3 });
    expect(effects.perHour).toEqual({ scrap: 15, oil: 3 });
  });
});

describe('NPC garrisons (§A3, §A4)', () => {
  /**
   * Every location used to start with an empty garrison: held on paper and defended by nobody, so
   * the whole city map could be taken by one Razor for free. Found by trying to write a test that
   * needed somebody to fight and discovering there was never anybody there.
   */
  it('puts somebody on every location nobody has taken yet', () => {
    for (const district of CITY_DISTRICTS) {
      for (const location of district.locations) {
        const control = startingControl(location, district);
        if (control.holder.kind === 'unoccupied') continue;
        expect(garrisonSize(control), `${district.id}/${location.id}`).toBeGreaterThan(0);
      }
    }
  });

  it('garrisons every location with units that actually exist', () => {
    for (const district of CITY_DISTRICTS) {
      for (const location of district.locations) {
        for (const unitId of Object.keys(startingGarrison(location, district))) {
          expect(findUnit(unitId), unitId).toBeDefined();
        }
      }
    }
  });

  it('puts regulars on Combine ground and rabble on everything else', () => {
    const withPlaces = CITY_DISTRICTS.filter((district) => district.locations.length > 0);
    const combine = withPlaces.find((district) => district.allegiance === 'government');
    const independent = withPlaces.find((district) => district.allegiance !== 'government');
    expect(combine && independent).toBeTruthy();
    if (!combine || !independent) return;

    /*
     * Every *garrisoned* location in the district, not the first one in the list.
     *
     * Only the best few locations in an open district are squatted at all (`squattedIn`), so
     * `locations[0]` is very often empty ground, and asserting on it made this test a statement
     * about the authoring order of one array. Adding two locations to the Rustyard was enough to
     * turn it green-to-red without a single rule changing.
     */
    const tiers = (district: typeof combine) =>
      district.locations
        .flatMap((location) => Object.keys(startingGarrison(location, district)))
        .map((id) => findUnit(id)?.tier);
    expect(tiers(combine).length).toBeGreaterThan(0);
    expect(tiers(independent).length).toBeGreaterThan(0);
    expect(tiers(combine).every((tier) => tier !== 'rabble')).toBe(true);
    expect(tiers(independent).some((tier) => tier === 'rabble')).toBe(true);
  });

  it('garrisons hard ground more heavily than easy ground', () => {
    const sorted = [...CITY_DISTRICTS]
      .filter((district) => district.locations.length > 0)
      .sort((a, b) => a.difficulty - b.difficulty);
    const easiest = sorted[0];
    const hardest = sorted[sorted.length - 1];
    expect(easiest && hardest).toBeTruthy();
    if (!easiest || !hardest) return;

    const strength = (district: typeof easiest) =>
      district.locations.reduce(
        (total, location) =>
          total +
          Object.values(startingGarrison(location, district)).reduce(
            (sum, count) => sum + count,
            0,
          ),
        0,
      ) / Math.max(1, district.locations.length);
    expect(strength(hardest)).toBeGreaterThan(strength(easiest));
  });

  it('is the same world for everybody', () => {
    const district = CITY_DISTRICTS.find((candidate) => candidate.locations.length > 0);
    const location = district?.locations[0];
    expect(district && location).toBeTruthy();
    if (!district || !location) return;
    expect(startingGarrison(location, district)).toEqual(startingGarrison(location, district));
  });
});

/**
 * The map is a location, and a location has to hold together.
 *
 * These are the two properties the layout was rebuilt for. Both are invisible in a screenshot:
 * ten markers scattered at random look exactly like ten markers arranged on purpose until you try
 * to read them, which is why they are pinned here rather than left to whoever moves a district
 * next.
 */
describe("the city's geography", () => {
  const byId = (id: string) => {
    const district = CITY_DISTRICTS.find((d) => d.id === id);
    if (!district) throw new Error(`no district ${id}`);
    return district;
  };

  /**
   * Height *is* difficulty. Not strictly, two districts may share a rung, but the correlation has
   * to be strong enough that "further up" reads as "harder" without a legend.
   */
  it('gets harder the further up the map you go', () => {
    const sorted = [...CITY_DISTRICTS].sort((a, b) => b.position.y - a.position.y);
    const difficulties = sorted.map((d) => d.difficulty);
    // Rank correlation, computed the plain way: every pair further up must be at least as hard
    // more often than not, and the ends must be unambiguous.
    let agree = 0;
    let total = 0;
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        total += 1;
        if (difficulties[j]! >= difficulties[i]!) agree += 1;
      }
    }
    expect(agree / total).toBeGreaterThan(0.85);
    // The lowest location on the map is the easiest, and the highest is the hardest. No ties allowed
    // at the ends: those two are what a player reads first.
    expect(sorted[0]?.difficulty).toBe(Math.min(...difficulties));
    expect(sorted.at(-1)?.difficulty).toBe(Math.max(...difficulties));
  });

  /** Two markers on top of each other is one district a player cannot click. */
  it('leaves room between every pair of districts', () => {
    for (const [i, a] of CITY_DISTRICTS.entries()) {
      for (const b of CITY_DISTRICTS.slice(i + 1)) {
        const gap = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
        expect(gap, `${a.id} and ${b.id} are on top of each other`).toBeGreaterThan(0.18);
      }
    }
  });

  /** The seat of the Directorate looks down the middle of the frame. */
  it('puts the Combine Spire at the top, centred', () => {
    const spire = byId('combine-spire');
    expect(spire.position.y).toBe(Math.min(...CITY_DISTRICTS.map((d) => d.position.y)));
    expect(Math.abs(spire.position.x - 0.5)).toBeLessThan(0.12);
  });

  /** ART-BIBLE §6.3: every anchor inside the plate's safe box. */
  it('keeps every district inside the map plate', () => {
    for (const district of CITY_DISTRICTS) {
      expect(district.position.x, district.id).toBeGreaterThanOrEqual(0.08);
      expect(district.position.x, district.id).toBeLessThanOrEqual(0.92);
      expect(district.position.y, district.id).toBeGreaterThanOrEqual(0.06);
      expect(district.position.y, district.id).toBeLessThanOrEqual(0.94);
    }
  });
});

/**
 * What a district is called, which for four of the twelve is not a fact about the district.
 *
 * A residential district is a plot, not a place with a history. It used to carry an authored name
 * anyway (the Terraces, the Row) and the map printed it whoever was standing there. What a plot is
 * called now depends on **who is looking**: yours carries your crew's name, live, and everybody
 * else's is a number. Both the map and the district screen read this one function so they cannot
 * disagree about what a place is called.
 */
describe('a plot is called after you, or numbered', () => {
  const residential = CITY_DISTRICTS.filter((district) => district.kind === 'residential');
  const contested = CITY_DISTRICTS.filter((district) => district.kind === 'contested');
  const mine = residential[1]!;

  it('has plots and ground to tell apart, so none of this is vacuous', () => {
    expect(residential.length).toBeGreaterThan(3);
    expect(contested.length).toBeGreaterThan(1);
  });

  it('calls your own plot after your crew, and follows a rename', () => {
    const viewer = { ownDistrictId: mine.id, ownName: 'EterosEgw' };
    expect(districtDisplayName(mine, viewer)).toBe('EterosEgw');
    expect(districtDisplayName(mine, { ...viewer, ownName: 'Something Else' })).toBe(
      'Something Else',
    );
  });

  /** The numbering runs from one with no gap in it, whichever plot happens to be yours. */
  it('numbers everybody else I, II, III, in order and without gaps', () => {
    for (const home of residential) {
      const viewer = { ownDistrictId: home.id, ownName: 'EterosEgw' };
      const others = residential.filter((district) => district.id !== home.id);
      expect(
        others.map((district) => districtDisplayName(district, viewer)),
        `viewed from ${home.id}`,
      ).toEqual(['Player District I', 'Player District II', 'Player District III']);
    }
  });

  /**
   * The point of numbering rather than naming: a stranger's crew name is not published to the
   * whole city just because they live somewhere.
   */
  it('never prints another crew’s name on their plot', () => {
    const viewer = { ownDistrictId: mine.id, ownName: 'EterosEgw' };
    for (const district of residential) {
      if (district.id === mine.id) continue;
      expect(districtDisplayName(district, viewer)).toMatch(/^Player District /);
    }
  });

  it('falls back to the plot’s own name when nobody is looking', () => {
    for (const district of residential) {
      expect(districtDisplayName(district), district.id).toMatch(/^Player District/);
    }
  });

  /**
   * The comparison has to collapse whitespace the way the *renderer* does, not the way `trim`
   * does.
   *
   * HTML collapses runs of whitespace when it lays text out, so `The  Ninth  Street  Crew` paints
   * exactly the pixels `The Ninth Street Crew` paints. A rule that only trimmed the ends called
   * them two names, let the second crew register, and put two identical tags on one map: which is
   * the whole thing `sameDistrictName` exists to stop, arriving through the middle of the string
   * instead of the ends.
   */
  it('treats names that paint the same pixels as one name', () => {
    const same = [
      'The Ninth Street Crew',
      'the ninth street crew',
      'THE NINTH STREET CREW',
      '  The Ninth Street Crew  ',
      'The  Ninth  Street  Crew',
      'The\tNinth\nStreet   Crew',
    ];
    for (const name of same) {
      expect(sameDistrictName('The Ninth Street Crew', name), name).toBe(true);
    }
    expect(sameDistrictName('The Ninth Street Crew', 'The Tenth Street Crew')).toBe(false);
    expect(sameDistrictName('Vex', 'Vexx')).toBe(false);
  });

  /** The reserved plot numbers are dodged through the same gap, so they close through it too. */
  it('reserves the plot numbers however they are spaced', () => {
    for (const name of ['Player District II', 'player  district  ii', ' PLAYER DISTRICT II ']) {
      expect(isReservedDistrictName(name), name).toBe(true);
    }
    // I..X are reserved as headroom for plots not drawn yet, so the first free one is XI.
    expect(isReservedDistrictName('Player District XI')).toBe(false);
    expect(isReservedDistrictName('The Ninth Street Crew')).toBe(false);
  });

  /** Contested ground has a name of its own and a crew never gets to overwrite it. */
  it('never lets a crew rename ground that is only being held', () => {
    const viewer = { ownDistrictId: 'rustyard', ownName: 'EterosEgw' };
    for (const district of contested) {
      expect(districtDisplayName(district, viewer), district.id).toBe(district.name);
    }
  });

  /**
   * The starter has to be a plot, and the Docks stopped being one. This is the pairing that
   * migration `0040` exists for: a crew left in a contested district owns ground that can be taken.
   */
  it('settles crews on a plot and leaves the Docks to be taken', () => {
    expect(findDistrict(STARTER_DISTRICT_ID)?.kind).toBe('residential');
    expect(findDistrict(BOT_DISTRICT_ID)?.kind).toBe('residential');
    expect(STARTER_DISTRICT_ID).not.toBe(BOT_DISTRICT_ID);
    expect(findDistrict('neon-docks')?.kind).toBe('contested');
    expect(findDistrict('neon-docks')?.locations.length).toBeGreaterThan(0);
  });
});
