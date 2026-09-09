import {
  columnSpeed,
  fittedFor,
  findUnit,
  findVehicle,
  unitColumnSpeed,
  type Army,
  type ColumnUnit,
  type Fleet,
  type UnitLoadouts,
  type VehicleSpec,
} from '@frontline/shared';

/**
 * What a column moves at, and who it is waiting for (§C3).
 *
 * The **number** is `columnSpeed`'s and is never recomputed here: one authority for the pace, so a
 * screen can never quote a clock the server disagrees with. What this adds is the **name**, which
 * the shared function has no reason to return: "45" on its own tells a player nothing they can act
 * on, and "held to 45 by 12 Scavengers walking" tells them to leave the Scavengers at home or
 * build something with more seats.
 *
 * Naming the group means knowing who got a seat, so {@link seat} runs the shared function's own
 * loading rules a second time for the two facts it has no reason to return: who is left on foot,
 * and which machines have somebody in them. All three rules are load-bearing for the *name*, and
 * the third is the one that is easy to leave out: **nobody boards a machine slower than their own
 * legs**. Left out, a Scrappy on 65 in front of two Road Reavers on 65 reads as "Held to 65 by the
 * Scrappy" while the Scrappy is carrying nobody and the Reavers are riding their own bikes, and a
 * crew is told to buy a faster machine when the yard was never the thing holding them.
 *
 * ## The sheet this reads a unit off
 *
 * The **workshop's refit**, because the armour line *takes speed away*: Scrap Plate is -2, Hardshell
 * Rig is -3. `battle/movement.ts` folds `fittedFor(base.unitLoadouts, unitId)` into every group's
 * speed, so a column with a Hardshell Rig on its slowest unit really is slower than the catalogue
 * says, and a screen reading the printed sheet quotes a road the crew then overruns. That is the
 * one direction these quotes may not be wrong in: they are all labelled *at most*.
 *
 * Not folded, and it can only ever make the road **shorter**, so the bound holds: the crew's
 * `unitSpeedPercent` (the Skate Ground, an officer's Speed) and its `travelSpeedPercent`. Neither
 * is on `BattleView` or `MissionsResponse`, and the only endpoint that carries a fold containing
 * one, `GET /overseer/me`, carries the *crew* half without the ground's, so it would not answer the
 * Skate Ground either. The place for them is the payloads these screens already read.
 */
export interface ColumnRead {
  /** 0 to 100. Spend it with `roadMinutes` or `travelMinutes`, never as a percentage off a clock. */
  speed: number;
  /** The group moving at exactly that pace, in the player's words, or null for an empty column. */
  heldBy: string | null;
}

/** One unit type in a column: how many, what they are called, and what `columnSpeed` asks of them. */
interface ColumnGroup {
  count: number;
  name: string;
  speed: number;
  rides: boolean;
}

/**
 * The seats spent exactly as `columnSpeed` spends them, kept rather than thrown away.
 *
 * Three rules, all of them the shared function's (`building/vehicles.ts`): machines are filled
 * **fastest first**, seats go to the **slowest** riders first, and **nobody boards a machine
 * slower than their own legs**, since a seat that costs a body twenty points of pace is a seat it
 * declines. A machine that ends up with nobody in it stops the fill: every machine behind it is
 * slower still, so it would carry nobody either.
 */
function seat(
  fleet: Fleet,
  groups: readonly ColumnGroup[],
): { walking: ColumnGroup[]; carrying: VehicleSpec[] } {
  const boarding = groups
    .filter((group) => group.rides)
    .map((group) => ({ ...group }))
    .sort((a, b) => a.speed - b.speed);
  const machines = Object.entries(fleet)
    .flatMap(([id, count]) => {
      const spec = findVehicle(id);
      return spec === undefined ? [] : Array.from({ length: count ?? 0 }, () => spec);
    })
    .sort((a, b) => b.speed - a.speed);

  const carrying: VehicleSpec[] = [];
  for (const machine of machines) {
    let seats = machine.capacity;
    let carried = 0;
    for (const group of boarding) {
      if (seats === 0) break;
      // `boarding` is slowest first, so the first group this machine cannot outrun is also the
      // last: nobody behind it would take a seat on it either.
      if (group.speed >= machine.speed) break;
      const aboard = Math.min(seats, group.count);
      group.count -= aboard;
      seats -= aboard;
      carried += aboard;
    }
    if (carried === 0) break;
    carrying.push(machine);
  }

  // A sheet that refuses to ride never reached `boarding` at all, so it walks by construction
  // rather than by running out of room.
  return {
    walking: [
      ...boarding.filter((group) => group.count > 0),
      ...groups.filter((group) => !group.rides),
    ],
    carrying,
  };
}

/**
 * The pace of a force, and the group it belongs to.
 *
 * `loadouts` is the crew's brackets (`Base.unitLoadouts`), required rather than defaulted: every
 * screen that quotes a column has a base on it, and a default would let the next caller quote the
 * printed sheet without noticing that the armour line moves it.
 */
export function readColumn(fleet: Fleet, force: Army, loadouts: UnitLoadouts): ColumnRead {
  const speedOf = (unitId: string): ColumnUnit =>
    unitColumnSpeed(unitId, { fitted: fittedFor(loadouts, unitId) });
  const groups: ColumnGroup[] = Object.entries(force)
    .filter(([, count]) => count > 0)
    .map(([unitId, count]) => ({
      count,
      name: findUnit(unitId)?.name ?? unitId,
      ...speedOf(unitId),
    }));
  if (groups.length === 0) return { speed: 0, heldBy: null };

  const speed = columnSpeed(fleet, force, speedOf);
  const { walking, carrying } = seat(fleet, groups);

  const onFoot = walking.find((group) => group.speed === speed);
  if (onFoot) return { speed, heldBy: `${onFoot.count} ${onFoot.name} walking` };

  // Nobody walks at the column's pace, so a machine with somebody in it is what holds it. Only the
  // machines that actually took anybody are candidates: one parked at home, or one every rider
  // declined, is not what the column is waiting for.
  const machine = carrying.find((spec) => spec.speed === speed);
  return { speed, heldBy: machine === undefined ? null : `the ${machine.name}` };
}

/** `Held to 45 by 12 Scavengers walking`, or the pace alone when nothing can be named. */
export function heldToLine(read: ColumnRead): string {
  return read.heldBy === null
    ? `Rides at ${read.speed}`
    : `Held to ${read.speed} by ${read.heldBy}`;
}
