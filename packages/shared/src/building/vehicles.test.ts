import { describe, expect, it } from 'vitest';
import { blueprintForVehicle, blueprintGateMet } from '../blueprints/index.js';
import { UNIT_CATALOG, findUnit } from '../units/index.js';
import {
  MAX_PER_VEHICLE,
  VEHICLES,
  VEHICLE_CLASSES,
  buildableVehicleIds,
  columnSpeed,
  effectiveVehicleSpeed,
  findVehicle,
  fleetCapacity,
  loadable,
  mergeFleets,
  removeFleet,
  vehicleInfamy,
  vehicleRefusal,
  vehiclesOfClass,
  wrecked,
  type ColumnUnit,
} from './vehicles.js';

const YES = () => true;
const NO = () => false;

/** A column-side sheet for a made-up unit, so these tests never depend on the roster's numbers. */
const walker =
  (speeds: Record<string, number>, refuses: readonly string[] = []) =>
  (unitId: string): ColumnUnit => ({
    speed: speeds[unitId] ?? 0,
    rides: !refuses.includes(unitId),
  });

/**
 * The Garage (§C).
 *
 * The rule the whole rewrite turns on is in `columnSpeed`: a machine is worth something to the
 * people **on it** and nothing at all to the yard it is parked in, and a column arrives when its
 * last people do. Every test in the first block is a different way of asking that, because the two
 * models it replaced each failed exactly one of them (a bike at home made every column in the game
 * faster; then a bike carrying two made forty walkers faster) and passed the rest.
 */

