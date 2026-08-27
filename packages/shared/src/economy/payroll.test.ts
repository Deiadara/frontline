import { describe, expect, it } from 'vitest';
import {
  DISMISSAL_WEEKS,
  PAYROLL_BASE,
  PAYROLL_STEP,
  PAYROLL_STEP_BASE_COST,
  committedPayroll,
  dismissalFee,
  payrollCapacity,
  payrollFits,
  payrollLedger,
  payrollStepCost,
  startingPayroll,
  PayrollStateSchema,
} from './payroll.js';

describe('the payroll book (§H7)', () => {
  it('starts every crew at the same standing figure', () => {
    expect(payrollCapacity(0, 0)).toBe(PAYROLL_BASE);
  });

  it('grows with the Nexus, with what has been bought, and with the district', () => {
    expect(payrollCapacity(4, 0)).toBeGreaterThan(payrollCapacity(0, 0));
    expect(payrollCapacity(0, 1)).toBe(PAYROLL_BASE + PAYROLL_STEP);
    expect(payrollCapacity(0, 0, 10)).toBe(Math.round(PAYROLL_BASE * 1.1));
  });

  /**
   * The board's own example: at a book of 200, buying the step that takes it to 230 costs 500
   * caps. That is about seventeen weeks of the step, and it is meant to be: the step is permanent.
   */
  it('prices the first step the way the board priced it', () => {
    expect(payrollStepCost(0)).toBe(PAYROLL_STEP_BASE_COST);
    expect(payrollStepCost(0)).toBeGreaterThan(PAYROLL_STEP * 10);
  });

  it('charges more for every further step, without ever refusing one', () => {
    let previous = 0;
    for (const steps of [0, 1, 2, 5, 10, 25, 50]) {
      const cost = payrollStepCost(steps);
      expect(cost, `${steps} steps`).toBeGreaterThan(previous);
      expect(Number.isFinite(cost), `${steps} steps`).toBe(true);
      previous = cost;
    }
  });

  it('reports what is spoken for and what is left', () => {
    const payroll = { ...startingPayroll(), commitments: { a: 60, b: 40 } };
    const ledger = payrollLedger(payroll, 0);
    expect(ledger.committed).toBe(100);
    expect(ledger.available).toBe(PAYROLL_BASE - 100);
    expect(committedPayroll(payroll.commitments)).toBe(100);
  });

  it('never reports a negative remainder, however far over the book a crew is', () => {
    const payroll = { ...startingPayroll(), commitments: { a: PAYROLL_BASE + 500 } };
    expect(payrollLedger(payroll, 0).available).toBe(0);
  });

  /** The one rule the whole book exists to enforce: you cannot promise what you do not have. */
  it('refuses a commitment that does not fit in what is left', () => {
    const ledger = payrollLedger({ ...startingPayroll(), commitments: { a: 150 } }, 0);
    expect(payrollFits(ledger, PAYROLL_BASE - 150)).toBe(true);
    expect(payrollFits(ledger, PAYROLL_BASE - 149)).toBe(false);
  });

  it('charges five weeks of the fee to let somebody go', () => {
    expect(dismissalFee(50)).toBe(50 * DISMISSAL_WEEKS);
    expect(dismissalFee(0)).toBe(0);
  });
});

/**
 * Nothing in the game is charged on a clock, and this is the guard on that.
 *
 * The payroll module is where every recurring draw lived: caps every Monday, then supplies every
 * Monday after the caps went. Both are gone, and what pins it is the *state*: a book with no
 * settled-through date has nothing for a cycle to catch up from, so a reinstated weekly draw
 * cannot be written without changing this shape and failing here.
 *
 * `DISMISSAL_WEEKS` is deliberately not caught by this. Weeks are still the unit a fee is quoted
 * in; what is gone is anything that comes due on its own.
 */
describe('nothing recurs', () => {
  it('starts a crew with a book and no settled-through date', () => {
    expect(startingPayroll()).toEqual({ purchasedSteps: 0, commitments: {} });
  });

  it('keeps no timestamp on the book, so there is nothing to settle from', () => {
    const shape = Object.keys(PayrollStateSchema.shape);
    expect(shape).toEqual(['purchasedSteps', 'commitments']);
  });

  it('has dropped the weekly cycle outright', async () => {
    const payroll = await import('./payroll.js');
    for (const gone of [
      'runEconomyCycle',
      'foodUpkeepFor',
      'suppliesUpkeepFor',
      'startOfPayWeek',
      'PAY_WEEK_MS',
    ]) {
      expect(payroll, gone).not.toHaveProperty(gone);
    }
  });
});
