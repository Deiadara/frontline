import { z } from 'zod';
import { BUILDING_MAX_LEVEL } from '../building/kinds.js';
import { buildingBuildSeconds, buildingCost } from '../building/cost.js';
import {
  GATE_DEFENSE_PERCENT_PER_LEVEL,
  GATE_INTEL_RESISTANCE_PER_LEVEL,
} from '../building/standing.js';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import type { PartialResources } from '../resources.js';

/**
 * The gate on a district somebody has taken whole (board request, §B7).
 *
 * ## Why it belongs to the ground rather than to the crew
 *
 * A district's gate is a physical thing standing in a place. Storing it against the district means
 * a crew that loses the ground loses the gate with it, and a crew that takes the ground inherits
 * whatever the last holder built: taking a district that has been worked up for a month is worth
 * more than taking a fresh one, which is the same reasoning that makes a location's level part of
 * the location rather than of whoever is standing on it.
 *
 * Keyed against the crew instead, the level would have to be discarded or duplicated every time
 * the district changed hands, and "your gate" would quietly mean four different walls.
 *
 * ## What "fully captured" means, and the one thing it excludes
 *
 * Every *location* in the district. The gate itself is not a location and never was: it is its own
 * `BattleTarget` kind, so the sweep that grants access cannot include it. That is the board's
 * caveat ("excluding gate, you cannot really capture that") and it is true by construction rather
 * than by a clause somebody has to remember.
 */

/** A gate that has just come into somebody's hands is a gate, not a hole. */
export const CAPTURED_GATE_START_LEVEL = 1;

/** The same ceiling every structure has. The board asked for "up to MAX level". */
export const CAPTURED_GATE_MAX_LEVEL = BUILDING_MAX_LEVEL;

export const CapturedGateSchema = z.object({
  districtId: IdSchema,
  level: z.number().int().min(0).max(CAPTURED_GATE_MAX_LEVEL),
  /** The level being worked towards, or null when nobody is working on it. */
  upgradingTo: z.number().int().min(1).max(CAPTURED_GATE_MAX_LEVEL).nullable().default(null),
  /** When that work lands. Settled lazily, like every other clock in this game. */
  upgradingUntil: IsoDateTimeSchema.nullable().default(null),
});
export type CapturedGate = z.infer<typeof CapturedGateSchema>;

/**
 * What raising a captured gate costs and takes.
 *
 * The Gate's own curve, unchanged, which is the board's rule: "costs pretty much the same things
 * to upgrade". Priced against an empty district rather than the crew's own, because the discounts
 * a home district earns (its Generator, its perks) are improvements to *that* district's yard and
 * do not reach a wall four districts away.
 */
export function capturedGateCost(toLevel: number): PartialResources {
  return buildingCost('gate', toLevel, []);
}

export function capturedGateSeconds(toLevel: number): number {
  return buildingBuildSeconds('gate', toLevel, []);
}

/** §B7: what a captured gate adds to the defence of everybody fighting behind it. */
export function capturedGateDefensePercent(level: number): number {
  return Math.max(0, level) * GATE_DEFENSE_PERCENT_PER_LEVEL;
}

/**
 * §B7: and how much less a scout reading this district comes away with.
 *
 * The board's rule is that "the spying part is true for all gates as well". It lands on the same
 * `intelResistancePercent` a home Gate does, so a scout looking at a district behind a level 8
 * captured gate is up against exactly what they would be looking at a home district behind a
 * level 8 one.
 */
export function capturedGateIntelResistancePercent(level: number): number {
  return Math.max(0, level) * GATE_INTEL_RESISTANCE_PER_LEVEL;
}

/** Whether this gate's work has landed by `now`. */
export function capturedGateUpgradeDue(gate: CapturedGate, now: Date): boolean {
  return gate.upgradingUntil !== null && Date.parse(gate.upgradingUntil) <= now.getTime();
}

/** Why a crew cannot raise this gate right now, already worded, or null when they can. */
export type CapturedGateRefusal = 'not_held' | 'already_working' | 'at_ceiling' | 'cannot_afford';

export function capturedGateRefusal(input: {
  holdsDistrict: boolean;
  gate: CapturedGate | undefined;
  stock: PartialResources;
}): CapturedGateRefusal | null {
  if (!input.holdsDistrict) return 'not_held';
  const level = input.gate?.level ?? CAPTURED_GATE_START_LEVEL;
  if (input.gate?.upgradingUntil) return 'already_working';
  if (level >= CAPTURED_GATE_MAX_LEVEL) return 'at_ceiling';
  const price = capturedGateCost(level + 1);
  for (const [resource, amount] of Object.entries(price)) {
    if ((input.stock[resource as keyof PartialResources] ?? 0) < (amount ?? 0)) {
      return 'cannot_afford';
    }
  }
  return null;
}
