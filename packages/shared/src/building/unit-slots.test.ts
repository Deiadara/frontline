import { describe, expect, it } from 'vitest';
import {
  CITY_LOCATIONS,
  LOCATION_CATALOG,
  MAX_LOCATION_LEVEL,
  bonusesAt,
  noTerritoryEffects,
  territoryEffectsFor,
} from '../city/index.js';
import { UNIT_CATALOG, findUnit } from '../units/index.js';
import { HOUSING_BASE, unitSlotCapacity } from './production.js';
import {
  UNIT_SLOTS_PER_LOCATION,
  UNIT_SLOTS_PER_LOCATION_LEVEL,
  districtUnitSlotCapacity,
  unitSlotCostOf,
  unitSlotDraw,
} from './unit-slots.js';
import type { Building } from './state.js';

const build = (kind: Building['kind'], level: number): Building => ({
  id: `b-${kind}`,
  kind,
  level,
  modifications: [],
  damage: 0,
});

const noGround = noTerritoryEffects();

describe('what a district can house (§A1)', () => {
  it('houses somebody with nothing built at all', () => {
    expect(districtUnitSlotCapacity([], noGround)).toBe(HOUSING_BASE);
    expect(HOUSING_BASE).toBeGreaterThan(0);
  });

  it('rises with the Quarters, every level of them', () => {
    let last = districtUnitSlotCapacity([], noGround);
    for (const level of [1, 5, 10, 20]) {
      const next = districtUnitSlotCapacity([build('quarters', level)], noGround);
      expect(next, `quarters ${level}`).toBeGreaterThan(last);
      last = next;
    }
  });

  it('adds whatever the ground is worth, on top of the buildings', () => {
    const built = [build('quarters', 6)];
    expect(districtUnitSlotCapacity(built, { unitSlotBonus: 60 })).toBe(
      unitSlotCapacity(built) + 60,
    );
  });

  /** A negative fold would be a way to *lose* beds by holding ground. Floored, not trusted. */
  it('never lets a negative ground figure take beds away', () => {
    expect(districtUnitSlotCapacity([], { unitSlotBonus: -500 })).toBe(HOUSING_BASE);
  });

  /**
   * §B5: the maintainer's rule, through the real fold: taking a location is worth twenty people, and
   * a few locations are worth a good deal more on top.
   */
  it('pays twenty for any location held, and more for the ones people live on', () => {
    expect(held(PLAIN.id)).toBe(UNIT_SLOTS_PER_LOCATION);
    expect(held(CAMP.id)).toBeGreaterThan(UNIT_SLOTS_PER_LOCATION);
  });

  /**
   * §A4: the flat twenty is for the block, and every level above the first adds three beds.
   *
   * The two are separate terms on purpose. If the twenty scaled, holding a fresh location would be
   * worth less than it is today and every existing crew's ceiling would move under them; if the
   * per-level beds were folded into the twenty, forty fresh locations would house as many people
   * as one worked one. Written as literals so a retune of either constant has to come past here.
   */
  it('adds three beds a level on top of the flat twenty, and nothing at level one', () => {
    expect(UNIT_SLOTS_PER_LOCATION_LEVEL).toBe(3);
    expect(held(PLAIN.id, 1)).toBe(20);
    expect(held(PLAIN.id, 2)).toBe(23);
    expect(held(PLAIN.id, 4)).toBe(29);
    expect(held(PLAIN.id, MAX_LOCATION_LEVEL)).toBe(47);
  });

  /**
   * §A4: a location that houses people scales *that* separately, on the ordinary bonus curve.
   *
   * The Fence Camp's own 50 is a hold bonus like any other and goes up with `LEVEL_SCALE`, so at
   * the ceiling it is 275. The flat 20 underneath it does not move, and the per-level beds are the
   * same three a Scrap Press gets. Three terms, three curves, and the sum is checked against the
   * parts so a change to any one of them cannot hide inside the total.
   */
  it('scales a housing location on its own curve, over and above the other two terms', () => {
    const own = (level: number): number =>
      bonusesAt('refugee_camp', level).reduce(
        (sum, bonus) => sum + (bonus.kind === 'unit_slots' ? bonus.flat : 0),
        0,
      );
    expect([own(1), own(4), own(MAX_LOCATION_LEVEL)]).toEqual([50, 125, 275]);

    expect(held(CAMP.id, 1)).toBe(70);
    expect(held(CAMP.id, 4)).toBe(154);
    expect(held(CAMP.id, MAX_LOCATION_LEVEL)).toBe(322);
    for (const level of [1, 4, MAX_LOCATION_LEVEL]) {
      expect(held(CAMP.id, level), `level ${level}`).toBe(held(PLAIN.id, level) + own(level));
    }
  });
});