describe('the catalogue', () => {
  it('prices every machine in scrap, oil and high-quality metal and nothing else', () => {
    for (const spec of VEHICLES) {
      const priced = Object.keys(spec.cost);
      expect(priced, spec.id).toContain('scrap');
      expect(priced, spec.id).toContain('oil');
      for (const key of priced) {
        expect(['scrap', 'oil', 'highQualityMetal'], `${spec.id} prices ${key}`).toContain(key);
      }
    }
  });

  it('has every class represented and every machine in exactly one of them', () => {
    for (const kind of VEHICLE_CLASSES) {
      expect(
        VEHICLES.some((spec) => spec.class === kind),
        kind,
      ).toBe(true);
    }
  });

  it('gives every machine a real capacity and a real speed contribution', () => {
    for (const spec of VEHICLES) {
      expect(spec.capacity, spec.id).toBeGreaterThan(0);
      expect(spec.speed, spec.id).toBeGreaterThan(0);
      expect(spec.speed, spec.id).toBeLessThanOrEqual(100);
    }
  });

  /*
   * The class ladder, which is the one thing about these numbers that is a rule and not a taste.
   *
   * `vehicles.ts` opens by promising "a motorbike column is faster per body than a truck column",
   * and for a long time the table said the opposite: the biggest truck in the game was written at
   * 28 against the bike's 22, so it outran the thing the doc used as its example of the opposite,
   * and the plated saloon at 32 beat both bikes while carrying twelve. Nothing failed, because
   * nothing asked. Every other test in this file reads its expectation out of `findVehicle`, which
   * is right for behaviour and useless here: a test derived from the table cannot catch the table
   * being wrong. These two are the independent anchor.
   */
  const fastest = (kind: (typeof VEHICLE_CLASSES)[number]): number =>
    Math.max(...vehiclesOfClass(kind).map((spec) => spec.speed));
  const slowest = (kind: (typeof VEHICLE_CLASSES)[number]): number =>
    Math.min(...vehiclesOfClass(kind).map((spec) => spec.speed));
  const biggest = (kind: (typeof VEHICLE_CLASSES)[number]): number =>
    Math.max(...vehiclesOfClass(kind).map((spec) => spec.capacity));
  const smallest = (kind: (typeof VEHICLE_CLASSES)[number]): number =>
    Math.min(...vehiclesOfClass(kind).map((spec) => spec.capacity));

  it('keeps every ground class quicker than the class that carries more than it', () => {
    // The slowest bike beats the fastest car, and the slowest car beats the fastest truck: the
    // bands do not overlap, so the trade holds whichever two machines a player is choosing between.
    expect(slowest('motorbike'), 'a car keeps up with a bike').toBeGreaterThan(fastest('car'));
    expect(slowest('car'), 'a truck keeps up with a car').toBeGreaterThan(fastest('truck'));
    // Flying is the premium: over the map rather than along it, and quicker than anything on it.
    expect(slowest('flying'), 'something on the ground outruns a flyer').toBeGreaterThan(
      fastest('motorbike'),
    );
  });

  it('makes each ground class carry more than the class that outruns it', () => {
    expect(smallest('car'), 'a bike carries as much as a car').toBeGreaterThan(
      biggest('motorbike'),
    );
    expect(smallest('truck'), 'a car carries as much as a truck').toBeGreaterThan(biggest('car'));
  });

  /**
   * Within a class, the later machine is the upgrade.
   *
   * The module says so in a sentence, "more seats and a little quicker, gated on a Garage level, a
   * blueprint and a much larger bill", and nothing asked. The cross-class ladder above was the rule
   * that broke last time; this is its neighbour, and it is the one the board's two replacements
   * (the Offie for the Dirt Runner, the Cheese Wagon for the Armoured Car) both had to satisfy. A
   * class with one machine in it passes vacuously, which is correct: there is no ladder to climb.
   */
  it('makes the later machine in a class faster, bigger and dearer than the one before it', () => {
    for (const kind of VEHICLE_CLASSES) {
      const rungs = vehiclesOfClass(kind).sort(
        (a, b) => a.requiresGarageLevel - b.requiresGarageLevel,
      );
      for (let at = 1; at < rungs.length; at += 1) {
        const below = rungs[at - 1]!;
        const above = rungs[at]!;
        expect(above.requiresGarageLevel, `${above.id} vs ${below.id}`).toBeGreaterThan(
          below.requiresGarageLevel,
        );
        expect(above.capacity, `${above.id} seats no more than ${below.id}`).toBeGreaterThan(
          below.capacity,
        );
        expect(above.speed, `${above.id} is no quicker than ${below.id}`).toBeGreaterThan(
          below.speed,
        );
        // A strict upgrade has to cost strictly more, or the earlier one has no reason to exist.
        expect(above.cost.scrap ?? 0, `${above.id} is not dearer than ${below.id}`).toBeGreaterThan(
          below.cost.scrap ?? 0,
        );
        expect(above.buildSeconds, `${above.id} is not a longer build`).toBeGreaterThan(
          below.buildSeconds,
        );
      }
    }
  });

  /**
   * The Garage page lists the catalogue in one run, in the order it is written, and what a player
   * expects that order to be is the order the Garage lets them out. Independent of the table on
   * purpose: a test that sorted the table and compared would pass whatever the table said.
   */
  it('is written in the order the Garage lets them out', () => {
    const levels = VEHICLES.map((spec) => spec.requiresGarageLevel);
    for (let at = 1; at < levels.length; at += 1) {
      expect(levels[at], VEHICLES[at]!.id).toBeGreaterThanOrEqual(levels[at - 1]!);
    }
  });

  /**
   * §D12c: every machine has a document of its own, the first bike included.
   *
   * The motorcycle used to be the deliberate exception, because Road Reavers are gated on bikes
   * being buildable and the old gate was a flat item off a shelf that restocks twice a month. A
   * document is assembled out of pages a mission drops, so the exception is not needed any more,
   * and §D12b makes the sharing explicit: one document for the machine and for the crew that
   * rides it.
   */
  it('puts every machine behind a document, the first bike included', () => {
    for (const spec of VEHICLES) {
      expect(blueprintForVehicle(spec.id)?.category, spec.id).toBe('unit');
    }
    expect(blueprintForVehicle('motorcycle')?.id).toBe('bp_motorcycle');
  });
});

