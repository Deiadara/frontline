import { z } from 'zod';
import { IdSchema, IsoDateTimeSchema } from '../primitives.js';
import type { Resources } from '../resources.js';

/**
 * The payroll book (GDD §H7): what the crew can commit to officers, and what it has committed.
 *
 * ## A budget, not a bill
 *
 * Officers used to draw caps out of the stockpile every Monday, which made hiring a good one a
 * slow bleed a player could not see coming and could not plan against. The book replaces that
 * outright: **payroll is a capacity**, like beds or power. It is a standing figure in caps per
 * week; every officer on the books commits a slice of it; and what is left is the only thing that
 * decides whether you can sign the next one. Nothing is deducted from the stockpile week to week.
 *
 * That turns a wage into a decision made once, at the table, about a resource the player can see
 * the whole of. The interesting question stops being "can I survive this" and becomes "is this
 * person worth a fifth of my book".
 *
 * ## Growing it costs caps, and costs more than it pays back quickly
 *
 * `Increase Payroll` in the Nexus buys one `PAYROLL_STEP` of standing capacity for a flat price
 * that climbs with every step already bought. The price is deliberately far above the step: a step
 * is permanent, so paying about seventeen weeks of it up front is what stops the button being an
 * obvious purchase every time a player has spare caps. There is no ceiling.
 *
 * ## Letting somebody go
 *
 * Releasing an officer frees their slice immediately and costs `DISMISSAL_WEEKS` of it in caps on
 * the spot. Firing is meant to be a real decision rather than a way to rotate the roster for free.
 */

export const PAY_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * §H7: upkeep settles "once a week on the real-world clock". That clock is Monday 00:00:00 UTC:
 * one global boundary for every player, so the week does not depend on when an account was made.
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
 * §D1: "more officers require more food", and each extra mouth costs more than the last, because
 * supplying a bigger crew is harder than supplying a smaller one twice.
 *
 * Food is the one thing still drawn weekly, and it is not a wage: it is what the district eats.
 * The caps side of an officer's contract is the payroll book above and never touches the stockpile.
 */
export const FOOD_UPKEEP_PER_OFFICER = 2;
export const FOOD_UPKEEP_CROWDING = 0.5;

export function foodUpkeepFor(officerCount: number): number {
  if (officerCount <= 0) return 0;
  const crew = Math.trunc(officerCount);
  // Rounded even though `n(n+3)/2` is integral for every integral `n`. The identity holds for
  // today's two constants and for nothing else, and food is spent straight out of a stockpile that
  // may not hold a fraction, so the guarantee lives here rather than in a comment about arithmetic
  // somebody may retune.
  return Math.round(crew * (FOOD_UPKEEP_PER_OFFICER + FOOD_UPKEEP_CROWDING * (crew - 1)));
}

// --- the book itself ---

/** What every crew starts with, in caps per week, before a Nexus or a single purchase. */
export const PAYROLL_BASE = 200;

/** Caps per week the Nexus adds per level: the book grows with the district on its own. */
export const PAYROLL_PER_NEXUS_LEVEL = 25;

/** Caps per week one purchase adds. The board's own example: 200 becomes 230. */
export const PAYROLL_STEP = 30;

/** Caps the first purchase costs. The board's own example: 500 for that first step. */
export const PAYROLL_STEP_BASE_COST = 500;

/**
 * How much dearer each further step is than the one before it.
 *
 * 1.15, so the tenth step costs about 1,760 caps and the twentieth about 7,100. A crew that keeps
 * buying keeps paying more for the same 30 caps of room, which is what stops a late-game stockpile
 * from turning the officer roster into a solved problem. It never stops being purchasable, which
 * is the board's rule: uncapped.
 */
export const PAYROLL_STEP_GROWTH = 1.15;

/** Weeks of an officer's own commitment it costs to let them go, paid in caps on the spot. */
export const DISMISSAL_WEEKS = 5;

export const PayrollStateSchema = z.object({
  /** Start of the last upkeep week already settled. Always a Monday 00:00 UTC once normalised. */
  paidThroughAt: IsoDateTimeSchema,
  /**
   * How many `PAYROLL_STEP` purchases the crew has made.
   *
   * Steps rather than caps, because the price of the next one is a function of how many have been
   * bought and storing the total would make that a second expression of the same fact. Defaulted
   * so a base written before the book existed parses as having bought none.
   */
  purchasedSteps: z.number().int().nonnegative().default(0),
  /**
   * What each officer's contract commits, in caps per week, keyed by officer id.
   *
   * Whole caps: a fee is a number two people agreed on out loud, and the `.int()` is here so a
   * hand-written row cannot smuggle a fraction into the committed total.
   */
  commitments: z.record(IdSchema, z.number().int().nonnegative()).default({}),
});
export type PayrollState = z.infer<typeof PayrollStateSchema>;

export function startingPayroll(now: string): PayrollState {
  return {
    paidThroughAt: startOfPayWeek(new Date(now)).toISOString(),
    purchasedSteps: 0,
    commitments: {},
  };
}

