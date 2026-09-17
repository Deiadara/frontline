import { z } from 'zod';
import { IdSchema } from '../primitives.js';

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
 * ## Growing it costs caps, and the ladder runs out
 *
 * `Increase Payroll` in the Nexus buys one `PAYROLL_STEP` of standing capacity for a flat price
 * that climbs by the same amount with every step already bought. The price is deliberately far
 * above the step: a step is permanent, so paying twenty weeks of it up front for the first one and
 * a hundred and twenty for the last is what stops the button being an obvious purchase every time
 * a player has spare caps.
 *
 * The ladder has `PAYROLL_STEPS_MAX` rungs and then it stops. A crew that has bought all of them
 * has nothing left to buy here, so `payrollStepCost` answers `null` rather than quoting a price
 * for a purchase that cannot happen, and every screen and route that reads it has to say so.
 *
 * ## Letting somebody go
 *
 * Releasing an officer frees their slice immediately and costs `DISMISSAL_WEEKS` of it in caps on
 * the spot. Firing is meant to be a real decision rather than a way to rotate the roster for free.
 *
 * ## Nothing is charged on a clock
 *
 * There is no weekly draw of any kind left in the game. Officers used to take caps every Monday and
 * the district used to eat supplies on the same boundary; both are gone. A cost a player is not
 * present for is a cost they cannot plan against, and the two of them together meant a crew could
 * come back from a fortnight away poorer than they left with nothing on screen to say why. Every
 * price in the game is now paid at the moment somebody presses something.
 */

// --- the book itself ---

/** What every crew starts with, in caps per week, before a Nexus or a single purchase. */
export const PAYROLL_BASE = 200;

/** Caps per week the Nexus adds per level: the book grows with the district on its own. */
export const PAYROLL_PER_NEXUS_LEVEL = 25;

/** Caps per week one purchase adds. The board's own example: 200 becomes 230. */
export const PAYROLL_STEP = 30;

/** Caps the first purchase costs: twenty weeks of the 30 caps a week it buys. */
export const PAYROLL_STEP_FIRST_COST = 600;

/**
 * How much dearer each further step is than the one before it, in caps.
 *
 * A flat 60 rather than a percentage, so the ladder is a straight line a player can hold in their
 * head: the tenth step costs 1,140 and the fiftieth 3,540, and the difference between any two
 * neighbours is always the same 60. The old curve compounded at 15% and ran to six figures by the
 * thirtieth rung, which priced the late game out of a mechanic it was supposed to still be using.
 */
export const PAYROLL_STEP_COST_RISE = 60;

/**
 * How many rungs the ladder has, and then there is nothing more to buy.
 *
 * Fifty-one, whose price is 3,600. That buys 1,530 caps a week of standing capacity on top of the
 * Nexus and the district, for 107,100 caps across the whole ladder, which is a target a crew can
 * actually finish rather than an asymptote it pays into forever.
 *
 * The ceiling is on *buying*, not on holding. A book that already sits above it keeps every cap of
 * what it has; it simply cannot widen further.
 */
export const PAYROLL_STEPS_MAX = 51;

/**
 * Weeks of an officer's own commitment it costs to let them go, paid in caps on the spot.
 *
 * Ten, at the board's rate: an officer on 30 caps a week costs 300 to release. Doubled from five,
 * and the reason is what the book is *for*. Committing costs nothing and releasing is the only
 * thing that walks it back, so the fee is the whole difference between a payroll and a scratch pad
 * a crew rewrites every time a better sheet walks into the Bar. At five weeks the sums worked out
 * in the player's favour too often: sign, try, release, sign again.
 */
export const DISMISSAL_WEEKS = 10;

export const PayrollStateSchema = z.object({
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

export function startingPayroll(): PayrollState {
  return { purchasedSteps: 0, commitments: {} };
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

/**
 * What the next `PAYROLL_STEP` costs, given how many have already been bought, or `null` when the
 * ladder has run out.
 *
 * `null` rather than a number nobody may pay. The alternative was to keep quoting the last rung's
 * price and refuse it at the till, which puts a live figure in front of a player on a button that
 * cannot work, and leaves every caller free to forget the ceiling exists. A nullable answer makes
 * the compiler walk the screens.
 *
 * `discountPercent` is `payrollStepDiscountPercent` off `CrewEffects`: the perk channel for
 * officers who make widening the book cheaper. Passed in as a plain number so this module never
 * has to know what a crew is, the same way `payrollCapacity` takes its bonus.
 */
export function payrollStepCost(purchasedSteps: number, discountPercent = 0): number | null {
  const bought = Math.max(0, Math.trunc(purchasedSteps));
  if (bought >= PAYROLL_STEPS_MAX) return null;
  const full = PAYROLL_STEP_FIRST_COST + bought * PAYROLL_STEP_COST_RISE;
  const off = Math.min(MAX_PAYROLL_STEP_DISCOUNT, Math.max(0, discountPercent));
  // At least one cap, so no stack of perks makes widening the book free.
  return Math.max(1, Math.round(full * (1 - off / 100)));
}

/** However many ledger clerks a crew hires, the next step still costs something. */
export const MAX_PAYROLL_STEP_DISCOUNT = 60;

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
  /**
   * Caps the next `Increase Payroll` costs, or `null` once the ladder is bought out.
   *
   * Nullable rather than a companion `stepsRemaining` beside a number that keeps lying. The price
   * and whether there is anything to price are one fact, and the payroll state already refuses to
   * hold the same fact twice: `purchasedSteps` is stored instead of the total it implies for
   * exactly this reason.
   */
  nextStepCost: z.number().int().positive().nullable(),
  /** Caps per week that purchase would add. */
  stepSize: z.number().int().positive(),
});
export type PayrollLedger = z.infer<typeof PayrollLedgerSchema>;

export function payrollLedger(
  payroll: PayrollState,
  nexusLevel: number,
  bonusPercent = 0,
  stepDiscountPercent = 0,
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
    nextStepCost: payrollStepCost(payroll.purchasedSteps, stepDiscountPercent),
    stepSize: PAYROLL_STEP,
  };
}

/** Whether one more commitment of this size fits in what is left. */
export function payrollFits(ledger: PayrollLedger, weeklyFee: number): boolean {
  return ledger.committed + Math.max(0, Math.round(weeklyFee)) <= ledger.capacity;
}
