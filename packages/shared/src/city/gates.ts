import { z } from 'zod';
import { BUILDING_MAX_LEVEL } from '../building/kinds.js';
import { buildingBuildSeconds, buildingCost } from '../building/cost.js';
import { GATE_DEFENSE_PERCENT_PER_LEVEL } from '../building/standing.js';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import { PartialResourcesSchema, type PartialResources } from '../resources.js';
import type { Building } from '../building/state.js';

/**
 * The gate on a district somebody has taken whole (maintainer request, §B7).
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

/** The same ceiling every structure has. The maintainer asked for "up to MAX level". */
export const CAPTURED_GATE_MAX_LEVEL = BUILDING_MAX_LEVEL;

export const CapturedGateSchema = z.object({
  districtId: IdSchema,
  level: z.number().int().min(0).max(CAPTURED_GATE_MAX_LEVEL),
  /** The level being worked towards, or null when nobody is working on it. */
  upgradingTo: z.number().int().min(1).max(CAPTURED_GATE_MAX_LEVEL).nullable().default(null),
  /** When that work lands. Settled lazily, like every other clock in this game. */
  upgradingUntil: IsoDateTimeSchema.nullable().default(null),
  /** When it began, so the first tenth of it can be called off (`time/cancel.ts`). */
  upgradingSince: IsoDateTimeSchema.nullable().default(null),
  /**
   * What the raise in progress was charged, so calling it off refunds that and not a price read
   * again at the cancel (2026-10-05): the price now takes the Engineer, and a cut seated for the
   * order and gone by the cancel would refund more than was paid. Null on a row written before.
   */
  upgradePaid: PartialResourcesSchema.nullable().optional(),
});
export type CapturedGate = z.infer<typeof CapturedGateSchema>;

/** A captured gate's raise runs 10% over the Gate's own curve (maintainer, 2026-10-05). */
export const CAPTURED_GATE_PRICE_RISE = 1.1;

/**
 * What prices a crew's raise: its home district's build-cost cards, its own points off a build,
 * and its Engineer. All three reach a captured gate since 2026-10-05 (maintainer: "apply both"):
 * it is a building raised by the same crew, and it was the one build the Engineer did not touch.
 */
export interface GatePricing {
  buildings?: readonly Building[];
  crewCostPercent?: number;
  engineerPercent?: number;
}

/**
 * What raising a captured gate costs: the Gate's own curve with the crew's discounts, as any build
 * takes them (`buildingCost`), then the rise. Every line stays at least one.
 */
export function capturedGateCost(toLevel: number, pricing: GatePricing = {}): PartialResources {
  const bill = buildingCost(
    'gate',
    toLevel,
    pricing.buildings ?? [],
    pricing.crewCostPercent ?? 0,
    pricing.engineerPercent ?? 0,
  );
  return Object.fromEntries(
    Object.entries(bill).map(([key, amount]) => [
      key,
      Math.max(1, Math.round((amount ?? 0) * CAPTURED_GATE_PRICE_RISE)),
    ]),
  );
}

export function capturedGateSeconds(toLevel: number): number {
  return buildingBuildSeconds('gate', toLevel, []);
}

/** §B7: what a captured gate adds to the defence of everybody fighting behind it. */
export function capturedGateDefensePercent(level: number): number {
  return Math.max(0, level) * GATE_DEFENSE_PERCENT_PER_LEVEL;
}

/** Why a crew cannot raise this gate right now, already worded, or null when they can. */
export type CapturedGateRefusal = 'not_held' | 'already_working' | 'at_ceiling' | 'cannot_afford';

export function capturedGateRefusal(input: {
  holdsDistrict: boolean;
  gate: CapturedGate | undefined;
  stock: PartialResources;
  /** The crew's discounts, so the refusal judges the price it would be charged. */
  pricing?: GatePricing;
}): CapturedGateRefusal | null {
  if (!input.holdsDistrict) return 'not_held';
  const level = input.gate?.level ?? CAPTURED_GATE_START_LEVEL;
  if (input.gate?.upgradingUntil) return 'already_working';
  if (level >= CAPTURED_GATE_MAX_LEVEL) return 'at_ceiling';
  const price = capturedGateCost(level + 1, input.pricing);
  for (const [resource, amount] of Object.entries(price)) {
    if ((input.stock[resource as keyof PartialResources] ?? 0) < (amount ?? 0)) {
      return 'cannot_afford';
    }
  }
  return null;
}
