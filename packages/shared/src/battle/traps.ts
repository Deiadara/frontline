import type { PartialResources } from '../resources.js';
import type { Army } from '../units/training.js';

/**
 * What you leave behind for people who come looking (GDD §A4, battle rework).
 *
 * A trap is the defensive counterpart to a perimeter: it costs materials rather than units, it
 * fires once, and it fires *before* anybody has decided anything. The board's rule is exact and it
 * is the interesting part: **the attack still goes through**. A trap does not turn an assault back;
 * it takes a bite out of it and then the fight happens anyway. The only case where it stops an
 * attack outright is the one where it left nothing standing to attack with, which is a thing that
 * only happens to somebody who came with four people.
 *
 * That constraint is what stops traps being a wall. A mechanic that could refuse an attack would let
 * a crew with materials and no army hold ground forever, which is the failure mode every siege
 * system in the genre has had to design out.
 *
 * ## Deterministic on purpose
 *
 * No roll. A trap is a known quantity to the person who laid it, that is what they paid for, and
 * a random one would be a lottery ticket rather than a plan. The victims are taken across the
 * attacking stacks in proportion to their size, so a trap cannot be baited by putting one Razor in
 * front of the Colossus.
 *
 * ## Where one comes from (§I4)
 *
 * A trap used to be bought with resources and armed on a location, where it sat waiting for
 * whoever turned up. It is a **consumable item** now: the Scrapyard cuts one for the cost below,
 * behind the trap's blueprint document and the Lab rung named here, and it goes into the inventory.
 * A defender sets one on a coming fight and it is spent at the mark. The ids in this catalogue are
 * therefore also item ids in `items/catalog.ts`, and that is the mechanic rather than a
 * coincidence: the deployment row names the trap, and the settler takes that id out of the bag.
 */

/**
 * What a trap does when the attack walks over it. Two kinds, and a trap is exactly one of them.
 *
 * **A bite** takes bodies off the attack before contact, about `bite` times the square root of the
 * column it fires on (see {@link trapBite}). **The wire** kills nobody: the attack goes on at its
 * full count, slower and shakier for its first few rounds (see {@link TrapWire}).
 */
export type TrapEffect = { kind: 'bite'; bite: number } | ({ kind: 'wire' } & TrapWire);

/**
 * Razor Wire's effect on the attack that walked through it (maintainer, 2026-09-29).
 *
 * The card said "Nobody dies of it; everybody slows down in it" over a mechanic that killed four
 * units like every other trap. It slows now, which is what it says.
 *
 * Both halves last the first `rounds` rounds and are handed back after them. Speed is read where
 * the engine reads it, reach and closing, so that half is worth most in front of a line that
 * shoots from range and next to nothing in front of a line of blades: getting across the ground
 * slowly is what a rifle wants. The morale half is what makes the wire worth something in a knife
 * fight as well. Handed back rather than left to recover, because a flat cut that lasts the whole
 * fight decides a big even one outright: over 200 seeds, 4 points kept for good took 1,000 Razors
 * and Breakers against the same from 53.5% to 8%, and 4 points for two rounds took them to 36.5%.
 */
export interface TrapWire {
  /** Points off every attacking sheet's speed while the attack is in the wire. */
  speedCut: number;
  /** Points off every attacking stack's running morale while the attack is in the wire. */
  moraleCut: number;
  /** How many rounds the attack spends in the wire before both come back. */
  rounds: number;
}

export interface TrapSpec {
  id: string;
  name: string;
  description: string;
  /** The Lab programme the yard wants finished before it will cut one. */
  requiresTech: string;
  cost: PartialResources;
  effect: TrapEffect;
}

