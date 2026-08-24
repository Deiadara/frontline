import { z } from 'zod';
import { IsoDateTimeSchema } from '../primitives.js';
import type { PartialResources } from '../resources.js';
import type { Army } from '../units/training.js';

/**
 * What you leave behind for people who come looking (GDD §A4, battle rework).
 *
 * A trap is the defensive counterpart to a perimeter: it costs materials rather than bodies, it
 * fires once, and it fires *before* anybody has decided anything. The board's rule is exact and it
 * is the interesting part — **the attack still goes through**. A trap does not turn an assault back;
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
 * No roll. A trap is a known quantity to the person who laid it — that is what they paid for — and
 * a random one would be a lottery ticket rather than a plan. The victims are taken across the
 * attacking stacks in proportion to their size, so a trap cannot be baited by putting one Razor in
 * front of the Colossus.
 */

export interface TrapSpec {
  id: string;
  name: string;
  description: string;
  /** The Lab programme that has to be finished before this can be laid. */
  requiresTech: string;
  cost: PartialResources;
  /** Share of the attacking force it takes off, before any ceiling. */
  killShare: number;
  /** ...and the ceiling, in bodies. A trap is a bite, never a battle. */
  maxKills: number;
}

export const TRAP_CATALOG: readonly TrapSpec[] = [
  {
    id: 'trap_pressure_plates',
    name: 'Pressure Plates',
    description:
      'Boards over a stairwell with something underneath them. Cheap, and everybody forgets which floor.',
    requiresTech: 'tech_pressure_plates',
    cost: { scrap: 700, caps: 400 },
    killShare: 0.06,
    maxKills: 6,
  },
  {
    id: 'trap_gas_shell',
    name: 'Buried Shell',
    description: 'A cracked chemical round under the approach, wired to whatever walks over it.',
    requiresTech: 'tech_shaped_charges',
    cost: { scrap: 1800, oil: 300, caps: 1100 },
    killShare: 0.1,
    maxKills: 14,
  },
  {
    id: 'trap_collapse',
    name: 'Prepared Collapse',
    description: 'The whole frontage, cut most of the way through, and one charge holding it up.',
    requiresTech: 'tech_demolition_doctrine',
    cost: { scrap: 4200, highQualityMetal: 260, caps: 2600 },
    killShare: 0.16,
    maxKills: 28,
  },
];

const BY_ID = new Map(TRAP_CATALOG.map((spec) => [spec.id, spec]));

export function findTrap(id: string): TrapSpec | undefined {
  return BY_ID.get(id);
}

/** Traps this crew's finished research allows it to lay. */
export function trapsAvailable(technologies: readonly string[]): TrapSpec[] {
  return TRAP_CATALOG.filter((spec) => technologies.includes(spec.requiresTech));
}

/** A trap sitting on a location, waiting. One per location — see the module note on why not three. */
export const ArmedTrapSchema = z.object({
  trapId: z.string().min(1),
  armedAt: IsoDateTimeSchema,
});
export type ArmedTrap = z.infer<typeof ArmedTrapSchema>;

export interface TrapToll {
  /** Bodies the trap took, by unit id. */
  killed: Army;
  /** What is left to fight with. */
  survivors: Army;
  /** True when it left nothing standing, which is the one case an attack does not happen at all. */
  wipedOut: boolean;
}

const total = (force: Army): number =>
  Object.values(force).reduce((sum, count) => sum + Math.max(0, count), 0);

/**
 * Setting one off.
 *
 * Victims are apportioned largest-stack-first after the proportional share is worked out, so the
 * rounding always lands on the stack that can absorb it rather than deleting a single Colossus to a
 * rounding error.
 */
export function springTrap(force: Army, trap: TrapSpec): TrapToll {
  const bodies = total(force);
  if (bodies === 0) return { killed: {}, survivors: { ...force }, wipedOut: false };

  let budget = Math.min(trap.maxKills, Math.max(1, Math.round(bodies * trap.killShare)), bodies);
  const killed: Army = {};
  const survivors: Army = { ...force };

  const stacks = Object.entries(force)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);

  for (const [unitId, count] of stacks) {
    if (budget <= 0) break;
    // The stack's proportional share, but never more than the budget and never more than it has.
    const share = Math.min(budget, count, Math.max(1, Math.round((count / bodies) * budget)));
    killed[unitId] = share;
    survivors[unitId] = count - share;
    if (survivors[unitId] === 0) delete survivors[unitId];
    budget -= share;
  }

  return { killed, survivors, wipedOut: total(survivors) === 0 };
}
