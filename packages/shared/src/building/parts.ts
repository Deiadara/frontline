import type { ItemCost } from '../items/inventory.js';
import type { BuildingKind } from './kinds.js';

/**
 * The levels a structure cannot be raised past on scrap alone (§A1, items extension).
 *
 * Resources are the *pace* of a district: you always get more of them eventually, so a cost in
 * scrap is a cost in time. Parts are a *gate*: a Generator at level eight needs a Coolant Cell, and
 * no amount of patience produces one. That is what makes the market a place a builder has to go rather
 * than a screen a trader visits.
 *
 * Deliberately sparse. Most levels of most structures ask for nothing but materials, because a
 * game where every upgrade is a shopping trip is a game about shopping. These are the five or six
 * moments in a district's life where the answer to "why can I not build this yet" is a name rather
 * than a number.
 *
 * Keyed by exact level: crossing it once is the toll. A structure already past the gate does not
 * pay again on the way to the level above.
 */
export const BUILDING_PART_GATES: Readonly<
  Partial<Record<BuildingKind, Record<number, ItemCost>>>
> = {
  // The generator's upper end runs hot enough to need real cooling.
  generator: {
    8: { coolant_cell: 1 },
    14: { coolant_cell: 3, ceramic_plate: 2 },
  },
  // A gauntlet past a certain size is a machine shop, not a yard.
  gauntlet: {
    6: { scrap_servo: 4 },
    12: { scrap_servo: 8, optic_cluster: 2 },
  },
  // The lab's deep end is instruments, and nobody in the district makes instruments.
  lab: {
    7: { optic_cluster: 2 },
    13: { optic_cluster: 4, neural_shunt: 1 },
  },
  // The garage is where machines are made, so it is the one that asks for the hard parts.
  garage: {
    5: { gyro_assembly: 2 },
    // Ten, not twelve: the Garage stops at ten (`BUILDING_LEVEL_CEILINGS`), and a gate above a
    // structure's ceiling is a gate nobody ever pays. It took the whole of the game's lifetime
    // demand for `rotor_hub` with it, so the one part with a single sink had no sink at all.
    10: { gyro_assembly: 4, rotor_hub: 1 },
  },
  // The infirmary's theatre. There is one part in the district that can hold a life open.
  infirmary: {
    9: { neural_shunt: 1, ceramic_plate: 2 },
  },
  /*
   * The four gates below were added with the parts they spend (2026-09-14).
   *
   * A component with no sink is the relic problem wearing a different hat: an item that drops, is
   * worth caps on a card, and can never be used for anything. So each new part was authored with
   * the level that asks for it, and `parts.test.ts` refuses a component that nothing anywhere
   * consumes.
   */
  // A Gate is a door that has to move, and a door that has to move is hydraulics.
  gate: {
    7: { hydraulic_ram: 2 },
    13: { hydraulic_ram: 4, pressure_valve: 1 },
  },
  // Everything in the yard above the first bench is cut and welded rather than bolted.
  scrapyard: {
    5: { weld_rod: 6 },
    11: { weld_rod: 12, hydraulic_ram: 2 },
  },
  // Glass, water and heat, all under pressure.
  greenhouse: {
    8: { pressure_valve: 1, weld_rod: 4 },
  },
  // Bunks are the cheap half. The hard half is talking to everybody in them at once.
  quarters: {
    10: { signal_relay: 2, weld_rod: 6 },
  },
};

/** What raising `kind` to `level` asks for beyond materials. Empty for almost every level. */
export function buildingParts(kind: BuildingKind, level: number): ItemCost {
  return BUILDING_PART_GATES[kind]?.[level] ?? {};
}

/** Whether this level asks for anything at all: the cheap check the UI does per plot. */
export function buildingNeedsParts(kind: BuildingKind, level: number): boolean {
  return Object.keys(buildingParts(kind, level)).length > 0;
}