/*
 * The bites (maintainer, 2026-09-29): "soften traps", and no hard caps on unit effects.
 *
 * These were a share of the attack with a ceiling in units (Pressure Plates 6% up to 6, the
 * Flooded Cellar 20% up to 34), and the engine turns on a few units at even strength: 40 Razors
 * and 10 Breakers against the same won 51% over 200 seeds, and 3% once Pressure Plates had taken
 * three of them. A bite that decides an even fight is a wall with extra steps, and the ceiling was
 * the other half of the rule: past 100 attackers a bigger column paid nothing more.
 *
 * Measured over 150 to 300 seeds on even Razor and Breaker columns, what one unit taken off the
 * attack does to it: from about 53% down to 30% at 50 units a side, 35% at 200, 39% at 400 and
 * 45% at 1,000. The engine's sensitivity falls slowly as the fight grows, so a bite that grows with the
 * square root of the column keeps a trap's tilt roughly the same size at every scale, and never
 * stops growing. The figures each coefficient buys are in `docs/BATTLE-ENGINE.md`, "Traps".
 */
export const TRAP_CATALOG: readonly TrapSpec[] = [
  {
    id: 'trap_pressure_plates',
    name: 'Pressure Plates',
    description:
      'Boards over a stairwell with something underneath them. Cheap, and everybody forgets which floor.',
    requiresTech: 'tech_pressure_plates',
    cost: { scrap: 700, planks: 520, caps: 400 },
    effect: { kind: 'bite', bite: 0.14 },
  },
  {
    id: 'trap_gas_shell',
    name: 'Buried Shell',
    description: 'A cracked chemical round under the approach, wired to whatever walks over it.',
    requiresTech: 'tech_shaped_charges',
    cost: { scrap: 1800, oil: 300, caps: 1100 },
    effect: { kind: 'bite', bite: 0.17 },
  },
  {
    id: 'trap_collapse',
    name: 'Prepared Collapse',
    description: 'The whole frontage, cut most of the way through, and one charge holding it up.',
    requiresTech: 'tech_demolition_doctrine',
    cost: { scrap: 4200, planks: 2400, highQualityMetal: 260, caps: 2600 },
    effect: { kind: 'bite', bite: 0.24 },
  },
  {
    id: 'trap_razor_wire',
    name: 'Razor Wire',
    description:
      'A belt of tape across the approach. Nobody dies of it; everybody slows down in it.',
    requiresTech: 'tech_watch_schedules',
    cost: { scrap: 450, planks: 180, caps: 240 },
    effect: { kind: 'wire', speedCut: 15, moraleCut: 2, rounds: 2 },
  },
  {
    id: 'trap_fuel_fougasse',
    name: 'Fuel Fougasse',
    description: 'A drum of thickened oil laid in a pit at an angle, with a charge behind it.',
    requiresTech: 'tech_sally_ports',
    cost: { scrap: 2400, planks: 400, oil: 620, caps: 1400 },
    effect: { kind: 'bite', bite: 0.2 },
  },
  {
    id: 'trap_flooded_cellar',
    name: 'Flooded Cellar',
    description: 'The basement filled from the culvert, and two bus bars sitting in the far wall.',
    requiresTech: 'tech_layered_defence',
    cost: { scrap: 5600, planks: 1800, oil: 900, highQualityMetal: 340, caps: 3200 },
    effect: { kind: 'bite', bite: 0.28 },
  },
];

const BY_ID = new Map(TRAP_CATALOG.map((spec) => [spec.id, spec]));

export function findTrap(id: string): TrapSpec | undefined {
  return BY_ID.get(id);
}

/**
 * How many units a biting trap takes off a column this big: `bite` times its square root, rounded.
 *
 * Never less than one, so a trap that goes off always takes somebody, and never more than the
 * column. No ceiling past that: a bigger column always loses a little more, and the square root is
 * what keeps "a little" from becoming the fight (see the note on the catalogue).
 */
export function trapBite(units: number, bite: number): number {
  if (units <= 0) return 0;
  return Math.min(units, Math.max(1, Math.round(bite * Math.sqrt(units))));
}

/** The column sizes a trap's card quotes its bite at. */
const QUOTED_COLUMNS = [50, 200, 1000] as const;

/**
 * What one trap does, in the words the Scrapyard's row and the fight page's picker both print.
 *
 * Written from the numbers rather than authored, so a tuning pass cannot leave a sentence behind
 * saying the old ones, and in one place so the two screens cannot disagree.
 */
