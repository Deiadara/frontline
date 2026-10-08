import { describe, expect, it } from 'vitest';
import { findUnit } from '../units/index.js';
import { COMBINE_LEADERS, combineSlotBudget } from './combine.js';
import {
  CITY_DISTRICTS,
  CITY_LOCATIONS,
  CONTESTED_DISTRICTS,
  DistrictSchema,
  RESIDENTIAL_DISTRICTS,
  districtDisplayName,
  sameDistrictName,
  isReservedDistrictName,
  isPaintableDistrictName,
  BOT_DISTRICT_ID,
  STARTER_DISTRICT_ID,
  UNIFIED_BONUSES,
  // Ashfall's own lookups. This file is Ashfall's map held to its shape, and the world-wide
  // versions moved to `atlas.ts` when the second city opened.
  findAshfallDistrict as findDistrict,
  findAshfallLocation as findLocation,
  garrisonOf,
  isContested,
  isDistrictRaidable,
  isSeatOfGovernmentPower,
  raidTargetOf,
} from './districts.js';
import { ALL_DISTRICTS, unifiedBonusFor } from './atlas.js';
import { DistrictNameSchema } from '../base.js';
import { hastenedMinutes } from '../missions.js';
import { musterSecondsFor } from '../units/muster.js';
import {
  LOCATION_KINDS,
  LOCATION_CATALOG,
  applyHoldBonus,
  describeHoldBonus,
  noTerritoryEffects,
} from './locations.js';
import { MIN_TRAVEL_MINUTES, travelMinutes } from './geography.js';
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
  COMBINE_UNOCCUPIED,
  SQUATTED_PLACES,
  missionSpeedPercentIn,
  territoryEffectsFor,
  type LocationControl,
} from './control.js';

/**
 * The city (GDD §A4).
 *
 * Where a claim can be checked against something other than the constant that produced it, it is:
 * the unified bonus is asserted to be *different in kind* from the locations it sits over.
 */

const MINE = 'base-mine';
const THEIRS = 'base-theirs';

