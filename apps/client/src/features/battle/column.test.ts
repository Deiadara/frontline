import {
  columnSpeed,
  findUnit,
  findUpgrade,
  findVehicle,
  unitColumnSpeed,
} from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { readColumn } from './column';

/**
 * Who a column is waiting for (§C3).
 *
 * The pace itself is `columnSpeed`'s and is pinned in `building/vehicles.test.ts`; what is under
 * test here is the *name* the screens put next to it, and the one rule it turns on: seats go to the
 * slowest riders first, and a sheet that will not ride never takes one.
 *
 * Every figure is read out of the catalogue. A tuning pass that changes a speed must not turn into
 * a failing label test, which is the trap `VehiclePicker.test.tsx` was written out of.
 */

const WAGON = findVehicle('armoured_car');
const RAZORS = findUnit('razors');
const COLOSSUS = findUnit('the_colossus');

const paceOf = (fleet: Record<string, number>, force: Record<string, number>) =>
  columnSpeed(fleet, force, (unitId) => unitColumnSpeed(unitId));

describe('readColumn', () => {
  it('has no pace and nobody to blame for an empty column', () => {
    expect(readColumn({ armoured_car: 1 }, {}, {})).toEqual({ speed: 0, heldBy: null });
  });

  it('never disagrees with columnSpeed about the number', () => {
    const cases: { fleet: Record<string, number>; force: Record<string, number> }[] = [
      { fleet: {}, force: { razors: 8 } },
      { fleet: { armoured_car: 3 }, force: { razors: 8 } },
      { fleet: { armoured_car: 3 }, force: { razors: 200 } },
      { fleet: { motorcycle: 1 }, force: { razors: 8, snipers: 4 } },
      { fleet: { heli_porter: 1 }, force: { the_colossus: 1, razors: 4 } },
    ];
    for (const { fleet, force } of cases) {
      expect(readColumn(fleet, force, {}).speed, JSON.stringify(force)).toEqual(
        paceOf(fleet, force),
      );
    }
  });

  it('names the machine when everybody has a seat', () => {
    const read = readColumn({ armoured_car: 3 }, { razors: 8 }, {});
    expect(read.speed).toEqual(WAGON?.speed);
    expect(read.heldBy).toEqual(`the ${WAGON?.name}`);
  });

  it('names the walkers, and how many, once the seats run out', () => {
    const seats = 3 * (WAGON?.capacity ?? 0);
    const bodies = seats + 80;
    const read = readColumn({ armoured_car: 3 }, { razors: bodies }, {});
    // The precondition: the walkers have to be the slower group, or the machine is still the answer.
    expect(RAZORS?.stats.speed).toBeLessThan(WAGON?.speed ?? 0);
    expect(read.speed).toEqual(RAZORS?.stats.speed);
    expect(read.heldBy).toEqual(`80 ${RAZORS?.name} walking`);
  });

  it('holds the whole column at a sheet that will not board, whatever is in the yard', () => {
    // Seats for everybody twice over, and it makes no difference: the Colossus does not fit in one.
    const read = readColumn({ armoured_car: 3 }, { the_colossus: 1, razors: 4 }, {});
    expect(COLOSSUS?.stats.speed).toBeLessThan(WAGON?.speed ?? 0);
    expect(read.speed).toEqual(COLOSSUS?.stats.speed);
    expect(read.heldBy).toEqual(`1 ${COLOSSUS?.name} walking`);
  });

  /*
   * The third loading rule, which is the one a name can be built without and be wrong.
   *
   * `columnSpeed` never seats a body on a machine it can outrun, so a Scrappy in front of Road
   * Reavers, who ride at exactly the bike's own 65, carries nobody. A reader that spends the yard's
   * seats as one pool boards them anyway, and then either names the empty Scrappy as what the
   * column is waiting for, or with a quicker group finds nothing walking at the column's pace and
   * hands the screen a `heldBy` of null over a column where every last body is on foot. Both were
   * live, and the equal-speed case is the one the *number* cannot catch: 65 either way, and only
   * the name says whether anybody is on the bike.
   */
  it('does not seat anybody on a machine they can outrun, and names the walkers instead', () => {
    const bike = findVehicle('motorcycle');
    const reavers = findUnit('road_reavers');
    const hounds = findUnit('cyber_dogs');
    const ironsides = findUnit('ironsides');
    // The preconditions, off the catalogue: one group exactly as quick as the bike, one quicker,
    // one slower. Seats going spare in every case, so nothing here turns on running out of room.
    expect(reavers?.stats.speed).toEqual(bike?.speed);
    expect(hounds?.stats.speed).toBeGreaterThan(bike?.speed ?? 0);
    expect(ironsides?.stats.speed).toBeLessThan(bike?.speed ?? 0);
    expect(bike?.capacity).toBeGreaterThanOrEqual(2);

    const evens = readColumn({ motorcycle: 1 }, { road_reavers: 2 }, {});
    expect(evens.speed).toEqual(reavers?.stats.speed);
    expect(evens.heldBy).toEqual(`2 ${reavers?.name} walking`);

    const quicker = readColumn({ motorcycle: 1 }, { cyber_dogs: 2 }, {});
    expect(quicker.speed).toEqual(hounds?.stats.speed);
    expect(quicker.heldBy).toEqual(`2 ${hounds?.name} walking`);

    // The contrast, on the same bike: a group it does outrun takes the seat and is named as such,
    // so none of this passes against a reader that has stopped seating anybody at all.
    const slower = readColumn({ motorcycle: 1 }, { ironsides: 2 }, {});
    expect(slower.speed).toEqual(bike?.speed);
    expect(slower.heldBy).toEqual(`the ${bike?.name}`);
  });

  /*
   * Whatever the yard and the force are, somebody is holding the column back.
   *
   * `columnSpeed` takes its answer from the machines that carried somebody and the groups still on
   * foot, and this reader rebuilds both sets, so the pace always belongs to a group it can name.
   * An unnamed holder means the two have drifted apart, which is the failure this file exists to
   * catch before a screen prints it.
   */
  it('always has somebody to blame while anybody is going', () => {
    const fleets: Record<string, number>[] = [
      {},
      { armoured_car: 1 },
      { motorcycle: 1 },
      { motorcycle: 2, armoured_car: 1 },
      { heli_porter: 1, armoured_car: 2 },
    ];
    const forces: Record<string, number>[] = [
      { razors: 20 },
      { scrapers: 20 },
      { cyber_dogs: 3 },
      { ironsides: 12, cyber_dogs: 4 },
      { the_colossus: 1, razors: 4 },
      { razors: 200, snipers: 30 },
    ];
    for (const fleet of fleets) {
      for (const force of forces) {
        const read = readColumn(fleet, force, {});
        const where = `${JSON.stringify(fleet)} carrying ${JSON.stringify(force)}`;
        expect(read.speed, where).toEqual(paceOf(fleet, force));
        expect(read.heldBy, where).not.toBeNull();
      }
    }
  });

  /*
   * The workshop's brackets, and the one direction these quotes may not be wrong in.
   *
   * `battle/movement.ts` and `missions/launch.ts` both fold `fittedFor(base.unitLoadouts, unitId)`
   * into every group's speed, and the armour line takes speed *away*. Read off the printed sheet
   * instead, a column with a Hardshell Rig on its slowest unit is quoted faster than it moves, and
   * every one of these screens labels its clock "at most": the crew then overruns it.
   *
   * Both directions, because a reader that ignored the brackets would pass a test that only
   * checked the cybernetics line against a column already at the ceiling.
   */
  it('reads a unit off the sheet the workshop left it with, in both directions', () => {
    const armour = findUpgrade('armour_3');
    const wiring = findUpgrade('cybernetics_3');
    expect(armour?.effect.speed, 'the armour line must still cost speed').toBeLessThan(0);
    expect(wiring?.effect.speed, 'the cybernetics line must still buy speed').toBeGreaterThan(0);

    const printed = RAZORS?.stats.speed ?? 0;
    // On foot, so the column is the group's own sheet and nothing else is in the answer.
    const bare = readColumn({}, { razors: 20 }, {});
    expect(bare.speed).toEqual(printed);

    const weighed = readColumn({}, { razors: 20 }, { razors: ['armour_3'] });
    expect(weighed.speed).toEqual(printed + (armour?.effect.speed ?? 0));
    expect(weighed.heldBy).toEqual(`20 ${RAZORS?.name} walking`);

    const quickened = readColumn({}, { razors: 20 }, { razors: ['cybernetics_3'] });
    expect(quickened.speed).toEqual(printed + (wiring?.effect.speed ?? 0));

    /*
     * And it reaches the *seating*, not only the arithmetic: Road Reavers are exactly as quick as
     * the Scrappy they ride, so the Hardshell Rig's three points are what put them in its seats.
     * The pace moving from the walkers' rigged number to the bike's own is the whole of what a
     * bracket buys a road.
     */
    const bike = findVehicle('motorcycle');
    const reavers = findUnit('road_reavers');
    expect(reavers?.stats.speed, 'the Reavers must still match the bike').toEqual(bike?.speed);
    expect((reavers?.stats.speed ?? 0) + (armour?.effect.speed ?? 0)).toBeLessThan(
      bike?.speed ?? 0,
    );

    // Unrigged they decline the seat and walk at their own pace, which is the same number.
    const declined = readColumn({ motorcycle: 1 }, { road_reavers: 2 }, {});
    expect(declined.speed).toEqual(bike?.speed);
    expect(declined.heldBy).toEqual(`2 ${reavers?.name} walking`);

    const rigged = readColumn(
      { motorcycle: 1 },
      { road_reavers: 2 },
      { road_reavers: ['armour_3'] },
    );
    expect(rigged.speed).toEqual(bike?.speed);
    expect(rigged.heldBy).toEqual(`the ${bike?.name}`);
  });
});