describe('what a column travels at (§C3)', () => {
  it('is the walkers own pace when there is nothing to ride', () => {
    expect(columnSpeed({}, { razors: 40 }, walker({ razors: 45 }))).toBe(45);
  });

  it('has no speed at all when nobody is going', () => {
    expect(columnSpeed({ rotorcraft: 4 }, {}, walker({}))).toBe(0);
    expect(columnSpeed({ rotorcraft: 4 }, { razors: 0 }, walker({ razors: 45 }))).toBe(0);
  });

  it('is the machine when everybody is on it', () => {
    const wagon = findVehicle('armoured_car')!;
    expect(
      columnSpeed({ armoured_car: 1 }, { razors: wagon.capacity }, walker({ razors: 45 })),
    ).toBe(wagon.speed);
  });

  /*
   * The whole point of the rewrite, and the one the weighted average got wrong.
   *
   * One bike, two seats, forty walking. The old model reported 36 for that column, which is the
   * bike's own number diluted, and the forty people on foot travelled at it. They do not: two
   * people arrive early and thirty-eight walk.
   */
  it('is the slowest group, not an average, when the seats do not cover the force', () => {
    expect(columnSpeed({ motorcycle: 1 }, { razors: 40 }, walker({ razors: 45 }))).toBe(45);
  });

  it('seats the slowest walkers first, which is the only way a seat raises the column', () => {
    const wagon = findVehicle('armoured_car')!; // 30 seats.
    const force = { ironsides: 20, cyber_dogs: 20 };
    const speeds = walker({ ironsides: 22, cyber_dogs: 90 });
    /*
     * Thirty seats against forty bodies. Seating the twenty Ironsides and ten of the hounds leaves
     * ten hounds walking at 90, so the column moves at the wagon's 48. Seating the *hounds* first
     * would have left ten Ironsides on foot and the column at 22, which is what a naive fill order
     * produces and is measurably worse for the crew that owns the wagon.
     */
    expect(columnSpeed({ armoured_car: 1 }, force, speeds)).toBe(wagon.speed);
    // The control: the same seats against a force one body larger than they can hold.
    expect(columnSpeed({ armoured_car: 1 }, { ironsides: 31 }, speeds)).toBe(22);
  });

  it('fills the fastest machine first, so owning a truck never slows a small column', () => {
    const rotor = findVehicle('rotorcraft')!;
    const force = { razors: rotor.capacity };
    expect(columnSpeed({ rotorcraft: 1, armoured_car: 1 }, force, walker({ razors: 45 }))).toBe(
      rotor.speed,
    );
  });

  /**
   * A seat is an offer, not an order.
   *
   * Two Cyberhounds on 90 and a Scrappy on 65 in the yard. The fill used to be unconditional, so
   * the hounds were put on the bike and the column reported 65: owning the cheapest machine in the
   * game made the fastest sheet in the game a quarter slower, and the only way to travel at the
   * pace the roster promised was to leave a bike at home. They run alongside it now.
   */
  it('never seats somebody on a machine slower than their own legs', () => {
    const bike = findVehicle('motorcycle')!;
    const speeds = walker({ cyber_dogs: 90, ironsides: 22 });
    expect(columnSpeed({ motorcycle: 1 }, { cyber_dogs: 2 }, speeds)).toBe(90);
    // Two controls on the same bike, so this cannot pass by ignoring the machine altogether: a
    // group slower than it still boards, and a group it cannot seat entirely still walks.
    expect(columnSpeed({ motorcycle: 1 }, { ironsides: 2 }, speeds)).toBe(bike.speed);
    expect(columnSpeed({ motorcycle: 1 }, { ironsides: 3 }, speeds)).toBe(22);
    // ...and the seats it does not spend on the hounds are still there for the slow group behind
    // them, which is the case a plain "skip the whole machine" would have got wrong.
    expect(columnSpeed({ motorcycle: 1 }, { cyber_dogs: 2, ironsides: 2 }, speeds)).toBe(
      bike.speed,
    );
  });

  it('wastes seats there is nobody to sit in', () => {
    const car = findVehicle('scrap_car')!;
    const wagon = findVehicle('armoured_car')!;
    // Four bodies against a yard that could seat fifty. Everybody rides the first car, so the pace
    // is that car's; the three cars behind it and the bus behind them are carrying air, and a
    // column is never held back by a machine nobody is in.
    expect(
      columnSpeed({ scrap_car: 4, armoured_car: 1 }, { razors: 4 }, walker({ razors: 45 })),
    ).toBe(car.speed);
    // The precondition, off the catalogue: the idle machines really are the slower ones, so this
    // is not passing because there was nothing for the answer to drop to.
    expect(wagon.speed).toBeLessThan(car.speed);
  });

  /**
   * The Colossus, and every sheet that ever carries `no_ride` after it.
   *
   * It never takes a seat whatever is in the yard, so it holds the column at its own 15 while the
   * rest of the force sits in a helicopter doing 95. That is the trait being a real cost rather
   * than a line of flavour on a card.
   */
  it('is dragged to the pace of a unit that will not ride', () => {
    const speeds = walker({ the_colossus: 15, razors: 45 }, ['the_colossus']);
    expect(columnSpeed({ heli_porter: 2 }, { the_colossus: 1, razors: 20 }, speeds)).toBe(15);
    // The control: the same column with the trait off boards it and moves at the machine.
    const rides = walker({ the_colossus: 15, razors: 45 });
    expect(columnSpeed({ heli_porter: 2 }, { the_colossus: 1, razors: 20 }, rides)).toBe(95);
  });

  it('never reports more than the fastest machine or the fastest walker', () => {
    const fastest = Math.max(...VEHICLES.map((spec) => spec.speed));
    const full = Object.fromEntries(VEHICLES.map((spec) => [spec.id, MAX_PER_VEHICLE]));
    for (const bodies of [1, 5, 40, 400]) {
      expect(columnSpeed(full, { razors: bodies }, walker({ razors: 45 }))).toBeLessThanOrEqual(
        fastest,
      );
    }
  });

  it('caps a machine at 100 however much is added to it', () => {
    const porter = findVehicle('heli_porter')!;
    expect(effectiveVehicleSpeed(porter)).toBe(porter.speed);
    expect(effectiveVehicleSpeed(porter, 0, 3)).toBe(98);
    expect(effectiveVehicleSpeed(porter, 0, 20)).toBe(100);
    expect(effectiveVehicleSpeed(porter, 50)).toBe(100);
  });
});