const control = (locationId: string, over: Partial<LocationControl> = {}): LocationControl => ({
  locationId,
  holder: { kind: 'unoccupied' },
  level: 1,
  upgradingUntil: null,
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
    expect(raidTargetOf(findDistrict('ccs')!)).toEqual({
      allegiance: 'government',
      isSeatOfPower: true,
    });
    // Chrome Row: the Steelbelt is the Combine's since 2026-09-19.
    expect(raidTargetOf(findDistrict('chrome-row')!)).toEqual({
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

describe('what a location says about itself (maintainer, 2026-09-15)', () => {
  const blacksite = findDistrict('blacksite')!;

  /**
   * `z.object` strips keys it was not told about. The district schema used to carry its own copy
   * of the location fields, so a blurb added to `LocationSchema` alone would have parsed cleanly
   * on the client and arrived as `undefined` on every sheet.
   */
  it('keeps a location’s own blurb through the district schema', () => {
    const parsed = DistrictSchema.parse(blacksite);
    for (const location of parsed.locations) {
      expect(location.blurb, location.id).toBe(
        blacksite.locations.find((one) => one.id === location.id)?.blurb,
      );
      expect(location.blurb, location.id).toBeTruthy();
    }
  });

  it('gives every Blacksite location its own line, none of them the kind’s', () => {
    const lines = new Set<string>();
    for (const location of blacksite.locations) {
      const blurb = location.blurb ?? '';
      expect(blurb.length, location.id).toBeGreaterThan(40);
      expect(blurb.trim().endsWith('.'), location.id).toBe(true);
      expect(blurb, location.id).not.toBe(LOCATION_CATALOG[location.kind].blurb);
      lines.add(blurb);
    }
    expect(lines.size).toBe(blacksite.locations.length);
  });

  it('renamed three holds and kept their ids, so nothing persisted moved', () => {
    expect(findLocation('blacksite-motorpool')?.name).toBe('Motor Pool');
    expect(findLocation('blacksite-blackward')?.name).toBe('Psychic Ward');
    expect(findLocation('blacksite-pit17')?.name).toBe('Robot Pit');
    // The new names are what the descriptions follow: minds behind the glass, machines in the ring.
    expect(findLocation('blacksite-blackward')?.blurb).toMatch(/minds/);
    expect(findLocation('blacksite-pit17')?.blurb).toMatch(/[Mm]achines/);
  });

  it('puts the Glasshouses on the Green Belt, on a kind that pays supplies', () => {
    const glasshouses = findLocation('glasshouse-fields-glasshouses');
    expect(glasshouses?.kind).toBe('glasshouse');
    expect(glasshouses?.blurb).toMatch(/glass/);
    expect(LOCATION_CATALOG.glasshouse.bonuses).toContainEqual(
      expect.objectContaining({ kind: 'resource', resource: 'supplies' }),
    );
    expect(findDistrict('glasshouse-fields')?.locations).toHaveLength(8);
  });

  // A location without a line is not a hole: everything outside the Blacksite still parses.
  it('leaves the blurb optional for ground authored without one', () => {
    const docks = findDistrict('neon-docks')!;
    expect(docks.locations.every((location) => location.blurb === undefined)).toBe(true);
    expect(() => DistrictSchema.parse(docks)).not.toThrow();
  });
});

describe('geography (§A4)', () => {
  it('makes the far side of the city genuinely far', () => {
    const near = travelMinutes(STARTER_DISTRICT_ID, 'chrome-row') ?? 0;
    const far = travelMinutes(STARTER_DISTRICT_ID, 'ccs') ?? 0;
    expect(near).toBeGreaterThanOrEqual(MIN_TRAVEL_MINUTES);
    expect(far).toBeGreaterThan(near * 1.5);
    // …and the whole city is crossable in a session, not in a week.
    expect(far).toBeLessThan(180);
  });

  it('is symmetric, and answers null for ground that is not on the map', () => {
    expect(travelMinutes('steelbelt', 'undergrid')).toBe(travelMinutes('undergrid', 'steelbelt'));
    expect(travelMinutes('steelbelt', 'nowhere')).toBeNull();
  });

  it('shortens the journey with a travel bonus, less and less, and never to nothing', () => {
    const to = (pace?: { speed?: number; reductionPercent?: number }) =>
      travelMinutes(STARTER_DISTRICT_ID, 'ccs', pace) ?? 0;
    const plain = to();
    const quick = to({ reductionPercent: 30 });
    const absurd = to({ reductionPercent: 500 });

    expect(quick).toBeLessThan(plain);
    expect(absurd).toBeLessThanOrEqual(quick);
    // Bent under its ceiling (2026-10-05): a quarter of the road always stays.
    expect(absurd).toBeGreaterThanOrEqual(Math.floor(plain / 4));
  });

  /**
   * The two halves of a road, and that they compose rather than one swallowing the other.
   *
   * Speed divides and the ground's reduction multiplies what is left, so a column at 100 halves
   * the walk and a crew holding the ground then takes its percentage off that half. Reading both
   * as one summed percentage, the way this used to, made a Rail Yard worth the same as a
   * helicopter. The exact arithmetic is pinned in `time/speed.test.ts`; what this asks is that the
   * map is wired to it in the right order.
   */
  it('divides by the column speed and then takes the ground off what is left', () => {
    const to = (pace?: { speed?: number; reductionPercent?: number }) =>
      travelMinutes(STARTER_DISTRICT_ID, 'ccs', pace) ?? 0;
    const plain = to();
    // Within a minute of the exact figure: the map rounds once at the end, so a 61-minute walk
    // halves to 30 rather than to 30.5.
    const within = (minutes: number, exact: number) => Math.abs(minutes - exact) <= 1;
    expect(to({ speed: 0, reductionPercent: 0 })).toBe(plain);
    expect(within(to({ speed: 100 }), plain / 2)).toBe(true);
    expect(within(to({ speed: 100, reductionPercent: 10 }), (plain / 2) * 0.9)).toBe(true);
    // Neither channel is worth nothing, and the pair beats either alone.
    expect(to({ speed: 30 })).toBeLessThan(plain);
    expect(to({ speed: 100, reductionPercent: 10 })).toBeLessThan(to({ speed: 100 }));
    expect(to({ speed: 100, reductionPercent: 10 })).toBeLessThan(to({ reductionPercent: 10 }));
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
    const combine = findDistrict('annexes');
    const open = findDistrict('chrome-row');
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
    // Chrome Row is the one open district the squatters hold *half* of (maintainer, 2026-09-19).
    expect(held).toHaveLength(SQUATTED_PLACES['chrome-row'] ?? 0);
    expect(held).toHaveLength(open.locations.length / 2);
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

  /**
   * The three exceptions the maintainer wrote into the map on 2026-09-19, each a different
   * shape of ground and each pinned by name so a retune of the default cannot move it.
   */
  it('hands the Undergrid to the looters whole, with its gate shut', () => {
    const undergrid = findDistrict('undergrid');
    if (!undergrid) throw new Error('no undergrid');
    expect(undergrid.allegiance).toBe('independent');
    for (const location of undergrid.locations) {
      expect(startingHolder(location, undergrid), location.id).toEqual({ kind: 'looters' });
      expect(
        Object.keys(startingGarrison(location, undergrid)).length,
        location.id,
      ).toBeGreaterThan(0);
    }
  });

  it('leaves the Fence Camp and its market empty, so the Glasshouse gate is down', () => {
    const fields = findDistrict('glasshouse-fields');
    if (!fields) throw new Error('no glasshouse');
    expect(fields.allegiance).toBe('government');
    const holders = Object.fromEntries(
      fields.locations.map((location) => [location.id, startingHolder(location, fields).kind]),
    );
    expect(holders['glasshouse-fields-fence']).toBe('unoccupied');
    expect(holders['glasshouse-fields-fieldgate']).toBe('unoccupied');
    // ...and the other six are the Combine's, or the district would be nobody's.
    expect(Object.values(holders).filter((kind) => kind === 'government')).toHaveLength(
      fields.locations.length - 2,
    );
    for (const id of COMBINE_UNOCCUPIED) {
      expect(startingGarrison(findLocation(id)!, fields)).toEqual({});
    }
  });

  it('is the Combine on six districts and the looters on two', () => {
    const contested = CITY_DISTRICTS.filter((district) => district.kind === 'contested');
    const combine = contested.filter((d) => d.allegiance === 'government').map((d) => d.id);
    const independent = contested.filter((d) => d.allegiance !== 'government').map((d) => d.id);
    expect(combine.sort()).toEqual(
      ['neon-docks', 'steelbelt', 'glasshouse-fields', 'annexes', 'blacksite', 'ccs'].sort(),
    );
    expect(independent.sort()).toEqual(['chrome-row', 'undergrid'].sort());
  });

  it('gives an unoccupied location nobody to fight', () => {
    const open = findDistrict('steelbelt');
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

  it('makes a location harder to take for the ground and the garrison', () => {
    const location = CITY_LOCATIONS[0]!;
    const bare = locationDefense(location, control(location.id));
    const held = locationDefense(location, control(location.id, { garrison: { razors: 20 } }));

    expect(bare).toBe(LOCATION_CATALOG[location.kind].baseDefense);
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

    // The Undergrid's locations are substations with fuel bunkers behind them; its unified bonus
    // is faster building on top (§A1 re-pointed the substations at oil when the grid went).
    expect(one.perHour.oil ?? 0).toBeGreaterThan(0);
    expect(all.buildSpeedPercent).toBeGreaterThan(one.buildSpeedPercent);
  });

  it('never pays a crew for ground somebody else is holding', () => {
    const theirs = world(() => ({ kind: 'crew', baseId: THEIRS }));
    expect(territoryEffectsFor(MINE, CITY_LOCATIONS, theirs)).toEqual(noTerritoryEffects());
    expect(territoryEffectsFor(THEIRS, CITY_LOCATIONS, theirs)).not.toEqual(noTerritoryEffects());
  });

  /*
   * A mission cut scoped to a district (the Printworks' tunnels) lands in the district channel and
   * pays on that board alone; the Blockhouse, which paid a city-scoped cut until it went over to
   * ANTI-COMBINE (maintainer 2026-10-07), pays no clock at all.
   */
  it('pays a district-scoped mission cut on one board, and the Blockhouse in ANTI-COMBINE', () => {
    const blockhouse = ALL_DISTRICTS.find((d) => d.id === 'blockhouse')!;
    const everywhere = ALL_DISTRICTS.flatMap((d) => d.locations);
    const held = new Map(
      everywhere.map((location) => [
        location.id,
        {
          locationId: location.id,
          holder:
            location.districtId === blockhouse.id
              ? ({ kind: 'crew', baseId: MINE } as const)
              : ({ kind: 'government' } as const),
          level: 1,
          upgradingUntil: null,
          garrison: {},
        } satisfies LocationControl,
      ]),
    );
    const effects = territoryEffectsFor(MINE, everywhere, held);
    // The Blockhouse held whole is a level of ANTI-COMBINE now, and no mission cut at all.
    expect(effects.antiCombineLevels).toBe(1);
    expect(effects.missionSpeedPercent).toBe(0);
    const terminusWork = ALL_DISTRICTS.find(
      (d) => d.cityId === blockhouse.cityId && d.id !== blockhouse.id && d.kind === 'contested',
    )!;
    const ashfallWork = CONTESTED_DISTRICTS[0]!;
    expect(ashfallWork.cityId).not.toBe(blockhouse.cityId);
    expect(missionSpeedPercentIn(effects, terminusWork.id)).toBe(0);
    // One district's board, and no other, for a cut scoped to it.
    applyHoldBonus(
      effects,
      { kind: 'mission_speed', percent: 11, inDistrict: true },
      { districtId: terminusWork.id },
    );
    expect(missionSpeedPercentIn(effects, terminusWork.id)).toBe(11);
    expect(missionSpeedPercentIn(effects, blockhouse.id)).toBe(0);
    expect(missionSpeedPercentIn(effects, ashfallWork.id)).toBe(0);
    // And a bonus that pays everywhere still does, on every board.
    const global = applyHoldBonus(noTerritoryEffects(), { kind: 'mission_speed', percent: 10 });
    expect(missionSpeedPercentIn(global, ashfallWork.id)).toBe(10);
    expect(missionSpeedPercentIn(global, terminusWork.id)).toBe(10);
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

  /**
   * The ladder `combineSlotBudget`'s own doc quotes, measured (bug pass, 2026-09-20).
   *
   * The comment on that constant is where a reader goes to find out how thin the Docks' gate is
   * before opening the game, and four of its six figures were a retune out of date: it said 6, 12,
   * 19 and 53 against the 10, 15, 22 and 54 the function returns, so the first Combine gate a new
   * crew meets was described as two thirds of what it is. Pinned here rather than left as prose,
   * because prose cannot fail.
   */
  it('stands the Combine on the ladder its own doc quotes', () => {
    const at = (difficulty: number) => combineSlotBudget(difficulty, 5);
    expect([1, 2, 3, 6, 8, 10].map(at)).toEqual([10, 15, 22, 54, 83, 118]);
  });

  /**
   * One curve for both parties (maintainer, 2026-09-29): a looter plot stands exactly the slots
   * the Combine would on the same ground, so a difficulty number means one thing whoever holds
   * it. The looters were on a head count of their own, `1.2 * difficulty + 0.9 * baseDefense`,
   * which stood 12 on the Undergrid's Laundry Stair against a budget of 44. The real-engine walk
   * that shows the ladder climbing is `apps/server/src/city/difficulty-ladder.test.ts`.
   */
  it('stands the looters on the Combine’s slot budget, each in its own units', () => {
    const slotsOf = (garrison: Record<string, number>) =>
      Object.entries(garrison).reduce(
        (total, [unitId, count]) => total + count * (findUnit(unitId)?.unitSlots ?? NaN),
        0,
      );
    const looterPlots = ALL_DISTRICTS.filter(isContested).flatMap((district) =>
      district.locations
        .filter((location) => startingHolder(location, district).kind === 'looters')
        .map((location) => ({ district, location })),
    );
    expect(looterPlots.length).toBeGreaterThan(20);
    for (const { district, location } of looterPlots) {
      const garrison = startingGarrison(location, district);
      const budget = combineSlotBudget(
        district.difficulty,
        LOCATION_CATALOG[location.kind].baseDefense,
      );
      expect(slotsOf(garrison), location.id).toBe(budget);
      expect(Object.keys(garrison).sort(), location.id).toEqual(['razors', 'scrapers']);
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

  it('puts the Combine on Combine ground and the player roster on everything else', () => {
    const withPlaces = CITY_DISTRICTS.filter((district) => district.locations.length > 0);
    const combine = withPlaces.filter((district) => district.allegiance === 'government');
    const independent = withPlaces.filter((district) => district.allegiance !== 'government');
    expect(combine.length).toBeGreaterThan(0);
    expect(independent.length).toBeGreaterThan(0);

    /*
     * Every *garrisoned* location in the district, not the first one in the list.
     *
     * Only the best few locations in an open district are squatted at all (`squattedIn`), so
     * `locations[0]` is very often empty ground, and asserting on it made this test a statement
     * about the authoring order of one array.
     */
    const units = (district: (typeof combine)[number]) =>
      district.locations
        .flatMap((location) => Object.keys(startingGarrison(location, district)))
        .map((id) => findUnit(id));
    for (const district of combine) {
      const standing = units(district);
      expect(standing.length, district.id).toBeGreaterThan(0);
      // The regime fields its own people and nobody else's (`UnitSpec.faction`).
      expect(
        standing.every((unit) => unit?.faction === 'combine'),
        district.id,
      ).toBe(true);
    }
    for (const district of independent) {
      const standing = units(district);
      expect(standing.length, district.id).toBeGreaterThan(0);
      expect(
        standing.every((unit) => unit !== undefined && unit.faction === undefined),
        district.id,
      ).toBe(true);
      expect(
        standing.some((unit) => unit?.tier === 'rabble'),
        district.id,
      ).toBe(true);
    }
  });

  /**
   * The ladder the maintainer set (2026-09-19): Levy on the cheapest ground, Greycoats behind
   * them, Enforcers from the Annexes, Suppressors from the Blacksite, all of it in the CCS. Pinned
   * by district rather than by difficulty band, so a retune of a district's difficulty that moved
   * its garrison up a rung is noticed.
   */
  it('steps the Combine garrison up the districts the maintainer named', () => {
    const faces = (id: string): string[] => {
      const district = findDistrict(id);
      if (!district) throw new Error(id);
      return [
        ...new Set(
          district.locations.flatMap((location) =>
            Object.keys(startingGarrison(location, district)),
          ),
        ),
      ].sort();
    };
    // The Docks: conscripts only, and the lightest gate in the game.
    expect(faces('neon-docks')).toEqual(['civic_levy']);
    expect(faces('steelbelt')).toEqual(['civic_levy', 'greycoat']);
    expect(faces('glasshouse-fields')).toEqual(['civic_levy', 'greycoat']);
    expect(faces('annexes')).toEqual(['greycoat', 'street_enforcers', 'syndic']);
    expect(faces('blacksite')).toEqual(['executioner', 'street_enforcers', 'suppressor']);
    expect(faces('ccs')).toEqual(['directive_xero', 'greycoat', 'street_enforcers', 'suppressor']);
  });

  it('stands each leader on his own plot, once, and nowhere else', () => {
    for (const leader of COMBINE_LEADERS) {
      // Across the world, not Ashfall: Arca's three command Arca (2026-10-07), and the
      // Ashfall-only lookups this file reads by default found neither their district nor their plot.
      const district = ALL_DISTRICTS.find((one) => one.id === leader.districtId);
      const plot = district?.locations.find((one) => one.id === leader.locationId);
      if (!district || !plot) throw new Error(leader.unitId);
      expect(plot.districtId).toBe(leader.districtId);
      expect(startingGarrison(plot, district)[leader.unitId]).toBe(1);
      for (const other of district.locations.filter((one) => one.id !== plot.id)) {
        expect(startingGarrison(other, district)[leader.unitId], other.id).toBeUndefined();
      }
    }
    // ...and the sentence on the district screen names the units that actually stand there.
    for (const district of ALL_DISTRICTS) {
      if (district.kind !== 'contested' || district.allegiance !== 'government') continue;
      const words = garrisonOf(district);
      const standing = new Set(
        district.locations.flatMap((location) => Object.keys(startingGarrison(location, district))),
      );
      if (standing.has('suppressor')) expect(words, district.id).toMatch(/Suppressor/);
      if (standing.has('street_enforcers')) expect(words, district.id).toMatch(/Enforcer/);
      if (standing.has('civic_levy')) expect(words, district.id).toMatch(/Levy/);
    }
  });

  it('garrisons hard ground more heavily than easy ground', () => {
    const sorted = [...CONTESTED_DISTRICTS].sort((a, b) => a.difficulty - b.difficulty);
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
   * to be strong enough that "further up" reads as "harder" without a legend. Contested ground only:
   * a plot has no difficulty (maintainer, 2026-09-30).
   */
  it('gets harder the further up the map you go', () => {
    const sorted = [...CONTESTED_DISTRICTS].sort((a, b) => b.position.y - a.position.y);
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

  /** The seat of the Combine looks down the middle of the frame. */
  it('puts the Combine Spire at the top, centred', () => {
    const spire = byId('ccs');
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
 * called now is **whoever lives there**: your crew's name on yours, live, the resident's on
 * everybody else's, and `Unclaimed Player District` on an empty one (maintainer, 2026-10-06; they
 * were numbered I, II, III before). Both the map and the district screen read this one function so
 * they cannot disagree about what a place is called.
 */
describe('a plot is called after whoever lives there', () => {
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

  it('calls another crew’s plot after that crew', () => {
    const viewer = { ownDistrictId: mine.id, ownName: 'EterosEgw', residentName: 'The Tenth' };
    for (const district of residential) {
      if (district.id === mine.id) continue;
      expect(districtDisplayName(district, viewer)).toBe('The Tenth');
    }
    // Your own plot is yours whatever the city read says is living there.
    expect(districtDisplayName(mine, viewer)).toBe('EterosEgw');
  });

  it('calls an empty plot unclaimed, whoever is looking', () => {
    const viewer = { ownDistrictId: mine.id, ownName: 'EterosEgw', residentName: null };
    for (const district of residential) {
      if (district.id === mine.id) continue;
      expect(districtDisplayName(district, viewer)).toBe('Unclaimed Player District');
      expect(districtDisplayName(district), district.id).toBe('Unclaimed Player District');
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

  /** The empty plot's name is dodged through the same gap, so it closes through it too. */
  it('reserves the empty plot’s name however it is spaced', () => {
    for (const name of [
      'Unclaimed Player District',
      'unclaimed  player  district',
      ' UNCLAIMED PLAYER DISTRICT ',
    ]) {
      expect(isReservedDistrictName(name), name).toBe(true);
    }
    expect(isReservedDistrictName('Player District')).toBe(false);
    expect(isReservedDistrictName('The Ninth Street Crew')).toBe(false);
  });

  /** Contested ground has a name of its own and a crew never gets to overwrite it. */
  it('never lets a crew rename ground that is only being held', () => {
    const viewer = { ownDistrictId: 'steelbelt', ownName: 'EterosEgw' };
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

describe('a crew name a reader can actually tell apart', () => {
  const ZERO_WIDTH = '\u200b';
  const RTL_OVERRIDE = '\u202e';
  const FULLWIDTH_N = '\uff2e';

  it('treats a zero-width character as no character at all', () => {
    // U+200B is not matched by `\s`, survives `trim()`, and paints nothing, so a second crew
    // called "Ninth Street" is indistinguishable on the map, in every report and in every listing.
    expect(sameDistrictName('Ninth Street', `N${ZERO_WIDTH}inth Street`)).toBe(true);
    expect(sameDistrictName('Ninth Street', `${ZERO_WIDTH}Ninth Street${ZERO_WIDTH}`)).toBe(true);
  });

  it('does not let an invisible character take a reserved plot name', () => {
    expect(isReservedDistrictName('Unclaimed Player District')).toBe(true);
    expect(isReservedDistrictName(`Unclaimed${ZERO_WIDTH} Player District`)).toBe(true);
  });

  it('folds compatibility forms, which paint the same word', () => {
    expect(sameDistrictName('Ninth Street', `${FULLWIDTH_N}inth Street`)).toBe(true);
  });

  it('refuses a name made of characters that do not paint', () => {
    expect(isPaintableDistrictName('Ninth Street')).toBe(true);
    expect(isPaintableDistrictName(`N${ZERO_WIDTH}inth Street`)).toBe(false);
    expect(isPaintableDistrictName(`${RTL_OVERRIDE}Ninth Street`)).toBe(false);
    expect(isPaintableDistrictName('A\nB')).toBe(false);
    expect(isPaintableDistrictName('A B')).toBe(true);
  });

  it('is refused by the schema every name arrives through', () => {
    expect(DistrictNameSchema.safeParse('Ninth Street').success).toBe(true);
    expect(DistrictNameSchema.safeParse(`N${ZERO_WIDTH}inth Street`).success).toBe(false);
    expect(DistrictNameSchema.safeParse('A\nB').success).toBe(false);
  });
});

/**
 * A card that quotes a time saving has to quote the saving, not the channel.
 *
 * Every speed channel is spent as `time / (1 + percent/100)`, and three of the four clamp the input
 * first. Printing the raw percentage as a reduction in time overstated it at every level and the
 * error grew with the level a player had paid for: a Smuggler's Tunnel at 10 read "-66% mission
 * time" against a real saving of 33%.
 */
describe('what a card promises against what the clock does', () => {
  const saving = (minutes: number, after: number) => Math.round((1 - after / minutes) * 100);

  it('quotes the mission saving the launch actually applies', () => {
    // Level 10 Smuggler's Tunnel: 12 scaled by LEVEL_SCALE[9] to 66, bent to about 49 at the launch.
    expect(describeHoldBonus({ kind: 'mission_speed', percent: 66 })).toBe(
      '-33% mission time (tapers, no hard stop)',
    );
    expect(saving(60, hastenedMinutes(60, 66))).toBe(33);
  });

  it('quotes the muster saving the bench actually applies', () => {
    const razors = findUnit('razors');
    if (!razors) throw new Error('fixture: no razors');
    const card = describeHoldBonus({ kind: 'muster_speed', percent: 90 });
    const real = saving(musterSecondsFor(razors, 1, 0), musterSecondsFor(razors, 1, 90));
    expect(card).toBe(`-${real}% muster time`);
  });

  it('quotes a research saving that is a divisor, not a subtraction, even with no clamp', () => {
    // 1 - 1/1.12 = 10.7%, not 12%.
    // Points since 2026-10-02 (P7-A): they join a curved sum, so a share of the clock is not theirs.
    expect(describeHoldBonus({ kind: 'research_speed', percent: 12 })).toBe(
      '+12 points off the research clock',
    );
    expect(describeHoldBonus({ kind: 'build_speed', percent: 12 })).toBe(
      '+12 points off the build clock',
    );
  });

  // The two that print points (research and build speed) promise no share of the clock.
  it('never promises a saving of a hundred percent or more', () => {
    for (const percent of [50, 100, 200, 500, 1000]) {
      for (const kind of ['muster_speed', 'mission_speed']) {
        const text = describeHoldBonus({ kind, percent } as Parameters<
          typeof describeHoldBonus
        >[0]);
        const quoted = Number(text.replace(/[^0-9]/g, ''));
        expect(quoted, `${kind} at ${percent}`).toBeLessThan(100);
      }
    }
  });
});
