import { z } from 'zod';

/**
 * Morale (GDD §D4) — a 0..100 meter the district drifts around.
 *
 * Infamy used to live here beside it, on the same 0..100 scale. It does not any more: it is an
 * uncapped point total with its own module (`economy/infamy.ts`), because a score you can fill up
 * is a score you stop playing for. What is left here is the meter machinery morale actually needs.
 */
export const METER_MIN = 0;
export const METER_MAX = 100;

export const MeterSchema = z.number().min(METER_MIN).max(METER_MAX);
export type Meter = z.infer<typeof MeterSchema>;

/** A fresh crew is willing but unknown: middling morale, no reputation on the street yet. */
export const STARTING_MORALE = 60;

/**
 * Morale lost per pay-week the crew went short (§D4, feeding the §H5 officer alignment meter).
 * Counted in *missed paydays*, never in caps: a large shortfall on a large payroll is still one
 * payday missed, and that is what a crew reacts to. Wages bite harder than rations — people will
 * tighten their belts for a week, but they notice an empty envelope immediately.
 */
export const MORALE_PER_UNPAID_WAGE_WEEK = -3;
export const MORALE_PER_STARVED_WEEK = -2;

/*
 * Every §D4 driver the game can currently produce is live. For the record, and so the next reader
 * does not go looking for a marker that was removed rather than forgotten: mission outcomes
 * (`MISSION_MORALE_DELTA`), unpaid payroll and starved upkeep (`moralePenaltyFor`), and the §F2
 * research settle (`moraleFromLeadership`). Infamy's drivers are listed in `economy/infamy.ts`,
 * where they now live.
 */

/** Clamps any arithmetic result back into the meter's 0..100 range. */
export function clampMeter(value: number): Meter {
  return Math.min(METER_MAX, Math.max(METER_MIN, value));
}

/** Immutable meter nudge — the only way a meter should ever be moved. */
export function adjustMeter(value: Meter, delta: number): Meter {
  return clampMeter(value + delta);
}