/**
 * The board's rule, and the numbers it turns on, read straight off the two catalogues.
 *
 * These are the independent anchor for the rebalance: the ladder tests above only ask that the
 * table is internally consistent, and a table that was consistently wrong would pass all of them.
 */
describe('units against machines', () => {
  const speedOf = (unitId: string): number => findUnit(unitId)!.stats.speed;
  const machines = VEHICLES.filter((spec) => spec.id !== 'heli_porter');

  it('puts the Road Reavers at exactly the speed of the bike they ride', () => {
    expect(speedOf('road_reavers')).toBe(findVehicle('motorcycle')!.speed);
  });

  /** The board named these: the sheets a machine is not an upgrade for. */
  it('puts the named exceptions above every machine but the Heli Porter', () => {
    const topOfTheYard = Math.max(...machines.map((spec) => spec.speed));
    for (const unitId of [
      'cyber_dogs',
      'kite_crews',
      'the_loose_end',
      'the_crimson_dancer',
      'the_cartographer',
      'the_specter',
    ]) {
      expect(speedOf(unitId), unitId).toBeGreaterThan(topOfTheYard);
    }
  });

  /** ...and the Heli Porter is the strongest design, so nothing on foot beats it. */
  it('leaves the Heli Porter unbeaten', () => {
    const porter = findVehicle('heli_porter')!;
    for (const unit of UNIT_CATALOG) {
      expect(unit.stats.speed, unit.id).toBeLessThanOrEqual(porter.speed);
    }
  });

  /**
   * Everybody else is slower than most of the yard, which is what makes the Garage worth building.
   *
   * The Scar is the slowest thing above a bike; a unit outside the named list that beat it would
   * be a unit the middle of the catalogue does nothing for.
   */
  it('leaves the rest of the roster slower than the Scar', () => {
    const named = new Set([
      'road_reavers',
      'cyber_dogs',
      'kite_crews',
      'the_loose_end',
      'the_crimson_dancer',
      'the_cartographer',
      'the_specter',
    ]);
    for (const unit of UNIT_CATALOG) {
      if (named.has(unit.id)) continue;
      expect(unit.stats.speed, unit.id).toBeLessThan(findVehicle('scrap_car')!.speed);
    }
  });
});

describe('loading and unloading', () => {
  it('leaves a machine at home when there is nobody to put in it', () => {
    // Two people going, and a yard with a bike and a bus in it. The bike is the faster of the two
    // and it seats them both, so the bus stays parked rather than being marched somewhere it can be
    // destroyed for free. Fastest first is the same order `columnSpeed` seats people in, which is
    // what stops the speed quoted on the screen from being a machine that was left behind.
    const taken = loadable({ motorcycle: 1, armoured_car: 1 }, 2);
    expect(taken).toEqual({ motorcycle: 1 });
  });

  it('takes enough to seat everybody when there is enough to take', () => {
    const taken = loadable({ armoured_car: 2 }, 45);
    expect(fleetCapacity(taken)).toBeGreaterThanOrEqual(45);
  });

  it('adds and subtracts fleets without ever going negative', () => {
    expect(mergeFleets({ motorcycle: 2 }, { motorcycle: 1, armoured_car: 1 })).toEqual({
      motorcycle: 3,
      armoured_car: 1,
    });
    expect(removeFleet({ motorcycle: 2 }, { motorcycle: 5 })).toEqual({});
    expect(removeFleet({ motorcycle: 2 }, { motorcycle: 1 })).toEqual({ motorcycle: 1 });
  });
});