/** Caps per week the crew may commit in total, before the district's own bonus. */
export function basePayrollCapacity(nexusLevel: number, purchasedSteps: number): number {
  return (
    PAYROLL_BASE +
    Math.max(0, Math.trunc(nexusLevel)) * PAYROLL_PER_NEXUS_LEVEL +
    Math.max(0, Math.trunc(purchasedSteps)) * PAYROLL_STEP
  );
}

/**
 * The whole ceiling: the Nexus, what has been bought, and what the district adds on top.
 *
 * `bonusPercent` is `payrollBonusPercent` from `building/standing.ts`, passed in as a plain number
 * so this module never has to know what a building is.
 */
export function payrollCapacity(
  nexusLevel: number,
  purchasedSteps: number,
  bonusPercent = 0,
): number {
  const base = basePayrollCapacity(nexusLevel, purchasedSteps);
  return Math.round(base * (1 + Math.max(0, bonusPercent) / 100));
}

/** What the next `PAYROLL_STEP` costs, given how many have already been bought. */
export function payrollStepCost(purchasedSteps: number): number {
  const bought = Math.max(0, Math.trunc(purchasedSteps));
  return Math.round(PAYROLL_STEP_BASE_COST * PAYROLL_STEP_GROWTH ** bought);
}

/** Caps per week already promised to officers. */
export function committedPayroll(commitments: PayrollState['commitments']): number {
  return Object.values(commitments).reduce((total, fee) => total + fee, 0);
}

/** What letting this officer go costs, in caps, right now. */
export function dismissalFee(weeklyFee: number): number {
  return Math.max(0, Math.round(weeklyFee)) * DISMISSAL_WEEKS;
}

/** The book as a screen shows it: the ceiling, what is spoken for, and what is left. */
export const PayrollLedgerSchema = z.object({
  capacity: z.number().int().nonnegative(),
  committed: z.number().int().nonnegative(),
  available: z.number().int().nonnegative(),
  purchasedSteps: z.number().int().nonnegative(),
  /** Caps the next `Increase Payroll` costs. */
  nextStepCost: z.number().int().positive(),
  /** Caps per week that purchase would add. */
  stepSize: z.number().int().positive(),
});
export type PayrollLedger = z.infer<typeof PayrollLedgerSchema>;

export function payrollLedger(
  payroll: PayrollState,
  nexusLevel: number,
  bonusPercent = 0,
): PayrollLedger {
  const capacity = payrollCapacity(nexusLevel, payroll.purchasedSteps, bonusPercent);
  const committed = committedPayroll(payroll.commitments);
  return {
    capacity,
    committed,
    // Never negative on screen. It can genuinely go negative for a crew that demolished its Nexus
    // with a full book, and a player reading "-40 available" learns nothing they cannot see from
    // the two figures above it.
    available: Math.max(0, capacity - committed),
    purchasedSteps: payroll.purchasedSteps,
    nextStepCost: payrollStepCost(payroll.purchasedSteps),
    stepSize: PAYROLL_STEP,
  };
}

/** Whether one more commitment of this size fits in what is left. */
export function payrollFits(ledger: PayrollLedger, weeklyFee: number): boolean {
  return ledger.committed + Math.max(0, Math.round(weeklyFee)) <= ledger.capacity;
}

// --- the weekly upkeep cycle: food only ---

export interface EconomyCycleInput {
  resources: Resources;
  payroll: PayrollState;
  /** Officers on the books: drives food upkeep (§D1). */
  officerCount: number;
  now: Date;
}

export interface EconomyCycleResult {
  /** Weeks settled by this run. 0 means nothing was owed and nothing changed. */
  weeksSettled: number;
  foodDue: number;
  foodConsumed: number;
  /** Upkeep the store could not cover. Nobody is owed caps: the book is not a bill. */
  foodShortfall: number;
  resources: Resources;
  payroll: PayrollState;
}

/**
 * Settles every week boundary crossed since `payroll.paidThroughAt`: food upkeep down (§D1), and
 * nothing else. Catches up honestly across a long absence and eats what it can when the store is
 * short, reporting the rest.
 */
export function runEconomyCycle({
  resources,
  payroll,
  officerCount,
  now,
}: EconomyCycleInput): EconomyCycleResult {
  const settledThrough = startOfPayWeek(new Date(payroll.paidThroughAt)).getTime();
  const dueThrough = startOfPayWeek(now).getTime();
  // A backwards clock must never claw upkeep back, so the week count floors at zero.
  const weeksSettled = Math.max(0, Math.round((dueThrough - settledThrough) / PAY_WEEK_MS));

  if (weeksSettled === 0) {
    return {
      weeksSettled: 0,
      foodDue: 0,
      foodConsumed: 0,
      foodShortfall: 0,
      resources,
      payroll,
    };
  }

  const foodDue = weeksSettled * foodUpkeepFor(officerCount);
  const foodConsumed = Math.min(resources.food, foodDue);

  return {
    weeksSettled,
    foodDue,
    foodConsumed,
    foodShortfall: foodDue - foodConsumed,
    resources: { ...resources, food: resources.food - foodConsumed },
    payroll: { ...payroll, paidThroughAt: new Date(dueThrough).toISOString() },
  };
}
