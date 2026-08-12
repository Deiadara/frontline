import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import type { Resources } from '../resources.js';

export const PAY_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * §H7: wages are paid "once a week on the real-world clock". That clock is Monday 00:00:00 UTC —
 * one global boundary for every player, so payday does not depend on when an account was made.
 */
export function startOfPayWeek(at: Date): Date {
  const midnight = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), 0, 0, 0, 0),
  );
  const daysSinceMonday = (midnight.getUTCDay() + 6) % 7;
  midnight.setUTCDate(midnight.getUTCDate() - daysSinceMonday);
  return midnight;
}

/**
 * §H7: "the first payment happens at recruitment and covers however much of the week is left."
 * Recruiting exactly on the boundary therefore costs a full week, and recruiting an hour before
 * it costs an hour's worth.
 */
export function proratedFirstWage(weeklyWageCaps: number, recruitedAt: Date): number {
  const weekEnds = startOfPayWeek(recruitedAt).getTime() + PAY_WEEK_MS;
  const remaining = weekEnds - recruitedAt.getTime();
  return Math.round((weeklyWageCaps * remaining) / PAY_WEEK_MS);
}

/**
 * §D1: "more officers require more food" — and each extra mouth costs more than the last, because
 * supplying a bigger crew is harder than supplying a smaller one twice. `n * (n + 3) / 2`, which
 * is always a whole number of food.
 */
export const FOOD_UPKEEP_PER_OFFICER = 2;
export const FOOD_UPKEEP_CROWDING = 0.5;

export function foodUpkeepFor(officerCount: number): number {
  if (officerCount <= 0) return 0;
  return officerCount * (FOOD_UPKEEP_PER_OFFICER + FOOD_UPKEEP_CROWDING * (officerCount - 1));
}

/**
 * The base's side of every wage contract, keyed by officer id. W5/MOU-164 negotiates the numbers
 * (§H7) and writes them here; this module only moves the money. The wage lives on the base rather
 * than on the officer because it is a contract between the two, not an attribute of the person.
 */
export const PayrollStateSchema = z.object({
  /** Start of the last pay week already settled. Always a Monday 00:00 UTC once normalised. */
  paidThroughAt: IsoDateTimeSchema,
  wages: z.record(IdSchema, z.number().nonnegative()),
});
export type PayrollState = z.infer<typeof PayrollStateSchema>;

export function startingPayroll(now: string): PayrollState {
  return { paidThroughAt: startOfPayWeek(new Date(now)).toISOString(), wages: {} };
}

export function weeklyWageBill(wages: PayrollState['wages']): number {
  return Object.values(wages).reduce((total, wage) => total + wage, 0);
}

export interface EconomyCycleInput {
  resources: Resources;
  payroll: PayrollState;
  /** Officers on the books — drives food upkeep (§D1). */
  officerCount: number;
  now: Date;
}

export interface EconomyCycleResult {
  /** Pay weeks settled by this run. 0 means nothing was owed and nothing changed. */
  weeksSettled: number;
  capsDue: number;
  capsPaid: number;
  /** Wages that could not be covered. TODO-LATER: morale penalty — W5/MOU-164 (§H5). */
  capsShortfall: number;
  foodDue: number;
  foodConsumed: number;
  /** Upkeep that could not be covered. TODO-LATER: morale penalty — W5/MOU-164 (§H5). */
  foodShortfall: number;
  resources: Resources;
  payroll: PayrollState;
}

/**
 * Settles every pay-week boundary crossed since `payroll.paidThroughAt`: caps wages out (§H7)
 * and food upkeep down (§D1). Catches up honestly across a long absence — three missed weeks
 * cost three weeks — and pays what it can when the stockpile is short, reporting the rest.
 */
export function runEconomyCycle({
  resources,
  payroll,
  officerCount,
  now,
}: EconomyCycleInput): EconomyCycleResult {
  const settledThrough = startOfPayWeek(new Date(payroll.paidThroughAt)).getTime();
  const dueThrough = startOfPayWeek(now).getTime();
  // A backwards clock must never claw wages back, so the week count floors at zero.
  const weeksSettled = Math.max(0, Math.round((dueThrough - settledThrough) / PAY_WEEK_MS));

  if (weeksSettled === 0) {
    return {
      weeksSettled: 0,
      capsDue: 0,
      capsPaid: 0,
      capsShortfall: 0,
      foodDue: 0,
      foodConsumed: 0,
      foodShortfall: 0,
      resources,
      payroll,
    };
  }

  const capsDue = weeksSettled * weeklyWageBill(payroll.wages);
  const foodDue = weeksSettled * foodUpkeepFor(officerCount);
  const capsPaid = Math.min(resources.caps, capsDue);
  const foodConsumed = Math.min(resources.food, foodDue);

  return {
    weeksSettled,
    capsDue,
    capsPaid,
    capsShortfall: capsDue - capsPaid,
    foodDue,
    foodConsumed,
    foodShortfall: foodDue - foodConsumed,
    resources: {
      ...resources,
      caps: resources.caps - capsPaid,
      food: resources.food - foodConsumed,
    },
    payroll: { ...payroll, paidThroughAt: new Date(dueThrough).toISOString() },
  };
}