describe('losing them (§C3)', () => {
  it('wrecks nothing when everybody walked it off', () => {
    expect(wrecked({ motorcycle: 4 }, 1)).toEqual({});
  });

  it('wrecks everything when the force was wiped', () => {
    expect(wrecked({ motorcycle: 2, armoured_car: 1 }, 0)).toEqual({
      motorcycle: 2,
      armoured_car: 1,
    });
  });

  /**
   * The Rotorcraft is the cheap way into the air, and this is what it costs.
   *
   * One machine of two wrecked, and it is the fragile one whichever way round the fleet is written
   * and whichever of the two is faster. Without the fragile ordering this picks the Heli Porter,
   * because it is quicker and the order was fastest first.
   */
  it('writes off a fragile machine before a sound one at the same share', () => {
    expect(wrecked({ rotorcraft: 1, heli_porter: 1 }, 0.5)).toEqual({ rotorcraft: 1 });
    expect(wrecked({ heli_porter: 1, rotorcraft: 1 }, 0.5)).toEqual({ rotorcraft: 1 });
    expect(findVehicle('rotorcraft')!.fragile).toBe(true);
    expect(findVehicle('heli_porter')!.fragile ?? false).toBe(false);
    // Among machines that are equally sound it is still the fastest that goes first.
    expect(wrecked({ heli_porter: 1, armoured_car: 1 }, 0.5)).toEqual({ heli_porter: 1 });
  });

  it('wrecks a share of them on a mauling, rounded down so a scratch is never a write-off', () => {
    expect(wrecked({ motorcycle: 2 }, 0.5)).toEqual({ motorcycle: 1 });
    expect(wrecked({ armoured_car: 1 }, 39 / 40)).toEqual({});
  });

  it('pays the destroyer infamy equal to what the machines could carry', () => {
    const bike = findVehicle('motorcycle')!;
    const wagon = findVehicle('armoured_car')!;
    expect(vehicleInfamy({ motorcycle: 2 })).toBe(bike.capacity * 2);
    expect(vehicleInfamy({ armoured_car: 1 })).toBe(wagon.capacity);
    // The whole reason capacity is the price: a bus is a bigger thing to have destroyed.
    expect(vehicleInfamy({ armoured_car: 1 })).toBeGreaterThan(vehicleInfamy({ motorcycle: 1 }));
    expect(vehicleInfamy({})).toBe(0);
  });
});

describe('building one', () => {
  it('lets a crew with a Garage and the drawings lay down a motorcycle', () => {
    expect(vehicleRefusal('motorcycle', {}, 1, YES, YES)).toBeNull();
  });

  it('will not build a machine without the plans, whatever the Garage is at', () => {
    expect(vehicleRefusal('rotorcraft', {}, 99, NO, YES)).toBe('needs_blueprint');
    // §D12c: the first bike is no longer the exception it used to be.
    expect(vehicleRefusal('motorcycle', {}, 99, NO, YES)).toBe('needs_blueprint');
  });

  it('refuses on the yard, the Garage, the plans and the money, in that order', () => {
    expect(vehicleRefusal('motorcycle', { motorcycle: MAX_PER_VEHICLE }, 99, NO, NO)).toBe(
      'fleet_full',
    );
    expect(vehicleRefusal('rotorcraft', {}, 1, NO, NO)).toBe('garage_too_low');
    expect(vehicleRefusal('rotorcraft', {}, 99, NO, NO)).toBe('needs_blueprint');
    expect(vehicleRefusal('motorcycle', {}, 9, YES, NO)).toBe('cannot_afford');
  });

  it('asks the satchel for the machine\u2019s own document', () => {
    const held = (vehicleId: string) =>
      blueprintGateMet({ bp_rotorcraft: 1 }, 'vehicle', vehicleId);
    expect(vehicleRefusal('rotorcraft', {}, 99, held, YES)).toBeNull();
    expect(vehicleRefusal('gas_balloon', {}, 99, held, YES)).toBe('needs_blueprint');
  });

  it('does not know what a machine outside the catalogue is', () => {
    expect(vehicleRefusal('hovercraft', {}, 99, YES, YES)).toBe('unknown_vehicle');
  });

  it('reports what the yard could turn out today, which is what gates Road Reavers', () => {
    expect(buildableVehicleIds(0, YES).has('motorcycle')).toBe(false);
    expect(buildableVehicleIds(1, YES).has('motorcycle')).toBe(true);
    expect(buildableVehicleIds(1, NO).has('motorcycle')).toBe(false);
    expect(buildableVehicleIds(99, NO).has('rotorcraft')).toBe(false);
    expect(buildableVehicleIds(99, YES).has('rotorcraft')).toBe(true);
  });
});