const CAMP = CITY_LOCATIONS.find((location) => location.kind === 'refugee_camp')!;
/** A location the catalogue gives no beds of its own, so only the two flat terms are in play. */
const PLAIN = CITY_LOCATIONS.find(
  (location) =>
    !LOCATION_CATALOG[location.kind].bonuses.some((bonus) => bonus.kind === 'unit_slots'),
)!;

/** What one location held at `level`, and nothing else, is worth in beds. */
const held = (locationId: string, level = 1): number =>
  territoryEffectsFor(
    'mine',
    CITY_LOCATIONS,
    new Map([
      [
        locationId,
        {
          locationId,
          holder: { kind: 'crew' as const, baseId: 'mine' },
          level,
          upgradingUntil: null,
          fortification: 0,
          fortifyingUntil: null,
          garrison: {},
        },
      ],
    ]),
  ).unitSlotBonus;

describe('who is drawing on it', () => {
  const crew = {
    commanders: [{ id: 'o1' }, { id: 'o2' }],
    army: { razors: 6, juggernauts: 2 },
    trainingQueue: [],
    fleet: {},
  };

  /**
   * §A1 as the maintainer rewrote it on 2026-09-15: everything the crew keeps is in one pool.
   *
   * The army and the bench at their slots, the officers at one bed each, the yard at one bed each.
   * Written as the sum of its four parts rather than as a literal, so a retune of any one term
   * cannot hide inside the total.
   */
  it('charges the army, the bench, the officers and the yard, all four', () => {
    const draw = unitSlotDraw(crew);
    expect(draw.officers).toBe(2);
    expect(draw.army).toBe(6 * unitSlotCostOf('razors') + 2 * unitSlotCostOf('juggernauts'));
    expect(draw.total).toBe(draw.officers + draw.army + draw.training + draw.fleet);
  });

  /** One bed each, whoever they are: an officer is one person whatever their sheet says. */
  it('charges one bed for every officer on the books', () => {
    const none = unitSlotDraw({ ...crew, commanders: [] });
    expect(crew.commanders.length).toBe(2);
    expect(unitSlotDraw(crew).total - none.total).toBe(2);
  });

  /**
   * One bed each, whichever machine: the Heli Porter seats twelve and the Scrappy seats two, and
   * the yard has to find room for one thing either way.
   */
  it('charges one bed for every machine in the yard, whatever it seats', () => {
    const empty = unitSlotDraw(crew).total;
    expect(unitSlotDraw({ ...crew, fleet: { motorcycle: 3 } }).total - empty).toBe(3);
    expect(unitSlotDraw({ ...crew, fleet: { heli_porter: 1 } }).total - empty).toBe(1);
    expect(unitSlotDraw({ ...crew, fleet: { motorcycle: 2, heli_porter: 1 } }).total - empty).toBe(
      3,
    );
  });

  /** Ground is not a hiding place: a garrison three districts away is still somebody you feed. */
  it('counts a garrison standing out in the city', () => {
    const home = unitSlotDraw(crew);
    const away = unitSlotDraw({ ...crew, garrison: { razors: 4 } });
    expect(away.army - home.army).toBe(4 * unitSlotCostOf('razors'));
  });

  it('is worth nothing for a unit id nothing answers to', () => {
    expect(unitSlotCostOf('a_unit_that_was_retired')).toBe(0);
  });
});

/**
 * A machine ordered onto the units' bench is housed from the moment it is ordered.
 *
 * The bench builds both since 2026-09-15, so a machine spends time in the queue the way a unit
 * does. It has to be charged there or the pool would say there was room right up to the read that
 * delivered it, which is the same defect `unitSlotsQueued` was written to close for units. Charged
 * once, not twice: what is on the bench is `count - delivered`, and what has landed is in the yard.
 */
