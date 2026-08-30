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
 * What the next `PAYROLL_STEP` costs, given how many have already been bought.
 *
 * `discountPercent` is `payrollStepDiscountPercent` off `CrewEffects`: the perk channel for
 * officers who make widening the book cheaper. Passed in as a plain number so this module never
 * has to know what a crew is, the same way `payrollCapacity` takes its bonus.
 */
export function payrollStepCost(purchasedSteps: number, discountPercent = 0): number {
  const bought = Math.max(0, Math.trunc(purchasedSteps));
  const full = PAYROLL_STEP_BASE_COST * PAYROLL_STEP_GROWTH ** bought;
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
