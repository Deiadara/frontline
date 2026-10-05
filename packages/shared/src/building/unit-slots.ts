import type { TerritoryEffects } from '../city/locations.js';
import {
  findUnit,
  unitSlotsUsed,
  unitSlotsQueued,
  type Army,
  type MusterQueue,
} from '../units/index.js';
import { findVehicle, fleetSize, type Fleet } from './vehicles.js';
import { baseUnitSlotBeds, unitSlotCapacity } from './production.js';
import type { Building } from './state.js';

/**
 * Unit slots (GDD §A1, §A4): the one pool everybody in the district draws on.
 *
 * One currency, and it is the same one a vehicle sells a seat in (`building/vehicles.ts`): a unit
 * that takes three slots of a district's housing takes three slots of a truck.
 *
 * There used to be two ceilings and they did not know about each other. The Quarters housed
 * the officers; the Gauntlet supplied an army; and a crew could fill both to the brim
 * without either noticing, so "how big is this crew" had two answers and neither was the whole
 * truth. A district that is three quarters barracks should not also have room for eighteen
 * officers, and the version with two counters could not say so.
 *
 * One pool now. The Quarters raise it and captured ground raises it, because people who work for
 * you have to sleep somewhere and the ground you hold is where the somewhere is.
 *
 * ## Everybody on the books draws on it, and so does everything in the yard
 *
 * Four terms, and every one of them is somebody or something this district has to make room for:
 * the army, the bench, the officers at **one bed each**, and the machines at **one bed each**
 * (maintainer request, 2026-09-15). The army used to be the whole of it, on the argument that
 * nineteen officers against a ceiling in the hundreds was a rounding error. The rule is now the
 * simpler one: if the crew feeds it or parks it, it is housed.
 *
 * One each rather than a rating, for both. An officer is one person whatever their sheet says, and
 * a machine is one thing in a yard however many it seats: the Heli Porter takes the same bed as
 * the Scrappy, which is what keeps the yard's own decision about *which* machine to build a
 * decision about seats and speed rather than a second housing puzzle.
 *
 * ## Why a unit costs its own slots rather than one each
 *
 * A Colossus is not one person. Every sheet carries a slot cost ({@link UnitSpec.unitSlots}) and it
 * is deliberately sub-linear against strength: a unit five times as dangerous as another tends to
 * cost four times the slots, so the heavy end of the roster is *efficient* per bed as well as
 * expensive per cap. That is the trade the maintainer asked for, and it is what stops a maxed
 * district being an ocean of Razors.
 */

/** Unit slots every held location adds, whatever it is. Ground you hold is ground people live on. */
export const UNIT_SLOTS_PER_LOCATION = 20;

/**
 * §A4: beds each *upgrade* adds, on top of the flat {@link UNIT_SLOTS_PER_LOCATION}.
 *
 * Three separate terms, and they are separate because they answer separate questions.
 *
 *   1. {@link UNIT_SLOTS_PER_LOCATION}, flat 20, for holding the block at all. Not scaled by
 *      level, deliberately: what houses people is the block, not how well the press in it runs.
 *   2. This, 3 a level above the first, because a place that has been worked up is a place more
 *      people can live and work. Charged per level rather than per location, so it is the ladder
 *      that pays it and holding forty fresh locations does not.
 *   3. Whatever the handful of locations that *are* housing give on their own
 *      (`{ kind: 'unit_slots' }` in the catalogue: the Soup Kitchen's 15, the Fence Camp's 50).
 *      That one scales with `LEVEL_SCALE` like every other hold bonus, so a Fence Camp worked to
 *      the ceiling houses five and a half times what a fresh one does.
 *
 * Counted from the *second* level, so a location walked into today is worth exactly what it was
 * worth before the ladder went to ten. Every level after that is 3 more beds whatever else the
 * upgrade bought.
 */
export const UNIT_SLOTS_PER_LOCATION_LEVEL = 3;

/**
 * What the district can house: the structures, plus the ground.
 *
 * `unitSlotCapacity` is the Quarters; `effects.unitSlotBonus` is what the map adds, which is
 * `UNIT_SLOTS_PER_LOCATION` for every location held plus whatever the handful of locations that
 * house people explicitly give on top.
 */