describe('a machine on the bench', () => {
  const order = (unitId: string, count: number, delivered: number) => ({
    id: `order-${unitId}`,
    unitId,
    count,
    delivered,
    startedAt: '2026-09-15T12:00:00.000Z',
    durationSeconds: 1800,
    paid: {},
  });

  it('takes its bed at order time, and hands it to the yard on delivery', () => {
    const queued = unitSlotDraw({
      commanders: [],
      army: {},
      trainingQueue: [order('motorcycle', 1, 0)],
      fleet: {},
    });
    expect(queued.training).toBe(1);
    expect(queued.fleet).toBe(0);

    const landed = unitSlotDraw({
      commanders: [],
      army: {},
      trainingQueue: [],
      fleet: { motorcycle: 1 },
    });
    expect(landed.training).toBe(0);
    expect(landed.fleet).toBe(1);
    expect(landed.total).toBe(queued.total);
  });

  /**
   * A batch counts what is still owed, not what was ordered.
   *
   * `/garage/build` writes orders of one today, so this is a guard rather than a live case: the day
   * the bench takes a batch of machines, reading `count` would charge the delivered part twice,
   * once in the yard and once here. That is exactly the defect `unitSlotsQueued` closed for units,
   * and it is cheaper to pin now than to find later.
   */
  it('charges a part-delivered batch for what is still owed', () => {
    const draw = unitSlotDraw({
      commanders: [],
      army: {},
      trainingQueue: [order('motorcycle', 4, 1)],
      fleet: { motorcycle: 1 },
    });
    expect(draw.training, 'three still owed').toBe(3);
    expect(draw.fleet, 'one handed over').toBe(1);
    expect(draw.total, 'four beds for four machines, not five').toBe(4);
  });

  /** The bench holds units and machines at once, and each is counted on its own terms. */
  it('counts units at their slots and machines at one, in the same queue', () => {
    const razors = findUnit('razors');
    if (!razors) throw new Error('fixture: no razors');
    const draw = unitSlotDraw({
      commanders: [],
      army: {},
      trainingQueue: [order('razors', 4, 0), order('scrap_car', 1, 0)],
      fleet: {},
    });
    expect(draw.training).toBe(4 * razors.unitSlots + 1);
  });
});

/**
 * The board's design rule for the merged pool, as an assertion rather than an intention.
 *
 * "If something is five times as strong as another unit, it might take up four times the
 * unit slots, giving it an advantage." So the heavy end of the roster has to be *efficient* per
 * bed, or a maxed district is an ocean of Razors and nothing else. Strength is taken as the crude
 * product a fight actually turns on: how hard it hits and how long it stands.
 */
describe('what a unit costs against the pool (§A1)', () => {
  const strength = (id: string): number => {
    const unit = findUnit(id)!;
    return unit.stats.offense * unit.stats.vitality;
  };
  const perBed = (id: string): number => strength(id) / unitSlotCostOf(id);

  it('pays a heavy unit more strength per bed than the cheapest thing on the street', () => {
    expect(perBed('juggernauts')).toBeGreaterThan(perBed('razors'));
    expect(perBed('the_colossus')).toBeGreaterThan(perBed('razors'));
  });

  it('holds across the roster: nothing in the catalogue is free, and the trend is upward', () => {
    for (const unit of UNIT_CATALOG) {
      expect(unitSlotCostOf(unit.id), unit.id).toBeGreaterThan(0);
    }
    const rabble = UNIT_CATALOG.filter((unit) => unit.tier === 'rabble');
    const legends = UNIT_CATALOG.filter((unit) => unit.tier === 'legendary');
    const mean = (units: typeof UNIT_CATALOG) =>
      units.reduce((total, unit) => total + perBed(unit.id), 0) / units.length;
    expect(mean(legends)).toBeGreaterThan(mean(rabble));
  });
});

/**
 * A batch that is halfway home is counted once, not twice.
 *
 * `splitDueTraining` hands a batch over one unit at a time and leaves the order on the bench with
 * `delivered` moved up and `count` unchanged. Each delivered unit joins `base.army`, so reading the
 * whole `count` here counted the delivered part in both places. The peak over-count is one unit
 * short of the whole batch, and the total is what gates further orders and what the roster prints
 * as free beds.
 */
describe('a training batch that is part way home', () => {
  const razors = findUnit('razors');
  if (!razors) throw new Error('fixture: no razors');

  const order = (count: number, delivered: number) => ({
    id: 'order-1',
    unitId: 'razors',
    count,
    delivered,
    startedAt: '2026-08-14T12:00:00.000Z',
    durationSeconds: 1000,
    paid: {},
  });

  it('counts only what has still to arrive', () => {
    const draw = (delivered: number, arrived: number) =>
      unitSlotDraw({
        commanders: [],
        army: arrived === 0 ? {} : { razors: arrived },
        trainingQueue: [order(10, delivered)],
        fleet: {},
      });

    // Nothing delivered: the whole batch is still owed.
    expect(draw(0, 0).total).toBe(10 * razors.unitSlots);
    // Four landed: four in the army, six still owed, and the total has not moved.
    expect(draw(4, 4).total).toBe(10 * razors.unitSlots);
    // Nine landed, which is where the old expression peaked at 19 for ten units.
    expect(draw(9, 9).total).toBe(10 * razors.unitSlots);
  });

  it('never charges a crew more than the batch it ordered', () => {
    for (let delivered = 0; delivered <= 50; delivered++) {
      const draw = unitSlotDraw({
        commanders: [],
        army: delivered === 0 ? {} : { razors: delivered },
        trainingQueue: [order(50, delivered)],
        fleet: {},
      });
      expect(draw.total, `${delivered} delivered`).toBe(50 * razors.unitSlots);
    }
  });
});