export function trapEffectLine(spec: TrapSpec): string {
  if (spec.effect.kind === 'wire') {
    const { speedCut, moraleCut, rounds } = spec.effect;
    return `Kills nobody. The attack loses ${speedCut} speed and ${moraleCut} morale for its first ${rounds} rounds`;
  }
  const bite = spec.effect.bite;
  const quoted = QUOTED_COLUMNS.map(
    (units) => `${trapBite(units, bite)} of ${units.toLocaleString('en-GB')}`,
  );
  return `Takes ${quoted.join(', ')} attacking units before contact`;
}

/** Traps this crew's finished research allows the yard to cut. */
export function trapsAvailable(technologies: readonly string[]): TrapSpec[] {
  return TRAP_CATALOG.filter((spec) => technologies.includes(spec.requiresTech));
}

export interface TrapToll {
  /** Units the trap took, by unit id. */
  killed: Army;
  /** What is left to fight with. */
  survivors: Army;
  /** True when it left nothing standing, which is the one case an attack does not happen at all. */
  wipedOut: boolean;
  /** What the wire does to the attack for its opening rounds, or null for a trap that bites. */
  slowed: TrapWire | null;
}

const total = (force: Army): number =>
  Object.values(force).reduce((sum, count) => sum + Math.max(0, count), 0);

/**
 * Setting one off.
 *
 * The wire takes nobody: the whole column goes on, and what it did to them rides out on `slowed`
 * for the engine to apply. A bite's victims are apportioned largest-stack-first after the proportional share is worked out, so the
 * rounding always lands on the stack that can absorb it rather than deleting a single Colossus to a
 * rounding error.
 */
export function springTrap(force: Army, trap: TrapSpec): TrapToll {
  const units = total(force);
  if (trap.effect.kind === 'wire') {
    const { speedCut, moraleCut, rounds } = trap.effect;
    return {
      killed: {},
      survivors: { ...force },
      wipedOut: false,
      slowed: units > 0 ? { speedCut, moraleCut, rounds } : null,
    };
  }
  if (units === 0) return { killed: {}, survivors: { ...force }, wipedOut: false, slowed: null };

  /*
   * What the trap is sold as taking, which is what it has to take.
   *
   * Held apart from the running `budget` below because the proportional share is a share of the
   * **bite**, not of whatever is left of it. Dividing the remainder by the original `units` shrank
   * the numerator on every stack after the first while the denominator stayed put, so the loop ran
   * out of stacks before it ran out of budget: a Flooded Cellar then sold as "20% of the attack,
   * up to 34 units" took 20 of 100 from a single stack and 14 from a force of five, and got weaker
   * the more varied the force it fired on.
   */
  const bite = trapBite(units, trap.effect.bite);
  let budget = bite;
  const killed: Army = {};
  const survivors: Army = { ...force };

  const stacks = Object.entries(force)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  for (const [unitId, count] of stacks) {
    if (budget <= 0) break;
    // The stack's proportional share, but never more than the budget and never more than it has.
    const share = Math.min(budget, count, Math.max(1, Math.round((count / units) * bite)));
    killed[unitId] = share;
    survivors[unitId] = count - share;
    if (survivors[unitId] === 0) delete survivors[unitId];
    budget -= share;
  }

  /*
   * Whatever the rounding left, spent largest-stack-first.
   *
   * Each stack's share rounds on its own, so a force spread over many stacks rounds down several
   * times over and the trap under-delivers: 12 of the 14 it advertises, on a 250-unit force in
   * seven stacks. Largest-first is the order the doc above promises, and it is the order that keeps
   * a lone Colossus off the bill until nothing bigger is left to take it.
   */
  for (const [unitId] of stacks) {
    if (budget <= 0) break;
    const left = survivors[unitId] ?? 0;
    if (left <= 0) continue;
    const extra = Math.min(budget, left);
    killed[unitId] = (killed[unitId] ?? 0) + extra;
    survivors[unitId] = left - extra;
    if (survivors[unitId] === 0) delete survivors[unitId];
    budget -= extra;
  }

  return { killed, survivors, wipedOut: total(survivors) === 0, slowed: null };
}
