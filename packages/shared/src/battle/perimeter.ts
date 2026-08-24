import { findUnit, type Army } from '../units/index.js';

/**
 * The ring around the fight (GDD §A4, battle rework).
 *
 * A second force, chosen before the mark and standing outside the battle proper. It never joins the
 * line and never appears in the round loop. What it does is stop people leaving — anybody breaking
 * out of the fight, and anybody being quietly pulled back out of a deployment before the fight
 * starts.
 *
 * ## Why anybody would field one
 *
 * Not for the kills. A perimeter is an **intelligence weapon**: the losing side only ever learns
 * what happened from the people who walked home, so a ring that catches all of them means the enemy
 * gets a silence where their report should be (`battle/analysis.ts` enforces exactly that). It costs
 * you units that could have been in the line — the trade is bodies now against the other side
 * planning blind next time, which is the decision the whole mechanic exists to create.
 *
 * ## The rule that makes it a gamble
 *
 * **A losing side's perimeter never fights.** The board's rule, and it is the right one: the ring is
 * outside the battle, so when the line inside it collapses there is nothing for the ring to do and
 * it walks away intact. So a perimeter is pure profit if you win and pure waste if you lose, and
 * every body in it is a body that was not helping you win.
 */

/**
 * How many runners one body on the ring can realistically cover.
 *
 * Above one because a perimeter is not a duel: somebody watching a road stops several people over
 * the course of a rout. Not much above one, because a thin ring around a mass breakout is a
 * formality — thirty people leaving at once past four is thirty people leaving.
 */
export const RUNNERS_COVERED_PER_BODY = 1.5;

/** The most of a withdrawal a ring can ever take. Nothing is airtight. */
export const MAX_PERIMETER_CATCH = 0.85;

/**
 * How much a runner's own speed and stealth are worth against the ring.
 *
 * The two stats that already decide who gets away from a lost fight (`rout.ts`), read the same way
 * here so a Road Reaver is hard to bottle up for the same reason it is hard to run down. Weighted
 * below one so no sheet makes a unit uncatchable.
 */
export const PERIMETER_EVASION_WEIGHT = 0.6;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const total = (force: Army): number =>
  Object.values(force).reduce((sum, count) => sum + Math.max(0, count), 0);

/**
 * How much of the ring is real, in bodies.
 *
 * Counted rather than weighted by sheet: standing on a road at night is a job a Razor does about as
 * well as a Sniper, and making the ring scale with offense would turn "deny them a report" into
 * "bring your best units and do it twice".
 */
export function perimeterBodies(perimeter: Army): number {
  return Object.entries(perimeter).reduce(
    (sum, [unitId, count]) => (findUnit(unitId) ? sum + Math.max(0, count) : sum),
    0,
  );
}

/** The share of a withdrawal the ring is thick enough to reach at all, 0..1. */
export function ringCoverage(perimeter: Army, runners: number): number {
  if (runners <= 0) return 0;
  return clamp((perimeterBodies(perimeter) * RUNNERS_COVERED_PER_BODY) / runners, 0, 1);
}

/** One runner's odds of being stopped, given how thick the ring is where they hit it. */
export function catchChance(unitId: string, coverage: number): number {
  const unit = findUnit(unitId);
  if (!unit) return 0;
  const slipperiness = ((unit.stats.speed + unit.stats.stealth) / 200) * PERIMETER_EVASION_WEIGHT;
  return clamp(MAX_PERIMETER_CATCH * coverage * (1 - slipperiness), 0, MAX_PERIMETER_CATCH);
}

export interface PerimeterToll {
  /** Runners the ring stopped. Dead, and they carry no report home. */
  caught: Army;
  /** Runners who got past it. */
  escaped: Army;
}

/**
 * What a ring takes out of a withdrawal.
 *
 * Rolled per individual off the passed stream, the same way the rout is, so the whole fight still
 * replays from one seed. An empty ring returns the withdrawal untouched **without drawing**, so a
 * battle nobody set a perimeter for produces the identical stream it always did — which is what lets
 * every existing engine test stay pinned to its numbers.
 */
export function perimeterToll(fleeing: Army, perimeter: Army, next: () => number): PerimeterToll {
  const runners = total(fleeing);
  const coverage = ringCoverage(perimeter, runners);
  if (coverage <= 0 || runners === 0) return { caught: {}, escaped: { ...fleeing } };

  const caught: Army = {};
  const escaped: Army = {};
  for (const [unitId, count] of Object.entries(fleeing)) {
    if (count <= 0) continue;
    const chance = catchChance(unitId, coverage);
    let stopped = 0;
    for (let i = 0; i < count; i += 1) if (next() < chance) stopped += 1;
    if (stopped > 0) caught[unitId] = stopped;
    if (count - stopped > 0) escaped[unitId] = count - stopped;
  }
  return { caught, escaped };
}

/**
 * Whether a side's ring is allowed to do anything at all.
 *
 * The losing side's is not. Stated as a named predicate rather than an `if` inside the resolver
 * because it is the single rule people get wrong when reading the feature back, and a function with
 * this name in a stack trace explains itself.
 */
export function perimeterFights(side: 'attacker' | 'defender', winner: 'attacker' | 'defender') {
  return side === winner;
}
