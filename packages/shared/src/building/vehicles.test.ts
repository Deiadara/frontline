import { describe, expect, it } from 'vitest';
import { blueprintForVehicle, blueprintGateMet } from '../blueprints/index.js';
import {
  MAX_PER_VEHICLE,
  VEHICLES,
  VEHICLE_CLASSES,
  buildableVehicleIds,
  carriedSpeedPercent,
  findVehicle,
  fleetCapacity,
  loadable,
  mergeFleets,
  removeFleet,
  vehicleInfamy,
  vehicleRefusal,
  vehiclesOfClass,
  wrecked,
} from './vehicles.js';

const YES = () => true;
const NO = () => false;

/**
 * The Garage (§C).
 *
 * The rule the whole rewrite turns on is in `carriedSpeedPercent`: a machine is worth something to
 * the people **on it** and nothing at all to the yard it is parked in. Every test in the first
 * block is a different way of asking that, because the model it replaced failed exactly one of
 * them (a bike at home made every column in the game faster) and passed the rest.
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
      expect(spec.speedPercent, spec.id).toBeGreaterThan(0);
    }
  });

  /*
   * The class ladder, which is the one thing about these numbers that is a rule and not a taste.
   *
   * `vehicles.ts` opens by promising "a motorbike column is faster per body than a truck column",
   * and for a long time the table said the opposite: the War Hauler was written at 28 against the
   * Motorcycle's 22, so the biggest truck in the game outran the bike the doc used as its example,
   * and the Armoured Car at 32 beat both bikes while carrying twelve. Nothing failed, because
   * nothing asked. Every other test in this file reads its expectation out of `findVehicle`, which
   * is right for behaviour and useless here: a test derived from the table cannot catch the table
   * being wrong. These two are the independent anchor.
   */
  const fastest = (kind: (typeof VEHICLE_CLASSES)[number]): number =>
    Math.max(...vehiclesOfClass(kind).map((spec) => spec.speedPercent));
  const slowest = (kind: (typeof VEHICLE_CLASSES)[number]): number =>
    Math.min(...vehiclesOfClass(kind).map((spec) => spec.speedPercent));
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
  it('is worth nothing when nobody is riding', () => {
    expect(carriedSpeedPercent({ rotorcraft: 4 }, 0)).toBe(0);
  });

  it('is worth nothing when the yard is empty', () => {
    expect(carriedSpeedPercent({}, 40)).toBe(0);
  });

  it('pays only for the share of the force it is actually carrying', () => {
    const bike = findVehicle('motorcycle')!;
    // One bike, two seats, forty walking: two fortieths of the bike's contribution.
    expect(carriedSpeedPercent({ motorcycle: 1 }, 40)).toBe(
      Math.round((bike.speedPercent * bike.capacity) / 40),
    );
    // The same bike carrying its whole load is worth its whole number.
    expect(carriedSpeedPercent({ motorcycle: 1 }, bike.capacity)).toBe(bike.speedPercent);
  });

  it('does not pay for seats there is nobody to sit in', () => {
    const hauler = findVehicle('war_hauler')!;
    expect(carriedSpeedPercent({ war_hauler: 1 }, 4)).toBe(hauler.speedPercent);
    expect(carriedSpeedPercent({ war_hauler: 4 }, 4)).toBe(hauler.speedPercent);
  });

  it('seats the fastest machines first, so owning a truck never slows a small column', () => {
    const rotor = findVehicle('rotorcraft')!;
    const withTruck = carriedSpeedPercent({ rotorcraft: 1, flatbed: 1 }, rotor.capacity);
    expect(withTruck).toBe(rotor.speedPercent);
  });

  it('never reports more than the fastest machine on the column', () => {
    const fastest = Math.max(...VEHICLES.map((spec) => spec.speedPercent));
    for (const bodies of [1, 5, 40, 400]) {
      const full = Object.fromEntries(VEHICLES.map((spec) => [spec.id, MAX_PER_VEHICLE]));
      expect(carriedSpeedPercent(full, bodies)).toBeLessThanOrEqual(fastest);
    }
  });
});

describe('loading and unloading', () => {
  it('leaves a machine at home when there is nobody to put in it', () => {
    // Two people going, and a yard with a bike and a flatbed in it. The bike is the faster of the
    // two and it seats them both, so the flatbed stays parked rather than being marched somewhere
    // it can be destroyed for free. Fastest first is the same order `carriedSpeedPercent` seats
    // people in, which is what stops the speed quoted on the screen from being a machine that was
    // left behind.
    const taken = loadable({ motorcycle: 1, flatbed: 1 }, 2);
    expect(taken).toEqual({ motorcycle: 1 });
  });

  it('takes enough to seat everybody when there is enough to take', () => {
    const taken = loadable({ flatbed: 2 }, 30);
    expect(fleetCapacity(taken)).toBeGreaterThanOrEqual(30);
  });

  it('adds and subtracts fleets without ever going negative', () => {
    expect(mergeFleets({ motorcycle: 2 }, { motorcycle: 1, flatbed: 1 })).toEqual({
      motorcycle: 3,
      flatbed: 1,
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
    expect(wrecked({ motorcycle: 2, flatbed: 1 }, 0)).toEqual({ motorcycle: 2, flatbed: 1 });
  });

  it('wrecks a share of them on a mauling, rounded down so a scratch is never a write-off', () => {
    expect(wrecked({ motorcycle: 2 }, 0.5)).toEqual({ motorcycle: 1 });
    expect(wrecked({ flatbed: 1 }, 39 / 40)).toEqual({});
  });

  it('pays the destroyer infamy equal to what the machines could carry', () => {
    const bike = findVehicle('motorcycle')!;
    const hauler = findVehicle('war_hauler')!;
    expect(vehicleInfamy({ motorcycle: 2 })).toBe(bike.capacity * 2);
    expect(vehicleInfamy({ war_hauler: 1 })).toBe(hauler.capacity);
    // The whole reason capacity is the price: a hauler is a bigger thing to have destroyed.
    expect(vehicleInfamy({ war_hauler: 1 })).toBeGreaterThan(vehicleInfamy({ motorcycle: 1 }));
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