export function districtUnitSlotCapacity(
  buildings: readonly Building[],
  effects: Pick<TerritoryEffects, 'unitSlotBonus'>,
  /**
   * The Steward's passive (`passives.ts`, maintainer 2026-10-04): a share of the **base**, which is
   * the structures' own beds and the ground's flat slots. A card that adds a percentage of unit
   * slots is a bonus on top, not base, so the Steward's share never multiplies it.
   */
  stewardPercent = 0,
  /**
   * The ground's own flat slots: the share of `unitSlotBonus` the held locations give. Research
   * and perks add flat slots on the same channel, and they are not base either (maintainer,
   * 2026-10-05: "base: buildings and ground only"), so the Steward is paid on this alone. Defaults
   * to the whole channel for a caller that only has ground on it.
   */
  groundSlots: number = effects.unitSlotBonus,
): number {
  const ground = Math.max(0, effects.unitSlotBonus);
  const base = baseUnitSlotBeds(buildings) + Math.max(0, Math.min(groundSlots, ground));
  return (
    unitSlotCapacity(buildings) + ground + Math.floor((base * Math.max(0, stewardPercent)) / 100)
  );
}

export interface UnitSlotDraw {
  /** Officers on the books, one bed each. */
  officers: number;
  /** Slots of everything standing on the roster, garrisons on held ground included. */
  army: number;
  /**
   * What is on the bench, counted at order time so a batch cannot overfill on landing.
   *
   * Units at their own slots and machines at one each, because the bench builds both now
   * (`units/muster.ts`). A machine moves from here into {@link UnitSlotDraw.fleet} on the read
   * that delivers it, exactly as a unit moves from here into `army`.
   */
  mustering: number;
  /** Machines parked in the yard, one bed each. */
  fleet: number;
  total: number;
}

/**
 * Machines ordered and not yet handed over, counted the way {@link unitSlotsQueued} counts units.
 *
 * `count - delivered`, so the part of an order that has already landed is charged once, in the
 * yard, rather than in both places. A vehicle order is always one machine today, and writing it
 * off the same two fields means a batched one cannot quietly go uncounted.
 */
function machinesQueued(queue: MusterQueue): number {
  return queue.reduce((total, order) => {
    if (findVehicle(order.unitId) === undefined) return total;
    return total + Math.max(0, order.count - order.delivered);
  }, 0);
}

/**
 * Why the Bar will not take a bid or sign anybody: every bed is taken (maintainer, 2026-09-29).
 *
 * An officer is one bed, so hiring one with the district full would put the crew over its own
 * ceiling the moment the table closed. Refused at the bid, re-checked at the close, where a winner
 * with no bed passes the person to the next bidder.
 */
export const NO_FREE_BED_TEXT = 'Every bed in your district is taken, and an officer needs one.';

/**
 * Everyone the district is currently housing, broken out.
 *
 * Returned as its parts rather than a single number because the screen has to be able to say
 * *what* is full: "you have no room" is a dead end, and "eleven of your fourteen beds are army" is
 * a decision.
 */
export function unitSlotDraw(input: {
  commanders: readonly { readonly id: string }[];
  army: Army;
  musterQueue: MusterQueue;
  /** Machines in the yard. Required rather than optional: a caller that forgets it under-counts. */
  fleet: Fleet;
  /** Units standing on captured ground. Still this crew's people, and still eating. */
  garrison?: Army;
}): UnitSlotDraw {
  const officers = input.commanders.length;
  const army = unitSlotsUsed(input.army) + (input.garrison ? unitSlotsUsed(input.garrison) : 0);
  const mustering = unitSlotsQueued(input.musterQueue) + machinesQueued(input.musterQueue);
  const fleet = fleetSize(input.fleet);
  return { officers, army, mustering, fleet, total: officers + army + mustering + fleet };
}

/** What one of these costs against the pool. The sheet's own slot figure, and nothing new. */
export function unitSlotCostOf(unitId: string): number {
  return findUnit(unitId)?.unitSlots ?? 0;
}
